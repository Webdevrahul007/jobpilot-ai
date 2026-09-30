import type { Page } from "playwright";
import { LinkedInSelectors, LinkedInUrls } from "./LinkedInSelectors.js";
import type { LoginResult, SessionCheckResult, StorageState } from "../types/automation.types.js";
import { logger } from "../utils/logger.js";
import { humanType, longDelay, mediumDelay, shortDelay, randomDelay } from "../utils/delay.js";

/**
 * LinkedInAuth — handles all LinkedIn authentication flows.
 *
 * Responsibilities:
 * - Login with email + password
 * - Detect and report challenges (CAPTCHA, security check, email verification)
 * - Check if a page context is already logged in
 * - Logout cleanly
 *
 * Does NOT manage browser lifecycle — that's BrowserManager's job.
 * Receives a Playwright Page and works with it.
 */
export class LinkedInAuth {
  private readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  // ── Login ──────────────────────────────────────────────────────────────────

  /**
   * Full login flow. Returns success + storageState on success,
   * or a descriptive error if login failed or was challenged.
   */
  async login(email: string, password: string): Promise<LoginResult> {
    logger.info("Starting LinkedIn login", { email });

    try {
      // Check if we're already logged in (e.g. session was pre-loaded)
      const alreadyLoggedIn = await this.isLoggedIn();
      if (alreadyLoggedIn) {
        logger.info("Already logged in — skipping login form");
        const sessionData = await this.captureStorageState();
        return { success: true, sessionData };
      }

      // Navigate to login page
      await this.navigateToLogin();

      // Fill credentials
      await this.fillEmail(email);
      await mediumDelay();
      await this.fillPassword(password);
      await shortDelay();

      // Submit
      await this.clickSignIn();

      // Wait for navigation to settle
      await this.page.waitForLoadState("networkidle", { timeout: 15_000 });
      await longDelay();

      // Analyse what happened after submit
      return await this.analysePostLoginState();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("Login failed with exception", { error: message });
      return { success: false, error: `Login exception: ${message}` };
    }
  }

  // ── Session Check ──────────────────────────────────────────────────────────

  /**
   * Check if the current browser context is authenticated.
   * Uses the global nav as the indicator — it only renders when logged in.
   */
  async isLoggedIn(): Promise<boolean> {
    try {
      const currentUrl = this.page.url();

      // If we're on a login/checkpoint page we're definitely not logged in
      if (
        currentUrl.includes("/login") ||
        currentUrl.includes("/checkpoint") ||
        currentUrl === "about:blank"
      ) {
        return false;
      }

      // Navigate to feed if we're not already on a LinkedIn page
      if (!currentUrl.includes("linkedin.com")) {
        await this.page.goto(LinkedInUrls.FEED, {
          waitUntil: "domcontentloaded",
          timeout: 15_000,
        });
      }

      // Check for global nav — the definitive logged-in indicator
      const navVisible = await this.page
        .locator(LinkedInSelectors.FEED.GLOBAL_NAV)
        .isVisible({ timeout: 5_000 })
        .catch(() => false);

      return navVisible;
    } catch {
      return false;
    }
  }

  /**
   * Check login state and extract the username if logged in.
   * Used by the API to report session status.
   */
  async checkSession(): Promise<SessionCheckResult> {
    try {
      await this.page.goto(LinkedInUrls.FEED, {
        waitUntil: "domcontentloaded",
        timeout: 15_000,
      });

      const isLoggedIn = await this.isLoggedIn();
      if (!isLoggedIn) return { isLoggedIn: false };

      // Try to extract display name from the nav
      const username = await this.extractUsername();
      return { isLoggedIn: true, ...(username !== undefined && { username }) };
    } catch {
      return { isLoggedIn: false };
    }
  }

  // ── Logout ─────────────────────────────────────────────────────────────────

  async logout(): Promise<void> {
    logger.info("Logging out of LinkedIn");

    try {
      // LinkedIn logout endpoint — works without UI interaction
      await this.page.goto("https://www.linkedin.com/m/logout/", {
        waitUntil: "domcontentloaded",
        timeout: 10_000,
      });

      await mediumDelay();
      logger.info("Logout successful");
    } catch (err) {
      logger.warn("Logout navigation failed (session may already be expired)", {
        err,
      });
    }
  }

  // ── Capture state ──────────────────────────────────────────────────────────

  /**
   * Serialize the current browser context's cookies + localStorage.
   * This is what gets saved to the database and restored later.
   */
  async captureStorageState(): Promise<StorageState> {
    const state = await this.page.context().storageState();
    return state as StorageState;
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private async navigateToLogin(): Promise<void> {
    logger.debug("Navigating to LinkedIn login page");

    await this.page.goto(LinkedInUrls.LOGIN, {
      waitUntil: "domcontentloaded",
      timeout: 20_000,
    });

    // Wait for email input to be ready
    await this.page
      .locator(LinkedInSelectors.LOGIN.EMAIL_INPUT)
      .waitFor({ state: "visible", timeout: 10_000 });

    await shortDelay();
  }

  private async fillEmail(email: string): Promise<void> {
    logger.debug("Filling email field");

    const emailField = this.page.locator(LinkedInSelectors.LOGIN.EMAIL_INPUT);
    await emailField.click();
    await shortDelay();

    // Type character by character — randomised delay per keystroke
    await humanType(async (char: string) => {
      await this.page.keyboard.type(char);
    }, email);
  }

  private async fillPassword(password: string): Promise<void> {
    logger.debug("Filling password field");

    const passwordField = this.page.locator(
      LinkedInSelectors.LOGIN.PASSWORD_INPUT
    );
    await passwordField.click();
    await shortDelay();

    await humanType(async (char: string) => {
      await this.page.keyboard.type(char);
    }, password);
  }

  private async clickSignIn(): Promise<void> {
    logger.debug("Clicking sign in button");

    // Try the primary selector first, fall back to generic submit
    const primaryBtn = this.page.locator(LinkedInSelectors.LOGIN.SUBMIT_BUTTON);
    const fallbackBtn = this.page.locator(
      LinkedInSelectors.LOGIN.SUBMIT_BUTTON_FALLBACK
    );

    const primaryVisible = await primaryBtn.isVisible().catch(() => false);

    if (primaryVisible) {
      await primaryBtn.click();
    } else {
      await fallbackBtn.first().click();
    }
  }

  /**
   * Called after the sign-in click and page settle.
   * Inspects the current URL and DOM to determine what happened.
   */
  private async analysePostLoginState(): Promise<LoginResult> {
    const currentUrl = this.page.url();
    logger.debug("Analysing post-login state", { url: currentUrl });

    // ── Success: landed on feed or home ──────────────────────────────────────
    if (
      currentUrl.includes("/feed") ||
      currentUrl === LinkedInUrls.BASE + "/" ||
      currentUrl.includes("/mynetwork")
    ) {
      logger.info("Login successful");
      const sessionData = await this.captureStorageState();
      return { success: true, sessionData };
    }

    // ── CAPTCHA challenge ─────────────────────────────────────────────────────
    if (currentUrl.includes("/checkpoint/challenge")) {
      const hasCaptcha = await this.page
        .locator(LinkedInSelectors.LOGIN.CAPTCHA_CONTAINER)
        .isVisible({ timeout: 3_000 })
        .catch(() => false);

      if (hasCaptcha) {
        logger.warn("CAPTCHA challenge detected — manual intervention required");
        return {
          success: false,
          error: "CAPTCHA_REQUIRED: LinkedIn is showing a CAPTCHA. Open the browser manually, solve it, then retry.",
        };
      }
    }

    // ── Security / email verification ────────────────────────────────────────
    if (
      currentUrl.includes("/checkpoint") ||
      currentUrl.includes("/challenge")
    ) {
      const hasVerification = await this.page
        .locator(LinkedInSelectors.LOGIN.VERIFICATION_CHALLENGE)
        .isVisible({ timeout: 3_000 })
        .catch(() => false);

      if (hasVerification) {
        logger.warn("Email verification challenge detected");
        return {
          success: false,
          error: "VERIFICATION_REQUIRED: LinkedIn sent a verification email/SMS. Complete verification manually then retry.",
        };
      }

      // Generic checkpoint — covers new security checks LinkedIn adds over time
      logger.warn("Unknown checkpoint detected", { url: currentUrl });
      return {
        success: false,
        error: `CHECKPOINT: LinkedIn stopped login at: ${currentUrl}. Manual action required.`,
      };
    }

    // ── Wrong credentials error ───────────────────────────────────────────────
    if (currentUrl.includes("/login")) {
      const errorText = await this.page
        .locator(LinkedInSelectors.LOGIN.ERROR_MESSAGE)
        .textContent({ timeout: 3_000 })
        .catch(() => null);

      const message = errorText?.trim() ?? "Unknown error on login page";
      logger.error("Login failed — credential error", { message });
      return {
        success: false,
        error: `CREDENTIAL_ERROR: ${message}`,
      };
    }

    // ── Unexpected URL — try to detect nav anyway ─────────────────────────────
    await randomDelay(1000, 2000);
    const navPresent = await this.page
      .locator(LinkedInSelectors.FEED.GLOBAL_NAV)
      .isVisible({ timeout: 5_000 })
      .catch(() => false);

    if (navPresent) {
      logger.info("Login successful (via nav detection)", { url: currentUrl });
      const sessionData = await this.captureStorageState();
      return { success: true, sessionData };
    }

    logger.error("Login result unknown", { url: currentUrl });
    return {
      success: false,
      error: `UNKNOWN: Unexpected URL after login: ${currentUrl}`,
    };
  }

  private async extractUsername(): Promise<string | undefined> {
    try {
      // Profile nav item shows the display name as aria-label
      const profileItem = this.page.locator(
        LinkedInSelectors.FEED.PROFILE_NAV_ITEM
      );
      const ariaLabel = await profileItem
        .getAttribute("aria-label", { timeout: 3_000 })
        .catch(() => null);

      if (ariaLabel) {
        // aria-label is typically "Profile for Rahul Jangid"
        return ariaLabel.replace(/^Profile for /i, "").trim();
      }

      return undefined;
    } catch {
      return undefined;
    }
  }
}

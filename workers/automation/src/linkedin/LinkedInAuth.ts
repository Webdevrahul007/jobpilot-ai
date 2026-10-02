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

      // Wait for URL to change away from /login
      // Don't use networkidle — LinkedIn keeps background connections open
      try {
        await this.page.waitForURL(
          (url) =>
            !url.toString().includes("/login") &&
            url.toString().includes("linkedin.com"),
          { timeout: 20_000 }
        );
      } catch {
        // URL didn't change — still check DOM state below
        await randomDelay(3000, 5000);
      }

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
      } else if (!currentUrl.includes("/feed") && !currentUrl.includes("/in/") && !currentUrl.includes("/jobs")) {
        // Already on LinkedIn but not a logged-in page — go to feed
        await this.page.goto(LinkedInUrls.FEED, {
          waitUntil: "domcontentloaded",
          timeout: 15_000,
        });
      }

      await this.page.waitForTimeout(2000);
      const finalUrl = this.page.url();

      // If we landed on feed or any authenticated page → logged in
      if (
        finalUrl.includes("/feed") ||
        finalUrl.includes("/in/") ||
        finalUrl.includes("/mynetwork") ||
        finalUrl.includes("/jobs") ||
        finalUrl.includes("/messaging") ||
        finalUrl.includes("/notifications")
      ) {
        return true;
      }

      // If redirected back to login → not logged in
      if (finalUrl.includes("/login") || finalUrl.includes("/checkpoint")) {
        return false;
      }

      // Fallback: check for any LinkedIn nav element
      const navVisible = await this.page
        .locator([
          LinkedInSelectors.FEED.GLOBAL_NAV,
          "nav[aria-label]",
          ".scaffold-layout__main",
          "main.scaffold-layout__main",
          "[data-test-id]",
        ].join(", "))
        .first()
        .isVisible({ timeout: 3_000 })
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

      await this.page.waitForTimeout(2000);
      const finalUrl = this.page.url();

      // URL-based check — most reliable across LinkedIn UI versions
      const isLoggedIn =
        finalUrl.includes("/feed") ||
        finalUrl.includes("/in/") ||
        finalUrl.includes("/mynetwork") ||
        finalUrl.includes("/jobs") ||
        finalUrl.includes("/messaging");

      if (!isLoggedIn) return { isLoggedIn: false };

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
      timeout: 30_000,
    });

    // Wait for page to settle
    await randomDelay(1500, 2500);

    // ── Dismiss Google One-Tap popup ──────────────────────────────────────────
    // LinkedIn shows a "Continue as X" Google popup that blocks the form.
    // We must close it before interacting with email/password fields.
    await this.dismissGoogleOneTap();

    // Wait for email field to be in DOM
    const emailSelector = `input[autocomplete="username"], #username, input[name="session_key"], input[type="email"]`;
    await this.page
      .locator(emailSelector)
      .first()
      .waitFor({ state: "attached", timeout: 10_000 });

    await shortDelay();
  }

  /**
   * Dismiss the Google One-Tap / "Continue as" popup that LinkedIn shows.
   * This popup overlays the login form and blocks input interaction.
   *
   * Multiple dismissal strategies tried in order:
   * 1. Click the "✕" close button on the Google popup
   * 2. Press Escape key
   * 3. Click outside the popup
   */
  private async dismissGoogleOneTap(): Promise<void> {
    const closeSelectors = [
      // Google One-Tap close button
      '#credential_picker_container iframe',
      'div[id="credential_picker_container"] [aria-label="Close"]',
      '[aria-label="Close"]',
      // LinkedIn's own "Sign in with Google" dismiss
      'button[aria-label*="Dismiss"]',
      'button[aria-label*="dismiss"]',
    ];

    // First try: press Escape — fastest and most reliable
    await this.page.keyboard.press("Escape");
    await randomDelay(500, 800);

    // Check if popup is still showing inside an iframe
    const frames = this.page.frames();
    for (const frame of frames) {
      if (frame.url().includes("accounts.google.com")) {
        try {
          const closeBtn = frame.locator('[aria-label="Close"], button:has-text("×"), button:has-text("✕")').first();
          if (await closeBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
            await closeBtn.click();
            await shortDelay();
            logger.debug("Closed Google iframe popup");
            return;
          }
        } catch {
          // continue
        }
      }
    }

    // Check if popup is in main page DOM
    for (const sel of closeSelectors) {
      const el = this.page.locator(sel).first();
      if (await el.isVisible({ timeout: 500 }).catch(() => false)) {
        await el.click().catch(() => null);
        await shortDelay();
        logger.debug("Dismissed Google One-Tap via selector", { sel });
        return;
      }
    }

    // Last resort: click top-left corner (outside any popup)
    await this.page.mouse.click(10, 10);
    await randomDelay(500, 800);
    logger.debug("Dismissed popup via background click");
  }

  private async fillEmail(email: string): Promise<void> {
    logger.debug("Filling email field");

    const emailSelector = `input[autocomplete="username"], #username, input[name="session_key"], input[type="email"]`;

    // page.evaluate sets value via JS — works regardless of CSS visibility
    const filled = await this.page.evaluate(
      ([sel, val]: [string, string]) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const g = globalThis as any;
        const input = g.document.querySelector(sel);
        if (!input) return false;
        // React-compatible: use native setter so React detects the change
        const nativeSetter = Object.getOwnPropertyDescriptor(
          Object.getPrototypeOf(input), "value"
        )?.set;
        if (nativeSetter) nativeSetter.call(input, val);
        else input.value = val;
        input.dispatchEvent(new g.Event("input",  { bubbles: true }));
        input.dispatchEvent(new g.Event("change", { bubbles: true }));
        input.dispatchEvent(new g.KeyboardEvent("keyup", { bubbles: true }));
        return input.value === val;
      },
      [emailSelector, email] as [string, string]
    );

    logger.debug("Email filled via JS evaluate", { filled });
    await shortDelay();
  }

  private async fillPassword(password: string): Promise<void> {
    logger.debug("Filling password field");

    const pwSelector = `input[autocomplete="current-password"], #password, input[name="session_password"], input[type="password"]`;

    const filled = await this.page.evaluate(
      ([sel, val]: [string, string]) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const g = globalThis as any;
        const input = g.document.querySelector(sel);
        if (!input) return false;
        const nativeSetter = Object.getOwnPropertyDescriptor(
          Object.getPrototypeOf(input), "value"
        )?.set;
        if (nativeSetter) nativeSetter.call(input, val);
        else input.value = val;
        input.dispatchEvent(new g.Event("input",  { bubbles: true }));
        input.dispatchEvent(new g.Event("change", { bubbles: true }));
        input.dispatchEvent(new g.KeyboardEvent("keyup", { bubbles: true }));
        return input.value === val;
      },
      [pwSelector, password] as [string, string]
    );

    logger.debug("Password filled via JS evaluate", { filled });
    await shortDelay();
  }

  private async clickSignIn(): Promise<void> {
    logger.debug("Clicking sign in button");

    // LinkedIn uses type="button" not type="submit" on the Sign in button
    // Find by text content "Sign in" inside the form
    const clicked = await this.page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const g = globalThis as any;
      const doc = g.document;

      // Strategy: find button containing "Sign in" text
      const allButtons = Array.from(doc.querySelectorAll("button")) as unknown as Array<{innerText: string; click: () => void}>;
      const signInBtn = allButtons.find((btn) => {
        const text = btn.innerText?.trim().toLowerCase();
        return text === "sign in";
      });

      if (signInBtn) {
        signInBtn.click();
        return true;
      }
      return false;
    });

    logger.debug("Sign in button clicked via JS", { clicked });

    if (!clicked) {
      // Fallback: Enter key
      await this.page.keyboard.press("Enter");
      logger.debug("Used Enter key fallback");
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

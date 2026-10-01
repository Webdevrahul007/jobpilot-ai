import path from "path";
import fs from "fs";
import type { Page } from "playwright";
import { LinkedInSelectors } from "./LinkedInSelectors.js";
import type { SubmitResult, SubmitOutcome } from "../types/automation.types.js";
import { logger } from "../utils/logger.js";
import { longDelay, mediumDelay, randomDelay, shortDelay } from "../utils/delay.js";

/**
 * LinkedInSubmitter — handles the final step of Easy Apply:
 * clicking Submit and confirming the application was sent.
 *
 * Pre-condition:  Easy Apply modal is open on the Review step
 *                 (LinkedInFormFiller.fillAllSteps() has completed successfully)
 * Post-condition: success → modal closed, application confirmed
 *                 failure → screenshot saved, modal dismissed
 *
 * Submit flow:
 * 1. Locate the "Submit application" button on the Review step
 * 2. Click it
 * 3. Wait for either the success screen or an error to appear
 * 4. Confirm success by checking for the confirmation heading/panel
 * 5. Dismiss the success screen cleanly
 * 6. On any failure: take a screenshot, dismiss the modal, return error
 *
 * Why a separate class from FormFiller?
 * Submit is a side-effecting, irreversible operation. Keeping it isolated
 * means we can test form filling independently (Phase 6) and add retry
 * logic or safety checks at the submit boundary without touching form logic.
 */
export class LinkedInSubmitter {
  private readonly page: Page;
  private readonly screenshotDir: string;

  constructor(page: Page, screenshotDir: string) {
    this.page = page;
    this.screenshotDir = screenshotDir;
    this.ensureScreenshotDir();
  }

  // ── Public ──────────────────────────────────────────────────────────────

  /**
   * Click Submit and confirm the outcome.
   * The modal must already be on the Review step before calling this.
   */
  async submit(jobId: string): Promise<SubmitResult> {
    logger.info("Attempting application submit", { jobId });

    try {
      // ── 1. Locate Submit button ──────────────────────────────────────
      const submitBtn = await this.findSubmitButton();
      if (!submitBtn) {
        logger.warn("Submit button not found — not on Review step", { jobId });
        return {
          success: false,
          jobId,
          outcome: "MODAL_NOT_OPEN",
          error: "Submit button not found. Modal may not be on the Review step.",
        };
      }

      // ── 2. Click Submit ──────────────────────────────────────────────
      logger.info("Clicking Submit application button", { jobId });
      await shortDelay();
      await submitBtn.click();

      // Wait for the page to react
      await this.page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => null);
      await mediumDelay();

      // ── 3. Detect outcome ────────────────────────────────────────────
      const outcome = await this.detectOutcome();
      logger.info("Submit outcome", { jobId, outcome });

      if (outcome === "SUCCESS") {
        await this.handleSuccessScreen();
        return { success: true, jobId, outcome: "SUCCESS" };
      }

      // ── 4. Failure — screenshot + dismiss ────────────────────────────
      const screenshotPath = await this.takeScreenshot(jobId);
      await this.dismissModal();

      const errorMessage = await this.getErrorText();

      return {
        success: false,
        jobId,
        outcome,
        ...(screenshotPath !== undefined && { screenshotPath }),
        error: errorMessage || `Submit failed with outcome: ${outcome}`,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("Submit threw exception", { jobId, error: message });

      const isSessionExpired =
        message.includes("SESSION_EXPIRED") ||
        this.page.url().includes("/login") ||
        this.page.url().includes("/checkpoint");

      const screenshotPath = await this.takeScreenshot(jobId).catch(() => undefined);
      await this.dismissModal().catch(() => null);

      return {
        success: false,
        jobId,
        outcome: isSessionExpired ? "SESSION_EXPIRED" : "ERROR",
        ...(screenshotPath !== undefined && { screenshotPath }),
        error: message,
      };
    }
  }

  // ── Private ──────────────────────────────────────────────────────────────

  private async findSubmitButton(): Promise<import("playwright").Locator | null> {
    const selectors = [
      LinkedInSelectors.EASY_APPLY.SUBMIT_BUTTON,
      'button[aria-label="Submit application"]',
      'button:has-text("Submit application")',
      // Some modal variants show "Submit" without "application"
      '.jobs-easy-apply-content button:has-text("Submit")',
    ];

    for (const sel of selectors) {
      const btn = this.page.locator(sel).first();
      const visible = await btn.isVisible({ timeout: 2_000 }).catch(() => false);
      if (visible) return btn;
    }
    return null;
  }

  /**
   * After clicking Submit, inspect the page to determine what happened.
   *
   * LinkedIn shows one of:
   * a) Success panel ("Your application was sent to...")
   * b) "Already applied" message (LinkedIn caught it)
   * c) Validation errors (required field was missed)
   * d) Modal still open on same step (submit silently failed)
   * e) Redirected to login (session expired)
   */
  private async detectOutcome(): Promise<SubmitOutcome> {
    const currentUrl = this.page.url();

    // Session expired
    if (currentUrl.includes("/login") || currentUrl.includes("/checkpoint")) {
      return "SESSION_EXPIRED";
    }

    // Success confirmation panel
    const successSelectors = [
      LinkedInSelectors.SUBMIT_SUCCESS.HEADING,
      LinkedInSelectors.SUBMIT_SUCCESS.CONFIRMATION,
      // Additional patterns LinkedIn uses
      'h2:has-text("sent")',
      '.post-apply-timeline',
      '.jobs-applied-confirmation',
      '[data-test-id="application-confirmation"]',
    ];

    for (const sel of successSelectors) {
      const visible = await this.page
        .locator(sel)
        .first()
        .isVisible({ timeout: 3_000 })
        .catch(() => false);
      if (visible) return "SUCCESS";
    }

    // Already applied message
    const alreadyAppliedTexts = [
      "already applied",
      "you've applied",
      "application already submitted",
    ];
    const pageText = await this.page
      .locator(".jobs-easy-apply-content, .artdeco-modal__content")
      .first()
      .textContent({ timeout: 2_000 })
      .catch(() => "");

    if (
      alreadyAppliedTexts.some((t) =>
        pageText?.toLowerCase().includes(t)
      )
    ) {
      return "ALREADY_APPLIED";
    }

    // Validation errors still showing
    const hasErrors = await this.page
      .locator(LinkedInSelectors.EASY_APPLY.ERROR_SUMMARY)
      .first()
      .isVisible({ timeout: 1_500 })
      .catch(() => false);
    if (hasErrors) return "SUBMIT_ERROR";

    // Modal still open — submit may have been blocked silently
    const modalOpen = await this.page
      .locator(LinkedInSelectors.EASY_APPLY.MODAL)
      .first()
      .isVisible({ timeout: 1_500 })
      .catch(() => false);
    if (modalOpen) return "SUBMIT_ERROR";

    // Wait a bit more and check again for success (slow page render)
    await randomDelay(2000, 3000);
    for (const sel of successSelectors) {
      const visible = await this.page
        .locator(sel)
        .first()
        .isVisible({ timeout: 2_000 })
        .catch(() => false);
      if (visible) return "SUCCESS";
    }

    return "ERROR";
  }

  /**
   * Cleanly close the post-application success screen.
   */
  private async handleSuccessScreen(): Promise<void> {
    await shortDelay();

    // Click "Done" or "Dismiss" to close the confirmation
    const doneBtn = this.page
      .locator(LinkedInSelectors.SUBMIT_SUCCESS.DONE_BUTTON)
      .first();
    const doneVisible = await doneBtn.isVisible({ timeout: 3_000 }).catch(() => false);
    if (doneVisible) {
      await doneBtn.click();
      await shortDelay();
    }

    // Dismiss save-job prompt if it appears
    const savePrompt = this.page.locator(LinkedInSelectors.SUBMIT_SUCCESS.SAVE_PROMPT).first();
    const saveVisible = await savePrompt.isVisible({ timeout: 2_000 }).catch(() => false);
    if (saveVisible) {
      await this.page.keyboard.press("Escape");
    }

    logger.info("Success screen dismissed");
  }

  private async getErrorText(): Promise<string> {
    const errors = await this.page
      .locator(LinkedInSelectors.EASY_APPLY.ERROR_SUMMARY)
      .allTextContents()
      .catch(() => [] as string[]);
    return errors.join("; ").trim();
  }

  /**
   * Take a screenshot and save it to the screenshots directory.
   * Returns the absolute file path, or undefined if capture failed.
   */
  async takeScreenshot(jobId: string): Promise<string | undefined> {
    try {
      const filename = `${jobId}_${Date.now()}.png`;
      const filePath = path.join(this.screenshotDir, filename);
      await this.page.screenshot({ path: filePath, fullPage: false });
      logger.info("Screenshot saved", { path: filePath });
      return filePath;
    } catch (err) {
      logger.warn("Failed to take screenshot", { error: err });
      return undefined;
    }
  }

  /**
   * Dismiss the Easy Apply modal cleanly after a failed submit.
   */
  async dismissModal(): Promise<void> {
    try {
      const closeBtn = this.page
        .locator(LinkedInSelectors.EASY_APPLY.CLOSE_BUTTON)
        .first();
      const visible = await closeBtn.isVisible({ timeout: 2_000 }).catch(() => false);

      if (visible) {
        await closeBtn.click();
        await shortDelay();

        const discardBtn = this.page
          .locator(LinkedInSelectors.EASY_APPLY.DISCARD_CONFIRM_BUTTON)
          .first();
        const discardVisible = await discardBtn
          .isVisible({ timeout: 2_000 })
          .catch(() => false);
        if (discardVisible) {
          await discardBtn.click();
          await shortDelay();
        }
      }
    } catch {
      // Non-fatal
    }
  }

  private ensureScreenshotDir(): void {
    if (!fs.existsSync(this.screenshotDir)) {
      fs.mkdirSync(this.screenshotDir, { recursive: true });
    }
  }
}

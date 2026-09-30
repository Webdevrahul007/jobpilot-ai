import fs from "fs";
import type { Page } from "playwright";
import { LinkedInSelectors } from "./LinkedInSelectors.js";
import type { ResumeUploadResult } from "../types/automation.types.js";
import { logger } from "../utils/logger.js";
import { longDelay, mediumDelay, randomDelay, shortDelay } from "../utils/delay.js";

/**
 * LinkedInResumeUploader
 *
 * Handles everything inside the Easy Apply modal related to resume:
 *   1. Click the "Easy Apply" button → open modal
 *   2. Detect which resume scenario LinkedIn is showing:
 *      a) Fresh upload field  → upload the PDF directly
 *      b) Existing resume card → keep it if it's our file, else replace
 *      c) No resume field      → step doesn't require a resume, skip
 *   3. After handling resume, click "Next" to advance the modal
 *   4. Return a typed result so the caller knows what happened
 *
 * IMPORTANT: This class handles ONLY the resume step.
 * It does NOT fill other form fields (Phase 6) or submit (Phase 7).
 * After openAndUploadResume() returns successfully the modal is open,
 * on the step after resume, ready for Phase 6 to fill remaining fields.
 *
 * Design decisions:
 * - We always prefer uploading our own file over relying on LinkedIn's
 *   cached version — guarantees the right resume is attached even if
 *   a previous user session uploaded something different.
 * - setInputFiles() is used directly on the hidden <input type="file">
 *   instead of clicking the label — more reliable across headless/headed.
 * - Modal is dismissed cleanly on any failure so the browser context
 *   stays usable for the next job.
 */
export class LinkedInResumeUploader {
  private readonly page: Page;
  private readonly resumeFilePath: string;
  private readonly resumeFileName: string;

  constructor(page: Page, resumeFilePath: string) {
    if (!fs.existsSync(resumeFilePath)) {
      throw new Error(
        `Resume file not found: ${resumeFilePath}. ` +
        `Place the PDF at this path before running.`
      );
    }

    this.page = page;
    this.resumeFilePath = resumeFilePath;
    this.resumeFileName = resumeFilePath.split("/").pop() ?? "resume.pdf";
  }

  // ── Public ──────────────────────────────────────────────────────────────

  /**
   * Open the Easy Apply modal for the current job page and handle the
   * resume upload step. Returns a typed result.
   *
   * Pre-condition:  page is already on a LinkedIn job detail URL
   * Post-condition: modal is open and advanced past the resume step,
   *                 OR modal has been dismissed and result.success = false
   */
  async openAndUploadResume(jobId: string): Promise<ResumeUploadResult> {
    logger.info("Starting Easy Apply + resume upload", {
      jobId,
      resume: this.resumeFileName,
    });

    try {
      // ── 1. Click Easy Apply ──────────────────────────────────────────
      const opened = await this.openEasyApplyModal();
      if (!opened) {
        return {
          success: false,
          jobId,
          resumeFileName: this.resumeFileName,
          scenario: "NO_BUTTON",
          error: "Easy Apply button not found on this job page",
        };
      }

      await mediumDelay();

      // ── 2. Handle resume step ────────────────────────────────────────
      const scenario = await this.detectResumeScenario();
      logger.info("Resume scenario detected", { jobId, scenario });

      switch (scenario) {
        case "UPLOAD_FIELD":
          await this.uploadResumeFile();
          break;

        case "EXISTING_RESUME":
          await this.handleExistingResume();
          break;

        case "NO_RESUME_FIELD":
          // No resume field on this step — nothing to do, proceed
          logger.info("No resume field on current step — skipping upload", { jobId });
          break;
      }

      await shortDelay();

      // ── 3. Advance past resume step ──────────────────────────────────
      await this.clickNext();
      await longDelay();

      logger.info("Resume step complete — modal advanced", { jobId, scenario });

      return {
        success: true,
        jobId,
        resumeFileName: this.resumeFileName,
        scenario,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("Resume upload failed", { jobId, error: message });

      // Dismiss the modal so the browser stays clean
      await this.dismissModal();

      return {
        success: false,
        jobId,
        resumeFileName: this.resumeFileName,
        scenario: "ERROR",
        error: message,
      };
    }
  }

  /**
   * Dismiss the Easy Apply modal without submitting.
   * Used for cleanup on error or when a job should be skipped after opening.
   */
  async dismissModal(): Promise<void> {
    try {
      const closeBtn = this.page.locator(LinkedInSelectors.EASY_APPLY.CLOSE_BUTTON).first();
      const visible = await closeBtn.isVisible({ timeout: 3_000 }).catch(() => false);

      if (visible) {
        await closeBtn.click();
        await shortDelay();

        // Confirm discard if a confirmation dialog appears
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

      logger.debug("Modal dismissed");
    } catch {
      // Non-fatal — modal may have already closed
    }
  }

  // ── Private ──────────────────────────────────────────────────────────────

  /**
   * Click the Easy Apply button and wait for the modal to open.
   */
  private async openEasyApplyModal(): Promise<boolean> {
    // Try all Easy Apply button selectors
    const btnSelectors = [
      'button[aria-label*="Easy Apply"]',
      'button.jobs-apply-button:has-text("Easy Apply")',
      '.jobs-s-apply button:has-text("Easy Apply")',
    ];

    for (const sel of btnSelectors) {
      const btn = this.page.locator(sel).first();
      const visible = await btn.isVisible({ timeout: 2_000 }).catch(() => false);

      if (visible) {
        logger.debug("Clicking Easy Apply button", { selector: sel });
        await btn.click();

        // Wait for modal to appear
        const modalVisible = await this.page
          .locator(LinkedInSelectors.EASY_APPLY.MODAL)
          .first()
          .waitFor({ state: "visible", timeout: 8_000 })
          .then(() => true)
          .catch(() => false);

        if (modalVisible) {
          logger.debug("Easy Apply modal opened");
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Inspect the current modal step and classify the resume scenario.
   *
   * LinkedIn shows one of three states:
   * 1. A file input (upload field)  → user needs to upload a resume
   * 2. An existing resume card      → a resume was uploaded previously
   * 3. Neither                      → this step doesn't involve resume
   */
  private async detectResumeScenario(): Promise<
    "UPLOAD_FIELD" | "EXISTING_RESUME" | "NO_RESUME_FIELD"
  > {
    await randomDelay(500, 1000);

    // Check for existing resume card first — it takes priority
    const existingCard = this.page.locator(
      LinkedInSelectors.RESUME.EXISTING_RESUME_CARD
    ).first();
    const hasExisting = await existingCard
      .isVisible({ timeout: 3_000 })
      .catch(() => false);

    if (hasExisting) return "EXISTING_RESUME";

    // Check for file input (may be hidden — use .count() not .isVisible())
    const fileInputCount = await this.page
      .locator(LinkedInSelectors.RESUME.FILE_INPUT)
      .count()
      .catch(() => 0);

    if (fileInputCount > 0) return "UPLOAD_FIELD";

    // Check for upload container (visible div even when input is hidden)
    const hasUploadContainer = await this.page
      .locator(LinkedInSelectors.RESUME.UPLOAD_CONTAINER)
      .first()
      .isVisible({ timeout: 2_000 })
      .catch(() => false);

    if (hasUploadContainer) return "UPLOAD_FIELD";

    return "NO_RESUME_FIELD";
  }

  /**
   * Upload the resume PDF directly to the hidden file input.
   * Using setInputFiles() is more reliable than clicking the label.
   */
  private async uploadResumeFile(): Promise<void> {
    logger.info("Uploading resume file", { path: this.resumeFilePath });

    const fileInput = this.page.locator(LinkedInSelectors.RESUME.FILE_INPUT).first();

    // setInputFiles works on hidden inputs — no need to make it visible
    await fileInput.setInputFiles(this.resumeFilePath);

    logger.debug("File set on input, waiting for upload...");

    // Wait for upload progress to appear then disappear
    await this.waitForUploadComplete();

    logger.info("Resume uploaded successfully");
  }

  /**
   * Handle the "existing resume" scenario.
   *
   * Strategy:
   * - If the existing resume filename matches ours → keep it (no re-upload needed)
   * - If it's a different filename → click "Upload a different resume" and upload ours
   *
   * This prevents redundant uploads on re-runs and handles cases where
   * a different resume was used in a previous session.
   */
  private async handleExistingResume(): Promise<void> {
    // Check if the existing resume is already our file
    const existingName = await this.page
      .locator(LinkedInSelectors.RESUME.EXISTING_RESUME_NAME)
      .first()
      .textContent({ timeout: 3_000 })
      .then((t) => t?.trim() ?? "")
      .catch(() => "");

    logger.info("Existing resume detected", { existingName, expected: this.resumeFileName });

    const isOurResume = existingName
      .toLowerCase()
      .includes(this.resumeFileName.toLowerCase().replace(".pdf", ""));

    if (isOurResume) {
      logger.info("Existing resume matches ours — keeping it");
      return; // Nothing to do
    }

    // Different resume — replace it with ours
    logger.info("Different resume found — replacing with ours");

    const replaceBtn = this.page
      .locator(LinkedInSelectors.RESUME.REPLACE_RESUME_LINK)
      .first();
    const replaceVisible = await replaceBtn
      .isVisible({ timeout: 3_000 })
      .catch(() => false);

    if (replaceVisible) {
      await replaceBtn.click();
      await shortDelay();
      // After clicking replace, the file input should appear
      await this.uploadResumeFile();
    } else {
      // Replace link not found — try uploading directly to file input
      logger.warn("Replace button not found, attempting direct upload");
      await this.uploadResumeFile();
    }
  }

  /**
   * Click the Next/Continue button to advance the modal to the next step.
   */
  private async clickNext(): Promise<void> {
    const nextSelectors = [
      LinkedInSelectors.EASY_APPLY.NEXT_BUTTON,
      'button[aria-label="Continue to next step"]',
      'button:has-text("Next")',
      // Some modal steps show "Review" instead of "Next" on the last step
      LinkedInSelectors.EASY_APPLY.REVIEW_BUTTON,
    ];

    for (const sel of nextSelectors) {
      const btn = this.page.locator(sel).first();
      const visible = await btn.isVisible({ timeout: 2_000 }).catch(() => false);

      if (visible) {
        logger.debug("Clicking Next button", { selector: sel });
        await btn.click();
        return;
      }
    }

    throw new Error("Next button not found after resume step");
  }

  /**
   * Wait for the file upload progress bar to disappear (= upload complete).
   * Falls back gracefully if progress bar never appears (instant upload).
   */
  private async waitForUploadComplete(): Promise<void> {
    // Wait a moment for upload to start
    await randomDelay(800, 1500);

    // Wait for progress bar to appear (may not appear for small files)
    const progressAppeared = await this.page
      .locator(LinkedInSelectors.RESUME.UPLOAD_PROGRESS)
      .first()
      .waitFor({ state: "visible", timeout: 3_000 })
      .then(() => true)
      .catch(() => false);

    if (progressAppeared) {
      // Wait for it to disappear (= done)
      await this.page
        .locator(LinkedInSelectors.RESUME.UPLOAD_PROGRESS)
        .first()
        .waitFor({ state: "hidden", timeout: 15_000 });
    }

    // Check for upload error
    const hasError = await this.page
      .locator(LinkedInSelectors.RESUME.UPLOAD_ERROR)
      .first()
      .isVisible({ timeout: 2_000 })
      .catch(() => false);

    if (hasError) {
      const errText = await this.page
        .locator(LinkedInSelectors.RESUME.UPLOAD_ERROR)
        .first()
        .textContent()
        .catch(() => "Unknown upload error");
      throw new Error(`LinkedIn rejected the resume file: ${errText?.trim()}`);
    }

    // Brief pause to let UI settle after upload
    await randomDelay(500, 1000);
  }
}

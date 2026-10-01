import type { Page } from "playwright";
import { FieldDetector } from "./FieldDetector.js";
import { AnswerResolver, type UserProfileData, type StoredAnswers } from "./AnswerResolver.js";
import { LinkedInSelectors } from "./LinkedInSelectors.js";
import type { FilledField, FormFillResult } from "../types/automation.types.js";
import { logger } from "../utils/logger.js";
import { longDelay, mediumDelay, randomDelay, shortDelay } from "../utils/delay.js";

const MAX_STEPS = 15; // hard stop — prevents infinite loops on unexpected modal states

/**
 * LinkedInFormFiller — drives the Easy Apply modal from the first step
 * (post-resume) through to the Review step.
 *
 * Contract with callers:
 * - Pre-condition:  modal is already open, on the step AFTER resume upload
 *                   (LinkedInResumeUploader.openAndUploadResume() has run)
 * - Post-condition: modal is on the "Review your application" step,
 *                   ready for Phase 7 to click Submit
 *                   OR result.success = false and modal has been dismissed
 *
 * Step loop logic:
 * 1. Detect all fields on the current step
 * 2. For each field: resolve an answer → fill it
 * 3. Click Next/Continue
 * 4. If "Review" button appeared → we're done, return
 * 5. If same step is still showing → a required field was missed → error
 * 6. Repeat up to MAX_STEPS
 */
export class LinkedInFormFiller {
  private readonly page: Page;
  private readonly resolver: AnswerResolver;
  private readonly detector: FieldDetector;

  constructor(
    page: Page,
    profile: UserProfileData,
    storedAnswers: StoredAnswers = {}
  ) {
    this.page = page;
    this.resolver = new AnswerResolver(profile, storedAnswers);
    this.detector = new FieldDetector(page);
  }

  // ── Public ──────────────────────────────────────────────────────────────

  /**
   * Fill all steps of the Easy Apply modal until we reach the Review step.
   * Returns the complete log of every field filled across all steps.
   */
  async fillAllSteps(jobId: string): Promise<FormFillResult> {
    logger.info("Starting form fill", { jobId });

    const allFilledFields: FilledField[] = [];
    const errors: string[] = [];
    let stepsCompleted = 0;
    let reachedReview = false;

    for (let step = 0; step < MAX_STEPS; step++) {
      await mediumDelay();

      // ── Check if we've reached Review ─────────────────────────────────
      const onReview = await this.isOnReviewStep();
      if (onReview) {
        reachedReview = true;
        logger.info("Reached Review step", { jobId, stepsCompleted });
        break;
      }

      // ── Check modal is still open ──────────────────────────────────────
      const modalOpen = await this.isModalOpen();
      if (!modalOpen) {
        logger.warn("Modal closed unexpectedly", { jobId, step });
        errors.push(`Modal closed unexpectedly on step ${step + 1}`);
        break;
      }

      const stepTitle = await this.getStepTitle();
      logger.info(`Processing step ${step + 1}: "${stepTitle}"`, { jobId });

      // ── Skip steps that only show info (no inputs) ─────────────────────
      const isInfoStep = await this.isInformationalStep();
      if (isInfoStep) {
        logger.debug("Informational step — clicking Next", { step });
        await this.clickNext();
        stepsCompleted++;
        continue;
      }

      // ── Detect + fill fields ───────────────────────────────────────────
      const fields = await this.detector.detectFields();
      logger.debug(`Step ${step + 1}: ${fields.length} fields detected`);

      for (const field of fields) {
        try {
          const answer = this.resolver.resolve(field);

          if (answer === null) {
            logger.debug("Skipping field (no answer / already filled)", {
              label: field.label,
              type: field.type,
            });
            continue;
          }

          const filled = await this.fillField(field.label, field.normalizedKey, field.type, field.locator, field.options, answer);
          if (filled) {
            allFilledFields.push({
              label: field.label,
              normalizedKey: field.normalizedKey,
              type: field.type,
              answer,
            });
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          logger.warn("Failed to fill field", { label: field.label, error: msg });
          errors.push(`Field "${field.label}": ${msg}`);
        }
      }

      await shortDelay();

      // ── Check for validation errors before proceeding ──────────────────
      const hasErrors = await this.hasValidationErrors();
      if (hasErrors) {
        const errText = await this.getValidationErrorText();
        logger.warn("Validation error on step", { step: step + 1, errText });
        errors.push(`Validation error on step ${step + 1}: ${errText}`);
        // Don't break — still try to advance, some errors are non-blocking
      }

      // ── Advance to next step ───────────────────────────────────────────
      const advanced = await this.clickNext();
      if (!advanced) {
        errors.push(`Could not advance past step ${step + 1} — Next button not found`);
        break;
      }

      stepsCompleted++;
      await longDelay();
    }

    if (!reachedReview && stepsCompleted >= MAX_STEPS) {
      errors.push(`Reached maximum step limit (${MAX_STEPS}) without finding Review step`);
    }

    return {
      success: reachedReview,
      jobId,
      stepsCompleted,
      filledFields: allFilledFields,
      errors,
    };
  }

  // ── Private: field filling ───────────────────────────────────────────────

  private async fillField(
    label: string,
    normalizedKey: string,
    type: string,
    locator: import("playwright").Locator,
    options: string[] | undefined,
    answer: string
  ): Promise<boolean> {
    logger.debug("Filling field", { label: normalizedKey, type, answer });

    switch (type) {
      case "text":
      case "textarea":
        return this.fillTextInput(locator, answer);

      case "select":
        return this.fillSelect(locator, answer, options);

      case "radio":
        return this.fillRadio(locator, answer);

      case "checkbox":
        return this.fillCheckbox(locator, answer);

      default:
        return false;
    }
  }

  private async fillTextInput(
    locator: import("playwright").Locator,
    answer: string
  ): Promise<boolean> {
    try {
      await locator.scrollIntoViewIfNeeded();
      await locator.click({ timeout: 3_000 });
      await shortDelay();

      // Clear existing value
      await locator.selectText().catch(() => null);
      await locator.fill("");
      await shortDelay();

      // Type character by character for human appearance
      await locator.type(answer, { delay: randomTypingDelay() });
      return true;
    } catch (err) {
      logger.debug("fillTextInput error", { error: err });
      return false;
    }
  }

  private async fillSelect(
    locator: import("playwright").Locator,
    answer: string,
    options?: string[]
  ): Promise<boolean> {
    try {
      await locator.scrollIntoViewIfNeeded();
      await shortDelay();

      // Try selectOption by label first, then by value
      const trySelect = async (val: string) =>
        locator.selectOption({ label: val }, { timeout: 2_000 }).catch(() =>
          locator.selectOption({ value: val }, { timeout: 2_000 }).catch(() =>
            locator.selectOption(val, { timeout: 2_000 })
          )
        );

      await trySelect(answer);

      // Verify selection took effect
      const current = await locator.inputValue().catch(() => "");
      if (current) return true;

      // Fallback: try partial match against available options
      if (options) {
        const partial = options.find((o) =>
          o.toLowerCase().includes(answer.toLowerCase()) ||
          answer.toLowerCase().includes(o.toLowerCase())
        );
        if (partial) {
          await trySelect(partial);
        }
      }

      return true;
    } catch {
      return false;
    }
  }

  private async fillRadio(
    locator: import("playwright").Locator,
    answer: string
  ): Promise<boolean> {
    try {
      // Find the radio group container from the first radio input
      const container = this.page.locator(".jobs-easy-apply-form-section__grouping, .fb-dash-form-element").filter({
        has: locator,
      }).first();

      // Try to click the label matching our answer
      const labels = await container
        .locator('input[type="radio"] + label, .fb-radio-button label, label')
        .all();

      for (const lbl of labels) {
        const text = await lbl.textContent().catch(() => "");
        if (text?.trim().toLowerCase() === answer.toLowerCase() ||
            text?.trim().toLowerCase().includes(answer.toLowerCase())) {
          await lbl.scrollIntoViewIfNeeded();
          await lbl.click({ timeout: 2_000 });
          await shortDelay();
          return true;
        }
      }

      // Fallback: click the radio input with matching value
      const radios = await container.locator('input[type="radio"]').all();
      for (const radio of radios) {
        const val = await radio.getAttribute("value").catch(() => "");
        if (val?.toLowerCase() === answer.toLowerCase()) {
          await radio.click({ timeout: 2_000 });
          return true;
        }
      }

      return false;
    } catch {
      return false;
    }
  }

  private async fillCheckbox(
    locator: import("playwright").Locator,
    answer: string
  ): Promise<boolean> {
    try {
      const shouldCheck = answer === "true" || answer.toLowerCase() === "yes";
      const isChecked = await locator.isChecked();

      if (shouldCheck !== isChecked) {
        await locator.scrollIntoViewIfNeeded();
        await locator.click({ timeout: 2_000 });
      }
      return true;
    } catch {
      return false;
    }
  }

  // ── Private: modal navigation ────────────────────────────────────────────

  private async isOnReviewStep(): Promise<boolean> {
    // Review step has a Submit button OR a "Review" heading
    const submitVisible = await this.page
      .locator(LinkedInSelectors.EASY_APPLY.SUBMIT_BUTTON)
      .first()
      .isVisible({ timeout: 1_000 })
      .catch(() => false);

    if (submitVisible) return true;

    const reviewVisible = await this.page
      .locator(LinkedInSelectors.EASY_APPLY.REVIEW_BUTTON)
      .first()
      .isVisible({ timeout: 1_000 })
      .catch(() => false);

    return reviewVisible;
  }

  private async isModalOpen(): Promise<boolean> {
    return this.page
      .locator(LinkedInSelectors.EASY_APPLY.MODAL)
      .first()
      .isVisible({ timeout: 2_000 })
      .catch(() => false);
  }

  private async isInformationalStep(): Promise<boolean> {
    // Steps that only show text (privacy policy, contact info preview, etc.)
    // have no inputs at all
    const inputCount = await this.page
      .locator(
        ".jobs-easy-apply-content input, .jobs-easy-apply-content select, .jobs-easy-apply-content textarea"
      )
      .count()
      .catch(() => 0);
    return inputCount === 0;
  }

  private async getStepTitle(): Promise<string> {
    return this.page
      .locator(LinkedInSelectors.EASY_APPLY.MODAL_HEADER)
      .first()
      .textContent({ timeout: 2_000 })
      .then((t) => t?.trim() ?? "Unknown step")
      .catch(() => "Unknown step");
  }

  private async hasValidationErrors(): Promise<boolean> {
    return this.page
      .locator(LinkedInSelectors.EASY_APPLY.ERROR_SUMMARY)
      .first()
      .isVisible({ timeout: 1_000 })
      .catch(() => false);
  }

  private async getValidationErrorText(): Promise<string> {
    const errors = await this.page
      .locator(LinkedInSelectors.EASY_APPLY.ERROR_SUMMARY)
      .allTextContents()
      .catch(() => [] as string[]);
    return errors.join("; ");
  }

  private async clickNext(): Promise<boolean> {
    const nextSelectors = [
      LinkedInSelectors.EASY_APPLY.NEXT_BUTTON,
      'button[aria-label="Continue to next step"]',
      'button:has-text("Next")',
      'button:has-text("Continue")',
      LinkedInSelectors.EASY_APPLY.REVIEW_BUTTON,
    ];

    for (const sel of nextSelectors) {
      const btn = this.page.locator(sel).first();
      if (await btn.isVisible({ timeout: 1_500 }).catch(() => false)) {
        await btn.click();
        await mediumDelay();
        return true;
      }
    }

    return false;
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────

/** Returns a random per-keystroke delay to mimic human typing speed. */
function randomTypingDelay(): number {
  return Math.floor(Math.random() * 130) + 50; // 50–180ms per character
}

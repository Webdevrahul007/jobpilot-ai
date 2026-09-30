import type { Page } from "playwright";
import { LinkedInSelectors, LinkedInUrls } from "./LinkedInSelectors.js";
import type { DetectionResult, DetectionVerdict } from "../types/automation.types.js";
import { logger } from "../utils/logger.js";
import { mediumDelay, randomDelay } from "../utils/delay.js";

/**
 * LinkedInEasyApplyDetector
 *
 * Opens each job's detail page and inspects the apply button area to
 * return an authoritative verdict before any application attempt.
 *
 * Strategy per job page:
 * 1. Navigate to the job URL
 * 2. Wait for the top-card section to load
 * 3. Check for "Applied" badge → ALREADY_APPLIED (skip)
 * 4. Check for "Easy Apply" button → EASY_APPLY (queue for Phase 5)
 * 5. Check for external "Apply" button → EXTERNAL_APPLY (skip)
 * 6. Fallback checks (closed, no button, session expired)
 *
 * Callers are responsible for concurrency — this class processes one job
 * at a time. DetectionService orchestrates parallel batches (Phase 4 API).
 */
export class LinkedInEasyApplyDetector {
  private readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  /**
   * Inspect a single job URL and return a verdict.
   */
  async detect(jobId: string, jobUrl: string): Promise<DetectionResult> {
    logger.debug("Detecting apply type", { jobId, jobUrl });

    try {
      await this.navigateToJob(jobUrl);
      const verdict = await this.inspectApplyArea();

      logger.debug("Detection verdict", { jobId, verdict });
      return { jobId, jobUrl, verdict };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);

      // Session expiry is a hard stop — propagate so the caller can abort
      if (message.includes("SESSION_EXPIRED")) {
        return { jobId, jobUrl, verdict: "SESSION_EXPIRED", error: message };
      }

      logger.warn("Detection error for job", { jobId, error: message });
      return { jobId, jobUrl, verdict: "ERROR", error: message };
    }
  }

  // ── Private ──────────────────────────────────────────────────────────────

  private async navigateToJob(jobUrl: string): Promise<void> {
    await this.page.goto(jobUrl, {
      waitUntil: "domcontentloaded",
      timeout: 20_000,
    });

    // Detect session expiry immediately after navigation
    const currentUrl = this.page.url();
    if (
      currentUrl.includes("/login") ||
      currentUrl.includes("/checkpoint")
    ) {
      throw new Error("SESSION_EXPIRED: Redirected to login page");
    }

    // Wait for the job top card to render
    await this.page
      .locator(
        ".job-details-jobs-unified-top-card__job-title, " +
        ".jobs-unified-top-card__job-title, " +
        ".jobs-details__main-content"
      )
      .first()
      .waitFor({ state: "visible", timeout: 10_000 })
      .catch(() => null); // non-fatal — continue with what loaded

    // Brief human-like pause before inspecting
    await randomDelay(500, 1200);
  }

  private async inspectApplyArea(): Promise<DetectionVerdict> {
    // ── 1. Already applied ───────────────────────────────────────────────
    const alreadyApplied = await this.checkAlreadyApplied();
    if (alreadyApplied) return "ALREADY_APPLIED";

    // ── 2. Job closed ────────────────────────────────────────────────────
    const isClosed = await this.checkJobClosed();
    if (isClosed) return "CLOSED";

    // ── 3. Easy Apply button ─────────────────────────────────────────────
    const hasEasyApply = await this.checkEasyApplyButton();
    if (hasEasyApply) return "EASY_APPLY";

    // ── 4. External Apply button ─────────────────────────────────────────
    const hasExternal = await this.checkExternalApplyButton();
    if (hasExternal) return "EXTERNAL_APPLY";

    // ── 5. No button found ───────────────────────────────────────────────
    return "NO_BUTTON";
  }

  private async checkAlreadyApplied(): Promise<boolean> {
    // LinkedIn shows "Applied" text or a checkmark when already applied
    const selectors = [
      '.jobs-apply-button--applied',
      'span.artdeco-inline-feedback:has-text("Applied")',
      '.post-apply-timeline',                              // post-application confirmation panel
      'button[aria-label*="Applied"]',
    ];

    for (const sel of selectors) {
      const found = await this.page
        .locator(sel)
        .first()
        .isVisible({ timeout: 1_500 })
        .catch(() => false);
      if (found) return true;
    }

    // Text-based fallback — check page text for "Applied X days ago"
    const pageText = await this.page
      .locator(".jobs-details__main-content")
      .first()
      .textContent({ timeout: 2_000 })
      .catch(() => "");
    
    return /\bapplied\b.*\bago\b/i.test(pageText ?? "");
  }

  private async checkJobClosed(): Promise<boolean> {
    const closedSelectors = [
      '.jobs-details-top-card__apply-error',
      '[data-tracking-control-name="jobs_apply_disabled"]',
    ];

    for (const sel of closedSelectors) {
      const found = await this.page
        .locator(sel)
        .first()
        .isVisible({ timeout: 1_500 })
        .catch(() => false);
      if (found) return true;
    }

    // Text check for "No longer accepting applications"
    const cardText = await this.page
      .locator(
        ".job-details-jobs-unified-top-card__primary-description-container, " +
        ".jobs-unified-top-card__primary-description"
      )
      .first()
      .textContent({ timeout: 2_000 })
      .catch(() => "");

    return /no longer accepting/i.test(cardText ?? "");
  }

  /**
   * Checks for the Easy Apply button.
   *
   * LinkedIn renders the button with:
   * - aria-label containing "Easy Apply"
   * - class jobs-apply-button
   * - contains the LinkedIn "bug" logo SVG
   *
   * We check text content as the most reliable signal across UI versions.
   */
  private async checkEasyApplyButton(): Promise<boolean> {
    const easyApplySelectors = [
      // Explicit aria-label
      'button[aria-label*="Easy Apply"]',
      // Class + text combination
      'button.jobs-apply-button:has-text("Easy Apply")',
      // Fallback: any button with Easy Apply text in the top card
      '.jobs-s-apply button:has-text("Easy Apply")',
      '.jobs-apply-button--top-card:has-text("Easy Apply")',
    ];

    for (const sel of easyApplySelectors) {
      const found = await this.page
        .locator(sel)
        .first()
        .isVisible({ timeout: 2_000 })
        .catch(() => false);
      if (found) return true;
    }

    // Text-based fallback — button text scan in the apply area
    const buttons = await this.page
      .locator(".jobs-s-apply button, .jobs-apply-button")
      .all()
      .catch(() => []);

    for (const btn of buttons) {
      const text = await btn.textContent().catch(() => "");
      if (text?.toLowerCase().includes("easy apply")) return true;
    }

    return false;
  }

  /**
   * Checks for external apply button — present when company uses an ATS
   * redirect (Workday, Greenhouse, Lever, etc.).
   *
   * External apply buttons look the same visually but:
   * - Do NOT have "Easy Apply" in their label
   * - Open a new tab to the company's career portal
   */
  private async checkExternalApplyButton(): Promise<boolean> {
    const externalSelectors = [
      // Apply button that is NOT Easy Apply
      'button.jobs-apply-button:not(:has-text("Easy Apply"))',
      // LinkedIn sometimes labels it "Apply" without "Easy"
      'button[aria-label="Apply to"][aria-label]:not([aria-label*="Easy Apply"])',
    ];

    for (const sel of externalSelectors) {
      const found = await this.page
        .locator(sel)
        .first()
        .isVisible({ timeout: 2_000 })
        .catch(() => false);
      if (found) {
        // Double-check: make sure this isn't an Easy Apply button
        const text = await this.page
          .locator(sel)
          .first()
          .textContent()
          .catch(() => "");
        if (!text?.toLowerCase().includes("easy apply")) return true;
      }
    }

    // Fallback: any .jobs-apply-button present that isn't Easy Apply
    const applyBtns = await this.page
      .locator(".jobs-apply-button, .jobs-s-apply button")
      .all()
      .catch(() => []);

    for (const btn of applyBtns) {
      const text = await btn.textContent().catch(() => "");
      const isVisible = await btn.isVisible().catch(() => false);
      if (isVisible && !text?.toLowerCase().includes("easy apply")) {
        return true;
      }
    }

    return false;
  }
}

/**
 * Run a batch of detection tasks with a concurrency limit.
 * 
 * @param tasks    Array of {jobId, jobUrl} to process
 * @param detector A LinkedInEasyApplyDetector instance (single page)
 * @param concurrency Max parallel jobs (default 1 — sequential, safest)
 */
export async function detectBatch(
  tasks: Array<{ jobId: string; jobUrl: string }>,
  detector: LinkedInEasyApplyDetector,
  concurrency = 1
): Promise<DetectionResult[]> {
  const results: DetectionResult[] = [];
  let sessionExpired = false;

  // Process in chunks of `concurrency`
  for (let i = 0; i < tasks.length; i += concurrency) {
    if (sessionExpired) break;

    const chunk = tasks.slice(i, i + concurrency);

    const chunkResults = await Promise.all(
      chunk.map((task) => detector.detect(task.jobId, task.jobUrl))
    );

    for (const r of chunkResults) {
      results.push(r);
      if (r.verdict === "SESSION_EXPIRED") {
        sessionExpired = true;
        logger.warn("Session expired during detection batch — stopping early");
        break;
      }
    }

    // Polite pause between chunks
    if (i + concurrency < tasks.length && !sessionExpired) {
      await mediumDelay();
    }
  }

  return results;
}

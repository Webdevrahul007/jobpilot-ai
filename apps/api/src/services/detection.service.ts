import path from "path";
import { PrismaClient } from "@prisma/client";
import {
  BrowserManager,
  SessionManager,
  LinkedInEasyApplyDetector,
  detectBatch,
} from "@jobpilot/automation";
import type { DetectionResult, BatchDetectionResult } from "@jobpilot/automation";
import { applicationRepository, type ApplicationFilters } from "@/repositories/application.repository.js";
import { sessionRepository } from "@/repositories/session.repository.js";
import { HttpError } from "@/middlewares/errorHandler.js";
import { logger } from "@/utils/logger.js";
import { env } from "@/config/env.js";
import prisma from "@/lib/prisma.js";

export interface RunDetectionInput {
  userId: string;
  jobSearchId: string;
  concurrency?: number; // default 2
  limit?: number;       // max jobs to process in one run, default 50
}

/**
 * DetectionService — orchestrates the Phase 4 detection pipeline.
 *
 * Flow for runDetection():
 * 1. Validate session
 * 2. Load undetected jobs for the search (isEasyApply = false AND no application yet)
 * 3. Restore Playwright session
 * 4. Run LinkedInEasyApplyDetector across jobs with concurrency limit
 * 5. For each verdict:
 *    - EASY_APPLY      → update job.isEasyApply=true, create Application(PENDING)
 *    - EXTERNAL_APPLY  → update job.isEasyApply=false, create Application(SKIPPED)
 *    - ALREADY_APPLIED → create Application(SKIPPED, "Already applied")
 *    - CLOSED          → create Application(SKIPPED, "Job closed")
 *    - NO_BUTTON       → create Application(SKIPPED, "No apply button")
 *    - ERROR           → create Application(FAILED, error message)
 *    - SESSION_EXPIRED → stop run, invalidate session, throw 401
 * 6. Return summary stats
 */
export class DetectionService {
  private getBrowserManager(): BrowserManager {
    return new BrowserManager({
      headless: true,
      slowMo: 0,
      sessionDir: path.resolve(env.PLAYWRIGHT_SESSION_DIR),
    });
  }

  private getSessionManager(): SessionManager {
    return new SessionManager(
      new PrismaClient(),
      path.resolve(env.PLAYWRIGHT_SESSION_DIR)
    );
  }

  // ── Run detection ──────────────────────────────────────────────────────

  async runDetection(input: RunDetectionInput): Promise<BatchDetectionResult> {
    const { userId, jobSearchId, concurrency = 2, limit = 50 } = input;

    logger.info("Detection run requested", { userId, jobSearchId, concurrency, limit });

    // ── 1. Validate session ──────────────────────────────────────────────
    const session = await sessionRepository.findActiveByUserId(userId);
    if (!session) {
      throw new HttpError(401, "No active LinkedIn session. Login first.");
    }
    if (session.expiresAt && session.expiresAt < new Date()) {
      throw new HttpError(401, "LinkedIn session expired. Login again.");
    }

    // ── 2. Load undetected jobs ──────────────────────────────────────────
    // "Undetected" = jobs that have no Application row yet
    // We use a raw query for this join since Prisma's type system makes
    // "has no related record" filters verbose
    const undetectedJobs = await this.findUndetectedJobs(jobSearchId, limit);

    if (undetectedJobs.length === 0) {
      logger.info("No undetected jobs found for this search", { jobSearchId });
      return {
        processed: 0,
        easyApply: 0,
        skipped: 0,
        errors: 0,
        results: [],
      };
    }

    logger.info(`Found ${undetectedJobs.length} undetected jobs`, { jobSearchId });

    // ── 3. Restore Playwright session ────────────────────────────────────
    const sessionMgr = this.getSessionManager();
    const sessionFilePath = await sessionMgr.restoreSession(userId);
    if (!sessionFilePath) {
      throw new HttpError(401, "Could not restore LinkedIn session. Login again.");
    }

    // ── 4. Run detection ─────────────────────────────────────────────────
    const browserManager = this.getBrowserManager();
    let results: DetectionResult[] = [];

    try {
      const browserSession = await browserManager.newSession({
        storageStatePath: sessionFilePath,
      });

      const detector = new LinkedInEasyApplyDetector(browserSession.page);
      results = await detectBatch(undetectedJobs, detector, concurrency);

      await browserManager.closeSession(browserSession);
    } finally {
      await browserManager.closeBrowser();
    }

    // ── 5. Persist verdicts ──────────────────────────────────────────────
    const sessionExpiredResult = results.find(
      (r) => r.verdict === "SESSION_EXPIRED"
    );

    // Process all non-session-expired results first
    const toProcess = results.filter((r) => r.verdict !== "SESSION_EXPIRED");
    await this.persistVerdicts(userId, toProcess);

    // Handle session expiry after saving progress
    if (sessionExpiredResult) {
      await sessionMgr.invalidateSession(userId);
      logger.warn("Session expired during detection — progress saved up to failure point");
    }

    // ── 6. Build summary ─────────────────────────────────────────────────
    const summary = this.buildSummary(results);

    logger.info("Detection run complete", summary);
    return summary;
  }

  // ── Applications list ─────────────────────────────────────────────────

  async listApplications(
    userId: string,
    filters: { status?: ApplicationFilters["status"]; page?: number; pageSize?: number }
  ) {
    const page = filters.page ?? 1;
    const pageSize = Math.min(filters.pageSize ?? 20, 100);

    const { applications, total } = await applicationRepository.findByUserId(
      userId,
      {
        ...(filters.status !== undefined && { status: filters.status }),
        page,
        pageSize,
      }
    );

    return {
      applications,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  async getApplicationCounts(userId: string) {
    return applicationRepository.getStatusCounts(userId);
  }

  // ── Private ───────────────────────────────────────────────────────────

  /**
   * Find jobs in a search that have no Application record yet.
   * These are candidates for detection.
   */
  private async findUndetectedJobs(
    jobSearchId: string,
    limit: number
  ): Promise<Array<{ jobId: string; jobUrl: string }>> {
    // Jobs with no application row = never inspected
    const jobs = await prisma.job.findMany({
      where: {
        jobSearchId,
        application: null, // LEFT JOIN IS NULL
      },
      select: { id: true, jobUrl: true },
      orderBy: { createdAt: "asc" }, // oldest first — process in collection order
      take: limit,
    });

    return jobs.map((j) => ({ jobId: j.id, jobUrl: j.jobUrl }));
  }

  /**
   * Map detection verdicts to Application records and Job updates.
   * Runs in a single bulk operation per batch.
   */
  private async persistVerdicts(
    userId: string,
    results: DetectionResult[]
  ): Promise<void> {
    if (results.length === 0) return;

    // Separate into DB writes
    const jobUpdates: Array<{ id: string; isEasyApply: boolean }> = [];
    const applicationUpserts: Array<{
      jobId: string;
      userId: string;
      status: "PENDING" | "SKIPPED" | "FAILED";
      failureReason?: string;
    }> = [];

    for (const result of results) {
      switch (result.verdict) {
        case "EASY_APPLY":
          jobUpdates.push({ id: result.jobId, isEasyApply: true });
          applicationUpserts.push({
            jobId: result.jobId,
            userId,
            status: "PENDING",
          });
          break;

        case "EXTERNAL_APPLY":
          jobUpdates.push({ id: result.jobId, isEasyApply: false });
          applicationUpserts.push({
            jobId: result.jobId,
            userId,
            status: "SKIPPED",
            failureReason: "External apply — not Easy Apply",
          });
          break;

        case "ALREADY_APPLIED":
          applicationUpserts.push({
            jobId: result.jobId,
            userId,
            status: "SKIPPED",
            failureReason: "Already applied to this job",
          });
          break;

        case "CLOSED":
          applicationUpserts.push({
            jobId: result.jobId,
            userId,
            status: "SKIPPED",
            failureReason: "Job is no longer accepting applications",
          });
          break;

        case "NO_BUTTON":
          applicationUpserts.push({
            jobId: result.jobId,
            userId,
            status: "SKIPPED",
            failureReason: "No apply button found on job page",
          });
          break;

        case "ERROR":
          applicationUpserts.push({
            jobId: result.jobId,
            userId,
            status: "FAILED",
            failureReason: result.error ?? "Detection error",
          });
          break;

        // SESSION_EXPIRED is filtered out before this method is called
      }
    }

    // Run all DB writes in parallel — they are independent
    await Promise.all([
      // Update job.isEasyApply for confirmed/denied easy apply jobs
      ...jobUpdates.map((u) =>
        prisma.job.update({
          where: { id: u.id },
          data: { isEasyApply: u.isEasyApply },
        })
      ),
      // Bulk upsert applications
      applicationRepository.bulkUpsert(applicationUpserts),
    ]);

    logger.info("Verdicts persisted", {
      jobUpdates: jobUpdates.length,
      applications: applicationUpserts.length,
    });
  }

  private buildSummary(results: DetectionResult[]): BatchDetectionResult {
    let easyApply = 0;
    let skipped = 0;
    let errors = 0;

    for (const r of results) {
      if (r.verdict === "EASY_APPLY") easyApply++;
      else if (r.verdict === "ERROR" || r.verdict === "SESSION_EXPIRED") errors++;
      else skipped++;
    }

    return {
      processed: results.length,
      easyApply,
      skipped,
      errors,
      results,
    };
  }
}

export const detectionService = new DetectionService();

import path from "path";
import fs from "fs";
import { PrismaClient } from "@prisma/client";
import {
  BrowserManager,
  SessionManager,
  LinkedInResumeUploader,
} from "@jobpilot/automation";
import type { ResumeUploadResult } from "@jobpilot/automation";
import { applicationRepository } from "@/repositories/application.repository.js";
import { sessionRepository } from "@/repositories/session.repository.js";
import { HttpError } from "@/middlewares/errorHandler.js";
import { logger } from "@/utils/logger.js";
import { env } from "@/config/env.js";
import prisma from "@/lib/prisma.js";

export interface RunResumeUploadInput {
  userId: string;
  jobId?: string;       // single job — test/manual trigger
  jobSearchId?: string; // batch — all PENDING jobs in a search
  limit?: number;       // max jobs per batch run, default 10
}

export interface ResumeUploadSummary {
  processed: number;
  succeeded: number;
  failed: number;
  results: ResumeUploadResult[];
}

/**
 * ResumeService — orchestrates the resume upload step of Easy Apply.
 *
 * This service is intentionally limited in scope:
 * - It opens the Easy Apply modal
 * - Handles resume upload/keep/replace
 * - Advances past the resume step
 * - Saves Application status to IN_PROGRESS (ready for Phase 6 form fill)
 * - Dismisses the modal after the step (Phase 6 will reopen it for form fill)
 *
 * Why dismiss after resume? Because resume upload is the most likely
 * failure point. Confirming it works independently before form filling
 * (Phase 6) means failed resumes don't leave half-filled forms open.
 * Phase 6 will reopen the modal from scratch for form fill + submit.
 *
 * Flow:
 * 1. Validate session
 * 2. Find PENDING application(s)
 * 3. For each: open job URL → upload resume → advance 1 step → dismiss
 * 4. Update Application.status:
 *    success → IN_PROGRESS (ready for Phase 6)
 *    failure → FAILED with reason
 */
export class ResumeService {
  private getBrowserManager(): BrowserManager {
    return new BrowserManager({
      headless: env.PLAYWRIGHT_HEADLESS === "true",
      slowMo: env.NODE_ENV === "production" ? 0 : 50,
      sessionDir: path.resolve(env.PLAYWRIGHT_SESSION_DIR),
    });
  }

  private getSessionManager(): SessionManager {
    return new SessionManager(
      new PrismaClient(),
      path.resolve(env.PLAYWRIGHT_SESSION_DIR)
    );
  }

  // ── Resume validation ─────────────────────────────────────────────────

  /**
   * Check that the resume file exists on disk and is readable.
   * Called at API startup and by the status endpoint.
   */
  validateResumeFile(): { exists: boolean; path: string; fileName: string } {
    const resumePath = path.resolve(env.RESUME_FILE_PATH);
    const exists = fs.existsSync(resumePath);
    return {
      exists,
      path: resumePath,
      fileName: resumePath.split("/").pop() ?? "unknown",
    };
  }

  // ── Run upload ────────────────────────────────────────────────────────

  async runResumeUpload(
    input: RunResumeUploadInput
  ): Promise<ResumeUploadSummary> {
    const { userId, jobId, jobSearchId, limit = 10 } = input;

    logger.info("Resume upload run requested", { userId, jobId, jobSearchId });

    // ── Validate resume file ──────────────────────────────────────────
    const resumeCheck = this.validateResumeFile();
    if (!resumeCheck.exists) {
      throw new HttpError(
        400,
        `Resume file not found at: ${resumeCheck.path}. ` +
          `Upload Rahul_Jangid_Resume.pdf to the resumes/ folder.`
      );
    }

    // ── Validate session ──────────────────────────────────────────────
    const session = await sessionRepository.findActiveByUserId(userId);
    if (!session) {
      throw new HttpError(401, "No active LinkedIn session. Login first.");
    }
    if (session.expiresAt && session.expiresAt < new Date()) {
      throw new HttpError(401, "LinkedIn session expired. Login again.");
    }

    // ── Resolve which jobs to process ─────────────────────────────────
    const jobs = await this.resolvePendingJobs(userId, jobId, jobSearchId, limit);

    if (jobs.length === 0) {
      logger.info("No PENDING jobs to process for resume upload");
      return { processed: 0, succeeded: 0, failed: 0, results: [] };
    }

    logger.info(`Processing ${jobs.length} jobs for resume upload`);

    // ── Restore Playwright session ────────────────────────────────────
    const sessionMgr = this.getSessionManager();
    const sessionFilePath = await sessionMgr.restoreSession(userId);
    if (!sessionFilePath) {
      throw new HttpError(401, "Could not restore LinkedIn session. Login again.");
    }

    // ── Run uploads ───────────────────────────────────────────────────
    const browserManager = this.getBrowserManager();
    const results: ResumeUploadResult[] = [];

    try {
      const browserSession = await browserManager.newSession({
        storageStatePath: sessionFilePath,
      });

      const uploader = new LinkedInResumeUploader(
        browserSession.page,
        path.resolve(env.RESUME_FILE_PATH)
      );

      for (const job of jobs) {
        // Check for session expiry on each job
        const currentUrl = browserSession.page.url();
        if (
          currentUrl.includes("/login") ||
          currentUrl.includes("/checkpoint")
        ) {
          logger.warn("Session expired during resume upload run");
          await sessionMgr.invalidateSession(userId);
          break;
        }

        // Navigate to job URL
        await browserSession.page.goto(job.jobUrl, {
          waitUntil: "domcontentloaded",
          timeout: 20_000,
        });

        const result = await uploader.openAndUploadResume(job.id);
        results.push(result);

        // Persist status update immediately after each job
        await this.persistResult(userId, job.applicationId, result);
      }

      await browserManager.closeSession(browserSession);
    } finally {
      await browserManager.closeBrowser();
    }

    const succeeded = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;

    logger.info("Resume upload run complete", {
      processed: results.length,
      succeeded,
      failed,
    });

    return {
      processed: results.length,
      succeeded,
      failed,
      results,
    };
  }

  // ── Private ───────────────────────────────────────────────────────────

  private async resolvePendingJobs(
    userId: string,
    jobId: string | undefined,
    jobSearchId: string | undefined,
    limit: number
  ): Promise<Array<{ id: string; jobUrl: string; applicationId: string }>> {
    if (jobId) {
      // Single job mode
      const job = await prisma.job.findUnique({
        where: { id: jobId },
        include: { application: true },
      });

      if (!job) throw new HttpError(404, "Job not found");
      if (!job.application) {
        throw new HttpError(400, "No application record for this job. Run detection first.");
      }
      if (job.application.status !== "PENDING") {
        throw new HttpError(
          400,
          `Job application status is ${job.application.status}, expected PENDING.`
        );
      }
      if (job.application.userId !== userId) {
        throw new HttpError(403, "Forbidden");
      }

      return [
        {
          id: job.id,
          jobUrl: job.jobUrl,
          applicationId: job.application.id,
        },
      ];
    }

    if (jobSearchId) {
      // Batch mode — all PENDING applications in this search
      const jobs = await prisma.job.findMany({
        where: {
          jobSearchId,
          isEasyApply: true,
          application: {
            userId,
            status: "PENDING",
          },
        },
        include: { application: true },
        orderBy: { createdAt: "asc" },
        take: limit,
      });

      return jobs
        .filter((j) => j.application !== null)
        .map((j) => ({
          id: j.id,
          jobUrl: j.jobUrl,
          applicationId: j.application!.id,
        }));
    }

    throw new HttpError(400, "Provide either jobId or jobSearchId");
  }

  /**
   * Update the application status based on upload result.
   * success → IN_PROGRESS (ready for Phase 6 form fill)
   * failure → FAILED with the error reason
   */
  private async persistResult(
    _userId: string,
    applicationId: string,
    result: ResumeUploadResult
  ): Promise<void> {
    if (result.success) {
      await applicationRepository.updateStatus(applicationId, "IN_PROGRESS");
    } else {
      await applicationRepository.updateStatus(applicationId, "FAILED", {
        failureReason: `Resume upload failed (${result.scenario}): ${result.error ?? "unknown error"}`,
      });
    }
  }
}

export const resumeService = new ResumeService();

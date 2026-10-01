import path from "path";
import { PrismaClient } from "@prisma/client";
import {
  BrowserManager,
  SessionManager,
  LinkedInResumeUploader,
  LinkedInFormFiller,
} from "@jobpilot/automation";
import type { UserProfileData } from "@jobpilot/automation";
import { applicationRepository } from "@/repositories/application.repository.js";
import { formAnswerRepository } from "@/repositories/formAnswer.repository.js";
import { sessionRepository } from "@/repositories/session.repository.js";
import { HttpError } from "@/middlewares/errorHandler.js";
import { logger } from "@/utils/logger.js";
import { env } from "@/config/env.js";
import prisma from "@/lib/prisma.js";
import type { FormFillResult } from "@jobpilot/automation";

export interface RunFormFillInput {
  userId: string;
  jobSearchId?: string;
  jobId?: string;
  limit?: number;
}

export interface FormFillRunSummary {
  processed: number;
  reachedReview: number;
  failed: number;
  totalFieldsFilled: number;
  results: Array<{
    jobId: string;
    applicationId: string;
    success: boolean;
    stepsCompleted: number;
    fieldsFilled: number;
    errors: string[];
  }>;
}

/**
 * FormFillService — orchestrates the full Easy Apply form fill pipeline.
 *
 * Flow per job:
 * 1. Validate session + resume file
 * 2. Find IN_PROGRESS applications (set by Phase 5 resume upload)
 * 3. Load user profile → build UserProfileData
 * 4. Load stored answers from previous FormAnswer rows
 * 5. For each job:
 *    a. Navigate to job URL
 *    b. Open Easy Apply modal + upload resume (LinkedInResumeUploader)
 *    c. Fill all remaining steps (LinkedInFormFiller)
 *    d. Persist filled fields to FormAnswer table
 *    e. Update Application status:
 *       - success → stays IN_PROGRESS (Phase 7 will submit)
 *       - failure → FAILED with error
 *
 * Note: This service does NOT submit the application.
 * After runFormFill() completes, the modal sits on the Review step.
 * Phase 7 (Submit) will reopen the modal and click Submit.
 *
 * Why reopen instead of keeping it open?
 * Keeping a browser open between API calls is stateful and fragile.
 * Phase 7 will run the full flow (resume + fill + submit) atomically.
 * This phase is for standalone testing of form filling only.
 */
export class FormFillService {
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

  // ── Form fill run ─────────────────────────────────────────────────────

  async runFormFill(input: RunFormFillInput): Promise<FormFillRunSummary> {
    const { userId, jobSearchId, jobId, limit = 5 } = input;

    logger.info("Form fill run requested", { userId, jobSearchId, jobId });

    // ── Validate resume ──────────────────────────────────────────────
    const resumePath = path.resolve(env.RESUME_FILE_PATH);
    const fs = await import("fs");
    if (!fs.existsSync(resumePath)) {
      throw new HttpError(400, `Resume file not found at: ${resumePath}`);
    }

    // ── Validate session ─────────────────────────────────────────────
    const session = await sessionRepository.findActiveByUserId(userId);
    if (!session) throw new HttpError(401, "No active LinkedIn session. Login first.");
    if (session.expiresAt && session.expiresAt < new Date()) {
      throw new HttpError(401, "LinkedIn session expired. Login again.");
    }

    // ── Load jobs to process ─────────────────────────────────────────
    const jobs = await this.resolveJobs(userId, jobId, jobSearchId, limit);
    if (jobs.length === 0) {
      logger.info("No IN_PROGRESS jobs to fill forms for");
      return { processed: 0, reachedReview: 0, failed: 0, totalFieldsFilled: 0, results: [] };
    }

    // ── Load profile + stored answers ────────────────────────────────
    const profile = await this.loadUserProfile(userId);
    const storedAnswers = await formAnswerRepository.loadStoredAnswers(userId);

    logger.info(`Processing ${jobs.length} jobs for form fill`, {
      storedAnswerKeys: Object.keys(storedAnswers).length,
    });

    // ── Restore session ──────────────────────────────────────────────
    const sessionMgr = this.getSessionManager();
    const sessionFilePath = await sessionMgr.restoreSession(userId);
    if (!sessionFilePath) {
      throw new HttpError(401, "Could not restore LinkedIn session.");
    }

    // ── Run fills ────────────────────────────────────────────────────
    const browserManager = this.getBrowserManager();
    const summaryResults: FormFillRunSummary["results"] = [];

    try {
      const browserSession = await browserManager.newSession({
        storageStatePath: sessionFilePath,
      });

      for (const job of jobs) {
        // Session expiry check
        if (
          browserSession.page.url().includes("/login") ||
          browserSession.page.url().includes("/checkpoint")
        ) {
          await sessionMgr.invalidateSession(userId);
          logger.warn("Session expired during form fill");
          break;
        }

        const result = await this.processOneJob(
          browserSession.page,
          job,
          profile,
          storedAnswers,
          resumePath
        );

        summaryResults.push(result);
      }

      await browserManager.closeSession(browserSession);
    } finally {
      await browserManager.closeBrowser();
    }

    const reachedReview = summaryResults.filter((r) => r.success).length;
    const failed = summaryResults.filter((r) => !r.success).length;
    const totalFieldsFilled = summaryResults.reduce(
      (sum, r) => sum + r.fieldsFilled,
      0
    );

    logger.info("Form fill run complete", {
      processed: summaryResults.length,
      reachedReview,
      failed,
      totalFieldsFilled,
    });

    return {
      processed: summaryResults.length,
      reachedReview,
      failed,
      totalFieldsFilled,
      results: summaryResults,
    };
  }

  // ── Private ───────────────────────────────────────────────────────────

  private async processOneJob(
    page: import("playwright").Page,
    job: { id: string; jobUrl: string; applicationId: string },
    profile: UserProfileData,
    storedAnswers: Record<string, string>,
    resumePath: string
  ): Promise<FormFillRunSummary["results"][number]> {
    logger.info("Processing job for form fill", { jobId: job.id });

    try {
      // Navigate to job page
      await page.goto(job.jobUrl, {
        waitUntil: "domcontentloaded",
        timeout: 20_000,
      });

      // Open modal + upload resume (Phase 5 logic reused)
      const uploader = new LinkedInResumeUploader(page, resumePath);
      const uploadResult = await uploader.openAndUploadResume(job.id);

      if (!uploadResult.success) {
        await applicationRepository.updateStatus(job.applicationId, "FAILED", {
          failureReason: `Modal open failed: ${uploadResult.error}`,
        });
        return {
          jobId: job.id,
          applicationId: job.applicationId,
          success: false,
          stepsCompleted: 0,
          fieldsFilled: 0,
          errors: [uploadResult.error ?? "Failed to open modal"],
        };
      }

      // Fill all remaining steps
      const filler = new LinkedInFormFiller(page, profile, storedAnswers);
      const fillResult: FormFillResult = await filler.fillAllSteps(job.id);

      // Persist form answers
      if (fillResult.filledFields.length > 0) {
        await formAnswerRepository.saveMany(
          job.applicationId,
          fillResult.filledFields
        );
        // Update stored answers cache so subsequent jobs in this run benefit
        for (const f of fillResult.filledFields) {
          if (f.normalizedKey) storedAnswers[f.normalizedKey] = f.answer;
        }
      }

      // Dismiss the modal — Phase 7 will reopen for submission
      await uploader.dismissModal();

      // Update application status
      if (fillResult.success) {
        // Keep IN_PROGRESS — Phase 7 picks up from here
        logger.info("Form fill succeeded — modal at Review step", { jobId: job.id });
      } else {
        await applicationRepository.updateStatus(job.applicationId, "FAILED", {
          failureReason: `Form fill failed: ${fillResult.errors.join("; ")}`,
        });
      }

      return {
        jobId: job.id,
        applicationId: job.applicationId,
        success: fillResult.success,
        stepsCompleted: fillResult.stepsCompleted,
        fieldsFilled: fillResult.filledFields.length,
        errors: fillResult.errors,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("Unexpected error processing job", { jobId: job.id, error: message });

      await applicationRepository.updateStatus(job.applicationId, "FAILED", {
        failureReason: `Unexpected error: ${message}`,
      }).catch(() => null);

      return {
        jobId: job.id,
        applicationId: job.applicationId,
        success: false,
        stepsCompleted: 0,
        fieldsFilled: 0,
        errors: [message],
      };
    }
  }

  private async resolveJobs(
    userId: string,
    jobId: string | undefined,
    jobSearchId: string | undefined,
    limit: number
  ): Promise<Array<{ id: string; jobUrl: string; applicationId: string }>> {
    if (jobId) {
      const job = await prisma.job.findUnique({
        where: { id: jobId },
        include: { application: true },
      });
      if (!job) throw new HttpError(404, "Job not found");
      if (!job.application) throw new HttpError(400, "No application for this job. Run detection first.");
      if (!["PENDING", "IN_PROGRESS"].includes(job.application.status)) {
        throw new HttpError(400, `Application status is ${job.application.status}. Expected PENDING or IN_PROGRESS.`);
      }
      if (job.application.userId !== userId) throw new HttpError(403, "Forbidden");
      return [{ id: job.id, jobUrl: job.jobUrl, applicationId: job.application.id }];
    }

    if (jobSearchId) {
      const jobs = await prisma.job.findMany({
        where: {
          jobSearchId,
          isEasyApply: true,
          application: { userId, status: { in: ["PENDING", "IN_PROGRESS"] } },
        },
        include: { application: true },
        orderBy: { createdAt: "asc" },
        take: limit,
      });
      return jobs
        .filter((j) => j.application !== null)
        .map((j) => ({ id: j.id, jobUrl: j.jobUrl, applicationId: j.application!.id }));
    }

    throw new HttpError(400, "Provide either jobId or jobSearchId");
  }

  private async loadUserProfile(userId: string): Promise<UserProfileData> {
    const profile = await prisma.userProfile.findUnique({ where: { userId } });
    if (!profile) {
      throw new HttpError(
        400,
        "User profile not found. Create your profile before running form fill."
      );
    }
    return {
      firstName: profile.firstName,
      lastName: profile.lastName,
      phone: profile.phone,
      city: profile.city,
      country: profile.country,
      ...(profile.linkedinUrl !== null && { linkedinUrl: profile.linkedinUrl }),
      totalYearsExp: profile.totalYearsExp,
      ...(profile.currentJobTitle !== null && { currentJobTitle: profile.currentJobTitle }),
      noticePeriodDays: profile.noticePeriodDays,
      ...(profile.expectedSalary !== null && { expectedSalary: profile.expectedSalary }),
      currency: profile.currency,
      visaRequired: profile.visaRequired,
      resumeFileName: profile.resumeFileName,
    };
  }

  // ── Answers lookup ────────────────────────────────────────────────────

  async getFormAnswers(applicationId: string, userId: string) {
    // Verify ownership
    const app = await applicationRepository.findById(applicationId);
    if (!app) throw new HttpError(404, "Application not found");
    if (app.userId !== userId) throw new HttpError(403, "Forbidden");

    return formAnswerRepository.findByApplicationId(applicationId);
  }
}

export const formFillService = new FormFillService();

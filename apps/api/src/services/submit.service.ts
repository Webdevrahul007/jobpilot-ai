import path from "path";
import fs from "fs";
import { PrismaClient } from "@prisma/client";
import {
  BrowserManager,
  SessionManager,
  LinkedInResumeUploader,
  LinkedInFormFiller,
  LinkedInSubmitter,
} from "@jobpilot/automation";
import type {
  UserProfileData,
  ApplicationRunResult,
  SubmitOutcome,
} from "@jobpilot/automation";
import { applicationRepository } from "@/repositories/application.repository.js";
import { formAnswerRepository } from "@/repositories/formAnswer.repository.js";
import { sessionRepository } from "@/repositories/session.repository.js";
import { HttpError } from "@/middlewares/errorHandler.js";
import { logger } from "@/utils/logger.js";
import { env } from "@/config/env.js";
import prisma from "@/lib/prisma.js";

export interface RunSubmitInput {
  userId: string;
  jobSearchId?: string;
  jobId?: string;
  limit?: number;        // max jobs per batch, default 5
  dryRun?: boolean;      // if true: fill form but do NOT click submit
}

export interface SubmitRunSummary {
  processed: number;
  applied: number;
  failed: number;
  skipped: number;
  dryRun: boolean;
  results: ApplicationRunResult[];
}

/**
 * SubmitService — the top-level orchestrator for Phase 7.
 *
 * Runs the complete Easy Apply pipeline per job:
 *   navigate → open modal → upload resume → fill all steps → submit
 *
 * Key behaviours:
 *
 * 1. ATOMIC per job — every step happens in one browser session.
 *    No state is shared between jobs. Each job gets its own fresh
 *    modal open from the job URL.
 *
 * 2. RETRY once on transient failures — if submit fails with
 *    SUBMIT_ERROR or ERROR (not ALREADY_APPLIED or SESSION_EXPIRED),
 *    we retry the full pipeline once. If it fails again → FAILED.
 *
 * 3. DRY RUN mode — fills the form and reaches the Review step
 *    but does NOT click Submit. Useful for testing field mapping
 *    before sending real applications.
 *
 * 4. SESSION EXPIRY is a hard stop — invalidates the session and
 *    aborts the batch immediately. Partial progress is saved.
 *
 * 5. DB updates are immediate after each job:
 *    SUCCESS        → Application.status = APPLIED, appliedAt = now()
 *    ALREADY_APPLIED → Application.status = SKIPPED
 *    failure        → Application.status = FAILED, screenshotUrl saved
 */
export class SubmitService {
  private readonly screenshotDir: string;

  constructor() {
    this.screenshotDir = path.resolve(
      process.cwd(),
      "../../screenshots"
    );
  }

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

  // ── Run submit ────────────────────────────────────────────────────────

  async runSubmit(input: RunSubmitInput): Promise<SubmitRunSummary> {
    const { userId, jobSearchId, jobId, limit = 5, dryRun = false } = input;

    logger.info("Submit run requested", { userId, jobSearchId, jobId, dryRun });

    // ── Validate resume ──────────────────────────────────────────────
    const resumePath = path.resolve(env.RESUME_FILE_PATH);
    if (!fs.existsSync(resumePath)) {
      throw new HttpError(400, `Resume file not found at: ${resumePath}`);
    }

    // ── Validate session ─────────────────────────────────────────────
    const session = await sessionRepository.findActiveByUserId(userId);
    if (!session) throw new HttpError(401, "No active LinkedIn session. Login first.");
    if (session.expiresAt && session.expiresAt < new Date()) {
      throw new HttpError(401, "LinkedIn session expired. Login again.");
    }

    // ── Load jobs ────────────────────────────────────────────────────
    const jobs = await this.resolveJobs(userId, jobId, jobSearchId, limit);
    if (jobs.length === 0) {
      logger.info("No eligible jobs found for submit run");
      return { processed: 0, applied: 0, failed: 0, skipped: 0, dryRun, results: [] };
    }

    // ── Load profile + stored answers ────────────────────────────────
    const profile = await this.loadUserProfile(userId);
    const storedAnswers = await formAnswerRepository.loadStoredAnswers(userId);

    logger.info(`Starting submit run for ${jobs.length} job(s)`, {
      dryRun,
      storedAnswerKeys: Object.keys(storedAnswers).length,
    });

    // ── Restore session ──────────────────────────────────────────────
    const sessionMgr = this.getSessionManager();
    const sessionFilePath = await sessionMgr.restoreSession(userId);
    if (!sessionFilePath) {
      throw new HttpError(401, "Could not restore LinkedIn session.");
    }

    // ── Run each job ─────────────────────────────────────────────────
    const browserManager = this.getBrowserManager();
    const results: ApplicationRunResult[] = [];
    let sessionExpired = false;

    try {
      const browserSession = await browserManager.newSession({
        storageStatePath: sessionFilePath,
      });

      for (const job of jobs) {
        if (sessionExpired) break;

        // Check session expiry between jobs
        const url = browserSession.page.url();
        if (url.includes("/login") || url.includes("/checkpoint")) {
          await sessionMgr.invalidateSession(userId);
          sessionExpired = true;
          logger.warn("Session expired between jobs — stopping batch");
          break;
        }

        // First attempt
        const result = await this.processJob(
          browserSession.page,
          job,
          profile,
          storedAnswers,
          resumePath,
          dryRun
        );

        // Retry once on transient failures (not session/already-applied)
        const shouldRetry =
          !result.success &&
          !["SESSION_EXPIRED", "ALREADY_APPLIED"].includes(result.outcome) &&
          !dryRun;

        if (shouldRetry) {
          logger.info("Retrying job after failure", { jobId: job.id });
          const retryResult = await this.processJob(
            browserSession.page,
            job,
            profile,
            storedAnswers,
            resumePath,
            dryRun
          );
          results.push({ ...retryResult, retried: true });

          if (retryResult.outcome === "SESSION_EXPIRED") {
            await sessionMgr.invalidateSession(userId);
            sessionExpired = true;
          }
        } else {
          results.push(result);

          if (result.outcome === "SESSION_EXPIRED") {
            await sessionMgr.invalidateSession(userId);
            sessionExpired = true;
          }
        }
      }

      await browserManager.closeSession(browserSession);
    } finally {
      await browserManager.closeBrowser();
    }

    // ── Summary ───────────────────────────────────────────────────────
    const applied = results.filter((r) => r.success).length;
    const skipped = results.filter((r) => r.outcome === "ALREADY_APPLIED").length;
    const failed = results.filter((r) => !r.success && r.outcome !== "ALREADY_APPLIED").length;

    logger.info("Submit run complete", {
      processed: results.length,
      applied,
      skipped,
      failed,
      dryRun,
    });

    return { processed: results.length, applied, failed, skipped, dryRun, results };
  }

  // ── Private: per-job pipeline ─────────────────────────────────────────

  private async processJob(
    page: import("playwright").Page,
    job: { id: string; jobUrl: string; applicationId: string },
    profile: UserProfileData,
    storedAnswers: Record<string, string>,
    resumePath: string,
    dryRun: boolean
  ): Promise<ApplicationRunResult> {
    logger.info("Processing job for submit", { jobId: job.id, dryRun });

    const submitter = new LinkedInSubmitter(page, this.screenshotDir);

    try {
      // ── Navigate ──────────────────────────────────────────────────
      await page.goto(job.jobUrl, {
        waitUntil: "domcontentloaded",
        timeout: 20_000,
      });

      // Check session after navigation
      const url = page.url();
      if (url.includes("/login") || url.includes("/checkpoint")) {
        return this.buildResult(job, false, "SESSION_EXPIRED", 0, 0, false, undefined, "Session expired during navigation");
      }

      // ── Resume upload ─────────────────────────────────────────────
      const uploader = new LinkedInResumeUploader(page, resumePath);
      const uploadResult = await uploader.openAndUploadResume(job.id);

      if (!uploadResult.success) {
        const screenshotPath = await submitter.takeScreenshot(job.id);
        await this.persistFailure(
          job.applicationId,
          `Resume step failed (${uploadResult.scenario}): ${uploadResult.error}`,
          screenshotPath
        );
        return this.buildResult(
          job, false, "MODAL_NOT_OPEN", 0, 0, false,
          screenshotPath,
          uploadResult.error
        );
      }

      // ── Form fill ─────────────────────────────────────────────────
      const filler = new LinkedInFormFiller(page, profile, storedAnswers);
      const fillResult = await filler.fillAllSteps(job.id);

      // Save answers regardless of fill success (partial answers are useful)
      if (fillResult.filledFields.length > 0) {
        await formAnswerRepository.saveMany(job.applicationId, fillResult.filledFields);
        // Update stored answers for subsequent jobs in this batch
        for (const f of fillResult.filledFields) {
          if (f.normalizedKey) storedAnswers[f.normalizedKey] = f.answer;
        }
      }

      if (!fillResult.success) {
        const screenshotPath = await submitter.takeScreenshot(job.id);
        await submitter.dismissModal();
        await this.persistFailure(
          job.applicationId,
          `Form fill failed after ${fillResult.stepsCompleted} steps: ${fillResult.errors.join("; ")}`,
          screenshotPath
        );
        return this.buildResult(
          job, false, "SUBMIT_ERROR",
          fillResult.stepsCompleted, fillResult.filledFields.length,
          false, screenshotPath,
          fillResult.errors.join("; ")
        );
      }

      // ── DRY RUN — stop before submit ─────────────────────────────
      if (dryRun) {
        await submitter.dismissModal();
        logger.info("Dry run — skipping submit", { jobId: job.id });
        return this.buildResult(
          job, true, "SUCCESS",
          fillResult.stepsCompleted, fillResult.filledFields.length,
          false, undefined,
          "DRY_RUN: reached Review step but did not submit"
        );
      }

      // ── Submit ────────────────────────────────────────────────────
      const submitResult = await submitter.submit(job.id);

      await this.persistOutcome(
        job.applicationId,
        submitResult.success,
        submitResult.outcome,
        submitResult.screenshotPath,
        submitResult.error
      );

      return this.buildResult(
        job,
        submitResult.success,
        submitResult.outcome,
        fillResult.stepsCompleted,
        fillResult.filledFields.length,
        false,
        submitResult.screenshotPath,
        submitResult.error
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("Unexpected error in processJob", { jobId: job.id, error: message });

      const screenshotPath = await submitter.takeScreenshot(job.id).catch(() => undefined);
      await submitter.dismissModal().catch(() => null);
      await this.persistFailure(job.applicationId, message, screenshotPath);

      const outcome: SubmitOutcome =
        message.includes("SESSION_EXPIRED") ? "SESSION_EXPIRED" : "ERROR";

      return this.buildResult(job, false, outcome, 0, 0, false, screenshotPath, message);
    }
  }

  // ── Private: DB persistence ───────────────────────────────────────────

  private async persistOutcome(
    applicationId: string,
    success: boolean,
    outcome: SubmitOutcome,
    screenshotPath?: string,
    error?: string
  ): Promise<void> {
    if (success) {
      await applicationRepository.updateStatus(applicationId, "APPLIED", {
        appliedAt: new Date(),
      });
      return;
    }

    if (outcome === "ALREADY_APPLIED") {
      await applicationRepository.updateStatus(applicationId, "SKIPPED", {
        failureReason: "Already applied to this job",
      });
      return;
    }

    await this.persistFailure(applicationId, error ?? outcome, screenshotPath);
  }

  private async persistFailure(
    applicationId: string,
    reason: string,
    screenshotPath?: string
  ): Promise<void> {
    await applicationRepository.updateStatus(applicationId, "FAILED", {
      failureReason: reason,
      ...(screenshotPath !== undefined && { screenshotUrl: screenshotPath }),
    });
  }

  // ── Private: helpers ──────────────────────────────────────────────────

  private buildResult(
    job: { id: string; applicationId: string },
    success: boolean,
    outcome: SubmitOutcome,
    stepsCompleted: number,
    fieldsFilled: number,
    retried: boolean,
    screenshotPath?: string,
    error?: string
  ): ApplicationRunResult {
    return {
      jobId: job.id,
      applicationId: job.applicationId,
      success,
      outcome,
      stepsCompleted,
      fieldsFilled,
      retried,
      ...(screenshotPath !== undefined && { screenshotPath }),
      ...(error !== undefined && { error }),
    };
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
      if (!job.application) {
        throw new HttpError(400, "No application record for this job. Run detection first.");
      }
      if (job.application.userId !== userId) throw new HttpError(403, "Forbidden");

      // Allow PENDING or IN_PROGRESS for submit
      const allowedStatuses = ["PENDING", "IN_PROGRESS"];
      if (!allowedStatuses.includes(job.application.status)) {
        throw new HttpError(
          400,
          `Application status is "${job.application.status}". Expected PENDING or IN_PROGRESS.`
        );
      }
      return [{ id: job.id, jobUrl: job.jobUrl, applicationId: job.application.id }];
    }

    if (jobSearchId) {
      const jobs = await prisma.job.findMany({
        where: {
          jobSearchId,
          isEasyApply: true,
          application: {
            userId,
            status: { in: ["PENDING", "IN_PROGRESS"] },
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

  private async loadUserProfile(userId: string): Promise<UserProfileData> {
    const profile = await prisma.userProfile.findUnique({ where: { userId } });
    if (!profile) {
      throw new HttpError(
        400,
        "User profile not found. Create a profile before applying."
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
      ...(profile.currentJobTitle !== null && {
        currentJobTitle: profile.currentJobTitle,
      }),
      noticePeriodDays: profile.noticePeriodDays,
      ...(profile.expectedSalary !== null && {
        expectedSalary: profile.expectedSalary,
      }),
      currency: profile.currency,
      visaRequired: profile.visaRequired,
      resumeFileName: profile.resumeFileName,
    };
  }

  // ── Application stats ─────────────────────────────────────────────────

  async getSubmitStats(userId: string) {
    return applicationRepository.getStatusCounts(userId);
  }
}

export const submitService = new SubmitService();

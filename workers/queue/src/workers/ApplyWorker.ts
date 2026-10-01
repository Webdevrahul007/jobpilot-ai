import path from "path";
import fs from "fs";
import { Worker, type Job } from "bullmq";
import { PrismaClient } from "@prisma/client";
import {
  BrowserManager,
  SessionManager,
  LinkedInResumeUploader,
  LinkedInFormFiller,
  LinkedInSubmitter,
} from "@jobpilot/automation";
import type { UserProfileData } from "@jobpilot/automation";
import { getRedisOptions } from "../utils/redis.js";
import { logger } from "../utils/logger.js";
import { QUEUE_NAMES } from "../types/jobs.types.js";
import type { ApplyJobPayload, JobResult } from "../types/jobs.types.js";
import dotenv from "dotenv";

dotenv.config({ path: path.resolve(__dirname, "../../../../.env") });

const SESSION_DIR = path.resolve(process.env["PLAYWRIGHT_SESSION_DIR"] ?? ".sessions");
const RESUME_PATH = path.resolve(process.env["RESUME_FILE_PATH"] ?? "./resumes/Rahul_Jangid_Resume.pdf");
const SCREENSHOT_DIR = path.resolve(process.env["SCREENSHOT_DIR"] ?? "../../screenshots");

/**
 * ApplyWorker — consumes jobs from the "apply" queue.
 *
 * Concurrency: 1 — applying is the most sensitive operation.
 * One job at a time prevents rate-limiting and ensures screenshot
 * files don't collide.
 *
 * Each job runs the complete atomic pipeline per qualifying job:
 *   navigate → resume upload → form fill → submit
 *
 * Retry inside the pipeline: the service itself retries submit once.
 * BullMQ retries the whole job on infrastructure failures (Redis down,
 * crash, OOM) — set to 2 attempts with 30s backoff.
 */
export function createApplyWorker(): Worker<ApplyJobPayload, JobResult> {
  const worker = new Worker<ApplyJobPayload, JobResult>(
    QUEUE_NAMES.APPLY,
    async (job: Job<ApplyJobPayload>) => {
      const start = Date.now();
      const { userId, jobSearchId, limit = 5, dryRun = false } = job.data;

      logger.info("ApplyWorker: processing job", {
        bullJobId: job.id,
        userId,
        jobSearchId,
        limit,
        dryRun,
      });

      await job.updateProgress(5);

      const prisma = new PrismaClient();
      const sessionManager = new SessionManager(prisma, SESSION_DIR);
      const browserManager = new BrowserManager({
        headless: true,
        slowMo: 0,
        sessionDir: SESSION_DIR,
      });

      try {
        // ── Validate resume ─────────────────────────────────────────────
        if (!fs.existsSync(RESUME_PATH)) {
          throw new Error(`Resume not found: ${RESUME_PATH}`);
        }

        // ── Validate session ────────────────────────────────────────────
        const session = await prisma.linkedInSession.findFirst({
          where: { userId, isActive: true },
        });
        if (!session) throw new Error("No active LinkedIn session.");
        if (session.expiresAt && session.expiresAt < new Date()) {
          throw new Error("LinkedIn session expired.");
        }

        await job.updateProgress(10);

        // ── Load eligible jobs (PENDING or IN_PROGRESS) ─────────────────
        const eligibleJobs = await prisma.job.findMany({
          where: {
            jobSearchId,
            isEasyApply: true,
            application: { userId, status: { in: ["PENDING", "IN_PROGRESS"] } },
          },
          include: { application: true },
          orderBy: { createdAt: "asc" },
          take: limit,
        });

        if (eligibleJobs.length === 0) {
          logger.info("ApplyWorker: no eligible jobs", { jobSearchId });
          return {
            success: true,
            message: "No PENDING/IN_PROGRESS jobs to apply",
            data: { processed: 0, applied: 0, failed: 0, skipped: 0 },
            durationMs: Date.now() - start,
          };
        }

        logger.info(`ApplyWorker: ${eligibleJobs.length} jobs to apply`, { jobSearchId });
        await job.updateProgress(15);

        // ── Load user profile ───────────────────────────────────────────
        const profile = await prisma.userProfile.findUnique({ where: { userId } });
        if (!profile) throw new Error("User profile not found.");

        const userProfile: UserProfileData = {
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

        // ── Load stored form answers ────────────────────────────────────
        const storedAnswerRows = await prisma.formAnswer.findMany({
          where: { application: { userId } },
          orderBy: { createdAt: "desc" },
          select: { questionKey: true, answer: true },
        });
        const storedAnswers: Record<string, string> = {};
        for (const row of storedAnswerRows) {
          if (row.questionKey && !(row.questionKey in storedAnswers)) {
            storedAnswers[row.questionKey] = row.answer;
          }
        }

        await job.updateProgress(20);

        // ── Restore session ─────────────────────────────────────────────
        const sessionFilePath = await sessionManager.restoreSession(userId);
        if (!sessionFilePath) throw new Error("Could not restore session.");

        // ── Process each job ────────────────────────────────────────────
        const browserSession = await browserManager.newSession({
          storageStatePath: sessionFilePath,
        });

        let applied = 0;
        let failed = 0;
        let skippedCount = 0;
        let sessionExpired = false;
        const progressStep = 60 / (eligibleJobs.length || 1);

        for (let i = 0; i < eligibleJobs.length; i++) {
          const jobRecord = eligibleJobs[i]!;
          const application = jobRecord.application!;

          if (sessionExpired) break;

          // Check session expiry between jobs
          const url = browserSession.page.url();
          if (url.includes("/login") || url.includes("/checkpoint")) {
            await sessionManager.invalidateSession(userId);
            sessionExpired = true;
            logger.warn("ApplyWorker: session expired between jobs");
            break;
          }

          logger.info(`ApplyWorker: applying to job ${i + 1}/${eligibleJobs.length}`, {
            jobId: jobRecord.id,
            title: jobRecord.title,
          });

          const submitter = new LinkedInSubmitter(browserSession.page, SCREENSHOT_DIR);

          try {
            // Navigate
            await browserSession.page.goto(jobRecord.jobUrl, {
              waitUntil: "domcontentloaded",
              timeout: 20_000,
            });

            // Check after nav
            const navUrl = browserSession.page.url();
            if (navUrl.includes("/login")) {
              await sessionManager.invalidateSession(userId);
              sessionExpired = true;
              break;
            }

            // Resume upload
            const uploader = new LinkedInResumeUploader(browserSession.page, RESUME_PATH);
            const uploadResult = await uploader.openAndUploadResume(jobRecord.id);

            if (!uploadResult.success) {
              failed++;
              const screenshot = await submitter.takeScreenshot(jobRecord.id);
              await prisma.application.update({
                where: { id: application.id },
                data: {
                  status: "FAILED",
                  failureReason: `Resume step: ${uploadResult.error}`,
                  ...(screenshot !== undefined && { screenshotUrl: screenshot }),
                },
              });
              continue;
            }

            // Form fill
            const filler = new LinkedInFormFiller(browserSession.page, userProfile, storedAnswers);
            const fillResult = await filler.fillAllSteps(jobRecord.id);

            // Save form answers
            if (fillResult.filledFields.length > 0) {
              await prisma.formAnswer.createMany({
                data: fillResult.filledFields.map((f) => ({
                  applicationId: application.id,
                  questionText: f.label,
                  questionKey: f.normalizedKey,
                  answer: f.answer,
                  inputType: f.type,
                })),
              });
              for (const f of fillResult.filledFields) {
                if (f.normalizedKey) storedAnswers[f.normalizedKey] = f.answer;
              }
            }

            if (!fillResult.success) {
              failed++;
              const screenshot = await submitter.takeScreenshot(jobRecord.id);
              await submitter.dismissModal();
              await prisma.application.update({
                where: { id: application.id },
                data: {
                  status: "FAILED",
                  failureReason: `Form fill: ${fillResult.errors.join("; ")}`,
                  ...(screenshot !== undefined && { screenshotUrl: screenshot }),
                },
              });
              continue;
            }

            // DryRun — stop before submit
            if (dryRun) {
              await submitter.dismissModal();
              logger.info("ApplyWorker: dry run — skipping submit", { jobId: jobRecord.id });
              continue;
            }

            // Submit (with one internal retry on transient error)
            let submitResult = await submitter.submit(jobRecord.id);

            if (
              !submitResult.success &&
              !["SESSION_EXPIRED", "ALREADY_APPLIED"].includes(submitResult.outcome)
            ) {
              logger.info("ApplyWorker: retrying submit", { jobId: jobRecord.id });
              // Re-run full flow for retry
              await browserSession.page.goto(jobRecord.jobUrl, {
                waitUntil: "domcontentloaded",
                timeout: 20_000,
              });
              const uploader2 = new LinkedInResumeUploader(browserSession.page, RESUME_PATH);
              const up2 = await uploader2.openAndUploadResume(jobRecord.id);
              if (up2.success) {
                const filler2 = new LinkedInFormFiller(browserSession.page, userProfile, storedAnswers);
                const fill2 = await filler2.fillAllSteps(jobRecord.id);
                if (fill2.success) {
                  submitResult = await submitter.submit(jobRecord.id);
                }
              }
            }

            // Persist outcome
            if (submitResult.success) {
              applied++;
              await prisma.application.update({
                where: { id: application.id },
                data: { status: "APPLIED", appliedAt: new Date() },
              });
            } else if (submitResult.outcome === "ALREADY_APPLIED") {
              skippedCount++;
              await prisma.application.update({
                where: { id: application.id },
                data: { status: "SKIPPED", failureReason: "Already applied" },
              });
            } else if (submitResult.outcome === "SESSION_EXPIRED") {
              await sessionManager.invalidateSession(userId);
              sessionExpired = true;
              failed++;
              await prisma.application.update({
                where: { id: application.id },
                data: { status: "FAILED", failureReason: "Session expired during submit" },
              });
              break;
            } else {
              failed++;
              await prisma.application.update({
                where: { id: application.id },
                data: {
                  status: "FAILED",
                  failureReason: submitResult.error ?? submitResult.outcome,
                  ...(submitResult.screenshotPath !== undefined && {
                    screenshotUrl: submitResult.screenshotPath,
                  }),
                },
              });
            }
          } catch (err) {
            failed++;
            const message = err instanceof Error ? err.message : String(err);
            logger.error("ApplyWorker: error on job", { jobId: jobRecord.id, error: message });
            const screenshot = await submitter.takeScreenshot(jobRecord.id).catch(() => undefined);
            await submitter.dismissModal().catch(() => null);
            await prisma.application.update({
              where: { id: application.id },
              data: {
                status: "FAILED",
                failureReason: message,
                ...(screenshot !== undefined && { screenshotUrl: screenshot }),
              },
            }).catch(() => null);
          }

          await job.updateProgress(20 + Math.round(progressStep * (i + 1)));
        }

        await browserManager.closeSession(browserSession);
        await job.updateProgress(100);

        const durationMs = Date.now() - start;
        logger.info("ApplyWorker: job complete", {
          jobSearchId,
          applied,
          failed,
          skipped: skippedCount,
          sessionExpired,
          durationMs,
        });

        return {
          success: applied > 0 || (!sessionExpired && failed === 0),
          message: dryRun
            ? `Dry run: ${eligibleJobs.length} jobs processed`
            : `Applied: ${applied} | Failed: ${failed} | Skipped: ${skippedCount}`,
          data: {
            processed: eligibleJobs.length,
            applied,
            failed,
            skipped: skippedCount,
            sessionExpired,
            dryRun,
          },
          durationMs,
        };
      } finally {
        await browserManager.closeBrowser();
        await prisma.$disconnect();
      }
    },
    {
      connection: getRedisOptions(),
      concurrency: 1, // one apply job at a time
    }
  );

  worker.on("completed", (job, result) => {
    logger.info("ApplyWorker: completed", { jobId: job.id, result: result.message });
  });

  worker.on("failed", (job, err) => {
    logger.error("ApplyWorker: failed", {
      jobId: job?.id,
      error: err.message,
      attempt: job?.attemptsMade,
    });
  });

  logger.info("ApplyWorker started", { concurrency: 1 });
  return worker;
}

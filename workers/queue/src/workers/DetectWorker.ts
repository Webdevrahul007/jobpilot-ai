import path from "path";
import { Worker, type Job } from "bullmq";
import { PrismaClient } from "@prisma/client";
import {
  BrowserManager,
  SessionManager,
  LinkedInEasyApplyDetector,
  detectBatch,
} from "@jobpilot/automation";
import type { DetectionResult } from "@jobpilot/automation";
import { getRedisOptions } from "../utils/redis.js";
import { logger } from "../utils/logger.js";
import { QUEUE_NAMES } from "../types/jobs.types.js";
import type { DetectJobPayload, JobResult } from "../types/jobs.types.js";
import dotenv from "dotenv";

dotenv.config({ path: path.resolve(__dirname, "../../../../.env") });

const SESSION_DIR = path.resolve(
  process.env["PLAYWRIGHT_SESSION_DIR"] ?? ".sessions"
);

/**
 * DetectWorker — consumes jobs from the "detect" queue.
 *
 * Concurrency: 2 (two detect jobs can run in parallel — each opens
 * its own browser session, no shared state)
 *
 * Each job:
 * 1. Finds all jobs in the search with no Application record yet
 * 2. Runs LinkedInEasyApplyDetector on each
 * 3. Maps verdicts → Application rows (PENDING / SKIPPED / FAILED)
 * 4. Updates job.isEasyApply for confirmed Easy Apply jobs
 */
export function createDetectWorker(): Worker<DetectJobPayload, JobResult> {
  const worker = new Worker<DetectJobPayload, JobResult>(
    QUEUE_NAMES.DETECT,
    async (job: Job<DetectJobPayload>) => {
      const start = Date.now();
      const { userId, jobSearchId, concurrency = 2, limit = 50 } = job.data;

      logger.info("DetectWorker: processing job", {
        bullJobId: job.id,
        userId,
        jobSearchId,
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
        // ── Validate session ────────────────────────────────────────────
        const session = await prisma.linkedInSession.findFirst({
          where: { userId, isActive: true },
        });
        if (!session) throw new Error("No active LinkedIn session.");
        if (session.expiresAt && session.expiresAt < new Date()) {
          throw new Error("LinkedIn session expired.");
        }

        await job.updateProgress(10);

        // ── Find undetected jobs ────────────────────────────────────────
        const undetected = await prisma.job.findMany({
          where: { jobSearchId, application: null },
          select: { id: true, jobUrl: true },
          orderBy: { createdAt: "asc" },
          take: limit,
        });

        if (undetected.length === 0) {
          logger.info("DetectWorker: no undetected jobs", { jobSearchId });
          return {
            success: true,
            message: "No undetected jobs to process",
            data: { processed: 0, easyApply: 0, skipped: 0, errors: 0 },
            durationMs: Date.now() - start,
          };
        }

        logger.info(`DetectWorker: ${undetected.length} jobs to detect`, { jobSearchId });
        await job.updateProgress(20);

        // ── Restore session ─────────────────────────────────────────────
        const sessionFilePath = await sessionManager.restoreSession(userId);
        if (!sessionFilePath) throw new Error("Could not restore session.");

        // ── Run detection ───────────────────────────────────────────────
        const browserSession = await browserManager.newSession({
          storageStatePath: sessionFilePath,
        });

        const detector = new LinkedInEasyApplyDetector(browserSession.page);
        const results: DetectionResult[] = await detectBatch(
          undetected.map((j) => ({ jobId: j.id, jobUrl: j.jobUrl })),
          detector,
          concurrency
        );

        await browserManager.closeSession(browserSession);
        await job.updateProgress(75);

        // ── Persist verdicts ────────────────────────────────────────────
        let easyApply = 0;
        let skipped = 0;
        let errors = 0;
        let sessionExpired = false;

        const toProcess = results.filter((r) => r.verdict !== "SESSION_EXPIRED");

        for (const result of toProcess) {
          try {
            switch (result.verdict) {
              case "EASY_APPLY":
                easyApply++;
                await prisma.job.update({
                  where: { id: result.jobId },
                  data: { isEasyApply: true },
                });
                await prisma.application.upsert({
                  where: { jobId: result.jobId },
                  create: { jobId: result.jobId, userId, status: "PENDING" },
                  update: { status: "PENDING" },
                });
                break;

              case "EXTERNAL_APPLY":
                skipped++;
                await prisma.job.update({
                  where: { id: result.jobId },
                  data: { isEasyApply: false },
                });
                await prisma.application.upsert({
                  where: { jobId: result.jobId },
                  create: {
                    jobId: result.jobId,
                    userId,
                    status: "SKIPPED",
                    failureReason: "External apply — not Easy Apply",
                  },
                  update: {
                    status: "SKIPPED",
                    failureReason: "External apply — not Easy Apply",
                  },
                });
                break;

              case "ALREADY_APPLIED":
                skipped++;
                await prisma.application.upsert({
                  where: { jobId: result.jobId },
                  create: {
                    jobId: result.jobId,
                    userId,
                    status: "SKIPPED",
                    failureReason: "Already applied",
                  },
                  update: { status: "SKIPPED", failureReason: "Already applied" },
                });
                break;

              case "CLOSED":
              case "NO_BUTTON":
                skipped++;
                await prisma.application.upsert({
                  where: { jobId: result.jobId },
                  create: {
                    jobId: result.jobId,
                    userId,
                    status: "SKIPPED",
                    failureReason:
                      result.verdict === "CLOSED"
                        ? "Job no longer accepting applications"
                        : "No apply button found",
                  },
                  update: {
                    status: "SKIPPED",
                    failureReason:
                      result.verdict === "CLOSED"
                        ? "Job no longer accepting applications"
                        : "No apply button found",
                  },
                });
                break;

              case "ERROR":
                errors++;
                await prisma.application.upsert({
                  where: { jobId: result.jobId },
                  create: {
                    jobId: result.jobId,
                    userId,
                    status: "FAILED",
                    failureReason: result.error ?? "Detection error",
                  },
                  update: {
                    status: "FAILED",
                    failureReason: result.error ?? "Detection error",
                  },
                });
                break;
            }
          } catch (dbErr) {
            logger.warn("DetectWorker: DB write failed for job", {
              jobId: result.jobId,
              error: dbErr,
            });
          }
        }

        // Check if any result was SESSION_EXPIRED
        if (results.some((r) => r.verdict === "SESSION_EXPIRED")) {
          sessionExpired = true;
          await sessionManager.invalidateSession(userId);
          logger.warn("DetectWorker: session expired during detection");
        }

        await job.updateProgress(100);

        const durationMs = Date.now() - start;
        logger.info("DetectWorker: job complete", {
          jobSearchId,
          processed: results.length,
          easyApply,
          skipped,
          errors,
          sessionExpired,
          durationMs,
        });

        return {
          success: !sessionExpired,
          message: sessionExpired
            ? `Detection partial (session expired) — ${easyApply} Easy Apply, ${skipped} skipped`
            : `Detection complete — ${easyApply} Easy Apply, ${skipped} skipped`,
          data: {
            processed: results.length,
            easyApply,
            skipped,
            errors,
            sessionExpired,
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
      concurrency: 2,
    }
  );

  worker.on("completed", (job, result) => {
    logger.info("DetectWorker: completed", { jobId: job.id, result: result.message });
  });

  worker.on("failed", (job, err) => {
    logger.error("DetectWorker: failed", {
      jobId: job?.id,
      error: err.message,
      attempt: job?.attemptsMade,
    });
  });

  logger.info("DetectWorker started", { concurrency: 2 });
  return worker;
}

import path from "path";
import { Worker, type Job } from "bullmq";
import { PrismaClient } from "@prisma/client";
import {
  BrowserManager,
  SessionManager,
  LinkedInJobSearch,
} from "@jobpilot/automation";
import type { JobSearchParams } from "@jobpilot/automation";
import { getRedisOptions } from "../utils/redis.js";
import { logger } from "../utils/logger.js";
import { QUEUE_NAMES } from "../types/jobs.types.js";
import type { ScrapeJobPayload, JobResult } from "../types/jobs.types.js";
import dotenv from "dotenv";

dotenv.config({ path: path.resolve(__dirname, "../../../../.env") });

const SESSION_DIR = path.resolve(
  process.env["PLAYWRIGHT_SESSION_DIR"] ?? ".sessions"
);

/**
 * ScrapeWorker — consumes jobs from the "scrape" queue.
 *
 * Concurrency: 1 (scraping LinkedIn is rate-sensitive — one at a time)
 * Retry: 3 attempts with exponential backoff (set on queue, not here)
 *
 * Each job:
 * 1. Validates LinkedIn session exists
 * 2. Restores Playwright session from DB → disk
 * 3. Runs LinkedInJobSearch for the configured search
 * 4. Deduplicates + bulk-inserts new jobs into DB
 * 5. Updates JobSearch.lastRunAt
 */
export function createScrapeWorker(): Worker<ScrapeJobPayload, JobResult> {
  const worker = new Worker<ScrapeJobPayload, JobResult>(
    QUEUE_NAMES.SCRAPE,
    async (job: Job<ScrapeJobPayload>) => {
      const start = Date.now();
      const { userId, jobSearchId, maxPages = 5 } = job.data;

      logger.info("ScrapeWorker: processing job", {
        bullJobId: job.id,
        userId,
        jobSearchId,
        maxPages,
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

        if (!session) {
          throw new Error("No active LinkedIn session. Login first via /api/v1/linkedin/login");
        }
        if (session.expiresAt && session.expiresAt < new Date()) {
          throw new Error("LinkedIn session expired. Login again.");
        }

        await job.updateProgress(15);

        // ── Load search config ──────────────────────────────────────────
        const searchConfig = await prisma.jobSearch.findUnique({
          where: { id: jobSearchId },
        });
        if (!searchConfig) throw new Error(`JobSearch not found: ${jobSearchId}`);

        await job.updateProgress(20);

        // ── Restore session ─────────────────────────────────────────────
        const sessionFilePath = await sessionManager.restoreSession(userId);
        if (!sessionFilePath) throw new Error("Could not restore session from DB");

        // ── Run scraper ─────────────────────────────────────────────────
        const browserSession = await browserManager.newSession({
          storageStatePath: sessionFilePath,
        });

        await job.updateProgress(30);

        const searcher = new LinkedInJobSearch(browserSession.page);
        const searchParams: JobSearchParams = {
          keywords: searchConfig.keywords,
          ...(searchConfig.location !== null && { location: searchConfig.location }),
          remoteOnly: searchConfig.remote,
          easyApplyOnly: false,
          maxPages,
        };

        const scrapeResult = await searcher.search(searchParams);
        await browserManager.closeSession(browserSession);

        await job.updateProgress(70);

        // ── Dedup + save ────────────────────────────────────────────────
        const scrapedUrls = scrapeResult.jobs.map((j) => j.jobUrl);
        const existing = await prisma.job.findMany({
          where: { jobUrl: { in: scrapedUrls } },
          select: { jobUrl: true },
        });
        const existingSet = new Set(existing.map((j) => j.jobUrl));
        const newJobs = scrapeResult.jobs.filter((j) => !existingSet.has(j.jobUrl));

        let inserted = 0;
        if (newJobs.length > 0) {
          const result = await prisma.job.createMany({
            data: newJobs.map((j) => ({
              jobSearchId,
              source: "LINKEDIN" as const,
              title: j.title,
              company: j.company,
              location: j.location || null,
              jobUrl: j.jobUrl,
              isEasyApply: j.isEasyApply,
              isRemote: j.isRemote,
              salary: j.salary,
              postedAt: null,
            })),
            skipDuplicates: true,
          });
          inserted = result.count;
        }

        // Update lastRunAt
        await prisma.jobSearch.update({
          where: { id: jobSearchId },
          data: { lastRunAt: new Date() },
        });

        await job.updateProgress(100);

        const durationMs = Date.now() - start;
        logger.info("ScrapeWorker: job complete", {
          jobSearchId,
          scraped: scrapeResult.jobs.length,
          inserted,
          durationMs,
        });

        return {
          success: true,
          message: `Scraped ${scrapeResult.jobs.length} jobs, inserted ${inserted} new`,
          data: {
            totalScraped: scrapeResult.jobs.length,
            newJobs: inserted,
            duplicatesSkipped: scrapeResult.jobs.length - inserted,
            pagesScraped: scrapeResult.pagesScraped,
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
      concurrency: 1, // one scrape at a time
    }
  );

  worker.on("completed", (job, result) => {
    logger.info("ScrapeWorker: completed", { jobId: job.id, result: result.message });
  });

  worker.on("failed", (job, err) => {
    logger.error("ScrapeWorker: failed", {
      jobId: job?.id,
      error: err.message,
      attempt: job?.attemptsMade,
    });
  });

  worker.on("progress", (job, progress) => {
    logger.debug("ScrapeWorker: progress", { jobId: job.id, progress });
  });

  logger.info("ScrapeWorker started", { concurrency: 1 });
  return worker;
}

import path from "path";
import { PrismaClient } from "@prisma/client";
import {
  BrowserManager,
  SessionManager,
  LinkedInJobSearch,
} from "@jobpilot/automation";
import type { JobSearchParams } from "@jobpilot/automation";
import { jobRepository, type JobFilters } from "@/repositories/job.repository.js";
import { jobSearchRepository, type CreateJobSearchInput } from "@/repositories/jobSearch.repository.js";
import { sessionRepository } from "@/repositories/session.repository.js";
import { HttpError } from "@/middlewares/errorHandler.js";
import { logger } from "@/utils/logger.js";
import { env } from "@/config/env.js";
import type { Job, JobSearch } from "@prisma/client";

export interface RunSearchInput {
  userId: string;
  jobSearchId: string;
  maxPages?: number;
}

export interface RunSearchResult {
  jobSearchId: string;
  totalScraped: number;
  newJobs: number;
  duplicatesSkipped: number;
  pagesScraped: number;
  linkedInTotal: number;
  errors: string[];
}

export interface ListJobsResult {
  jobs: Job[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

/**
 * JobService — orchestrates the full job search pipeline.
 *
 * Flow for runSearch():
 * 1. Validate user has an active LinkedIn session
 * 2. Load the JobSearch config from DB
 * 3. Restore Playwright session from DB → disk
 * 4. Launch headless browser, run LinkedInJobSearch
 * 5. Deduplicate scraped URLs against existing DB rows
 * 6. Bulk-insert new jobs via jobRepository.upsertMany()
 * 7. Update JobSearch.lastRunAt
 * 8. Return summary stats
 */
export class JobService {
  // ── Helpers ──────────────────────────────────────────────────────────────

  private getBrowserManager(): BrowserManager {
    return new BrowserManager({
      headless: true, // always headless for searches — no UI needed
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

  // ── Job Search Config CRUD ───────────────────────────────────────────────

  async createSearch(input: CreateJobSearchInput): Promise<JobSearch> {
    logger.info("Creating job search config", {
      userId: input.userId,
      keywords: input.keywords,
    });
    return jobSearchRepository.create(input);
  }

  async listSearches(userId: string): Promise<JobSearch[]> {
    return jobSearchRepository.findAllByUserId(userId);
  }

  async getSearch(id: string, userId: string): Promise<JobSearch> {
    const search = await jobSearchRepository.findById(id);
    if (!search) throw new HttpError(404, "Job search not found");
    if (search.userId !== userId) throw new HttpError(403, "Forbidden");
    return search;
  }

  async deleteSearch(id: string, userId: string): Promise<void> {
    await this.getSearch(id, userId); // validates ownership
    await jobSearchRepository.delete(id);
  }

  // ── Run Search ───────────────────────────────────────────────────────────

  /**
   * Execute a LinkedIn job search run for a saved JobSearch config.
   * This is the heavy operation — opens a browser and scrapes LinkedIn.
   */
  async runSearch(input: RunSearchInput): Promise<RunSearchResult> {
    const { userId, jobSearchId, maxPages } = input;

    logger.info("Job search run requested", { userId, jobSearchId });

    // ── 1. Validate session ──────────────────────────────────────────────
    const session = await sessionRepository.findActiveByUserId(userId);
    if (!session) {
      throw new HttpError(
        401,
        "No active LinkedIn session found. Please login via /api/v1/linkedin/login first."
      );
    }
    if (session.expiresAt && session.expiresAt < new Date()) {
      throw new HttpError(
        401,
        "LinkedIn session has expired. Please login again."
      );
    }

    // ── 2. Load search config ────────────────────────────────────────────
    const searchConfig = await jobSearchRepository.findById(jobSearchId);
    if (!searchConfig) throw new HttpError(404, "Job search config not found");
    if (searchConfig.userId !== userId) throw new HttpError(403, "Forbidden");

    // ── 3. Restore Playwright session ────────────────────────────────────
    const sessionMgr = this.getSessionManager();
    const sessionFilePath = await sessionMgr.restoreSession(userId);
    if (!sessionFilePath) {
      throw new HttpError(
        401,
        "Could not restore LinkedIn session from storage. Please login again."
      );
    }

    // ── 4. Run the scraper ───────────────────────────────────────────────
    const browserManager = this.getBrowserManager();
    let scrapeResult;

    try {
      const browserSession = await browserManager.newSession({
        storageStatePath: sessionFilePath,
      });

      const searcher = new LinkedInJobSearch(browserSession.page);

      const searchParams: JobSearchParams = {
        keywords: searchConfig.keywords,
        ...(searchConfig.location !== null &&
          searchConfig.location !== undefined && {
            location: searchConfig.location,
          }),
        remoteOnly: searchConfig.remote,
        easyApplyOnly: false, // collect ALL jobs, filter by Easy Apply in Phase 4
        maxPages: maxPages ?? 5,
      };

      scrapeResult = await searcher.search(searchParams);
      await browserManager.closeSession(browserSession);

      // Check if we got redirected to login (session expired mid-run)
      const sessionExpiredError = scrapeResult.errors.find((e) =>
        e.includes("SESSION_EXPIRED")
      );
      if (sessionExpiredError) {
        await sessionMgr.invalidateSession(userId);
        throw new HttpError(
          401,
          "LinkedIn session expired during search. Please login again."
        );
      }
    } finally {
      await browserManager.closeBrowser();
    }

    // ── 5. Deduplicate + save ────────────────────────────────────────────
    const scrapedUrls = scrapeResult.jobs.map((j) => j.jobUrl);
    const newUrls = await jobRepository.findNewUrls(scrapedUrls);
    const newUrlSet = new Set(newUrls);

    const newJobs = scrapeResult.jobs.filter((j) => newUrlSet.has(j.jobUrl));
    const duplicatesSkipped = scrapeResult.jobs.length - newJobs.length;

    const inserted = await jobRepository.upsertMany(
      jobSearchId,
      "LINKEDIN",
      newJobs
    );

    // ── 6. Update lastRunAt ──────────────────────────────────────────────
    await jobSearchRepository.markLastRun(jobSearchId);

    logger.info("Job search run complete", {
      jobSearchId,
      scraped: scrapeResult.jobs.length,
      new: inserted,
      skipped: duplicatesSkipped,
      errors: scrapeResult.errors.length,
    });

    return {
      jobSearchId,
      totalScraped: scrapeResult.jobs.length,
      newJobs: inserted,
      duplicatesSkipped,
      pagesScraped: scrapeResult.pagesScraped,
      linkedInTotal: scrapeResult.totalFound,
      errors: scrapeResult.errors,
    };
  }

  // ── List Jobs ────────────────────────────────────────────────────────────

  async listJobs(
    jobSearchId: string,
    userId: string,
    filters: JobFilters
  ): Promise<ListJobsResult> {
    // Ownership check
    await this.getSearch(jobSearchId, userId);

    const page = filters.page ?? 1;
    const pageSize = Math.min(filters.pageSize ?? 20, 100);

    const { jobs, total } = await jobRepository.findBySearchId(jobSearchId, {
      ...filters,
      page,
      pageSize,
    });

    return {
      jobs,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  async getJobStats(jobSearchId: string, userId: string) {
    await this.getSearch(jobSearchId, userId);
    return jobRepository.getStatsBySearchId(jobSearchId);
  }
}

export const jobService = new JobService();

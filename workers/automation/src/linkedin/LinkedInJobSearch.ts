import type { Page } from "playwright";
import { LinkedInSelectors, LinkedInUrls, buildJobSearchUrl } from "./LinkedInSelectors.js";
import type { JobSearchParams, JobSearchResult, ScrapedJob } from "../types/automation.types.js";
import { logger } from "../utils/logger.js";
import { longDelay, mediumDelay, randomDelay } from "../utils/delay.js";

const JOBS_PER_PAGE = 25;
const DEFAULT_MAX_PAGES = 5;

/**
 * LinkedInJobSearch — scrapes LinkedIn Jobs search results.
 *
 * Strategy:
 * 1. Build URL with all filters baked in as query params
 * 2. Navigate page by page (URL-based, not clicking Next button)
 * 3. For each page: wait for cards to load → extract data from each card
 * 4. Return all scraped jobs + metadata
 *
 * Does NOT open individual job detail pages — the list card has
 * everything we need (title, company, location, Easy Apply badge, URL).
 * Opening detail pages would be 25x slower and trigger rate limiting.
 */
export class LinkedInJobSearch {
  private readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  // ── Public ─────────────────────────────────────────────────────────────────

  async search(params: JobSearchParams): Promise<JobSearchResult> {
    const maxPages = params.maxPages ?? DEFAULT_MAX_PAGES;
    const allJobs: ScrapedJob[] = [];
    const errors: string[] = [];
    let totalFound = 0;
    let pagesScraped = 0;

    logger.info("Starting LinkedIn job search", {
      keywords: params.keywords,
      location: params.location,
      easyApplyOnly: params.easyApplyOnly,
      remoteOnly: params.remoteOnly,
      maxPages,
    });

    for (let page = 0; page < maxPages; page++) {
      const start = page * JOBS_PER_PAGE;

      const url = buildJobSearchUrl({
        keywords: params.keywords,
        ...(params.location !== undefined && { location: params.location }),
        ...(params.easyApplyOnly !== undefined && { easyApplyOnly: params.easyApplyOnly }),
        ...(params.remoteOnly !== undefined && { remoteOnly: params.remoteOnly }),
        ...(start > 0 && { start }),
      });

      logger.info(`Scraping page ${page + 1}/${maxPages}`, { url, start });

      try {
        const pageResult = await this.scrapePage(url);

        // Capture total count from first page's header
        if (page === 0) {
          totalFound = pageResult.totalCount;
          logger.info(`LinkedIn reports ${totalFound} total results`);
        }

        // No results on first page — bail immediately
        if (page === 0 && pageResult.jobs.length === 0) {
          logger.warn("No jobs found for this search");
          break;
        }

        // Empty page means we've gone past the last page
        if (pageResult.jobs.length === 0) {
          logger.info(`Page ${page + 1} returned 0 jobs — reached end of results`);
          break;
        }

        allJobs.push(...pageResult.jobs);
        errors.push(...pageResult.errors);
        pagesScraped++;

        logger.info(`Page ${page + 1}: extracted ${pageResult.jobs.length} jobs (total so far: ${allJobs.length})`);

        // Don't hit the next page immediately — looks more human
        if (page < maxPages - 1) {
          await randomDelay(2000, 4000);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error(`Failed to scrape page ${page + 1}`, { error: message });
        errors.push(`Page ${page + 1} failed: ${message}`);
        // Don't abort the whole search — partial results are still useful
        break;
      }
    }

    // Deduplicate by jobUrl (same job can appear on multiple pages)
    const unique = deduplicateByUrl(allJobs);

    logger.info("Job search complete", {
      totalFound,
      pagesScraped,
      extracted: allJobs.length,
      afterDedup: unique.length,
      errors: errors.length,
    });

    return {
      jobs: unique,
      totalFound,
      pagesScraped,
      errors,
    };
  }

  // ── Private ────────────────────────────────────────────────────────────────

  private async scrapePage(url: string): Promise<{
    jobs: ScrapedJob[];
    totalCount: number;
    errors: string[];
  }> {
    // Navigate to the search results page
    await this.page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: 20_000,
    });

    // Wait for the results list to appear
    try {
      await this.page
        .locator(LinkedInSelectors.JOBS.RESULTS_LIST)
        .waitFor({ state: "visible", timeout: 10_000 });
    } catch {
      // Check if we've been redirected to login (session expired)
      if (this.page.url().includes("/login")) {
        throw new Error("SESSION_EXPIRED: Redirected to login page during search");
      }
      // Check for no results banner
      const noResults = await this.page
        .locator(LinkedInSelectors.JOBS.NO_RESULTS)
        .isVisible()
        .catch(() => false);
      if (noResults) {
        return { jobs: [], totalCount: 0, errors: [] };
      }
      throw new Error("Results list did not appear within timeout");
    }

    // Wait for loading spinner to disappear
    await this.page
      .locator(LinkedInSelectors.JOBS.LOADING_SPINNER)
      .waitFor({ state: "hidden", timeout: 5_000 })
      .catch(() => null); // non-fatal — spinner may not exist on this page

    // Scroll down the results panel to load all lazy-loaded cards
    await this.scrollResultsList();
    await mediumDelay();

    // Extract total count from header
    const totalCount = await this.extractTotalCount();

    // Extract all job cards on this page
    const { jobs, errors } = await this.extractJobCards();

    return { jobs, totalCount, errors };
  }

  /**
   * Scroll the left results panel to trigger lazy loading of all cards.
   * LinkedIn renders cards lazily — if we don't scroll, we only get ~5.
   */
  private async scrollResultsList(): Promise<void> {
    try {
      const listLocator = this.page.locator(LinkedInSelectors.JOBS.RESULTS_LIST).first();
      const isVisible = await listLocator.isVisible().catch(() => false);
      if (!isVisible) return;

      const selector = ".jobs-search-results-list, .scaffold-layout__list";

      // Scroll in increments to trigger lazy load.
      // The selector is passed as an arg so the callback body stays
      // free of DOM type references (automation tsconfig has no "dom" lib).
      for (let i = 0; i < 5; i++) {
        await this.page.evaluate((sel: string) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const list = (globalThis as any).document?.querySelector(sel);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          if (list) (list as any).scrollTop += 600;
        }, selector);
        await randomDelay(400, 800);
      }

      // Scroll back to top
      await this.page.evaluate((sel: string) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const list = (globalThis as any).document?.querySelector(sel);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if (list) (list as any).scrollTop = 0;
      }, selector);

      await randomDelay(300, 600);
    } catch {
      // Non-fatal — continue with whatever cards loaded
    }
  }

  /**
   * Extract all job cards from the current page.
   * Each card is processed independently — one bad card won't skip the rest.
   */
  private async extractJobCards(): Promise<{
    jobs: ScrapedJob[];
    errors: string[];
  }> {
    const jobs: ScrapedJob[] = [];
    const errors: string[] = [];

    const cards = await this.page
      .locator(LinkedInSelectors.JOBS.JOB_CARD)
      .all();

    logger.debug(`Found ${cards.length} job card elements`);

    for (let i = 0; i < cards.length; i++) {
      try {
        const job = await this.extractSingleCard(cards[i]!);
        if (job) {
          jobs.push(job);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        errors.push(`Card ${i + 1}: ${message}`);
        logger.debug(`Card ${i + 1} extraction failed`, { error: message });
      }
    }

    return { jobs, errors };
  }

  private async extractSingleCard(
    card: ReturnType<Page["locator"]>
  ): Promise<ScrapedJob | null> {
    // ── Title + URL ───────────────────────────────────────────────────────────
    const titleEl = card.locator(LinkedInSelectors.JOBS.CARD_TITLE).first();
    const titleVisible = await titleEl.isVisible().catch(() => false);
    if (!titleVisible) return null;

    const title = await titleEl.textContent().then((t) => t?.trim() ?? "");
    if (!title) return null;

    const rawHref = await titleEl.getAttribute("href").catch(() => null);
    if (!rawHref) return null;

    const jobUrl = cleanJobUrl(rawHref);

    // ── Company ───────────────────────────────────────────────────────────────
    const company = await card
      .locator(LinkedInSelectors.JOBS.CARD_COMPANY)
      .first()
      .textContent()
      .then((t) => t?.trim() ?? "Unknown")
      .catch(() => "Unknown");

    // ── Location ──────────────────────────────────────────────────────────────
    const locationItems = await card
      .locator(LinkedInSelectors.JOBS.CARD_LOCATION)
      .allTextContents()
      .catch(() => [] as string[]);

    // First metadata item is usually location, second is workplace type
    const location = locationItems[0]?.trim() ?? "";

    // ── Remote detection ──────────────────────────────────────────────────────
    // Check URL param (set by our filter), card text, or workplace type badge
    const cardText = (await card.textContent().catch(() => "")) ?? "";
    const isRemote =
      cardText.toLowerCase().includes("remote") ||
      location.toLowerCase().includes("remote");

    // ── Easy Apply badge ──────────────────────────────────────────────────────
    // LinkedIn shows a small "Easy Apply" text or their bug logo on cards
    const isEasyApply =
      cardText.toLowerCase().includes("easy apply");

    // ── Salary ────────────────────────────────────────────────────────────────
    const salary = await card
      .locator(LinkedInSelectors.JOBS.CARD_SALARY)
      .first()
      .textContent()
      .then((t) => t?.trim() ?? null)
      .catch(() => null);

    // ── Posted date ───────────────────────────────────────────────────────────
    // Look for "X days ago", "1 week ago", "Just now" etc in the card text
    const postedMatch = cardText.match(
      /(\d+\s+(?:minute|hour|day|week|month)s?\s+ago|just now|recently)/i
    );
    const postedAt = postedMatch?.[0]?.trim() ?? null;

    return {
      title,
      company,
      location,
      jobUrl,
      isEasyApply,
      isRemote,
      salary,
      postedAt,
    };
  }

  private async extractTotalCount(): Promise<number> {
    try {
      const countEl = this.page
        .locator(LinkedInSelectors.JOBS.RESULT_COUNT)
        .first();
      const text = await countEl.textContent({ timeout: 3_000 }).catch(() => null);
      if (!text) return 0;

      // LinkedIn shows "1,234 results" or "Over 1,000 results"
      const match = text.replace(/,/g, "").match(/(\d+)/);
      return match ? parseInt(match[1]!, 10) : 0;
    } catch {
      return 0;
    }
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Strip LinkedIn tracking params from a job URL.
 * Keeps only the canonical path + jobId so deduplication works correctly.
 *
 * Input:  https://www.linkedin.com/jobs/view/1234567890/?trackingId=abc&refId=xyz
 * Output: https://www.linkedin.com/jobs/view/1234567890/
 */
function cleanJobUrl(href: string): string {
  try {
    // Handle relative URLs
    const base = href.startsWith("http")
      ? href
      : `${LinkedInUrls.BASE}${href}`;

    const url = new URL(base);

    // Keep only the path — strip all query params (they're all tracking)
    return `${url.origin}${url.pathname}`;
  } catch {
    return href;
  }
}

/**
 * Deduplicate an array of scraped jobs by jobUrl.
 * Keeps the first occurrence (earlier pages rank higher on LinkedIn).
 */
function deduplicateByUrl(jobs: ScrapedJob[]): ScrapedJob[] {
  const seen = new Set<string>();
  return jobs.filter((job) => {
    if (seen.has(job.jobUrl)) return false;
    seen.add(job.jobUrl);
    return true;
  });
}

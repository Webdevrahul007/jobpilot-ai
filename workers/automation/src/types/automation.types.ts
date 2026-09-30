import type { BrowserContext, Page } from "playwright";

export interface BrowserConfig {
  headless: boolean;
  slowMo: number;
  sessionDir: string;
}

export interface LaunchOptions {
  storageStatePath?: string;
  headless?: boolean;
}

export interface BrowserSession {
  context: BrowserContext;
  page: Page;
}

export interface StorageState {
  cookies: Array<{
    name: string;
    value: string;
    domain: string;
    path: string;
    expires: number;
    httpOnly: boolean;
    secure: boolean;
    sameSite: "Strict" | "Lax" | "None";
  }>;
  origins: Array<{
    origin: string;
    localStorage: Array<{ name: string; value: string }>;
  }>;
}

export interface LoginResult {
  success: boolean;
  sessionData?: StorageState;
  error?: string;
}

export interface SessionCheckResult {
  isLoggedIn: boolean;
  username?: string;
}

// ── Job Search ─────────────────────────────────────────────────────────────

export interface JobSearchParams {
  keywords: string;
  location?: string;
  easyApplyOnly?: boolean;
  remoteOnly?: boolean;
  maxPages?: number; // default 5 (= 125 jobs max)
}

/**
 * A single job card extracted from LinkedIn search results.
 * This is the raw scraped data — not the DB model.
 */
export interface ScrapedJob {
  title: string;
  company: string;
  location: string;
  jobUrl: string;         // canonical URL, tracking params stripped
  isEasyApply: boolean;
  isRemote: boolean;
  salary: string | null;
  postedAt: string | null; // raw string e.g. "2 days ago" — parsed later
}

export interface JobSearchResult {
  jobs: ScrapedJob[];
  totalFound: number;     // count from LinkedIn's "X results" header
  pagesScraped: number;
  errors: string[];       // non-fatal per-card errors logged here
}

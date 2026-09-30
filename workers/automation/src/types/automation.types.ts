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
  maxPages?: number;
}

export interface ScrapedJob {
  title: string;
  company: string;
  location: string;
  jobUrl: string;
  isEasyApply: boolean;
  isRemote: boolean;
  salary: string | null;
  postedAt: string | null;
}

export interface JobSearchResult {
  jobs: ScrapedJob[];
  totalFound: number;
  pagesScraped: number;
  errors: string[];
}

// ── Easy Apply Detection ───────────────────────────────────────────────────

/**
 * Verdict returned for a single job page inspection.
 */
export type DetectionVerdict =
  | "EASY_APPLY"       // "Easy Apply" button confirmed on detail page
  | "EXTERNAL_APPLY"   // "Apply" button → redirects off LinkedIn
  | "ALREADY_APPLIED"  // "Applied" badge shown — user already applied
  | "CLOSED"           // Job no longer accepting applications
  | "NO_BUTTON"        // No apply button found at all
  | "SESSION_EXPIRED"  // Redirected to login mid-run
  | "ERROR";           // Unexpected error inspecting this job

export interface DetectionResult {
  jobId: string;
  jobUrl: string;
  verdict: DetectionVerdict;
  error?: string;
}

export interface BatchDetectionResult {
  processed: number;
  easyApply: number;
  skipped: number;
  errors: number;
  results: DetectionResult[];
}

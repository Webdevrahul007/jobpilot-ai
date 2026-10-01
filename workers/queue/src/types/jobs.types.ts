/**
 * Queue job type definitions — single source of truth.
 *
 * Every queue job must match one of these interfaces.
 * Both the producer (API) and consumer (worker) import from here.
 */

// ── Queue names ───────────────────────────────────────────────────────────────

export const QUEUE_NAMES = {
  SCRAPE: "scrape",
  DETECT: "detect",
  APPLY: "apply",
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

// ── Job payloads ──────────────────────────────────────────────────────────────

/**
 * Scrape job — collect jobs from LinkedIn for a saved search config.
 */
export interface ScrapeJobPayload {
  userId: string;
  jobSearchId: string;
  maxPages?: number;   // default 5
}

/**
 * Detect job — run Easy Apply detection for a search's undetected jobs.
 */
export interface DetectJobPayload {
  userId: string;
  jobSearchId: string;
  concurrency?: number; // default 2
  limit?: number;       // max jobs per run, default 50
}

/**
 * Apply job — run the full submit pipeline for a search's PENDING/IN_PROGRESS jobs.
 */
export interface ApplyJobPayload {
  userId: string;
  jobSearchId: string;
  limit?: number;       // max jobs per run, default 5
  dryRun?: boolean;     // fill forms but don't click Submit
}

// ── Union type for all job data ───────────────────────────────────────────────

export type JobPayload = ScrapeJobPayload | DetectJobPayload | ApplyJobPayload;

// ── Job result stored in QueueJob DB table ────────────────────────────────────

export interface JobResult {
  success: boolean;
  message: string;
  data?: unknown;
  error?: string;
  durationMs: number;
}

// ── Queue stats shape returned by QueueManager ────────────────────────────────

export interface QueueStats {
  name: QueueName;
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
  paused: boolean;
}

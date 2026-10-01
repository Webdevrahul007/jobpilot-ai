import { Queue, QueueEvents } from "bullmq";
import { getRedisOptions } from "../utils/redis.js";
import { logger } from "../utils/logger.js";
import type {
  QueueName,
  QueueStats,
  ScrapeJobPayload,
  DetectJobPayload,
  ApplyJobPayload,
} from "../types/jobs.types.js";
import { QUEUE_NAMES } from "../types/jobs.types.js";

/**
 * Queue configuration per queue type.
 *
 * defaultJobOptions:
 * - attempts: max retries before marking failed
 * - backoff: exponential — waits 2s, 4s, 8s between retries
 * - removeOnComplete: keep last 100 completed jobs for dashboard history
 * - removeOnFail: keep last 200 failed jobs for debugging
 */
const QUEUE_CONFIG = {
  [QUEUE_NAMES.SCRAPE]: {
    attempts: 3,
    backoffDelay: 5_000,   // 5s initial, exponential
  },
  [QUEUE_NAMES.DETECT]: {
    attempts: 2,
    backoffDelay: 10_000,
  },
  [QUEUE_NAMES.APPLY]: {
    attempts: 2,           // apply retries are handled inside the worker itself
    backoffDelay: 30_000,  // 30s — give LinkedIn time to recover
  },
} as const;

const REMOVE_ON_COMPLETE = { count: 100 };
const REMOVE_ON_FAIL = { count: 200 };

/**
 * QueueManager — owns all BullMQ Queue instances.
 *
 * Responsibilities:
 * - Create and hold Queue references (producers)
 * - Provide typed `add*Job()` methods so producers never touch raw BullMQ API
 * - Return queue stats for the dashboard
 *
 * Workers (consumers) are in separate files — QueueManager is producer-only.
 */
export class QueueManager {
  private readonly scrapeQueue: Queue<ScrapeJobPayload>;
  private readonly detectQueue: Queue<DetectJobPayload>;
  private readonly applyQueue: Queue<ApplyJobPayload>;
  private readonly connection = getRedisOptions();

  constructor() {
    this.scrapeQueue = this.createQueue<ScrapeJobPayload>(
      QUEUE_NAMES.SCRAPE,
      QUEUE_CONFIG[QUEUE_NAMES.SCRAPE]
    );
    this.detectQueue = this.createQueue<DetectJobPayload>(
      QUEUE_NAMES.DETECT,
      QUEUE_CONFIG[QUEUE_NAMES.DETECT]
    );
    this.applyQueue = this.createQueue<ApplyJobPayload>(
      QUEUE_NAMES.APPLY,
      QUEUE_CONFIG[QUEUE_NAMES.APPLY]
    );

    logger.info("QueueManager initialized", {
      queues: Object.values(QUEUE_NAMES),
    });
  }

  // ── Add jobs ──────────────────────────────────────────────────────────────

  async addScrapeJob(
    payload: ScrapeJobPayload,
    opts?: { delay?: number; priority?: number }
  ): Promise<string> {
    const job = await this.scrapeQueue.add(
      `scrape:${payload.jobSearchId}`,
      payload,
      {
        ...(opts?.delay !== undefined && { delay: opts.delay }),
        ...(opts?.priority !== undefined && { priority: opts.priority }),
      }
    );
    logger.info("Scrape job enqueued", { jobId: job.id, searchId: payload.jobSearchId });
    return job.id!;
  }

  async addDetectJob(
    payload: DetectJobPayload,
    opts?: { delay?: number }
  ): Promise<string> {
    const job = await this.detectQueue.add(
      `detect:${payload.jobSearchId}`,
      payload,
      { ...(opts?.delay !== undefined && { delay: opts.delay }) }
    );
    logger.info("Detect job enqueued", { jobId: job.id, searchId: payload.jobSearchId });
    return job.id!;
  }

  async addApplyJob(
    payload: ApplyJobPayload,
    opts?: { delay?: number; priority?: number }
  ): Promise<string> {
    const job = await this.applyQueue.add(
      `apply:${payload.jobSearchId}`,
      payload,
      {
        ...(opts?.delay !== undefined && { delay: opts.delay }),
        ...(opts?.priority !== undefined && { priority: opts.priority }),
      }
    );
    logger.info("Apply job enqueued", { jobId: job.id, searchId: payload.jobSearchId });
    return job.id!;
  }

  /**
   * Enqueue the full pipeline for a search in sequence:
   * scrape → detect (after scrape delay) → apply (after detect delay)
   *
   * Uses delays to give each stage time to complete before the next starts.
   * In production, use job completion events instead — but delays work
   * well for the MVP and avoid distributed coordination complexity.
   */
  async addFullPipeline(
    userId: string,
    jobSearchId: string,
    opts?: { scrapePages?: number; applyLimit?: number; dryRun?: boolean }
  ): Promise<{ scrapeJobId: string; detectJobId: string; applyJobId: string }> {
    const SCRAPE_DURATION_ESTIMATE_MS = 3 * 60_000;   // ~3 min
    const DETECT_DURATION_ESTIMATE_MS = 5 * 60_000;   // ~5 min

    const scrapeJobId = await this.addScrapeJob({
      userId,
      jobSearchId,
      maxPages: opts?.scrapePages ?? 5,
    });

    const detectJobId = await this.addDetectJob(
      { userId, jobSearchId, concurrency: 2, limit: 50 },
      { delay: SCRAPE_DURATION_ESTIMATE_MS }
    );

    const applyJobId = await this.addApplyJob(
      {
        userId,
        jobSearchId,
        limit: opts?.applyLimit ?? 5,
        dryRun: opts?.dryRun ?? false,
      },
      { delay: SCRAPE_DURATION_ESTIMATE_MS + DETECT_DURATION_ESTIMATE_MS }
    );

    logger.info("Full pipeline enqueued", {
      userId,
      jobSearchId,
      scrapeJobId,
      detectJobId,
      applyJobId,
    });

    return { scrapeJobId, detectJobId, applyJobId };
  }

  // ── Stats ─────────────────────────────────────────────────────────────────

  async getStats(): Promise<QueueStats[]> {
    const queues = [
      { name: QUEUE_NAMES.SCRAPE as QueueName, q: this.scrapeQueue },
      { name: QUEUE_NAMES.DETECT as QueueName, q: this.detectQueue },
      { name: QUEUE_NAMES.APPLY  as QueueName, q: this.applyQueue  },
    ];

    return Promise.all(
      queues.map(async ({ name, q }) => {
        const counts = await q.getJobCounts(
          "waiting", "active", "completed", "failed", "delayed"
        );
        const isPaused = await q.isPaused();
        return {
          name,
          waiting:   counts["waiting"]   ?? 0,
          active:    counts["active"]    ?? 0,
          completed: counts["completed"] ?? 0,
          failed:    counts["failed"]    ?? 0,
          delayed:   counts["delayed"]   ?? 0,
          paused:    isPaused,
        };
      })
    );
  }

  async getQueueStats(queueName: QueueName): Promise<QueueStats> {
    const q = this.getQueue(queueName);
    const counts = await q.getJobCounts(
      "waiting", "active", "completed", "failed", "delayed"
    );
    const isPaused = await q.isPaused();
    return {
      name: queueName,
      waiting:   counts["waiting"]   ?? 0,
      active:    counts["active"]    ?? 0,
      completed: counts["completed"] ?? 0,
      failed:    counts["failed"]    ?? 0,
      delayed:   counts["delayed"]   ?? 0,
      paused:    isPaused,
    };
  }

  // ── Control ───────────────────────────────────────────────────────────────

  async pauseQueue(name: QueueName): Promise<void> {
    await this.getQueue(name).pause();
    logger.info("Queue paused", { name });
  }

  async resumeQueue(name: QueueName): Promise<void> {
    await this.getQueue(name).resume();
    logger.info("Queue resumed", { name });
  }

  async drainQueue(name: QueueName): Promise<void> {
    await this.getQueue(name).drain();
    logger.info("Queue drained", { name });
  }

  async close(): Promise<void> {
    await Promise.all([
      this.scrapeQueue.close(),
      this.detectQueue.close(),
      this.applyQueue.close(),
    ]);
    logger.info("All queues closed");
  }

  // ── Private ───────────────────────────────────────────────────────────────

  private createQueue<T>(
    name: string,
    config: { attempts: number; backoffDelay: number }
  ): Queue<T> {
    return new Queue<T>(name, {
      connection: this.connection,
      defaultJobOptions: {
        attempts: config.attempts,
        backoff: { type: "exponential", delay: config.backoffDelay },
        removeOnComplete: REMOVE_ON_COMPLETE,
        removeOnFail: REMOVE_ON_FAIL,
      },
    });
  }

  private getQueue(name: QueueName): Queue {
    switch (name) {
      case QUEUE_NAMES.SCRAPE: return this.scrapeQueue;
      case QUEUE_NAMES.DETECT: return this.detectQueue;
      case QUEUE_NAMES.APPLY:  return this.applyQueue;
    }
  }
}

// Singleton — reused by both API and worker process
let _instance: QueueManager | null = null;

export function getQueueManager(): QueueManager {
  if (!_instance) _instance = new QueueManager();
  return _instance;
}

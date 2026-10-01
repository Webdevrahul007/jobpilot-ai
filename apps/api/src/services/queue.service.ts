import { getQueueManager } from "@jobpilot/queue";
import type {
  QueueName,
  QueueStats,
  ScrapeJobPayload,
  DetectJobPayload,
  ApplyJobPayload,
} from "@jobpilot/queue";
import { QUEUE_NAMES } from "@jobpilot/queue";
import { sessionRepository } from "@/repositories/session.repository.js";
import { HttpError } from "@/middlewares/errorHandler.js";
import { logger } from "@/utils/logger.js";

export interface EnqueueScrapeInput {
  userId: string;
  jobSearchId: string;
  maxPages?: number;
}

export interface EnqueueDetectInput {
  userId: string;
  jobSearchId: string;
  concurrency?: number;
  limit?: number;
}

export interface EnqueueApplyInput {
  userId: string;
  jobSearchId: string;
  limit?: number;
  dryRun?: boolean;
}

export interface EnqueuePipelineInput {
  userId: string;
  jobSearchId: string;
  scrapePages?: number;
  applyLimit?: number;
  dryRun?: boolean;
}

/**
 * QueueService — API-side interface to the BullMQ queues.
 *
 * Responsibilities:
 * - Validate session before enqueuing (fast fail — no point queuing
 *   a job that will immediately fail with "no session")
 * - Delegate to QueueManager for the actual enqueue
 * - Return queue stats for the dashboard
 *
 * Does NOT process jobs — that's the worker process's job.
 */
export class QueueService {
  private get qm() {
    return getQueueManager();
  }

  // ── Enqueue individual queues ─────────────────────────────────────────────

  async enqueueScrape(input: EnqueueScrapeInput): Promise<{ jobId: string }> {
    await this.validateSession(input.userId);

    const payload: ScrapeJobPayload = {
      userId: input.userId,
      jobSearchId: input.jobSearchId,
      ...(input.maxPages !== undefined && { maxPages: input.maxPages }),
    };

    const jobId = await this.qm.addScrapeJob(payload);
    logger.info("Scrape job enqueued via API", { jobId, ...input });
    return { jobId };
  }

  async enqueueDetect(input: EnqueueDetectInput): Promise<{ jobId: string }> {
    await this.validateSession(input.userId);

    const payload: DetectJobPayload = {
      userId: input.userId,
      jobSearchId: input.jobSearchId,
      ...(input.concurrency !== undefined && { concurrency: input.concurrency }),
      ...(input.limit !== undefined && { limit: input.limit }),
    };

    const jobId = await this.qm.addDetectJob(payload);
    logger.info("Detect job enqueued via API", { jobId, ...input });
    return { jobId };
  }

  async enqueueApply(input: EnqueueApplyInput): Promise<{ jobId: string }> {
    await this.validateSession(input.userId);

    const payload: ApplyJobPayload = {
      userId: input.userId,
      jobSearchId: input.jobSearchId,
      ...(input.limit !== undefined && { limit: input.limit }),
      ...(input.dryRun !== undefined && { dryRun: input.dryRun }),
    };

    const jobId = await this.qm.addApplyJob(payload);
    logger.info("Apply job enqueued via API", { jobId, ...input });
    return { jobId };
  }

  // ── Enqueue full pipeline ─────────────────────────────────────────────────

  async enqueuePipeline(input: EnqueuePipelineInput): Promise<{
    scrapeJobId: string;
    detectJobId: string;
    applyJobId: string;
  }> {
    await this.validateSession(input.userId);

    const result = await this.qm.addFullPipeline(
      input.userId,
      input.jobSearchId,
      {
        ...(input.scrapePages !== undefined && { scrapePages: input.scrapePages }),
        ...(input.applyLimit !== undefined && { applyLimit: input.applyLimit }),
        ...(input.dryRun !== undefined && { dryRun: input.dryRun }),
      }
    );

    logger.info("Full pipeline enqueued via API", { ...input, ...result });
    return result;
  }

  // ── Stats ─────────────────────────────────────────────────────────────────

  async getAllStats(): Promise<QueueStats[]> {
    return this.qm.getStats();
  }

  async getQueueStats(name: QueueName): Promise<QueueStats> {
    return this.qm.getQueueStats(name);
  }

  // ── Control ───────────────────────────────────────────────────────────────

  async pauseQueue(name: QueueName): Promise<void> {
    await this.qm.pauseQueue(name);
  }

  async resumeQueue(name: QueueName): Promise<void> {
    await this.qm.resumeQueue(name);
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private async validateSession(userId: string): Promise<void> {
    const session = await sessionRepository.findActiveByUserId(userId);
    if (!session) {
      throw new HttpError(401, "No active LinkedIn session. Login first.");
    }
    if (session.expiresAt && session.expiresAt < new Date()) {
      throw new HttpError(401, "LinkedIn session expired. Login again.");
    }
  }
}

export const queueService = new QueueService();

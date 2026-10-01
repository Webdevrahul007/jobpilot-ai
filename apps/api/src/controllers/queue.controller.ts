import type { Request, Response } from "express";
import { z } from "zod";
import { queueService } from "@/services/queue.service.js";
import { sendSuccess } from "@/utils/response.js";
import { QUEUE_NAMES } from "@jobpilot/queue";
import type { QueueName } from "@jobpilot/queue";

// ── Schemas ────────────────────────────────────────────────────────────────

const QueueNameSchema = z.enum([
  QUEUE_NAMES.SCRAPE,
  QUEUE_NAMES.DETECT,
  QUEUE_NAMES.APPLY,
]);

const EnqueueScrapeSchema = z.object({
  userId: z.string().min(1),
  jobSearchId: z.string().min(1),
  maxPages: z.coerce.number().int().min(1).max(20).optional(),
});

const EnqueueDetectSchema = z.object({
  userId: z.string().min(1),
  jobSearchId: z.string().min(1),
  concurrency: z.coerce.number().int().min(1).max(5).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

const EnqueueApplySchema = z.object({
  userId: z.string().min(1),
  jobSearchId: z.string().min(1),
  limit: z.coerce.number().int().min(1).max(20).optional(),
  dryRun: z.boolean().optional().default(false),
});

const EnqueuePipelineSchema = z.object({
  userId: z.string().min(1),
  jobSearchId: z.string().min(1),
  scrapePages: z.coerce.number().int().min(1).max(20).optional(),
  applyLimit: z.coerce.number().int().min(1).max(20).optional(),
  dryRun: z.boolean().optional().default(false),
});

const QueueControlSchema = z.object({
  queue: QueueNameSchema,
});

// ── Handlers ───────────────────────────────────────────────────────────────

/**
 * GET /api/v1/queue/stats
 * All three queue stats — used by the dashboard.
 */
export async function getAllStatsHandler(
  _req: Request,
  res: Response
): Promise<void> {
  const stats = await queueService.getAllStats();
  sendSuccess(res, stats, "Queue stats retrieved");
}

/**
 * GET /api/v1/queue/stats/:queueName
 */
export async function getQueueStatsHandler(
  req: Request,
  res: Response
): Promise<void> {
  const { queueName } = z
    .object({ queueName: QueueNameSchema })
    .parse(req.params);
  const stats = await queueService.getQueueStats(queueName as QueueName);
  sendSuccess(res, stats, "Queue stats retrieved");
}

/**
 * POST /api/v1/queue/scrape
 * Enqueue a scrape job.
 */
export async function enqueueScrapeHandler(
  req: Request,
  res: Response
): Promise<void> {
  const body = EnqueueScrapeSchema.parse(req.body);
  const result = await queueService.enqueueScrape({
    userId: body.userId,
    jobSearchId: body.jobSearchId,
    ...(body.maxPages !== undefined && { maxPages: body.maxPages }),
  });
  sendSuccess(res, result, "Scrape job enqueued", 202);
}

/**
 * POST /api/v1/queue/detect
 */
export async function enqueueDetectHandler(
  req: Request,
  res: Response
): Promise<void> {
  const body = EnqueueDetectSchema.parse(req.body);
  const result = await queueService.enqueueDetect({
    userId: body.userId,
    jobSearchId: body.jobSearchId,
    ...(body.concurrency !== undefined && { concurrency: body.concurrency }),
    ...(body.limit !== undefined && { limit: body.limit }),
  });
  sendSuccess(res, result, "Detect job enqueued", 202);
}

/**
 * POST /api/v1/queue/apply
 */
export async function enqueueApplyHandler(
  req: Request,
  res: Response
): Promise<void> {
  const body = EnqueueApplySchema.parse(req.body);
  const result = await queueService.enqueueApply({
    userId: body.userId,
    jobSearchId: body.jobSearchId,
    ...(body.limit !== undefined && { limit: body.limit }),
    dryRun: body.dryRun,
  });
  sendSuccess(res, result, "Apply job enqueued", 202);
}

/**
 * POST /api/v1/queue/pipeline
 * Enqueue scrape → detect → apply in sequence with delays.
 */
export async function enqueuePipelineHandler(
  req: Request,
  res: Response
): Promise<void> {
  const body = EnqueuePipelineSchema.parse(req.body);
  const result = await queueService.enqueuePipeline({
    userId: body.userId,
    jobSearchId: body.jobSearchId,
    ...(body.scrapePages !== undefined && { scrapePages: body.scrapePages }),
    ...(body.applyLimit !== undefined && { applyLimit: body.applyLimit }),
    dryRun: body.dryRun,
  });
  sendSuccess(res, result, "Full pipeline enqueued", 202);
}

/**
 * POST /api/v1/queue/pause
 * Body: { queue: "scrape" | "detect" | "apply" }
 */
export async function pauseQueueHandler(
  req: Request,
  res: Response
): Promise<void> {
  const { queue } = QueueControlSchema.parse(req.body);
  await queueService.pauseQueue(queue as QueueName);
  sendSuccess(res, { queue, paused: true }, "Queue paused");
}

/**
 * POST /api/v1/queue/resume
 */
export async function resumeQueueHandler(
  req: Request,
  res: Response
): Promise<void> {
  const { queue } = QueueControlSchema.parse(req.body);
  await queueService.resumeQueue(queue as QueueName);
  sendSuccess(res, { queue, paused: false }, "Queue resumed");
}

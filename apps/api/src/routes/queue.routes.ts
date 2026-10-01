import { Router } from "express";
import {
  getAllStatsHandler,
  getQueueStatsHandler,
  enqueueScrapeHandler,
  enqueueDetectHandler,
  enqueueApplyHandler,
  enqueuePipelineHandler,
  pauseQueueHandler,
  resumeQueueHandler,
} from "@/controllers/queue.controller.js";

const router = Router();

/**
 * Queue Routes
 *
 * GET   /api/v1/queue/stats              — all queue stats
 * GET   /api/v1/queue/stats/:queueName   — single queue stats
 * POST  /api/v1/queue/scrape             — enqueue scrape job
 * POST  /api/v1/queue/detect             — enqueue detect job
 * POST  /api/v1/queue/apply              — enqueue apply job
 * POST  /api/v1/queue/pipeline           — enqueue full pipeline
 * POST  /api/v1/queue/pause              — pause a queue
 * POST  /api/v1/queue/resume             — resume a queue
 */
router.get("/stats", getAllStatsHandler);
router.get("/stats/:queueName", getQueueStatsHandler);
router.post("/scrape", enqueueScrapeHandler);
router.post("/detect", enqueueDetectHandler);
router.post("/apply", enqueueApplyHandler);
router.post("/pipeline", enqueuePipelineHandler);
router.post("/pause", pauseQueueHandler);
router.post("/resume", resumeQueueHandler);

export default router;

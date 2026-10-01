/**
 * Worker process entry point.
 *
 * Run with:  npm run worker:dev --workspace=workers/queue
 * Production: npm run worker --workspace=workers/queue
 *
 * This process is separate from the API server. It:
 * 1. Boots all three BullMQ workers (scrape, detect, apply)
 * 2. Keeps running until SIGTERM/SIGINT
 * 3. Gracefully closes all workers on shutdown
 */

import path from "path";
import dotenv from "dotenv";
dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

import { createScrapeWorker } from "./workers/ScrapeWorker.js";
import { createDetectWorker } from "./workers/DetectWorker.js";
import { createApplyWorker } from "./workers/ApplyWorker.js";
import { logger } from "./utils/logger.js";

logger.info("🚀 JobPilot Queue Worker starting...");
logger.info("Redis URL", { url: (process.env["REDIS_URL"] ?? "redis://localhost:6379").replace(/:([^:@]{1,50})@/, ":***@") });

const scrapeWorker = createScrapeWorker();
const detectWorker = createDetectWorker();
const applyWorker  = createApplyWorker();

logger.info("✅ All workers running", {
  queues: ["scrape (concurrency:1)", "detect (concurrency:2)", "apply (concurrency:1)"],
});

// ── Graceful shutdown ─────────────────────────────────────────────────────────

const shutdown = async (signal: string) => {
  logger.info(`${signal} received — shutting down workers gracefully`);

  try {
    await Promise.all([
      scrapeWorker.close(),
      detectWorker.close(),
      applyWorker.close(),
    ]);
    logger.info("All workers closed cleanly");
    process.exit(0);
  } catch (err) {
    logger.error("Error during shutdown", { err });
    process.exit(1);
  }
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT",  () => shutdown("SIGINT"));

process.on("unhandledRejection", (reason) => {
  logger.error("Unhandled promise rejection in worker process", { reason });
});

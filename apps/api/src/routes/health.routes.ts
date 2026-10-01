import { Router } from "express";
import type { Request, Response } from "express";
import { Redis } from "ioredis";
import { sendSuccess, sendError } from "@/utils/response.js";
import { env } from "@/config/env.js";
import prisma from "@/lib/prisma.js";

const router = Router();

/**
 * GET /api/v1/health
 * Basic liveness — process is running. No external checks.
 * Kept for backwards compatibility.
 */
router.get("/", (_req: Request, res: Response) => {
  sendSuccess(res, {
    status: "ok",
    timestamp: new Date().toISOString(),
    uptime: Math.floor(process.uptime()),
    environment: env.NODE_ENV,
  });
});

/**
 * GET /api/v1/health/live
 * Liveness probe — process is alive and event loop is responsive.
 * Used by Docker HEALTHCHECK and Railway.
 *
 * Returns 200 as long as the Node process is running.
 * Never checks external dependencies — a slow DB should not cause
 * the container to be killed and restarted (that makes things worse).
 */
router.get("/live", (_req: Request, res: Response) => {
  res.status(200).json({
    status: "live",
    timestamp: new Date().toISOString(),
    uptime: Math.floor(process.uptime()),
    memoryMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
    pid: process.pid,
  });
});

/**
 * GET /api/v1/health/ready
 * Readiness probe — can the service handle requests?
 * Checks DB connection + Redis connection.
 *
 * Returns 200 only when all dependencies are healthy.
 * Returns 503 with details on which dependency failed.
 *
 * Used by: load balancers, Railway zero-downtime deploys,
 *          k8s readiness probes.
 */
router.get("/ready", async (_req: Request, res: Response) => {
  const checks: Record<string, { ok: boolean; latencyMs?: number; error?: string }> = {};

  // ── DB check ─────────────────────────────────────────────────────────────
  const dbStart = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    checks["database"] = { ok: true, latencyMs: Date.now() - dbStart };
  } catch (err) {
    checks["database"] = {
      ok: false,
      latencyMs: Date.now() - dbStart,
      error: err instanceof Error ? err.message : "DB check failed",
    };
  }

  // ── Redis check ───────────────────────────────────────────────────────────
  const redisStart = Date.now();
  let redisClient: Redis | null = null;
  try {
    redisClient = new Redis(env.REDIS_URL, {
      maxRetriesPerRequest: 1,
      connectTimeout: 3_000,
      lazyConnect: true,
    });
    await redisClient.connect();
    await redisClient.ping();
    checks["redis"] = { ok: true, latencyMs: Date.now() - redisStart };
  } catch (err) {
    checks["redis"] = {
      ok: false,
      latencyMs: Date.now() - redisStart,
      error: err instanceof Error ? err.message : "Redis check failed",
    };
  } finally {
    await redisClient?.quit().catch(() => null);
  }

  // ── Resume file check ─────────────────────────────────────────────────────
  try {
    const { existsSync } = await import("fs");
    const resumeExists = existsSync(env.RESUME_FILE_PATH);
    checks["resumeFile"] = { ok: resumeExists };
    if (!resumeExists) {
      checks["resumeFile"]!.error = `Resume not found: ${env.RESUME_FILE_PATH}`;
    }
  } catch {
    checks["resumeFile"] = { ok: false, error: "Could not check resume file" };
  }

  const allOk = Object.values(checks).every((c) => c.ok);
  const criticalOk = checks["database"]?.ok && checks["redis"]?.ok;

  const payload = {
    status: allOk ? "ready" : criticalOk ? "degraded" : "not_ready",
    timestamp: new Date().toISOString(),
    checks,
  };

  // 503 only if critical services (DB + Redis) are down
  // 200 with status="degraded" if only optional checks fail (resume file)
  if (!criticalOk) {
    sendError(res, "Service not ready", 503, JSON.stringify(payload));
    return;
  }

  sendSuccess(res, payload, allOk ? "Service ready" : "Service degraded");
});

export default router;

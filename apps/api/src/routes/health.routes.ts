import { Router } from "express";
import type { Request, Response } from "express";
import { sendSuccess } from "@/utils/response.js";

const router = Router();

/**
 * GET /api/v1/health
 * Simple liveness probe — used by Docker, load balancers, and Railway.
 */
router.get("/", (_req: Request, res: Response) => {
  sendSuccess(res, {
    status: "ok",
    timestamp: new Date().toISOString(),
    uptime: Math.floor(process.uptime()),
    environment: process.env["NODE_ENV"] ?? "development",
  });
});

export default router;

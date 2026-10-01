import { Router } from "express";
import { runSubmitHandler, submitStatsHandler } from "@/controllers/submit.controller.js";

const router = Router();

/**
 * Apply Routes
 *
 * POST  /api/v1/apply/run       — run full apply pipeline (dryRun supported)
 * GET   /api/v1/apply/stats     — aggregated status counts
 */
router.post("/run", runSubmitHandler);
router.get("/stats", submitStatsHandler);

export default router;

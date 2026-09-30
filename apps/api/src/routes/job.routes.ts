import { Router } from "express";
import {
  createSearchHandler,
  listSearchesHandler,
  deleteSearchHandler,
  runSearchHandler,
  listJobsHandler,
  jobStatsHandler,
} from "@/controllers/job.controller.js";

const router = Router();

/**
 * Job Search Routes
 *
 * POST   /api/v1/jobs/searches                      — create search config
 * GET    /api/v1/jobs/searches?userId=              — list all searches
 * DELETE /api/v1/jobs/searches/:searchId?userId=    — delete a search
 * POST   /api/v1/jobs/searches/:searchId/run        — trigger a search run
 * GET    /api/v1/jobs/searches/:searchId/jobs       — list collected jobs
 * GET    /api/v1/jobs/searches/:searchId/stats      — aggregated stats
 */
router.post("/searches", createSearchHandler);
router.get("/searches", listSearchesHandler);
router.delete("/searches/:searchId", deleteSearchHandler);
router.post("/searches/:searchId/run", runSearchHandler);
router.get("/searches/:searchId/jobs", listJobsHandler);
router.get("/searches/:searchId/stats", jobStatsHandler);

export default router;

import { Router } from "express";
import {
  runDetectionHandler,
  listApplicationsHandler,
  applicationCountsHandler,
} from "@/controllers/detection.controller.js";

const router = Router();

/**
 * Detection Routes
 *
 * POST  /api/v1/detect/searches/:searchId/run   — run detection batch
 * GET   /api/v1/detect/applications             — list applications
 * GET   /api/v1/detect/applications/counts      — status summary counts
 */
router.post("/searches/:searchId/run", runDetectionHandler);
router.get("/applications/counts", applicationCountsHandler);  // before /applications to avoid param clash
router.get("/applications", listApplicationsHandler);

export default router;

import { Router } from "express";
import {
  resumeStatusHandler,
  runResumeUploadHandler,
} from "@/controllers/resume.controller.js";

const router = Router();

/**
 * Resume Routes
 *
 * GET   /api/v1/resume/status   — check PDF exists on disk
 * POST  /api/v1/resume/upload   — trigger resume upload run
 */
router.get("/status", resumeStatusHandler);
router.post("/upload", runResumeUploadHandler);

export default router;

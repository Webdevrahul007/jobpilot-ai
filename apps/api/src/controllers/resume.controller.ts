import type { Request, Response } from "express";
import { z } from "zod";
import { resumeService } from "@/services/resume.service.js";
import { sendSuccess, sendError } from "@/utils/response.js";

// ── Schemas ────────────────────────────────────────────────────────────────

const RunResumeSchema = z.object({
  userId: z.string().min(1),
  jobId: z.string().optional(),
  jobSearchId: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
}).refine((d) => d.jobId !== undefined || d.jobSearchId !== undefined, {
  message: "Either jobId or jobSearchId is required",
});

// ── Handlers ───────────────────────────────────────────────────────────────

/**
 * GET /api/v1/resume/status
 * Check whether the resume PDF exists on the server and is ready to use.
 */
export async function resumeStatusHandler(
  _req: Request,
  res: Response
): Promise<void> {
  const status = resumeService.validateResumeFile();

  if (!status.exists) {
    sendError(
      res,
      `Resume file not found at: ${status.path}. Upload Rahul_Jangid_Resume.pdf to the resumes/ folder.`,
      404
    );
    return;
  }

  sendSuccess(res, status, "Resume file is ready");
}

/**
 * POST /api/v1/resume/upload
 * Trigger resume upload for one job (jobId) or all PENDING jobs in a search (jobSearchId).
 */
export async function runResumeUploadHandler(
  req: Request,
  res: Response
): Promise<void> {
  const body = RunResumeSchema.parse(req.body);

  const result = await resumeService.runResumeUpload({
    userId: body.userId,
    ...(body.jobId !== undefined && { jobId: body.jobId }),
    ...(body.jobSearchId !== undefined && { jobSearchId: body.jobSearchId }),
    ...(body.limit !== undefined && { limit: body.limit }),
  });

  sendSuccess(res, result, "Resume upload run complete");
}

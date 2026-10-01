import type { Request, Response } from "express";
import { z } from "zod";
import { submitService } from "@/services/submit.service.js";
import { sendSuccess } from "@/utils/response.js";

// ── Schemas ────────────────────────────────────────────────────────────────

const RunSubmitSchema = z
  .object({
    userId: z.string().min(1),
    jobId: z.string().optional(),
    jobSearchId: z.string().optional(),
    limit: z.coerce.number().int().min(1).max(20).optional(),
    dryRun: z.boolean().optional().default(false),
  })
  .refine((d) => d.jobId !== undefined || d.jobSearchId !== undefined, {
    message: "Either jobId or jobSearchId is required",
  });

// ── Handlers ───────────────────────────────────────────────────────────────

/**
 * POST /api/v1/apply/run
 * Run the full apply pipeline for one job or a batch.
 * Set dryRun: true to fill forms but not click Submit.
 */
export async function runSubmitHandler(
  req: Request,
  res: Response
): Promise<void> {
  const body = RunSubmitSchema.parse(req.body);

  const result = await submitService.runSubmit({
    userId: body.userId,
    ...(body.jobId !== undefined && { jobId: body.jobId }),
    ...(body.jobSearchId !== undefined && { jobSearchId: body.jobSearchId }),
    ...(body.limit !== undefined && { limit: body.limit }),
    dryRun: body.dryRun,
  });

  sendSuccess(res, result, result.dryRun ? "Dry run complete" : "Apply run complete");
}

/**
 * GET /api/v1/apply/stats?userId=
 * Aggregated application status counts for the dashboard.
 */
export async function submitStatsHandler(
  req: Request,
  res: Response
): Promise<void> {
  const { userId } = z.object({ userId: z.string().min(1) }).parse(req.query);
  const stats = await submitService.getSubmitStats(userId);
  sendSuccess(res, stats, "Application stats retrieved");
}

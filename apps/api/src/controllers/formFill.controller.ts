import type { Request, Response } from "express";
import { z } from "zod";
import { formFillService } from "@/services/formFill.service.js";
import { sendSuccess } from "@/utils/response.js";

const RunFormFillSchema = z
  .object({
    userId: z.string().min(1),
    jobId: z.string().optional(),
    jobSearchId: z.string().optional(),
    limit: z.coerce.number().int().min(1).max(20).optional(),
  })
  .refine((d) => d.jobId !== undefined || d.jobSearchId !== undefined, {
    message: "Either jobId or jobSearchId is required",
  });

/**
 * POST /api/v1/form/fill
 * Run the form fill pipeline for one job or all IN_PROGRESS jobs in a search.
 */
export async function runFormFillHandler(
  req: Request,
  res: Response
): Promise<void> {
  const body = RunFormFillSchema.parse(req.body);

  const result = await formFillService.runFormFill({
    userId: body.userId,
    ...(body.jobId !== undefined && { jobId: body.jobId }),
    ...(body.jobSearchId !== undefined && { jobSearchId: body.jobSearchId }),
    ...(body.limit !== undefined && { limit: body.limit }),
  });

  sendSuccess(res, result, "Form fill run complete");
}

/**
 * GET /api/v1/form/answers/:applicationId?userId=
 * Retrieve all form answers stored for a specific application.
 */
export async function getFormAnswersHandler(
  req: Request,
  res: Response
): Promise<void> {
  const { applicationId } = z
    .object({ applicationId: z.string().min(1) })
    .parse(req.params);
  const { userId } = z.object({ userId: z.string().min(1) }).parse(req.query);

  const answers = await formFillService.getFormAnswers(applicationId, userId);
  sendSuccess(res, answers, "Form answers retrieved");
}

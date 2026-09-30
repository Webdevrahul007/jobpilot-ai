import type { Request, Response } from "express";
import { z } from "zod";
import { detectionService } from "@/services/detection.service.js";
import { sendSuccess } from "@/utils/response.js";

// ── Validation schemas ─────────────────────────────────────────────────────

const RunDetectionSchema = z.object({
  userId: z.string().min(1),
  concurrency: z.coerce.number().int().min(1).max(5).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

const ListApplicationsSchema = z.object({
  userId: z.string().min(1),
  status: z
    .enum(["PENDING", "IN_PROGRESS", "APPLIED", "SKIPPED", "FAILED"])
    .optional(),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
});

// ── Handlers ───────────────────────────────────────────────────────────────

/**
 * POST /api/v1/detect/searches/:searchId/run
 * Trigger a detection run for all undetected jobs in a search.
 */
export async function runDetectionHandler(
  req: Request,
  res: Response
): Promise<void> {
  const { searchId } = z
    .object({ searchId: z.string().min(1) })
    .parse(req.params);
  const body = RunDetectionSchema.parse(req.body);

  const result = await detectionService.runDetection({
    userId: body.userId,
    jobSearchId: searchId,
    ...(body.concurrency !== undefined && { concurrency: body.concurrency }),
    ...(body.limit !== undefined && { limit: body.limit }),
  });

  sendSuccess(res, result, "Detection run complete");
}

/**
 * GET /api/v1/detect/applications?userId=&status=&page=&pageSize=
 * List all applications for a user with optional status filter.
 */
export async function listApplicationsHandler(
  req: Request,
  res: Response
): Promise<void> {
  const query = ListApplicationsSchema.parse(req.query);

  const result = await detectionService.listApplications(query.userId, {
    ...(query.status !== undefined && { status: query.status }),
    ...(query.page !== undefined && { page: query.page }),
    ...(query.pageSize !== undefined && { pageSize: query.pageSize }),
  });

  sendSuccess(res, result, "Applications retrieved", 200, {
    page: result.page,
    pageSize: result.pageSize,
    total: result.total,
    totalPages: result.totalPages,
  });
}

/**
 * GET /api/v1/detect/applications/counts?userId=
 * Aggregated counts per status — used by the dashboard summary cards.
 */
export async function applicationCountsHandler(
  req: Request,
  res: Response
): Promise<void> {
  const { userId } = z.object({ userId: z.string().min(1) }).parse(req.query);
  const counts = await detectionService.getApplicationCounts(userId);
  sendSuccess(res, counts, "Application counts retrieved");
}

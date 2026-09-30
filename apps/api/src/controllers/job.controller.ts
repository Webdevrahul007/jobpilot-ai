import type { Request, Response } from "express";
import { z } from "zod";
import { jobService } from "@/services/job.service.js";
import { sendSuccess } from "@/utils/response.js";

// ── Validation schemas ─────────────────────────────────────────────────────

const CreateSearchSchema = z.object({
  userId: z.string().min(1),
  name: z.string().min(1, "Search name is required"),
  keywords: z.string().min(1, "Keywords are required"),
  location: z.string().optional(),
  remote: z.boolean().optional(),
});

const RunSearchSchema = z.object({
  userId: z.string().min(1),
  maxPages: z.coerce.number().int().min(1).max(20).optional(),
});

const ListJobsSchema = z.object({
  userId: z.string().min(1),
  isEasyApply: z
    .string()
    .optional()
    .transform((v) => (v === undefined ? undefined : v === "true")),
  isRemote: z
    .string()
    .optional()
    .transform((v) => (v === undefined ? undefined : v === "true")),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
});

// ── Handlers ───────────────────────────────────────────────────────────────

/**
 * POST /api/v1/jobs/searches
 * Create a new saved job search config.
 */
export async function createSearchHandler(
  req: Request,
  res: Response
): Promise<void> {
  const body = CreateSearchSchema.parse(req.body);
  const search = await jobService.createSearch({
    userId: body.userId,
    name: body.name,
    keywords: body.keywords,
    ...(body.location !== undefined && { location: body.location }),
    ...(body.remote !== undefined && { remote: body.remote }),
  });
  sendSuccess(res, search, "Job search created", 201);
}

/**
 * GET /api/v1/jobs/searches?userId=
 * List all saved searches for a user.
 */
export async function listSearchesHandler(
  req: Request,
  res: Response
): Promise<void> {
  const { userId } = z.object({ userId: z.string().min(1) }).parse(req.query);
  const searches = await jobService.listSearches(userId);
  sendSuccess(res, searches, "Job searches retrieved");
}

/**
 * DELETE /api/v1/jobs/searches/:searchId?userId=
 * Delete a saved search (and all its collected jobs via cascade).
 */
export async function deleteSearchHandler(
  req: Request,
  res: Response
): Promise<void> {
  const { searchId } = z.object({ searchId: z.string().min(1) }).parse(req.params);
  const { userId } = z.object({ userId: z.string().min(1) }).parse(req.query);
  await jobService.deleteSearch(searchId, userId);
  sendSuccess(res, null, "Job search deleted");
}

/**
 * POST /api/v1/jobs/searches/:searchId/run
 * Trigger a live LinkedIn search run for a saved config.
 * This opens a browser, scrapes LinkedIn, saves to DB, and returns a summary.
 */
export async function runSearchHandler(
  req: Request,
  res: Response
): Promise<void> {
  const { searchId } = z
    .object({ searchId: z.string().min(1) })
    .parse(req.params);
  const body = RunSearchSchema.parse(req.body);

  const result = await jobService.runSearch({
    userId: body.userId,
    jobSearchId: searchId,
    ...(body.maxPages !== undefined && { maxPages: body.maxPages }),
  });

  sendSuccess(res, result, "Search run complete");
}

/**
 * GET /api/v1/jobs/searches/:searchId/jobs
 * List all jobs collected for a search, with optional filters + pagination.
 */
export async function listJobsHandler(
  req: Request,
  res: Response
): Promise<void> {
  const { searchId } = z
    .object({ searchId: z.string().min(1) })
    .parse(req.params);
  const query = ListJobsSchema.parse(req.query);

  const result = await jobService.listJobs(searchId, query.userId, {
    ...(query.isEasyApply !== undefined && { isEasyApply: query.isEasyApply }),
    ...(query.isRemote !== undefined && { isRemote: query.isRemote }),
    ...(query.page !== undefined && { page: query.page }),
    ...(query.pageSize !== undefined && { pageSize: query.pageSize }),
  });

  sendSuccess(res, result, "Jobs retrieved", 200, {
    page: result.page,
    pageSize: result.pageSize,
    total: result.total,
    totalPages: result.totalPages,
  });
}

/**
 * GET /api/v1/jobs/searches/:searchId/stats
 * Aggregated stats for a search (total, easyApply, applied, etc.)
 */
export async function jobStatsHandler(
  req: Request,
  res: Response
): Promise<void> {
  const { searchId } = z
    .object({ searchId: z.string().min(1) })
    .parse(req.params);
  const { userId } = z.object({ userId: z.string().min(1) }).parse(req.query);

  const stats = await jobService.getJobStats(searchId, userId);
  sendSuccess(res, stats, "Job stats retrieved");
}

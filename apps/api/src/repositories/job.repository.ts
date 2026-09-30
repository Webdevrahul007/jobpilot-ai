import prisma from "@/lib/prisma.js";
import type { Job, JobSource, Prisma } from "@prisma/client";
import type { ScrapedJob } from "@jobpilot/automation";

export interface JobFilters {
  jobSearchId?: string;
  isEasyApply?: boolean;
  isRemote?: boolean;
  source?: JobSource;
  page?: number;
  pageSize?: number;
}

/**
 * JobRepository — all DB operations for the Job model.
 *
 * Key design decisions:
 * - upsertMany() uses createMany with skipDuplicates instead of individual
 *   upserts — one round-trip for a full page of 25 jobs instead of 25.
 * - jobUrl has a @unique constraint so skipDuplicates silently ignores
 *   jobs we've already seen across any previous search run.
 * - findNewUrls() lets the service filter scraped URLs before hitting the
 *   DB — cheap existence check before a bulk write.
 */
export class JobRepository {
  /**
   * Bulk insert scraped jobs. Silently skips any jobUrl already in the DB.
   * Returns the count of actually inserted (new) jobs.
   */
  async upsertMany(
    jobSearchId: string,
    source: JobSource,
    jobs: ScrapedJob[]
  ): Promise<number> {
    if (jobs.length === 0) return 0;

    const data: Prisma.JobCreateManyInput[] = jobs.map((j) => ({
      jobSearchId,
      source,
      title: j.title,
      company: j.company,
      location: j.location || null,
      jobUrl: j.jobUrl,
      isEasyApply: j.isEasyApply,
      isRemote: j.isRemote,
      salary: j.salary,
      postedAt: parseRelativeDate(j.postedAt),
    }));

    const result = await prisma.job.createMany({
      data,
      skipDuplicates: true,
    });

    return result.count;
  }

  /**
   * Given a list of URLs, return only the ones NOT already in the DB.
   * Used to report how many jobs are truly new vs already collected.
   */
  async findNewUrls(urls: string[]): Promise<string[]> {
    if (urls.length === 0) return [];

    const existing = await prisma.job.findMany({
      where: { jobUrl: { in: urls } },
      select: { jobUrl: true },
    });

    const existingSet = new Set(existing.map((j) => j.jobUrl));
    return urls.filter((url) => !existingSet.has(url));
  }

  /**
   * Paginated list of jobs for a given search, with optional filters.
   */
  async findBySearchId(
    jobSearchId: string,
    filters: JobFilters = {}
  ): Promise<{ jobs: Job[]; total: number }> {
    const page = filters.page ?? 1;
    const pageSize = filters.pageSize ?? 20;
    const skip = (page - 1) * pageSize;

    const where: Prisma.JobWhereInput = {
      jobSearchId,
      ...(filters.isEasyApply !== undefined && { isEasyApply: filters.isEasyApply }),
      ...(filters.isRemote !== undefined && { isRemote: filters.isRemote }),
    };

    const [jobs, total] = await prisma.$transaction([
      prisma.job.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take: pageSize,
        include: { application: { select: { status: true } } },
      }),
      prisma.job.count({ where }),
    ]);

    return { jobs, total };
  }

  /**
   * Stats for a job search: how many jobs, how many are Easy Apply, etc.
   */
  async getStatsBySearchId(jobSearchId: string): Promise<{
    total: number;
    easyApply: number;
    remote: number;
    applied: number;
    pending: number;
    failed: number;
    skipped: number;
  }> {
    const [total, easyApply, remote, applied, pending, failed, skipped] =
      await prisma.$transaction([
        prisma.job.count({ where: { jobSearchId } }),
        prisma.job.count({ where: { jobSearchId, isEasyApply: true } }),
        prisma.job.count({ where: { jobSearchId, isRemote: true } }),
        prisma.job.count({
          where: { jobSearchId, application: { status: "APPLIED" } },
        }),
        prisma.job.count({
          where: { jobSearchId, application: { status: "PENDING" } },
        }),
        prisma.job.count({
          where: { jobSearchId, application: { status: "FAILED" } },
        }),
        prisma.job.count({
          where: { jobSearchId, application: { status: "SKIPPED" } },
        }),
      ]);

    return { total, easyApply, remote, applied, pending, failed, skipped };
  }

  async findById(id: string): Promise<Job | null> {
    return prisma.job.findUnique({ where: { id } });
  }

  async findByUrl(jobUrl: string): Promise<Job | null> {
    return prisma.job.findUnique({ where: { jobUrl } });
  }
}

export const jobRepository = new JobRepository();

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Convert LinkedIn's relative time strings to approximate Date objects.
 * These are rough — we don't need precision, just searchability.
 *
 * "2 days ago"   → now - 2 days
 * "1 week ago"   → now - 7 days
 * "Just now"     → now
 * null           → null
 */
function parseRelativeDate(relative: string | null): Date | null {
  if (!relative) return null;

  const now = new Date();
  const lower = relative.toLowerCase().trim();

  if (lower === "just now" || lower === "recently") return now;

  const match = lower.match(/(\d+)\s+(minute|hour|day|week|month)/);
  if (!match) return null;

  const value = parseInt(match[1]!, 10);
  const unit = match[2]!;

  const ms = {
    minute: 60_000,
    hour: 3_600_000,
    day: 86_400_000,
    week: 604_800_000,
    month: 2_592_000_000,
  }[unit];

  if (!ms) return null;
  return new Date(now.getTime() - value * ms);
}

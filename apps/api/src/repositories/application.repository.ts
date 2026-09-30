import prisma from "@/lib/prisma.js";
import type { Application, ApplicationStatus, Prisma } from "@prisma/client";

export interface CreateApplicationInput {
  jobId: string;
  userId: string;
  status: ApplicationStatus;
  failureReason?: string;
}

export interface ApplicationFilters {
  userId?: string;
  status?: ApplicationStatus;
  page?: number;
  pageSize?: number;
}

/**
 * ApplicationRepository — all DB operations for the Application model.
 *
 * Design notes:
 * - upsertForJob() uses upsert so calling it twice for the same job is safe.
 *   Detection runs can be re-run without creating duplicate rows.
 * - bulkCreateSkipped() inserts many SKIPPED applications in one transaction
 *   — used when a batch of external-apply jobs all need to be dismissed at once.
 * - The Application table has @unique on jobId, so one job → one application.
 */
export class ApplicationRepository {
  /**
   * Upsert a single application for a job.
   * If an application already exists for this job, updates its status.
   */
  async upsertForJob(input: CreateApplicationInput): Promise<Application> {
    return prisma.application.upsert({
      where: { jobId: input.jobId },
      create: {
        jobId: input.jobId,
        userId: input.userId,
        status: input.status,
        ...(input.failureReason !== undefined && {
          failureReason: input.failureReason,
        }),
      },
      update: {
        status: input.status,
        ...(input.failureReason !== undefined && {
          failureReason: input.failureReason,
        }),
      },
    });
  }

  /**
   * Bulk upsert multiple applications in a single transaction.
   * Used after a detection batch to persist all verdicts at once.
   * Returns the count of rows created or updated.
   */
  async bulkUpsert(inputs: CreateApplicationInput[]): Promise<number> {
    if (inputs.length === 0) return 0;

    // Prisma doesn't have a native bulkUpsert — we use a transaction
    // of individual upserts. For batches up to ~100 this is fine.
    // Phase 9 (queue) will naturally keep batches small anyway.
    const ops = inputs.map((input) =>
      prisma.application.upsert({
        where: { jobId: input.jobId },
        create: {
          jobId: input.jobId,
          userId: input.userId,
          status: input.status,
          ...(input.failureReason !== undefined && {
            failureReason: input.failureReason,
          }),
        },
        update: {
          status: input.status,
          ...(input.failureReason !== undefined && {
            failureReason: input.failureReason,
          }),
        },
      })
    );

    const results = await prisma.$transaction(ops);
    return results.length;
  }

  async findByJobId(jobId: string): Promise<Application | null> {
    return prisma.application.findUnique({ where: { jobId } });
  }

  async findById(id: string): Promise<Application | null> {
    return prisma.application.findUnique({ where: { id } });
  }

  /**
   * Paginated list of applications for a user, with optional status filter.
   */
  async findByUserId(
    userId: string,
    filters: ApplicationFilters = {}
  ): Promise<{ applications: Application[]; total: number }> {
    const page = filters.page ?? 1;
    const pageSize = filters.pageSize ?? 20;
    const skip = (page - 1) * pageSize;

    const where: Prisma.ApplicationWhereInput = {
      userId,
      ...(filters.status !== undefined && { status: filters.status }),
    };

    const [applications, total] = await prisma.$transaction([
      prisma.application.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take: pageSize,
        include: {
          job: {
            select: {
              title: true,
              company: true,
              location: true,
              jobUrl: true,
              isEasyApply: true,
            },
          },
        },
      }),
      prisma.application.count({ where }),
    ]);

    return { applications, total };
  }

  /**
   * Update a single application's status (used by Phase 7 — submit).
   */
  async updateStatus(
    id: string,
    status: ApplicationStatus,
    extra?: { failureReason?: string; appliedAt?: Date; screenshotUrl?: string }
  ): Promise<Application> {
    return prisma.application.update({
      where: { id },
      data: {
        status,
        ...(extra?.failureReason !== undefined && {
          failureReason: extra.failureReason,
        }),
        ...(extra?.appliedAt !== undefined && { appliedAt: extra.appliedAt }),
        ...(extra?.screenshotUrl !== undefined && {
          screenshotUrl: extra.screenshotUrl,
        }),
      },
    });
  }

  /**
   * Aggregate counts per status for a user — used by the dashboard.
   */
  async getStatusCounts(userId: string): Promise<Record<ApplicationStatus, number>> {
    const rows = await prisma.application.groupBy({
      by: ["status"],
      where: { userId },
      _count: { status: true },
    });

    const counts: Record<string, number> = {
      PENDING: 0,
      IN_PROGRESS: 0,
      APPLIED: 0,
      SKIPPED: 0,
      FAILED: 0,
    };

    for (const row of rows) {
      counts[row.status] = row._count.status;
    }

    return counts as Record<ApplicationStatus, number>;
  }
}

export const applicationRepository = new ApplicationRepository();

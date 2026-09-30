import prisma from "@/lib/prisma.js";
import type { JobSearch, JobSource, Prisma } from "@prisma/client";

export interface CreateJobSearchInput {
  userId: string;
  name: string;
  keywords: string;
  location?: string;
  remote?: boolean;
  source?: JobSource;
}

export interface UpdateJobSearchInput {
  name?: string;
  keywords?: string;
  location?: string;
  remote?: boolean;
  isActive?: boolean;
  lastRunAt?: Date;
}

/**
 * JobSearchRepository — CRUD for JobSearch configurations.
 *
 * A JobSearch is the user's saved search config (keywords, location, filters).
 * A single user can have multiple active searches running in parallel (Phase 9).
 */
export class JobSearchRepository {
  async create(input: CreateJobSearchInput): Promise<JobSearch> {
    return prisma.jobSearch.create({
      data: {
        userId: input.userId,
        name: input.name,
        keywords: input.keywords,
        location: input.location ?? null,
        remote: input.remote ?? false,
        source: input.source ?? "LINKEDIN",
        isActive: true,
      },
    });
  }

  async findById(id: string): Promise<JobSearch | null> {
    return prisma.jobSearch.findUnique({ where: { id } });
  }

  async findAllByUserId(userId: string): Promise<JobSearch[]> {
    return prisma.jobSearch.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
    });
  }

  async findActiveByUserId(userId: string): Promise<JobSearch[]> {
    return prisma.jobSearch.findMany({
      where: { userId, isActive: true },
      orderBy: { createdAt: "desc" },
    });
  }

  async update(id: string, input: UpdateJobSearchInput): Promise<JobSearch> {
    const data: Prisma.JobSearchUpdateInput = {};
    if (input.name !== undefined) data["name"] = input.name;
    if (input.keywords !== undefined) data["keywords"] = input.keywords;
    if (input.location !== undefined) data["location"] = input.location;
    if (input.remote !== undefined) data["remote"] = input.remote;
    if (input.isActive !== undefined) data["isActive"] = input.isActive;
    if (input.lastRunAt !== undefined) data["lastRunAt"] = input.lastRunAt;

    return prisma.jobSearch.update({ where: { id }, data });
  }

  async markLastRun(id: string): Promise<void> {
    await prisma.jobSearch.update({
      where: { id },
      data: { lastRunAt: new Date() },
    });
  }

  async deactivate(id: string): Promise<void> {
    await prisma.jobSearch.update({
      where: { id },
      data: { isActive: false },
    });
  }

  async delete(id: string): Promise<void> {
    await prisma.jobSearch.delete({ where: { id } });
  }
}

export const jobSearchRepository = new JobSearchRepository();

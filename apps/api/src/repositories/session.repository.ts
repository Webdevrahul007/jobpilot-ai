import prisma from "@/lib/prisma.js";
import type { LinkedInSession } from "@prisma/client";

/**
 * SessionRepository — all database operations for LinkedInSession.
 *
 * Rules:
 * - No business logic here. Just SQL via Prisma.
 * - No HTTP types (Request/Response). Pure data in, data out.
 * - Every method is independently testable with a mock Prisma client.
 */
export class SessionRepository {
  /**
   * Find the most recent active session for a user.
   */
  async findActiveByUserId(userId: string): Promise<LinkedInSession | null> {
    return prisma.linkedInSession.findFirst({
      where: { userId, isActive: true },
      orderBy: { createdAt: "desc" },
    });
  }

  /**
   * Find all sessions for a user (active and inactive) for audit/history.
   */
  async findAllByUserId(userId: string): Promise<LinkedInSession[]> {
    return prisma.linkedInSession.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
    });
  }

  /**
   * Create a new active session, deactivating any previous ones.
   * Done in a transaction to prevent race conditions.
   */
  async createSession(
    userId: string,
    sessionData: object,
    expiresAt: Date
  ): Promise<LinkedInSession> {
    return prisma.$transaction(async (tx) => {
      // Deactivate all existing sessions for this user
      await tx.linkedInSession.updateMany({
        where: { userId, isActive: true },
        data: { isActive: false },
      });

      // Create the new session
      return tx.linkedInSession.create({
        data: {
          userId,
          sessionData,
          isActive: true,
          lastUsedAt: new Date(),
          expiresAt,
        },
      });
    });
  }

  /**
   * Touch lastUsedAt — called every time a session is successfully restored.
   */
  async updateLastUsed(sessionId: string): Promise<void> {
    await prisma.linkedInSession.update({
      where: { id: sessionId },
      data: { lastUsedAt: new Date() },
    });
  }

  /**
   * Mark all sessions for a user as inactive (logout / invalidation).
   */
  async deactivateAll(userId: string): Promise<number> {
    const result = await prisma.linkedInSession.updateMany({
      where: { userId, isActive: true },
      data: { isActive: false },
    });
    return result.count;
  }

  /**
   * Mark a single session as inactive.
   */
  async deactivateById(sessionId: string): Promise<void> {
    await prisma.linkedInSession.update({
      where: { id: sessionId },
      data: { isActive: false },
    });
  }

  /**
   * Hard delete all sessions for a user — used when a user account is deleted.
   */
  async deleteAllByUserId(userId: string): Promise<void> {
    await prisma.linkedInSession.deleteMany({ where: { userId } });
  }
}

// Singleton — reuse the same instance across the app
export const sessionRepository = new SessionRepository();

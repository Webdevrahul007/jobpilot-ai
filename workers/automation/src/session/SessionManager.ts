import fs from "fs";
import path from "path";
import { PrismaClient } from "@prisma/client";
import type { StorageState } from "../types/automation.types.js";
import { logger } from "../utils/logger.js";

/**
 * SessionManager — bridges Playwright storageState ↔ Database ↔ Disk.
 *
 * Storage strategy:
 * ┌─────────────────────────────────────────────────────────────────┐
 * │  PostgreSQL (LinkedInSession table)                             │
 * │  └─ source of truth, survives restarts, shared across workers  │
 * │                                                                 │
 * │  Disk (.sessions/session_<userId>.json)                        │
 * │  └─ local cache, read directly by Playwright for zero latency  │
 * └─────────────────────────────────────────────────────────────────┘
 *
 * Flow:
 *   Save:    storageState → DB  AND  storageState → disk file
 *   Restore: DB → disk file → return file path (Playwright reads it)
 *   Check:   DB row → check isActive + expiresAt
 */
export class SessionManager {
  private readonly prisma: PrismaClient;
  private readonly sessionDir: string;

  constructor(prisma: PrismaClient, sessionDir: string) {
    this.prisma = prisma;
    this.sessionDir = sessionDir;
    this.ensureSessionDir();
  }

  // ── Save ───────────────────────────────────────────────────────────────────

  /**
   * Persist a fresh storageState after a successful login.
   * Upserts the DB row and writes the disk cache file.
   */
  async saveSession(userId: string, storageState: StorageState): Promise<void> {
    logger.info("Saving LinkedIn session", { userId });

    // Calculate expiry — LinkedIn sessions typically last ~30 days.
    // We use 25 days to refresh proactively before expiry.
    const expiresAt = new Date(Date.now() + 25 * 24 * 60 * 60 * 1000);

    // Deactivate any existing sessions for this user first
    await this.prisma.linkedInSession.updateMany({
      where: { userId, isActive: true },
      data: { isActive: false },
    });

    // Create new active session
    await this.prisma.linkedInSession.create({
      data: {
        userId,
        sessionData: storageState as object,
        isActive: true,
        lastUsedAt: new Date(),
        expiresAt,
      },
    });

    // Write disk cache
    await this.writeDiskCache(userId, storageState);

    logger.info("Session saved", { userId, expiresAt });
  }

  // ── Restore ────────────────────────────────────────────────────────────────

  /**
   * Restore the most recent active session for a user.
   * Returns the disk file path (to pass to BrowserManager.newSession),
   * or null if no valid session exists.
   */
  async restoreSession(userId: string): Promise<string | null> {
    logger.info("Restoring LinkedIn session", { userId });

    const session = await this.getActiveSession(userId);

    if (!session) {
      logger.info("No active session found", { userId });
      return null;
    }

    // Check expiry
    if (session.expiresAt && session.expiresAt < new Date()) {
      logger.warn("Session expired, marking inactive", {
        userId,
        expiresAt: session.expiresAt,
      });
      await this.prisma.linkedInSession.update({
        where: { id: session.id },
        data: { isActive: false },
      });
      return null;
    }

    // Write to disk so Playwright can read it directly
    const storageState = session.sessionData as unknown as StorageState;
    const filePath = await this.writeDiskCache(userId, storageState);

    // Update lastUsedAt
    await this.prisma.linkedInSession.update({
      where: { id: session.id },
      data: { lastUsedAt: new Date() },
    });

    logger.info("Session restored to disk", { userId, filePath });
    return filePath;
  }

  // ── Invalidate ─────────────────────────────────────────────────────────────

  /**
   * Mark all sessions for a user as inactive.
   * Called on logout or when the bot detects a session has expired mid-run.
   */
  async invalidateSession(userId: string): Promise<void> {
    logger.info("Invalidating LinkedIn session", { userId });

    await this.prisma.linkedInSession.updateMany({
      where: { userId, isActive: true },
      data: { isActive: false },
    });

    // Remove disk cache
    const filePath = this.getDiskCachePath(userId);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      logger.debug("Disk cache removed", { filePath });
    }

    logger.info("Session invalidated", { userId });
  }

  // ── Status ─────────────────────────────────────────────────────────────────

  /**
   * Check if a valid (non-expired, active) session exists in the DB.
   * Does NOT open a browser — purely a DB check.
   */
  async hasValidSession(userId: string): Promise<boolean> {
    const session = await this.getActiveSession(userId);
    if (!session) return false;
    if (session.expiresAt && session.expiresAt < new Date()) return false;
    return true;
  }

  async getSessionInfo(userId: string): Promise<{
    hasSession: boolean;
    isActive: boolean;
    lastUsedAt: Date | null;
    expiresAt: Date | null;
  }> {
    const session = await this.getActiveSession(userId);

    if (!session) {
      return {
        hasSession: false,
        isActive: false,
        lastUsedAt: null,
        expiresAt: null,
      };
    }

    const isExpired = session.expiresAt
      ? session.expiresAt < new Date()
      : false;

    return {
      hasSession: true,
      isActive: session.isActive && !isExpired,
      lastUsedAt: session.lastUsedAt,
      expiresAt: session.expiresAt,
    };
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private async getActiveSession(userId: string) {
    return this.prisma.linkedInSession.findFirst({
      where: { userId, isActive: true },
      orderBy: { createdAt: "desc" },
    });
  }

  /**
   * Write storageState JSON to the local disk cache directory.
   * Returns the absolute file path.
   */
  private async writeDiskCache(
    userId: string,
    storageState: StorageState
  ): Promise<string> {
    const filePath = this.getDiskCachePath(userId);
    fs.writeFileSync(filePath, JSON.stringify(storageState, null, 2), "utf-8");
    logger.debug("Disk cache written", { filePath });
    return filePath;
  }

  private getDiskCachePath(userId: string): string {
    return path.join(this.sessionDir, `session_${userId}.json`);
  }

  private ensureSessionDir(): void {
    if (!fs.existsSync(this.sessionDir)) {
      fs.mkdirSync(this.sessionDir, { recursive: true });
    }
  }
}

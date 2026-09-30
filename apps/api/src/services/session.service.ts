import path from "path";
import { PrismaClient } from "@prisma/client";
import { BrowserManager, LinkedInAuth, SessionManager } from "@jobpilot/automation";
import type { StorageState } from "@jobpilot/automation";
import { sessionRepository } from "@/repositories/session.repository.js";
import { HttpError } from "@/middlewares/errorHandler.js";
import { logger } from "@/utils/logger.js";
import { env } from "@/config/env.js";

/**
 * SessionService — business logic for LinkedIn session management.
 *
 * Orchestrates:
 * - BrowserManager (Playwright)
 * - LinkedInAuth (login/logout/check)
 * - SessionManager (save/restore/invalidate)
 * - SessionRepository (DB queries)
 *
 * Controllers call this. This layer never touches HTTP.
 */
export class SessionService {
  private getBrowserManager(headless?: boolean): BrowserManager {
    return new BrowserManager({
      headless: headless ?? env.PLAYWRIGHT_HEADLESS === "true",
      slowMo: env.NODE_ENV === "production" ? 0 : 50,
      sessionDir: path.resolve(env.PLAYWRIGHT_SESSION_DIR),
    });
  }

  private getSessionManager(): SessionManager {
    return new SessionManager(
      new PrismaClient(),
      path.resolve(env.PLAYWRIGHT_SESSION_DIR)
    );
  }

  // ── Login ──────────────────────────────────────────────────────────────────

  /**
   * Run the full LinkedIn login flow for a user.
   * Saves the session to DB + disk on success.
   */
  async login(
    userId: string,
    email: string,
    password: string
  ): Promise<{ message: string; expiresAt: Date }> {
    logger.info("Session service: login requested", { userId });

    const browserManager = this.getBrowserManager(false); // headed for login
    const sessionMgr = this.getSessionManager();

    try {
      // Check if a valid session already exists — skip login if so
      const existing = await sessionRepository.findActiveByUserId(userId);
      if (existing && existing.expiresAt && existing.expiresAt > new Date()) {
        logger.info("Valid session already exists, skipping re-login", { userId });
        return {
          message: "Already logged in — existing session is valid",
          expiresAt: existing.expiresAt,
        };
      }

      const session = await browserManager.newSession();
      const auth = new LinkedInAuth(session.page);

      const result = await auth.login(email, password);

      await browserManager.closeSession(session);

      if (!result.success || !result.sessionData) {
        // Surface the specific error type to the client
        throw new HttpError(400, result.error ?? "LinkedIn login failed");
      }

      await sessionMgr.saveSession(userId, result.sessionData as StorageState);

      const saved = await sessionRepository.findActiveByUserId(userId);
      const expiresAt = saved?.expiresAt ?? new Date(Date.now() + 25 * 24 * 60 * 60 * 1000);

      logger.info("Login successful, session saved", { userId });
      return { message: "Login successful", expiresAt };
    } finally {
      await browserManager.closeBrowser();
    }
  }

  // ── Status ─────────────────────────────────────────────────────────────────

  /**
   * Return session metadata without opening a browser.
   * Fast DB-only check for dashboard display.
   */
  async getStatus(userId: string): Promise<{
    hasSession: boolean;
    isActive: boolean;
    lastUsedAt: Date | null;
    expiresAt: Date | null;
  }> {
    const session = await sessionRepository.findActiveByUserId(userId);

    if (!session) {
      return { hasSession: false, isActive: false, lastUsedAt: null, expiresAt: null };
    }

    const isExpired = session.expiresAt ? session.expiresAt < new Date() : false;

    return {
      hasSession: true,
      isActive: session.isActive && !isExpired,
      lastUsedAt: session.lastUsedAt,
      expiresAt: session.expiresAt,
    };
  }

  /**
   * Live check — actually opens a browser and hits LinkedIn to verify
   * the session is still valid. More expensive than getStatus().
   */
  async verifySession(userId: string): Promise<{
    isValid: boolean;
    username?: string;
  }> {
    logger.info("Session service: live verify requested", { userId });

    const sessionMgr = this.getSessionManager();
    const browserManager = this.getBrowserManager(true); // headless for checks

    try {
      const filePath = await sessionMgr.restoreSession(userId);

      if (!filePath) {
        return { isValid: false };
      }

      const session = await browserManager.newSession({
        storageStatePath: filePath,
      });
      const auth = new LinkedInAuth(session.page);

      const result = await auth.checkSession();
      await browserManager.closeSession(session);

      if (result.isLoggedIn) {
        // Touch lastUsedAt
        const dbSession = await sessionRepository.findActiveByUserId(userId);
        if (dbSession) {
          await sessionRepository.updateLastUsed(dbSession.id);
        }
      } else {
        // Session expired on LinkedIn's side — invalidate locally
        await sessionMgr.invalidateSession(userId);
      }

      return {
        isValid: result.isLoggedIn,
        ...(result.username !== undefined && { username: result.username }),
      };
    } finally {
      await browserManager.closeBrowser();
    }
  }

  // ── Logout ─────────────────────────────────────────────────────────────────

  async logout(userId: string): Promise<void> {
    logger.info("Session service: logout requested", { userId });

    const sessionMgr = this.getSessionManager();
    const browserManager = this.getBrowserManager(true);

    try {
      const filePath = await sessionMgr.restoreSession(userId);

      if (filePath) {
        // Actually hit LinkedIn's logout endpoint
        const session = await browserManager.newSession({
          storageStatePath: filePath,
        });
        const auth = new LinkedInAuth(session.page);
        await auth.logout();
        await browserManager.closeSession(session);
      }

      // Invalidate locally regardless of whether browser logout succeeded
      await sessionMgr.invalidateSession(userId);
      logger.info("Logout complete", { userId });
    } finally {
      await browserManager.closeBrowser();
    }
  }
}

export const sessionService = new SessionService();

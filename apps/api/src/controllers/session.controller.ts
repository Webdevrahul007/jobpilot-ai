import type { Request, Response } from "express";
import { z } from "zod";
import { sessionService } from "@/services/session.service.js";
import { sendSuccess, sendError } from "@/utils/response.js";
import { logger } from "@/utils/logger.js";

/**
 * SessionController — HTTP handlers for LinkedIn session endpoints.
 *
 * Rules:
 * - Extract and validate input from req
 * - Call service
 * - Send response
 * - No business logic here
 */

// ── Validation schemas ─────────────────────────────────────────────────────

const LoginSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(1, "Password is required"),
  userId: z.string().min(1, "userId is required"),
});

const UserIdSchema = z.object({
  userId: z.string().min(1, "userId is required"),
});

// ── Handlers ───────────────────────────────────────────────────────────────

/**
 * POST /api/v1/linkedin/login
 * Trigger LinkedIn login flow — opens a browser, logs in, saves session.
 */
export async function loginHandler(req: Request, res: Response): Promise<void> {
  const body = LoginSchema.parse(req.body); // throws ZodError → errorHandler

  logger.info("Login request received", { userId: body.userId });

  const result = await sessionService.login(
    body.userId,
    body.email,
    body.password
  );

  sendSuccess(res, result, result.message, 200);
}

/**
 * GET /api/v1/linkedin/status/:userId
 * Fast DB-only session status check. Use for dashboard polling.
 */
export async function statusHandler(req: Request, res: Response): Promise<void> {
  const { userId } = UserIdSchema.parse(req.params);

  const status = await sessionService.getStatus(userId);
  sendSuccess(res, status, "Session status retrieved");
}

/**
 * GET /api/v1/linkedin/verify/:userId
 * Live browser-based verification. Slower — use on demand, not for polling.
 */
export async function verifyHandler(req: Request, res: Response): Promise<void> {
  const { userId } = UserIdSchema.parse(req.params);

  logger.info("Live session verify requested", { userId });

  const result = await sessionService.verifySession(userId);

  if (result.isValid) {
    sendSuccess(res, result, "Session is valid");
  } else {
    sendError(res, "Session is invalid or expired — please login again", 401);
  }
}

/**
 * POST /api/v1/linkedin/logout
 * Logout from LinkedIn and invalidate the stored session.
 */
export async function logoutHandler(req: Request, res: Response): Promise<void> {
  const body = UserIdSchema.parse(req.body);

  logger.info("Logout request received", { userId: body.userId });

  await sessionService.logout(body.userId);
  sendSuccess(res, null, "Logged out successfully");
}

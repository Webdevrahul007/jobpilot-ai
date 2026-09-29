import rateLimit from "express-rate-limit";
import { CONSTANTS } from "@/config/constants.js";
import { sendError } from "@/utils/response.js";
import type { Request, Response } from "express";

export const rateLimiter = rateLimit({
  windowMs: CONSTANTS.RATE_LIMIT_WINDOW_MS,
  max: CONSTANTS.RATE_LIMIT_MAX_REQUESTS,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req: Request, res: Response) => {
    sendError(res, "Too many requests, please try again later.", 429);
  },
});

import type { Request, Response } from "express";
import { sendError } from "@/utils/response.js";

export function notFoundHandler(req: Request, res: Response): void {
  sendError(res, `Route ${req.method} ${req.originalUrl} not found`, 404);
}

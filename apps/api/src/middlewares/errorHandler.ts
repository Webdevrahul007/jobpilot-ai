import type { Request, Response, NextFunction } from "express";
import { ZodError } from "zod";
import { logger } from "@/utils/logger.js";
import { sendError } from "@/utils/response.js";

// Centralised error handling — every thrown error lands here.
// Controllers stay clean because we use express-async-errors to
// automatically forward async errors to next().
export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  // Zod validation errors → 400
  if (err instanceof ZodError) {
    const message = err.errors.map((e) => `${e.path.join(".")}: ${e.message}`).join(", ");
    sendError(res, "Validation failed", 400, message);
    return;
  }

  // Known application errors with a statusCode property
  if (isAppError(err)) {
    sendError(res, err.message, err.statusCode);
    return;
  }

  // Unknown errors — log full detail, return generic message
  logger.error("Unhandled error", { error: err });
  sendError(res, "Internal server error", 500);
}

interface AppError extends Error {
  statusCode: number;
}

function isAppError(err: unknown): err is AppError {
  return (
    err instanceof Error &&
    "statusCode" in err &&
    typeof (err as AppError).statusCode === "number"
  );
}

// Factory so services can throw typed HTTP errors without importing Express
export class HttpError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string
  ) {
    super(message);
    this.name = "HttpError";
  }
}

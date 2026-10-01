import winston from "winston";
import DailyRotateFile from "winston-daily-rotate-file";
import path from "path";
import fs from "fs";
import { env } from "@/config/env.js";

const { combine, timestamp, errors, colorize, printf, json } = winston.format;

// ── Formats ───────────────────────────────────────────────────────────────────

const devFormat = combine(
  colorize(),
  timestamp({ format: "HH:mm:ss" }),
  errors({ stack: true }),
  printf(({ level, message, timestamp, stack, ...meta }) => {
    const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : "";
    return `${timestamp} [${level}]: ${stack ?? message}${metaStr}`;
  })
);

// JSON format for production — log aggregators (Datadog, CloudWatch, etc.)
// parse these automatically
const prodFormat = combine(
  timestamp(),
  errors({ stack: true }),
  json()
);

// ── Transports ────────────────────────────────────────────────────────────────

const transports: winston.transport[] = [
  new winston.transports.Console({
    format: env.NODE_ENV === "production" ? prodFormat : devFormat,
    stderrLevels: ["error"],
  }),
];

// File logging — only in production or when LOG_DIR is explicitly set
if (env.LOG_DIR) {
  const logDir = path.resolve(env.LOG_DIR);

  // Ensure log directory exists
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }

  // Combined log — all levels
  transports.push(
    new DailyRotateFile({
      dirname: logDir,
      filename: "jobpilot-api-%DATE%.log",
      datePattern: "YYYY-MM-DD",
      zippedArchive: true,        // compress rotated files
      maxSize: "20m",             // rotate if file exceeds 20MB
      maxFiles: "14d",            // keep 14 days of logs
      format: combine(timestamp(), errors({ stack: true }), json()),
      level: "info",
    })
  );

  // Error-only log — separate file for quick error scanning
  transports.push(
    new DailyRotateFile({
      dirname: logDir,
      filename: "jobpilot-api-error-%DATE%.log",
      datePattern: "YYYY-MM-DD",
      zippedArchive: true,
      maxSize: "10m",
      maxFiles: "30d",            // keep error logs longer
      format: combine(timestamp(), errors({ stack: true }), json()),
      level: "error",
    })
  );
}

// ── Logger instance ───────────────────────────────────────────────────────────

export const logger = winston.createLogger({
  level: env.NODE_ENV === "production" ? "info" : "debug",
  transports,
  // Catch unhandled exceptions and rejections — write to log before crashing
  exceptionHandlers: [
    new winston.transports.Console({ stderrLevels: ["error"] }),
    ...(env.LOG_DIR
      ? [
          new DailyRotateFile({
            dirname: path.resolve(env.LOG_DIR),
            filename: "jobpilot-api-exceptions-%DATE%.log",
            datePattern: "YYYY-MM-DD",
            maxFiles: "30d",
          }),
        ]
      : []),
  ],
  rejectionHandlers: [
    new winston.transports.Console({ stderrLevels: ["error"] }),
  ],
});

/**
 * Create a child logger with additional default metadata.
 * Use this to tag logs from a specific module:
 *
 *   const log = childLogger({ module: "auth" });
 *   log.info("User logged in");  // → { module: "auth", message: "User logged in" }
 */
export function childLogger(meta: Record<string, unknown>): winston.Logger {
  return logger.child(meta);
}

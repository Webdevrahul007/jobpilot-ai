import winston from "winston";
import { env } from "@/config/env.js";

const { combine, timestamp, errors, colorize, printf, json } = winston.format;

// Human-readable format for dev, JSON for production (log aggregators love JSON)
const devFormat = combine(
  colorize(),
  timestamp({ format: "HH:mm:ss" }),
  errors({ stack: true }),
  printf(({ level, message, timestamp, stack, ...meta }) => {
    const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : "";
    return `${timestamp} [${level}]: ${stack ?? message}${metaStr}`;
  })
);

const prodFormat = combine(
  timestamp(),
  errors({ stack: true }),
  json()
);

export const logger = winston.createLogger({
  level: env.NODE_ENV === "production" ? "info" : "debug",
  format: env.NODE_ENV === "production" ? prodFormat : devFormat,
  transports: [new winston.transports.Console()],
  // Unhandled rejections / exceptions go to stderr
  exceptionHandlers: [new winston.transports.Console({ stderrLevels: ["error"] })],
  rejectionHandlers: [new winston.transports.Console({ stderrLevels: ["error"] })],
});

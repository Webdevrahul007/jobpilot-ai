/**
 * Lightweight logger for the automation worker.
 * Kept separate from the API logger — workers may run in isolation
 * without the full Express stack loaded.
 */

type LogLevel = "info" | "warn" | "error" | "debug";

function formatMessage(level: LogLevel, message: string, meta?: unknown): string {
  const ts = new Date().toISOString();
  const metaStr = meta !== undefined ? ` ${JSON.stringify(meta)}` : "";
  return `${ts} [${level.toUpperCase()}] [automation] ${message}${metaStr}`;
}

export const logger = {
  info: (message: string, meta?: unknown) =>
    console.log(formatMessage("info", message, meta)),

  warn: (message: string, meta?: unknown) =>
    console.warn(formatMessage("warn", message, meta)),

  error: (message: string, meta?: unknown) =>
    console.error(formatMessage("error", message, meta)),

  debug: (message: string, meta?: unknown) => {
    if (process.env["NODE_ENV"] !== "production") {
      console.debug(formatMessage("debug", message, meta));
    }
  },
};

import { PrismaClient } from "@prisma/client";
import { env } from "@/config/env.js";
import { logger } from "@/utils/logger.js";

/**
 * Prisma Client singleton.
 *
 * Why a singleton: PrismaClient manages a connection pool internally.
 * Creating a new instance per request exhausts connections fast.
 *
 * The global trick prevents hot-reload in dev from creating multiple
 * instances every time a file changes (Next.js / tsx watch quirk).
 */

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log:
      env.NODE_ENV === "development"
        ? [
            { emit: "event", level: "query" },
            { emit: "event", level: "error" },
            { emit: "event", level: "warn" },
          ]
        : [{ emit: "event", level: "error" }],
  });

// Log slow queries in development — helps catch N+1 problems early
if (env.NODE_ENV === "development") {
  prisma.$on("query" as never, (e: { query: string; duration: number }) => {
    if (e.duration > 200) {
      logger.warn("Slow Prisma query detected", {
        query: e.query,
        durationMs: e.duration,
      });
    }
  });
}

if (env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

export default prisma;

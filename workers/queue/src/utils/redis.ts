import { Redis } from "ioredis";
import dotenv from "dotenv";
import path from "path";

// Load .env from repo root
dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

const REDIS_URL = process.env["REDIS_URL"] ?? "redis://localhost:6379";

/**
 * Shared Redis connection for BullMQ.
 *
 * BullMQ requires two connections per queue (one for commands, one for blocking).
 * We use a factory function so each Queue/Worker gets its own connection,
 * as recommended by BullMQ docs.
 *
 * `enableOfflineQueue: false` causes BullMQ to fail fast on Redis disconnect
 * instead of silently buffering commands — better for production visibility.
 */
export function createRedisConnection(): Redis {
  return new Redis(REDIS_URL, {
    maxRetriesPerRequest: null, // Required by BullMQ
    enableReadyCheck: false,    // Required by BullMQ
    enableOfflineQueue: false,
    lazyConnect: false,
  });
}

/**
 * Shared connection options object — used where BullMQ accepts
 * a ConnectionOptions instead of a Redis instance.
 */
export function getRedisOptions() {
  const url = new URL(REDIS_URL.replace("redis://", "http://").replace("redis://:","http://user:"));
  return {
    host: url.hostname || "localhost",
    port: parseInt(url.port || "6379", 10),
    password: url.password || undefined,
    maxRetriesPerRequest: null as null,
    enableReadyCheck: false,
  };
}

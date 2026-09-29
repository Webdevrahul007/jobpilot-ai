// Must be first — validates all env vars before anything else loads
import { env } from "./config/env.js";

import express from "express";
import "express-async-errors";
import helmet from "helmet";
import cors from "cors";
import compression from "compression";
import morgan from "morgan";
import cookieParser from "cookie-parser";

import { logger } from "./utils/logger.js";
import { errorHandler } from "./middlewares/errorHandler.js";
import { notFoundHandler } from "./middlewares/notFound.js";
import { rateLimiter } from "./middlewares/rateLimiter.js";
import apiRoutes from "./routes/index.js";

const app = express();

// ── Security middleware ────────────────────────────────────────────────────────
app.use(helmet());
app.use(
  cors({
    origin: env.CORS_ORIGIN,
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

// ── Parsing middleware ─────────────────────────────────────────────────────────
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));
app.use(cookieParser());
app.use(compression());

// ── Logging ───────────────────────────────────────────────────────────────────
// Use 'tiny' in production to reduce log volume; 'dev' for coloured output locally
app.use(morgan(env.NODE_ENV === "production" ? "tiny" : "dev"));

// ── Rate limiting ─────────────────────────────────────────────────────────────
app.use(rateLimiter);

// ── Routes ────────────────────────────────────────────────────────────────────
app.use(env.API_PREFIX, apiRoutes);

// ── 404 + error handling (must be last) ──────────────────────────────────────
app.use(notFoundHandler);
app.use(errorHandler);

// ── Start server ──────────────────────────────────────────────────────────────
const server = app.listen(env.PORT, () => {
  logger.info(`🚀 API server running`, {
    port: env.PORT,
    env: env.NODE_ENV,
    prefix: env.API_PREFIX,
  });
});

// Graceful shutdown — important for Docker and zero-downtime deploys
const shutdown = (signal: string) => {
  logger.info(`${signal} received. Shutting down gracefully...`);
  server.close(() => {
    logger.info("Server closed.");
    process.exit(0);
  });

  // Force shutdown if graceful close takes too long
  setTimeout(() => {
    logger.error("Could not close connections in time. Forcing shutdown.");
    process.exit(1);
  }, 10_000);
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

export default app;

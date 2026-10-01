# ── Stage 1: Dependencies ─────────────────────────────────────────────────────
FROM node:22-alpine AS deps

WORKDIR /app

COPY package.json package-lock.json ./
COPY workers/automation/package.json ./workers/automation/
COPY workers/queue/package.json ./workers/queue/
COPY prisma ./prisma/

RUN npm ci --workspace=workers/automation --workspace=workers/queue --include-workspace-root

# ── Stage 2: Builder ──────────────────────────────────────────────────────────
FROM node:22-alpine AS builder

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/workers/automation/node_modules ./workers/automation/node_modules
COPY --from=deps /app/workers/queue/node_modules ./workers/queue/node_modules
COPY . .

RUN npx prisma generate --schema=./prisma/schema.prisma

# ── Stage 3: Runner ───────────────────────────────────────────────────────────
# Use Playwright's official image which includes Chromium + all OS dependencies.
# Much simpler than manually installing libglib2, libnss3, etc. on Alpine.
FROM mcr.microsoft.com/playwright:v1.47.2-noble AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PLAYWRIGHT_HEADLESS=true

# Non-root user
RUN groupadd --system --gid 1001 nodejs && \
    useradd --system --uid 1001 --gid nodejs appuser

# Required runtime directories
RUN mkdir -p /app/logs /app/resumes /app/.sessions /app/screenshots && \
    chown -R appuser:nodejs /app

COPY --from=builder --chown=appuser:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=appuser:nodejs /app/workers/automation ./workers/automation
COPY --from=builder --chown=appuser:nodejs /app/workers/queue ./workers/queue
COPY --from=builder --chown=appuser:nodejs /app/prisma ./prisma

USER appuser

# Healthcheck: verify worker process is alive
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD pgrep -f "worker.ts" || pgrep -f "tsx" || exit 1

CMD ["node_modules/.bin/tsx", "workers/queue/src/worker.ts"]

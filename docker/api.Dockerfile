# ── Stage 1: Dependencies ─────────────────────────────────────────────────────
# Install ALL deps (including dev) for the build step
FROM node:22-alpine AS deps

WORKDIR /app

# Copy workspace manifests first — Docker layer cache means npm install
# only re-runs when package.json files change, not on every code change
COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/
COPY prisma ./prisma/

RUN npm ci --workspace=apps/api --include-workspace-root

# ── Stage 2: Builder ──────────────────────────────────────────────────────────
FROM node:22-alpine AS builder

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/api/node_modules ./apps/api/node_modules
COPY . .

# Generate Prisma client before building (it emits to node_modules)
RUN npx prisma generate --schema=./prisma/schema.prisma

# Compile TypeScript
RUN npm run build:api

# ── Stage 3: Runner ───────────────────────────────────────────────────────────
# Lean production image — no dev deps, no source, no TypeScript compiler
FROM node:22-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

# Non-root user for security
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 appuser

# Only copy what's needed to run
COPY --from=builder --chown=appuser:nodejs /app/apps/api/dist ./dist
COPY --from=builder --chown=appuser:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=appuser:nodejs /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=builder --chown=appuser:nodejs /app/prisma ./prisma

USER appuser

EXPOSE 4000

# Run migrations then start the server
# migrate deploy is safe in production — it never prompts, never resets data
CMD ["sh", "-c", "npx prisma migrate deploy --schema=./prisma/schema.prisma && node dist/server.js"]

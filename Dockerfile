# Moolah — self-hosted Docker image.
#
# Multi-stage: install deps, build the Next.js standalone server, then assemble a
# slim runtime. Migrations are applied at container start by docker-entrypoint.sh
# so the database schema is always current before the server accepts traffic.

# ── deps ────────────────────────────────────────────────────────────────────
FROM node:22-slim AS deps
WORKDIR /app
# openssl is required by Prisma's query engine.
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY prisma ./prisma
COPY prisma.config.ts ./
# postinstall runs `prisma generate`, which needs the schema (copied above).
RUN npm ci

# ── builder ─────────────────────────────────────────────────────────────────
FROM node:22-slim AS builder
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# A build-time placeholder; the real secret is provided at runtime. Next only
# needs SOME value present so build-time env access doesn't throw.
ENV AUTH_SECRET="build-time-placeholder"
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# ── runner ──────────────────────────────────────────────────────────────────
FROM node:22-slim AS runner
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000

# Run as a non-root user.
RUN groupadd --system --gid 1001 nodejs && useradd --system --uid 1001 --gid nodejs nextjs

# Standalone server output + static assets + public files.
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

# Migration tooling lives in its own self-contained tree at /app/migrate so it
# can run `prisma migrate deploy` at startup. We copy the builder's full
# node_modules here (not just prisma/@prisma) for two reasons: the `prisma` CLI
# is a devDependency, so a production-pruned tree wouldn't contain it; and
# Prisma 7 loads prisma.config.ts through @prisma/config, which pulls a deep
# transitive closure (effect, c12, dotenv, jiti, …) that's fragile to resolve by
# hand and breaks on every Prisma bump. Shipping the resolved tree wholesale
# costs image size but is the robust choice. The app server itself still runs
# from the slim standalone bundle copied above.
COPY --from=builder --chown=nextjs:nodejs /app/node_modules ./migrate/node_modules
COPY --from=builder --chown=nextjs:nodejs /app/prisma ./migrate/prisma
COPY --from=builder --chown=nextjs:nodejs /app/prisma.config.ts ./migrate/prisma.config.ts
COPY --chown=nextjs:nodejs docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x ./docker-entrypoint.sh

USER nextjs
EXPOSE 3000

ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["node", "server.js"]

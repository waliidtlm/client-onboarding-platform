FROM node:24.16.0-alpine3.23 AS base

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

RUN npm install --global pnpm@11.9.0

WORKDIR /app

FROM base AS dependencies

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/package.json

RUN pnpm install --frozen-lockfile

FROM base AS builder

COPY --from=dependencies /app/node_modules ./node_modules
COPY --from=dependencies /app/apps/web/node_modules ./apps/web/node_modules
COPY . .

ENV NEXT_TELEMETRY_DISABLED=1
# Prisma generate validates the datasource URL but does not connect to it.
# These non-secret placeholders exist only in the discarded build stage.
ENV DATABASE_URL="postgresql://build-only@127.0.0.1:5432/onboarding_app"
ENV AUTH_SECRET="build-only-placeholder-not-used-at-runtime"
ENV NEXTAUTH_URL="http://127.0.0.1:3000"

RUN pnpm --filter @client-onboarding/web build

FROM dependencies AS migrator

COPY . .

CMD ["pnpm", "db:deploy"]

FROM node:24.16.0-alpine3.23 AS runner

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

WORKDIR /app

RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs

COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/static ./apps/web/.next/static

USER nextjs

EXPOSE 3000

CMD ["node", "apps/web/server.js"]

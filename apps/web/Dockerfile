FROM node:26.10.0-alpine3.23 AS base

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
ENV AUTOMATION_SERVICE_TOKEN="build-only-automation-token-not-used-runtime"
ENV AUTOMATION_HMAC_SECRET="build-only-automation-hmac-not-used-runtime"
ENV AUTOMATION_PHASE5_SERVICE_TOKEN="build-only-phase5-service-token-not-runtime"
ENV AUTOMATION_PHASE6_SERVICE_TOKEN="build-only-phase6-service-token-not-runtime"
ENV AUTOMATION_PHASE6_HMAC_SECRET="build-only-phase6-hmac-secret-not-runtime"
ENV AUTOMATION_PHASE7_SERVICE_TOKEN="build-only-phase7-service-token-not-runtime"
ENV AUTOMATION_PHASE7_HMAC_SECRET="build-only-phase7-hmac-secret-not-runtime"
ENV AUTOMATION_PHASE5_HMAC_SECRET="build-only-phase5-hmac-secret-not-runtime"
ENV CLIENT_ACCESS_ACTIVE_SIGNING_KEY_VERSION="1"
ENV CLIENT_ACCESS_SIGNING_KEYS="{\"1\":\"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA\"}"
ENV CLIENT_ACCESS_PUBLIC_BASE_URL="http://127.0.0.1:3000/client-access"
ENV APP_PUBLIC_ORIGIN="http://127.0.0.1:3000"
ENV CLIENT_SESSION_SECRET="BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB"
ENV PUBLIC_RATE_LIMIT_HMAC_SECRET="CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC"
ENV CLIENT_SUPPORT_CONTACT="support@example.com"
ENV OBJECT_STORAGE_INTERNAL_ENDPOINT="http://127.0.0.1:9000"
ENV OBJECT_STORAGE_BROWSER_ENDPOINT="http://127.0.0.1:9000"
ENV OBJECT_STORAGE_BUCKET="build-only-files"
ENV OBJECT_STORAGE_ACCESS_KEY="build-only-storage"
ENV OBJECT_STORAGE_SECRET_KEY="build-only-storage-secret-0000000000"
ENV SMTP_HOST="127.0.0.1"
ENV SMTP_PORT="1025"
ENV NEXTAUTH_URL="http://127.0.0.1:3000"

RUN pnpm --filter @client-onboarding/web build

FROM dependencies AS migrator

COPY . .

CMD ["pnpm", "db:deploy"]

FROM node:26.10.0-alpine3.23 AS runner

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

import { createHmac } from "node:crypto";

import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { prisma } from "@/lib/database";
import { rateLimitSecret } from "@/lib/client-access/keys";
import { getServerEnvironment } from "@/lib/env";

export const RATE_LIMITS = {
  TOKEN_EXCHANGE_IP: { limit: 10, windowSeconds: 10 * 60 },
  TOKEN_EXCHANGE_RECORD: { limit: 5, windowSeconds: 10 * 60 },
  PUBLIC_MUTATION_SESSION: { limit: 30, windowSeconds: 5 * 60 },
  UPLOAD_INTENT_SESSION: { limit: 20, windowSeconds: 10 * 60 },
  STAFF_LOGIN_IP: { limit: 30, windowSeconds: 15 * 60 },
  STAFF_LOGIN_ACCOUNT: { limit: 10, windowSeconds: 15 * 60 },
} as const;

export type RateLimitScope = keyof typeof RATE_LIMITS;

export function normalizeClientIp(request: Request): string {
  const environment = getServerEnvironment();
  if (environment.TRUSTED_PROXY_HOPS === 0) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("TRUSTED_PROXY_CONFIGURATION_REQUIRED");
    }
    return "127.0.0.1";
  }
  const forwarded = request.headers
    .get("x-forwarded-for")
    ?.split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (!forwarded || forwarded.length < environment.TRUSTED_PROXY_HOPS) {
    throw new Error("TRUSTED_PROXY_HEADER_MISSING");
  }
  return forwarded[forwarded.length - environment.TRUSTED_PROXY_HOPS]!.toLowerCase();
}

export function rateLimitSubjectHash(scope: RateLimitScope, subject: string): string {
  return createHmac("sha256", rateLimitSecret()).update(`${scope}\n${subject}`).digest("hex");
}

export async function consumeRateLimit(
  scope: RateLimitScope,
  subject: string,
  database: PrismaClient = prisma,
): Promise<Readonly<{ allowed: boolean; retryAfterSeconds: number }>> {
  const policy = RATE_LIMITS[scope];
  return database.$transaction(async (tx) => {
    const clock = await tx.$queryRaw<Array<{ now: Date; windowStartedAt: Date }>>(Prisma.sql`
      SELECT
        CURRENT_TIMESTAMP AS "now",
        to_timestamp(
          floor(extract(epoch FROM CURRENT_TIMESTAMP) / ${policy.windowSeconds})
          * ${policy.windowSeconds}
        ) AS "windowStartedAt"
    `);
    const now = clock[0]!.now;
    const windowStartedAt = clock[0]!.windowStartedAt;
    const expiresAt = new Date(
      windowStartedAt.getTime() + (policy.windowSeconds + 24 * 60 * 60) * 1_000,
    );
    const subjectHash = rateLimitSubjectHash(scope, subject);
    const rows = await tx.$queryRaw<Array<{ count: number }>>(Prisma.sql`
      INSERT INTO "PublicRateLimitBucket" (
        "id", "scope", "subjectHash", "windowStartedAt", "count", "expiresAt", "updatedAt"
      )
      VALUES (
        gen_random_uuid(),
        ${scope},
        ${subjectHash},
        ${windowStartedAt},
        1,
        ${expiresAt},
        CURRENT_TIMESTAMP
      )
      ON CONFLICT ("scope", "subjectHash", "windowStartedAt")
      DO UPDATE SET
        "count" = "PublicRateLimitBucket"."count" + 1,
        "updatedAt" = CURRENT_TIMESTAMP
      RETURNING "count"
    `);
    await tx.$executeRaw(Prisma.sql`
      DELETE FROM "PublicRateLimitBucket"
      WHERE "id" IN (
        SELECT "id"
        FROM "PublicRateLimitBucket"
        WHERE "expiresAt" <= CURRENT_TIMESTAMP
        ORDER BY "expiresAt" ASC
        LIMIT 25
        FOR UPDATE SKIP LOCKED
      )
    `);
    return {
      allowed: rows[0]!.count <= policy.limit,
      retryAfterSeconds: Math.max(
        1,
        Math.ceil(
          (windowStartedAt.getTime() + policy.windowSeconds * 1_000 - now.getTime()) / 1_000,
        ),
      ),
    };
  });
}

export async function resetRateLimit(
  scope: RateLimitScope,
  subject: string,
  database: PrismaClient = prisma,
): Promise<void> {
  const subjectHash = rateLimitSubjectHash(scope, subject);
  await database.publicRateLimitBucket.deleteMany({
    where: { scope, subjectHash },
  });
}

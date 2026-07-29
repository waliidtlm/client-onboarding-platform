import { OnboardingStatus, type PrismaClient } from "@/generated/prisma/client";
import {
  createClientSession,
  verifyClientSession,
  verifyCsrfToken,
  type ClientSession,
} from "@/domain/client-access/session";
import { parseCapabilityToken, verifyCapabilityToken } from "@/domain/client-access/token";
import { prisma } from "@/lib/database";
import { clientAccessSigningKey, clientSessionSecret } from "@/lib/client-access/keys";
import { consumeRateLimit } from "@/application/client-access/rate-limit-service";

export const CLIENT_SESSION_COOKIE = "northstar_client_access";
export const CLIENT_SESSION_SECONDS = 30 * 60;

const allowedClientStates = [
  OnboardingStatus.CLIENT_AWAITING_ACTION,
  OnboardingStatus.CLIENT_REQUIREMENTS_COMPLETE,
] as const;

export type ValidClientAccess = Readonly<{
  tokenId: string;
  onboardingId: string;
  sessionId: string;
  csrfHash: string;
  expiresAt: Date;
}>;

export async function exchangeClientCapability(rawToken: string, database: PrismaClient = prisma) {
  const parsed = parseCapabilityToken(rawToken);
  if (!parsed) return null;
  const tokenRate = await consumeRateLimit("TOKEN_EXCHANGE_RECORD", parsed.tokenId, database);
  if (!tokenRate.allowed)
    return { rateLimited: true as const, retryAfterSeconds: tokenRate.retryAfterSeconds };
  const record = await database.clientAccessToken.findUnique({
    where: { id: parsed.tokenId },
    include: { onboarding: true },
  });
  const signingKey = record ? clientAccessSigningKey(record.signingKeyVersion) : null;
  const now = new Date();
  if (
    !record ||
    !signingKey ||
    !verifyCapabilityToken(rawToken, parsed, record, signingKey) ||
    record.expiresAt <= now ||
    record.revokedAt ||
    record.onboarding.cancelledAt ||
    !allowedClientStates.includes(record.onboarding.status as (typeof allowedClientStates)[number])
  ) {
    return null;
  }
  const session = createClientSession({
    tokenId: record.id,
    secret: clientSessionSecret(),
    now,
    lifetimeSeconds: Math.min(
      CLIENT_SESSION_SECONDS,
      Math.max(1, Math.floor((record.expiresAt.getTime() - now.getTime()) / 1_000)),
    ),
  });
  await database.clientAccessToken.updateMany({
    where: {
      id: record.id,
      OR: [{ lastUsedAt: null }, { lastUsedAt: { lt: new Date(now.getTime() - 5 * 60 * 1_000) } }],
    },
    data: { lastUsedAt: now },
  });
  return {
    rateLimited: false as const,
    tokenId: record.id,
    onboardingId: record.onboardingId,
    ...session,
  };
}

export async function validateClientSession(
  cookieValue: string | undefined,
  suppliedCsrf: string | null,
  requireCsrf: boolean,
  database: PrismaClient = prisma,
): Promise<ValidClientAccess | null> {
  if (!cookieValue) return null;
  const now = new Date();
  const session = verifyClientSession(cookieValue, clientSessionSecret(), now);
  if (!session || (requireCsrf && (!suppliedCsrf || !verifyCsrfToken(session, suppliedCsrf)))) {
    return null;
  }
  const token = await database.clientAccessToken.findUnique({
    where: { id: session.tokenId },
    include: { onboarding: true },
  });
  if (
    !token ||
    token.revokedAt ||
    token.expiresAt <= now ||
    token.onboarding.cancelledAt ||
    !allowedClientStates.includes(token.onboarding.status as (typeof allowedClientStates)[number])
  ) {
    return null;
  }
  return {
    tokenId: token.id,
    onboardingId: token.onboardingId,
    sessionId: session.sessionId,
    csrfHash: session.csrfHash,
    expiresAt: session.expiresAt,
  };
}

export function csrfIsValid(session: ClientSession, value: string): boolean {
  return verifyCsrfToken(session, value);
}

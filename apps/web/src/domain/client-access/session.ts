import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const SESSION_VERSION = "s1";

function signature(value: string, secret: Buffer): string {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

export function createClientSession(input: {
  tokenId: string;
  secret: Buffer;
  now: Date;
  lifetimeSeconds: number;
}): Readonly<{ cookieValue: string; csrfToken: string; expiresAt: Date; sessionId: string }> {
  const sessionId = randomBytes(32).toString("base64url");
  const csrfToken = randomBytes(32).toString("base64url");
  const csrfHash = createHash("sha256").update(csrfToken).digest("base64url");
  const expiresAt = new Date(input.now.getTime() + input.lifetimeSeconds * 1000);
  const unsigned = [
    SESSION_VERSION,
    input.tokenId.toLowerCase(),
    sessionId,
    Math.floor(expiresAt.getTime() / 1000),
    csrfHash,
  ].join(".");
  return {
    cookieValue: `${unsigned}.${signature(unsigned, input.secret)}`,
    csrfToken,
    expiresAt,
    sessionId,
  };
}

export type ClientSession = Readonly<{
  tokenId: string;
  sessionId: string;
  expiresAt: Date;
  csrfHash: string;
}>;

export function verifyClientSession(
  cookieValue: string,
  secret: Buffer,
  now: Date,
): ClientSession | null {
  const parts = cookieValue.split(".");
  if (parts.length !== 6 || parts[0] !== SESSION_VERSION) return null;
  const [version, tokenId, sessionId, expiration, csrfHash, suppliedSignature] = parts;
  if (
    !/^[0-9a-f-]{36}$/i.test(tokenId!) ||
    !/^[A-Za-z0-9_-]{43}$/.test(sessionId!) ||
    !/^[1-9][0-9]{9,10}$/.test(expiration!) ||
    !/^[A-Za-z0-9_-]{43}$/.test(csrfHash!) ||
    !/^[A-Za-z0-9_-]{43}$/.test(suppliedSignature!)
  ) {
    return null;
  }
  const unsigned = [version, tokenId, sessionId, expiration, csrfHash].join(".");
  const expected = Buffer.from(signature(unsigned, secret), "base64url");
  const supplied = Buffer.from(suppliedSignature!, "base64url");
  const expiresAt = new Date(Number(expiration) * 1000);
  if (
    expected.length !== supplied.length ||
    !timingSafeEqual(expected, supplied) ||
    expiresAt <= now
  ) {
    return null;
  }
  return { tokenId: tokenId!, sessionId: sessionId!, expiresAt, csrfHash: csrfHash! };
}

export function verifyCsrfToken(session: ClientSession, supplied: string): boolean {
  if (!/^[A-Za-z0-9_-]{43}$/.test(supplied)) return false;
  const expected = Buffer.from(session.csrfHash, "base64url");
  const actual = createHash("sha256").update(supplied).digest();
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

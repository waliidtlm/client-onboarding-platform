import { randomBytes, randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  createClientSession,
  verifyClientSession,
  verifyCsrfToken,
} from "@/domain/client-access/session";

describe("client session signatures", () => {
  it("verifies a live session and its CSRF token", () => {
    const secret = randomBytes(32);
    const now = new Date("2028-01-01T00:00:00.000Z");
    const created = createClientSession({
      tokenId: randomUUID(),
      secret,
      now,
      lifetimeSeconds: 1_800,
    });
    const session = verifyClientSession(
      created.cookieValue,
      secret,
      new Date(now.getTime() + 1_000),
    );
    expect(session).not.toBeNull();
    expect(verifyCsrfToken(session!, created.csrfToken)).toBe(true);
    expect(verifyCsrfToken(session!, randomBytes(32).toString("base64url"))).toBe(false);
  });

  it("rejects an expired or modified cookie", () => {
    const secret = randomBytes(32);
    const now = new Date("2028-01-01T00:00:00.000Z");
    const created = createClientSession({
      tokenId: randomUUID(),
      secret,
      now,
      lifetimeSeconds: 10,
    });
    expect(
      verifyClientSession(created.cookieValue, secret, new Date(now.getTime() + 11_000)),
    ).toBeNull();
    expect(verifyClientSession(`${created.cookieValue.slice(0, -1)}A`, secret, now)).toBeNull();
  });
});

import { randomBytes, randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  createCapabilityToken,
  parseCapabilityToken,
  reconstructCapabilityToken,
  verifyCapabilityToken,
} from "@/domain/client-access/token";

describe("client capability tokens", () => {
  it("reconstructs and verifies without storing the bearer", () => {
    const key = randomBytes(32);
    const id = randomUUID();
    const expiresAt = new Date("2030-01-02T00:00:00.000Z");
    const created = createCapabilityToken({
      tokenId: id,
      expiresAt,
      signingKeyVersion: 4,
      signingKey: key,
    });
    const record = {
      id,
      tokenHash: created.tokenHash,
      tokenNonce: created.tokenNonce,
      tokenVersion: created.tokenVersion,
      signingKeyVersion: created.signingKeyVersion,
      expiresAt,
    };
    expect(reconstructCapabilityToken(record, key)).toBe(created.rawToken);
    expect(
      verifyCapabilityToken(created.rawToken, parseCapabilityToken(created.rawToken)!, record, key),
    ).toBe(true);
  });

  it("rejects malformed and tampered capabilities", () => {
    const key = randomBytes(32);
    const id = randomUUID();
    const expiresAt = new Date("2030-01-02T00:00:00.000Z");
    const created = createCapabilityToken({
      tokenId: id,
      expiresAt,
      signingKeyVersion: 1,
      signingKey: key,
    });
    const tampered = `${created.rawToken.slice(0, -1)}A`;
    expect(parseCapabilityToken("not-a-token")).toBeNull();
    expect(
      verifyCapabilityToken(
        tampered,
        parseCapabilityToken(tampered)!,
        {
          id,
          tokenHash: created.tokenHash,
          tokenNonce: created.tokenNonce,
          tokenVersion: created.tokenVersion,
          signingKeyVersion: created.signingKeyVersion,
          expiresAt,
        },
        key,
      ),
    ).toBe(false);
  });
});

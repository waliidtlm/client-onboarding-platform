import { describe, expect, it } from "vitest";
import {
  canonicalAutomationRequest,
  signAutomationRequest,
  verifyAutomationAuthentication,
} from "@/lib/automation/service-auth";

const secret = "test-hmac-secret-with-at-least-32-characters";
const token = "test-service-token-with-at-least-32-characters";
const timestamp = "1785196800";
const rawBody = new TextEncoder().encode('{"requestId":"abc"}');
const base = {
  method: "POST",
  requestTarget: "/api/internal/automation/claim",
  timestamp,
  rawBody,
};

describe("automation service authentication", () => {
  it("creates the documented canonical request", () => {
    expect(canonicalAutomationRequest(base).split("\n")).toHaveLength(4);
    expect(canonicalAutomationRequest(base)).toContain(
      "POST\n/api/internal/automation/claim\n1785196800\n",
    );
  });

  it("accepts a matching token, body, timestamp, and HMAC", () => {
    expect(
      verifyAutomationAuthentication({
        ...base,
        authorization: `Bearer ${token}`,
        signature: signAutomationRequest(base, secret),
        serviceToken: token,
        hmacSecret: secret,
        maxAgeSeconds: 300,
        now: new Date(1_785_196_800_000),
      }),
    ).toBe(true);
  });

  it.each([
    ["invalid token", { authorization: "Bearer wrong" }],
    ["altered body", { rawBody: new TextEncoder().encode("{}") }],
    ["expired timestamp", { now: new Date(1_785_197_200_000) }],
    ["malformed signature", { signature: "not-a-signature" }],
  ])("rejects %s", (_name, overrides) => {
    expect(
      verifyAutomationAuthentication({
        ...base,
        authorization: `Bearer ${token}`,
        signature: signAutomationRequest(base, secret),
        serviceToken: token,
        hmacSecret: secret,
        maxAgeSeconds: 300,
        now: new Date(1_785_196_800_000),
        ...overrides,
      }),
    ).toBe(false);
  });
});

import { describe, expect, it } from "vitest";

import { POST } from "@/app/api/internal/automation/claim/route";
import { signAutomationRequest } from "@/lib/automation/service-auth";

const serviceToken = "unit-test-automation-service-token-000000";
const hmacSecret = "unit-test-automation-hmac-secret-000000";
const path = "/api/internal/automation/claim";

function requestFor(
  body: string,
  overrides: Readonly<{
    token?: string;
    timestamp?: string;
    signatureBody?: string;
    signature?: string;
    contentLength?: string;
  }> = {},
): Request {
  const timestamp = overrides.timestamp ?? String(Math.floor(Date.now() / 1_000));
  const signatureBody = new TextEncoder().encode(overrides.signatureBody ?? body);
  const signature =
    overrides.signature ??
    signAutomationRequest(
      {
        method: "POST",
        requestTarget: path,
        timestamp,
        rawBody: signatureBody,
      },
      hmacSecret,
    );
  return new Request(`http://127.0.0.1:3000${path}`, {
    method: "POST",
    body,
    headers: {
      authorization: `Bearer ${overrides.token ?? serviceToken}`,
      "content-type": "application/json",
      "x-automation-timestamp": timestamp,
      "x-automation-signature": signature,
      ...(overrides.contentLength ? { "content-length": overrides.contentLength } : {}),
    },
  });
}

describe("automation claim Route Handler boundary", () => {
  it("rejects a missing token generically", async () => {
    const request = new Request(`http://127.0.0.1:3000${path}`, {
      method: "POST",
      body: "{}",
    });
    const response = await POST(request);
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: { code: "UNAUTHORIZED", message: "Authentication failed." },
    });
  });

  it.each([
    ["invalid token", { token: "wrong-token" }, 401],
    ["altered signed body", { signatureBody: "{}" }, 401],
    ["malformed signature", { signature: "sha256=broken" }, 401],
    ["expired timestamp", { timestamp: String(Math.floor(Date.now() / 1_000) - 1_000) }, 401],
  ] as const)("rejects %s", async (_name, overrides, status) => {
    const response = await POST(requestFor('{"invalid":true}', overrides));
    expect(response.status).toBe(status);
  });

  it("rejects malformed authenticated input", async () => {
    const response = await POST(requestFor("{"));
    expect(response.status).toBe(400);
  });

  it("rejects oversized requests before application processing", async () => {
    const response = await POST(requestFor("{}", { contentLength: "65537" }));
    expect(response.status).toBe(413);
  });
});

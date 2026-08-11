import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  consumeRateLimit,
  normalizeClientIp,
} from "@/application/client-access/rate-limit-service";
import { enforceStaffSignInRateLimit } from "@/lib/auth/signin-rate-limit";

vi.mock("@/application/client-access/rate-limit-service", () => ({
  consumeRateLimit: vi.fn(),
  normalizeClientIp: vi.fn(),
}));

function request(email = "Person@Northstar.test") {
  return new Request("http://127.0.0.1:3100/api/auth/callback/credentials", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ email, password: "not-logged" }),
  });
}

describe("staff sign-in rate-limit boundary", () => {
  beforeEach(() => {
    vi.mocked(normalizeClientIp).mockReturnValue("198.51.100.7");
    vi.mocked(consumeRateLimit).mockResolvedValue({
      allowed: true,
      retryAfterSeconds: 900,
    });
  });

  it("hashes normalized account and IP through the shared limiter", async () => {
    await expect(enforceStaffSignInRateLimit(request())).resolves.toBeNull();
    expect(consumeRateLimit).toHaveBeenNthCalledWith(1, "STAFF_LOGIN_IP", "198.51.100.7");
    expect(consumeRateLimit).toHaveBeenNthCalledWith(
      2,
      "STAFF_LOGIN_ACCOUNT",
      "person@northstar.test",
    );
  });

  it("returns one generic response for a limit or database failure", async () => {
    vi.mocked(consumeRateLimit).mockResolvedValueOnce({
      allowed: false,
      retryAfterSeconds: 600,
    });
    const limited = await enforceStaffSignInRateLimit(request("unknown@northstar.test"));
    expect(limited?.status).toBe(429);
    expect(await limited?.json()).toEqual({
      error: "CredentialsSignin",
      message: "The email or password is invalid, or this account is unavailable.",
    });

    vi.mocked(consumeRateLimit).mockRejectedValueOnce(new Error("database unavailable"));
    const failedClosed = await enforceStaffSignInRateLimit(request());
    expect(failedClosed?.status).toBe(429);
    expect(await failedClosed?.text()).not.toContain("database unavailable");
  });
});

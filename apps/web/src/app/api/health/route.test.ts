import { describe, expect, it } from "vitest";

import { GET } from "@/app/api/health/route";

describe("GET /api/health", () => {
  it("reports that the web process is alive", async () => {
    const response = GET();

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      status: "ok",
      service: "client-onboarding-web",
    });
  });
});

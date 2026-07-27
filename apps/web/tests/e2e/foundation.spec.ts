import { expect, test } from "@playwright/test";

test("shows the Phase 0 foundation page", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Client Onboarding Platform" })).toBeVisible();
  await expect(page.getByText("Phase 0 · Project Foundation")).toBeVisible();
});

test("exposes a process health endpoint", async ({ request }) => {
  const response = await request.get("/api/health");

  expect(response.status()).toBe(200);
  await expect(response.json()).resolves.toEqual({
    status: "ok",
    service: "client-onboarding-web",
  });
});

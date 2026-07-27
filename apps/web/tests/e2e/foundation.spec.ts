import { expect, test } from "@playwright/test";

test("redirects an unauthenticated staff member to sign in", async ({ page }) => {
  await page.goto("/dashboard");

  await expect(page).toHaveURL(/\/signin\?callbackUrl=%2Fdashboard/);
  await expect(page.getByRole("heading", { name: "Staff sign in" })).toBeVisible();
});

test("exposes a process health endpoint", async ({ request }) => {
  const response = await request.get("/api/health");

  expect(response.status()).toBe(200);
  await expect(response.json()).resolves.toEqual({
    status: "ok",
    service: "client-onboarding-web",
  });
});

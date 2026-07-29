import { expect, test } from "@playwright/test";

test("removes the fragment capability before exchange and does not retain it", async ({ page }) => {
  const fragmentSecret = "TEST_FRAGMENT_SECRET_DO_NOT_USE";
  await page.route("**/client-access/api/exchange", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true }),
    });
  });
  await page.route("**/client-access/api/context", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        clientCompany: "Fragment Test Client",
        packageName: "Secure Test Package",
        status: "CLIENT_AWAITING_ACTION",
        requirementsCompletedAt: null,
        requirements: [],
      }),
    });
  });

  await page.goto("/api/health");
  const exchangeRequest = page.waitForRequest("**/client-access/api/exchange");
  await page.goto(`/client-access#token=${fragmentSecret}`);
  const request = await exchangeRequest;

  expect(request.postDataJSON()).toEqual({ token: fragmentSecret });
  await expect(page.getByRole("heading", { name: "Fragment Test Client" })).toBeVisible();
  await expect.poll(() => new URL(page.url()).hash).toBe("");
  const retainedBrowserStorage = await page.evaluate(() =>
    [localStorage, sessionStorage].flatMap((storage) =>
      Array.from({ length: storage.length }, (_, index) => {
        const key = storage.key(index) ?? "";
        return `${key}:${storage.getItem(key) ?? ""}`;
      }),
    ),
  );
  expect(retainedBrowserStorage.join("\n")).not.toContain(fragmentSecret);
  await expect(page.locator("body")).not.toContainText(fragmentSecret);

  await page.goBack();
  await expect.poll(() => new URL(page.url()).pathname).toBe("/api/health");
  expect(page.url()).not.toContain(fragmentSecret);
});

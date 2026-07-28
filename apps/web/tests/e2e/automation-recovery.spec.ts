import { expect, test, type Page } from "@playwright/test";

const testStaffPassword = (() => {
  const value = process.env.TEST_STAFF_PASSWORD;
  if (!value) throw new Error("TEST_STAFF_PASSWORD is required");
  return value;
})();

async function signIn(page: Page, email: string) {
  await page.goto("/signin");
  await page.getByLabel("Staff email").fill(email);
  await page.getByLabel("Password").fill(testStaffPassword);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

test("Admin can review automation history without exposing service credentials", async ({
  page,
}) => {
  await signIn(page, "admin@northstar.test");
  await page.getByRole("link", { name: "Automation" }).click();

  await expect(page).toHaveURL(/\/automation-events$/);
  await expect(page.getByRole("heading", { name: "Automation events" })).toBeVisible();
  await expect(
    page.getByText(
      "Review failed automation attempts without changing the onboarding business record.",
    ),
  ).toBeVisible();
  await expect(page.getByText("No automation events have been recorded.")).toBeVisible();
  await expect(page.locator("body")).not.toContainText(
    process.env.AUTOMATION_SERVICE_TOKEN ?? "playwright-automation-service-token-000000",
  );
});

test("non-Admin roles cannot open automation recovery", async ({ page }) => {
  await signIn(page, "delivery@northstar.test");
  await page.goto("/automation-events");

  await expect(page).toHaveURL(/\/access-denied/);
  await expect(
    page.getByRole("heading", { name: "You do not have permission to view this information." }),
  ).toBeVisible();
});

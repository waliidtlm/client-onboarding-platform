import { expect, test, type Page } from "@playwright/test";

const testStaffPassword = (() => {
  const value = process.env.TEST_STAFF_PASSWORD;
  if (!value) throw new Error("TEST_STAFF_PASSWORD is required");
  return value;
})();

async function signIn(page: Page, email: string, password = testStaffPassword) {
  await page.goto("/signin");
  await page.getByLabel("Staff email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

test("active staff can sign in, view list/detail, and sign out", async ({ page }) => {
  await signIn(page, "admin@northstar.test");

  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole("heading", { name: "Onboarding workspace" })).toBeVisible();

  await page.getByRole("link", { name: "Onboardings", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Onboardings" })).toBeVisible();
  await expect(page.getByText("Atlas Fitness Studio")).toBeVisible();
  await expect(page.getByText("COMMERCIAL PENDING")).toBeVisible();
  await expect(page.getByText("Waiting for activation requirement")).toBeVisible();

  await page.getByRole("link", { name: "Atlas Fitness Studio" }).click();
  await expect(page.getByRole("heading", { name: "Atlas Fitness Studio" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Commercial Gate", exact: true })).toBeVisible();
  await expect(page.getByText("USD 2000.00", { exact: false })).toBeVisible();

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/signin$/);
});

for (const [email, password] of [
  ["admin@northstar.test", "incorrect-password"],
  ["unknown@northstar.test", "incorrect-password"],
  ["disabled@northstar.test", testStaffPassword],
] as const) {
  test(`uses a generic rejection for unavailable credentials: ${email}`, async ({ page }) => {
    await signIn(page, email, password);

    await expect(page.locator(".form-error[role='alert']")).toHaveText(
      "The email or password is invalid, or this account is unavailable.",
    );
    await expect(page).toHaveURL(/\/signin/);
  });
}

test("Delivery can view the onboarding but commercial rows are not exposed", async ({ page }) => {
  await signIn(page, "delivery@northstar.test");
  await expect(page).toHaveURL(/\/dashboard$/);
  await page.goto("/onboardings");
  await page.getByRole("link", { name: "Atlas Fitness Studio" }).click();

  await expect(page.getByTestId("commercial-restricted")).toBeVisible();
  await expect(page.getByText("NS-2026-0001")).toHaveCount(0);
  await expect(page.getByText("USD 2000.00", { exact: false })).toHaveCount(0);
});

test("missing onboarding records show the not-found state", async ({ page }) => {
  await signIn(page, "admin@northstar.test");
  await expect(page).toHaveURL(/\/dashboard$/);
  await page.goto("/onboardings/00000000-0000-0000-0000-000000000000");

  await expect(
    page.getByRole("heading", { name: "The requested onboarding record does not exist." }),
  ).toBeVisible();
});

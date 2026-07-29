import { expect, test, type Browser, type Page } from "@playwright/test";

const testStaffPassword = (() => {
  const value = process.env.TEST_STAFF_PASSWORD;
  if (!value) throw new Error("TEST_STAFF_PASSWORD is required");
  return value;
})();
let correctedOnboardingPath = "";

async function signIn(page: Page, email: string) {
  await page.goto("/signin");
  await page.getByLabel("Staff email").fill(email);
  await page.getByLabel("Password").fill(testStaffPassword);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

async function signedInPage(browser: Browser, email: string) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await signIn(page, email);
  return { context, page };
}

test.describe.serial("Phase 2 commercial workflow", () => {
  test("Sales submits an incomplete new-client handoff and corrects the same onboarding", async ({
    page,
  }) => {
    await signIn(page, "sales@northstar.test");
    await page.goto("/onboardings/new");
    await page.getByLabel("External deal reference").fill("DEAL-E2E-NEW-CLIENT-001");
    await page.getByLabel("Enter a new client").check();
    await page.getByLabel("New company name").fill("E2E Harbor Fitness");
    await page.getByLabel("Purchased package").selectOption({ label: "Paid Growth Launch" });
    await page.getByLabel("Agreed total").fill("5000.00");
    await page.getByLabel("Currency").fill("USD");
    await page.getByRole("button", { name: "Submit sales handoff" }).click();

    await expect(page.getByRole("heading", { name: "Correct the incomplete handoff" })).toBeVisible(
      { timeout: 15_000 },
    );
    correctedOnboardingPath = new URL(page.url()).pathname.replace(/\/handoff$/, "");
    await page.getByLabel("New client contact name").fill("Hana Harbor");
    await page.getByLabel("New client contact email").fill("hana@harbor-fitness.test");
    await page.getByRole("button", { name: "Correct handoff" }).click();

    await expect(page.getByRole("heading", { name: "E2E Harbor Fitness" })).toBeVisible();
    await expect(page.getByText("COMMERCIAL PENDING")).toBeVisible();
    await expect(
      page.getByText("Waiting for Finance to issue the activation invoice"),
    ).toBeVisible();
  });

  test("role-specific commercial controls remain server-authorized", async ({ browser }) => {
    const sales = await signedInPage(browser, "sales@northstar.test");
    await sales.page.goto(correctedOnboardingPath);
    await expect(sales.page.getByRole("button", { name: "Issue activation invoice" })).toHaveCount(
      0,
    );
    await sales.context.close();

    const finance = await signedInPage(browser, "finance@northstar.test");
    await finance.page.goto("/onboardings");
    await finance.page.getByRole("link", { name: "Atlas Fitness Studio" }).click();
    await expect(finance.page.getByRole("button", { name: "Update contract" })).toHaveCount(0);
    await finance.context.close();

    const delivery = await signedInPage(browser, "delivery@northstar.test");
    await delivery.page.goto("/onboardings");
    await delivery.page.getByRole("link", { name: "Atlas Fitness Studio" }).click();
    await expect(
      delivery.page.getByRole("heading", {
        name: "The requested onboarding record does not exist.",
      }),
    ).toBeVisible();
    await expect(delivery.page.getByText("NS-2026-0001")).toHaveCount(0);
    await delivery.context.close();
  });

  test("Finance verifies the additional Atlas payment and the same onboarding activates", async ({
    browser,
    page,
  }) => {
    await signIn(page, "finance@northstar.test");
    await page.goto("/onboardings");
    await page.getByRole("link", { name: "Atlas Fitness Studio" }).click();
    const atlasPath = new URL(page.url()).pathname;

    await page.getByLabel("Payment amount").fill("1000.00");
    await page.getByLabel("Payment evidence/reference").fill("PAYMENT-E2E-ATLAS-002");
    await page.getByRole("button", { name: "Record payment" }).click();
    await expect(
      page.locator(".payment-review-card").filter({ hasText: "USD 1000.00" }),
    ).toContainText("PENDING");

    const sales = await signedInPage(browser, "sales@northstar.test");
    await sales.page.goto(atlasPath);
    await expect(sales.page.getByRole("button", { name: "Save payment review" })).toHaveCount(0);
    await sales.context.close();

    await page.getByLabel("Verified amount").fill("1000.00");
    await page.getByRole("button", { name: "Save payment review" }).click();
    await expect(page.getByText("READY FOR ONBOARDING")).toBeVisible();
    await expect(page.getByText("Commercial Gate: APPROVED")).toBeVisible();
    await expect(page.getByText("ONBOARDING ACTIVATED")).toHaveCount(1);
  });

  test("repeated activation recalculation leaves one activation audit event", async ({ page }) => {
    await signIn(page, "admin@northstar.test");
    await page.goto("/onboardings");
    await page.getByRole("link", { name: "Atlas Fitness Studio" }).click();
    await page.getByRole("button", { name: "Recalculate gate" }).click();
    await page.getByRole("button", { name: "Recalculate gate" }).click();

    await expect(page.getByText("READY FOR ONBOARDING")).toBeVisible();
    await expect(page.getByText("ONBOARDING ACTIVATED")).toHaveCount(1);
  });
});

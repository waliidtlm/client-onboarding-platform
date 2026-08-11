import { randomUUID } from "node:crypto";

import { PrismaPg } from "@prisma/adapter-pg";
import { expect, test, type Page } from "@playwright/test";

import { PrismaClient } from "../../src/generated/prisma/client";

const testStaffPassword = (() => {
  const value = process.env.TEST_STAFF_PASSWORD;
  if (!value) throw new Error("TEST_STAFF_PASSWORD is required");
  return value;
})();
const testDatabaseUrl = process.env.TEST_DATABASE_URL;
if (!testDatabaseUrl) throw new Error("TEST_DATABASE_URL is required");
const client = new PrismaClient({
  adapter: new PrismaPg({ connectionString: testDatabaseUrl }),
});
let eventId = "";

test.beforeAll(async () => {
  const onboarding = await client.onboarding.findFirstOrThrow();
  const suffix = randomUUID();
  const event = await client.automationEvent.create({
    data: {
      eventType: "PROVISIONING_TASK_REQUESTED",
      aggregateType: "ONBOARDING",
      aggregateId: onboarding.id,
      payload: { taskId: randomUUID(), privateValue: "must-never-render" },
      schemaVersion: 1,
      status: "FAILED",
      attemptCount: 1,
      maxAttempts: 3,
      availableAt: new Date(),
      occurredAt: new Date(),
      lastErrorCode: "PROVIDER_TEMPORARY_FAILURE",
      lastError:
        "Bearer must-never-render C:\\Users\\private-user\\worker.ts stack trace must-never-render",
      correlationId: randomUUID(),
      deduplicationKey: `PHASE7-E2E-RECOVERY:${suffix}`,
      runs: {
        create: {
          workflowName: "Fictional recovery test",
          workerId: `worker-private-value-${suffix}`,
          n8nExecutionId: `n8n-private-value-${suffix}`,
          claimRequestId: randomUUID(),
          idempotencyKey: `PHASE7-E2E-RUN:${suffix}`,
          status: "FAILED",
          attemptNumber: 1,
          startedAt: new Date(),
          completedAt: new Date(),
          errorCode: "PROVIDER_TEMPORARY_FAILURE",
          errorMessage:
            "authorization: must-never-render C:\\Users\\private-user\\worker.ts stack trace",
          failedNode: "private-node-name",
          failureClassification: "OPERATOR_REMEDIABLE",
          failureReportedAt: new Date(),
        },
      },
    },
  });
  eventId = event.id;
});

test.afterAll(async () => client.$disconnect());

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
  await expect(page.getByTestId(`automation-event-${eventId}`)).toBeVisible();
  await expect(page.getByText("PROVISIONING TASK REQUESTED")).toBeVisible();
  await expect(page.getByText("1 / 3")).toBeVisible();
  await expect(
    page.getByText(
      "A provider operation failed temporarily. Review current eligibility before retrying.",
    ),
  ).toBeVisible();
  await expect(page.getByText("Open onboarding recovery")).toBeVisible();
  await expect(page.getByLabel("Status")).toHaveValue("ACTION_REQUIRED");
  await expect(page.locator("body")).not.toContainText("n8n execution");
  await expect(page.locator("body")).not.toContainText("must-never-render");
  await expect(page.locator("body")).not.toContainText("worker-private-value");
  await expect(page.locator("body")).not.toContainText("private-node-name");
  await expect(page.locator("body")).not.toContainText("private-user");
  await expect(page.locator("body")).not.toContainText("stack trace");
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

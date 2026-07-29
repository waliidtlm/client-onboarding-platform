import { createHash, randomUUID } from "node:crypto";

import { PrismaPg } from "@prisma/adapter-pg";
import { expect, test, type Page } from "@playwright/test";

import {
  ActivationRequirementStatus,
  ActivationType,
  CommercialGateStatus,
  DealStatus,
  OnboardingStatus,
  PrismaClient,
  SalesHandoffStatus,
} from "../../src/generated/prisma/client";

const databaseUrl = process.env.TEST_DATABASE_URL;
const testStaffPassword = process.env.TEST_STAFF_PASSWORD;
if (!databaseUrl || !testStaffPassword) throw new Error("Phase 6 E2E environment is incomplete");

const client = new PrismaClient({
  adapter: new PrismaPg({ connectionString: databaseUrl }),
});
let onboardingId: string;
let companyName: string;

async function signIn(page: Page) {
  await page.goto("/signin");
  await page.getByLabel("Staff email").fill("delivery@northstar.test");
  await page.getByLabel("Password").fill(testStaffPassword!);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

test.beforeAll(async () => {
  const [admin, projectManager, delivery, sales] = await Promise.all([
    client.user.findUniqueOrThrow({ where: { email: "admin@northstar.test" } }),
    client.user.findUniqueOrThrow({ where: { email: "pm@northstar.test" } }),
    client.user.findUniqueOrThrow({ where: { email: "delivery@northstar.test" } }),
    client.user.findUniqueOrThrow({ where: { email: "sales@northstar.test" } }),
  ]);
  const suffix = randomUUID();
  companyName = `Phase 6 Delivery E2E ${suffix}`;
  const servicePackage = await client.servicePackage.create({
    data: {
      name: `Phase 6 Delivery Package ${suffix}`,
      description: "E2E-only package.",
      activationType: ActivationType.MANUAL_APPROVAL,
      activationValue: "0.0000",
    },
  });
  const customer = await client.client.create({
    data: {
      companyName,
      contactName: "Delivery E2E Client",
      contactEmail: `phase6-delivery-${suffix}@example.test`,
    },
  });
  const now = new Date(Date.now() - 60_000);
  const onboarding = await client.onboarding.create({
    data: {
      clientId: customer.id,
      servicePackageId: servicePackage.id,
      externalDealId: `PHASE6-E2E-${suffix}`,
      dealStatus: DealStatus.CLOSED_WON,
      salesHandoffStatus: SalesHandoffStatus.COMPLETE,
      commercialGateStatus: CommercialGateStatus.APPROVED,
      status: OnboardingStatus.PROJECT_READY,
      projectManagerId: projectManager.id,
      submittedById: sales.id,
      validatedById: admin.id,
      invoiceTotal: "1000.0000",
      currency: "USD",
      servicePackageNameSnapshot: servicePackage.name,
      activationTypeSnapshot: ActivationType.MANUAL_APPROVAL,
      activationValueSnapshot: "0.0000",
      activationRequirementStatus: ActivationRequirementStatus.SATISFIED,
      activatedAt: now,
      requirementsCompletedAt: now,
      projectReadyAt: now,
      kickoff: {
        create: {
          status: "COMPLETED",
          scheduledStartAt: now,
          timezone: "UTC",
          meetingUrl: "https://meet.example.test/e2e",
          scheduleRevision: 1,
          completedAt: now,
          completedById: projectManager.id,
          outcomeNotes:
            "The delivery E2E kickoff confirmed scope, ownership, milestones, and immediate next actions.",
          completionIdempotencyKey: `PHASE6-E2E-KICKOFF:${suffix}`,
          completionFingerprint: createHash("sha256").update(`kickoff:${suffix}`).digest("hex"),
        },
      },
      deliveryHandoff: {
        create: {
          preparedById: projectManager.id,
          assignedDeliveryUserId: delivery.id,
          status: "NOTIFIED",
          summary:
            "Delivery owns the approved project scope and should begin with the frozen kickoff decisions.",
          riskNotes: "No blocking risks were identified.",
          nextActions: "Acknowledge ownership and begin delivery planning.",
          sourceSnapshot: { schemaVersion: 1, onboardingId: suffix },
          sourceFingerprint: createHash("sha256").update(`source:${suffix}`).digest("hex"),
          summarySchemaVersion: 1,
          assignmentRevision: 1,
          preparedAt: now,
        },
      },
    },
  });
  onboardingId = onboarding.id;
});

test.afterAll(async () => client.$disconnect());

test("assigned Delivery sees only the handoff workspace and can acknowledge", async ({ page }) => {
  await signIn(page);
  await page.goto(`/onboardings/${onboardingId}`);

  await expect(page.getByRole("heading", { name: companyName })).toBeVisible();
  await expect(page.getByText("Assigned delivery workspace")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Delivery handoff" })).toBeVisible();
  await expect(
    page.getByText("Delivery owns the approved project scope", { exact: false }),
  ).toBeVisible();
  await expect(page.getByText("Commercial Gate", { exact: true })).toHaveCount(0);
  await expect(page.getByText(`PHASE6-E2E-`, { exact: false })).toHaveCount(0);

  await page.getByRole("button", { name: "Acknowledge handoff" }).click();
  await expect(page).toHaveURL(new RegExp(`/onboardings/${onboardingId}\\?success=`));
  await expect(
    page.getByText("Delivery handoff acknowledged and onboarding completed."),
  ).toBeVisible();
  await expect(page.getByText("ACKNOWLEDGED", { exact: true })).toBeVisible();
});

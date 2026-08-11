import { randomUUID } from "node:crypto";

import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { evaluateDueReminders } from "../../src/application/reminders/evaluation-service";
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
if (!databaseUrl) throw new Error("TEST_DATABASE_URL is required");

const client = new PrismaClient({
  adapter: new PrismaPg({ connectionString: databaseUrl }),
});

describe("Phase 7 reminder materialization", () => {
  beforeAll(async () => client.$connect());
  afterAll(async () => client.$disconnect());

  it("creates bounded deterministic windows and stops after submission", async () => {
    const [admin, projectManager, sales] = await Promise.all([
      client.user.findUniqueOrThrow({ where: { email: "admin@northstar.test" } }),
      client.user.findUniqueOrThrow({ where: { email: "pm@northstar.test" } }),
      client.user.findUniqueOrThrow({ where: { email: "sales@northstar.test" } }),
    ]);
    const suffix = randomUUID();
    const servicePackage = await client.servicePackage.create({
      data: {
        name: `Phase 7 Reminder Package ${suffix}`,
        description: "Isolated Phase 7 reminder integration fixture.",
        activationType: ActivationType.DEPOSIT_PERCENTAGE,
        activationValue: "30.0000",
        requirementTemplates: {
          create: {
            name: "Mandatory campaign brief",
            description: "A mandatory fictional brief.",
            inputType: "TEXT",
            isRequired: true,
            sequence: 1,
            dueOffsetDays: 1,
          },
        },
      },
      include: { requirementTemplates: true },
    });
    const customer = await client.client.create({
      data: {
        companyName: `Phase 7 Reminder Client ${suffix}`,
        contactName: "Fictional Reminder Client",
        contactEmail: `phase7-reminder-${suffix}@example.test`,
      },
    });
    const accessDeliveredAt = new Date(Date.now() - 11 * 24 * 60 * 60 * 1000);
    const onboarding = await client.onboarding.create({
      data: {
        clientId: customer.id,
        servicePackageId: servicePackage.id,
        externalDealId: `PHASE7-REMINDER-${suffix}`,
        dealStatus: DealStatus.CLOSED_WON,
        salesHandoffStatus: SalesHandoffStatus.COMPLETE,
        commercialGateStatus: CommercialGateStatus.APPROVED,
        status: OnboardingStatus.CLIENT_AWAITING_ACTION,
        projectManagerId: projectManager.id,
        submittedById: sales.id,
        validatedById: admin.id,
        invoiceTotal: "1000.0000",
        currency: "USD",
        servicePackageNameSnapshot: servicePackage.name,
        activationTypeSnapshot: ActivationType.DEPOSIT_PERCENTAGE,
        activationValueSnapshot: "30.0000",
        activationRequiredAmount: "300.0000",
        activationRequirementStatus: ActivationRequirementStatus.SATISFIED,
        activatedAt: new Date(),
        welcomeEmailSentAt: accessDeliveredAt,
        clientAccessDeliveredAt: accessDeliveredAt,
      },
    });
    const requirement = await client.clientRequirement.create({
      data: {
        onboardingId: onboarding.id,
        templateId: servicePackage.requirementTemplates[0]!.id,
        name: "Mandatory campaign brief",
        description: "A mandatory fictional brief.",
        inputType: "TEXT",
        isRequired: true,
        sequence: 1,
        dueOffsetDays: 1,
        dueAt: new Date(accessDeliveredAt.getTime() + 24 * 60 * 60 * 1000),
        status: "PENDING",
      },
    });

    const first = await evaluateDueReminders({ requestId: randomUUID() }, client);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.value.createdCount).toBe(5);

    const notifications = await client.notificationLog.findMany({
      where: {
        onboardingId: onboarding.id,
        notificationType: "CLIENT_REQUIREMENT",
      },
      orderBy: { idempotencyKey: "asc" },
    });
    expect(notifications).toHaveLength(5);
    expect(notifications.filter((item) => item.recipient === customer.contactEmail)).toHaveLength(
      3,
    );
    expect(notifications.every((item) => item.recipient.endsWith(".test"))).toBe(true);
    expect(new Set(notifications.map((item) => item.idempotencyKey)).size).toBe(5);

    const replay = await evaluateDueReminders({ requestId: randomUUID() }, client);
    expect(replay).toMatchObject({ ok: true, value: { createdCount: 0 } });

    await client.clientRequirement.update({
      where: { id: requirement.id },
      data: {
        status: "UNDER_REVIEW",
        currentSubmissionVersion: 1,
        reviewingSubmissionVersion: 1,
        version: { increment: 1 },
      },
    });
    const stopped = await evaluateDueReminders({ requestId: randomUUID() }, client);
    expect(stopped).toMatchObject({ ok: true, value: { createdCount: 0 } });
  });
});

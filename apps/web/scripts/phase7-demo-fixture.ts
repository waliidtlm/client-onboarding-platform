import { createHash, randomUUID } from "node:crypto";

import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../src/generated/prisma/client";

const DATABASE_NAME = "onboarding_phase7_demo";
const FIXTURE_MARKER = "PHASE7_DEMO_FIXTURE_v1";

const databaseUrl = process.env.DATABASE_URL;
if (
  !databaseUrl ||
  new URL(databaseUrl).pathname !== `/${DATABASE_NAME}` ||
  process.env.PHASE7_DEMO_FIXTURE_MARKER !== FIXTURE_MARKER
) {
  throw new Error("Phase 7 fixture refused: isolated database name or marker is not exact");
}

const database = new PrismaClient({
  adapter: new PrismaPg({ connectionString: databaseUrl }),
});

const now = new Date();
const oneHour = 60 * 60 * 1000;
const oneDay = 24 * oneHour;
const clientAccessDeliveredAt = new Date(now.getTime() - 68 * oneHour);

try {
  const existing = await database.onboarding.findUnique({
    where: { externalDealId: FIXTURE_MARKER },
  });
  if (existing) {
    const reminderOnboarding = await database.onboarding.findUnique({
      where: { externalDealId: `${FIXTURE_MARKER}:REMINDER` },
    });
    if (reminderOnboarding) {
      await database.automationEvent.updateMany({
        where: {
          aggregateId: reminderOnboarding.id,
          eventType: "REMINDER_NOTIFICATION_REQUESTED",
          status: { in: ["FAILED", "DEAD_LETTER"] },
        },
        data: {
          status: "PENDING",
          attemptCount: 0,
          currentRunId: null,
          claimedBy: null,
          claimedAt: null,
          leaseExpiresAt: null,
          processedAt: null,
          lastErrorCode: null,
          lastError: null,
          resolvedById: null,
          resolvedAt: null,
          resolutionCode: null,
          availableAt: new Date(),
        },
      });
    }
    process.stdout.write(`Phase 7 fixture already exists: ${existing.id}\n`);
    process.exit(0);
  }

  const [admin, sales, projectManager, delivery, servicePackage] = await Promise.all([
    database.user.findUniqueOrThrow({ where: { email: "admin@northstar.test" } }),
    database.user.findUniqueOrThrow({ where: { email: "sales@northstar.test" } }),
    database.user.findUniqueOrThrow({ where: { email: "pm@northstar.test" } }),
    database.user.findUniqueOrThrow({ where: { email: "delivery@northstar.test" } }),
    database.servicePackage.findFirstOrThrow({
      include: {
        provisioningTemplates: { orderBy: { sequence: "asc" } },
        requirementTemplates: { orderBy: { sequence: "asc" } },
      },
    }),
  ]);
  const customer = await database.client.upsert({
    where: { companyName: "Atlas Fitness Studio — Phase 7 Isolated Demo" },
    create: {
      companyName: "Atlas Fitness Studio — Phase 7 Isolated Demo",
      contactName: "Amina Atlas",
      contactEmail: "amina.atlas@phase7-demo.test",
      contactPhone: FIXTURE_MARKER,
    },
    update: {
      contactName: "Amina Atlas",
      contactEmail: "amina.atlas@phase7-demo.test",
      contactPhone: FIXTURE_MARKER,
    },
  });
  const onboarding = await database.onboarding.create({
    data: {
      clientId: customer.id,
      servicePackageId: servicePackage.id,
      externalDealId: FIXTURE_MARKER,
      dealStatus: "CLOSED_WON",
      salesHandoffStatus: "COMPLETE",
      commercialGateStatus: "APPROVED",
      status: "COMPLETED",
      projectManagerId: projectManager.id,
      submittedById: sales.id,
      validatedById: admin.id,
      invoiceTotal: "10000.0000",
      currency: "USD",
      servicePackageNameSnapshot: servicePackage.name,
      activationTypeSnapshot: servicePackage.activationType,
      activationValueSnapshot: servicePackage.activationValue,
      activationRequiredAmount: "3000.0000",
      activationRequirementStatus: "SATISFIED",
      activatedAt: new Date(now.getTime() - 96 * oneHour),
      internalReadinessApprovedById: projectManager.id,
      internalReadinessApprovedAt: new Date(now.getTime() - 72 * oneHour),
      requirementsGenerationKey: `${FIXTURE_MARKER}:REQUIREMENTS`,
      requirementsGeneratedAt: new Date(now.getTime() - 70 * oneHour),
      clientAccessDeliveredAt,
      requirementsCompletedAt: new Date(now.getTime() - 36 * oneHour),
      projectReadyAt: new Date(now.getTime() - 12 * oneHour),
      completedAt: new Date(now.getTime() - oneHour),
      slaTargetHoursSnapshot: 120,
      slaResult: "MET",
      version: 12,
    },
  });
  const token = await database.clientAccessToken.create({
    data: {
      onboardingId: onboarding.id,
      tokenHash: createHash("sha256").update(`${FIXTURE_MARKER}:token`).digest("hex"),
      tokenNonce: "D".repeat(43),
      tokenVersion: 1,
      signingKeyVersion: 1,
      issueSequence: 1,
      issuanceKey: `${FIXTURE_MARKER}:ACCESS`,
      requestFingerprint: createHash("sha256").update(`${FIXTURE_MARKER}:access`).digest("hex"),
      expiresAt: new Date(now.getTime() + 24 * oneHour),
      revokedAt: new Date(now.getTime() - oneHour),
      revocationReason: "ONBOARDING_COMPLETED",
    },
  });

  for (const [index, template] of servicePackage.provisioningTemplates.entries()) {
    await database.provisioningTask.create({
      data: {
        onboardingId: onboarding.id,
        templateId: template.id,
        name: template.name,
        description: template.description,
        sequence: template.sequence,
        isRequired: template.isRequired,
        automationKey: template.automationKey,
        status: "COMPLETED",
        attemptCount: index === 0 ? 2 : 1,
        maxAttempts: 3,
        externalReference: `sandbox://${FIXTURE_MARKER}/${template.automationKey}`,
        idempotencyKey: `${FIXTURE_MARKER}:PROVISIONING:${template.id}`,
        startedAt: new Date(now.getTime() - 90 * oneHour),
        completedAt: new Date(now.getTime() - 80 * oneHour + index * oneHour),
      },
    });
  }

  for (const [index, template] of servicePackage.requirementTemplates.entries()) {
    const corrected = index === 0;
    const requirement = await database.clientRequirement.create({
      data: {
        onboardingId: onboarding.id,
        templateId: template.id,
        name: template.name,
        description: template.description,
        inputType: template.inputType,
        isRequired: template.isRequired,
        sequence: template.sequence,
        dueOffsetDays: template.dueOffsetDays,
        dueAt: new Date(clientAccessDeliveredAt.getTime() + template.dueOffsetDays * oneDay),
        status: "APPROVED",
        currentSubmissionVersion: corrected ? 2 : 1,
        approvedById: projectManager.id,
        approvedAt: new Date(now.getTime() - 38 * oneHour + index * 60_000),
      },
    });
    if (corrected) {
      await database.requirementSubmission.create({
        data: {
          requirementId: requirement.id,
          submissionVersion: 1,
          textValue: "Initial fictional submission requiring correction.",
          submittedViaTokenId: token.id,
          submissionIdempotencyKey: `${FIXTURE_MARKER}:SUBMISSION:${index}:1`,
          requestFingerprint: createHash("sha256")
            .update(`${FIXTURE_MARKER}:submission:${index}:1`)
            .digest("hex"),
          submittedAt: new Date(now.getTime() - 54 * oneHour),
          reviewedAt: new Date(now.getTime() - 52 * oneHour),
          reviewedById: projectManager.id,
          reviewDecision: "REJECTED",
          reviewReason: "Please provide the corrected approved version.",
        },
      });
    }
    await database.requirementSubmission.create({
      data: {
        requirementId: requirement.id,
        submissionVersion: corrected ? 2 : 1,
        textValue: "Corrected fictional Phase 7 demo submission.",
        submittedViaTokenId: token.id,
        submissionIdempotencyKey: `${FIXTURE_MARKER}:SUBMISSION:${index}:FINAL`,
        requestFingerprint: createHash("sha256")
          .update(`${FIXTURE_MARKER}:submission:${index}:final`)
          .digest("hex"),
        submittedAt: new Date(now.getTime() - 48 * oneHour + index * 60_000),
        reviewedAt: new Date(now.getTime() - 40 * oneHour + index * 60_000),
        reviewedById: projectManager.id,
        reviewDecision: "APPROVED",
      },
    });
  }

  await database.kickoff.create({
    data: {
      onboardingId: onboarding.id,
      status: "COMPLETED",
      scheduledStartAt: new Date(now.getTime() - 24 * oneHour),
      timezone: "Africa/Casablanca",
      meetingUrl: "https://meet.example.test/phase7-demo",
      scheduleRevision: 1,
      completedAt: new Date(now.getTime() - 12 * oneHour),
      completedById: projectManager.id,
      outcomeNotes: "Goals, access, owners, and launch milestones confirmed.",
      completionIdempotencyKey: `${FIXTURE_MARKER}:KICKOFF`,
      completionFingerprint: createHash("sha256").update(`${FIXTURE_MARKER}:kickoff`).digest("hex"),
    },
  });
  await database.deliveryHandoff.create({
    data: {
      onboardingId: onboarding.id,
      preparedById: projectManager.id,
      assignedDeliveryUserId: delivery.id,
      status: "ACKNOWLEDGED",
      summary: "Paid Growth Launch is ready for Delivery.",
      riskNotes: "No open mandatory requirements.",
      nextActions: "Launch the approved campaign plan.",
      sourceSnapshot: { fixture: FIXTURE_MARKER, approvedRequirementCount: 8 },
      sourceFingerprint: createHash("sha256").update(`${FIXTURE_MARKER}:handoff`).digest("hex"),
      summarySchemaVersion: 1,
      assignmentRevision: 1,
      preparedAt: new Date(now.getTime() - 12 * oneHour),
      acknowledgedAt: new Date(now.getTime() - oneHour),
      acknowledgedById: delivery.id,
      acknowledgmentNotes: "Delivery ownership accepted.",
      acknowledgmentIdempotencyKey: `${FIXTURE_MARKER}:ACK`,
      acknowledgmentFingerprint: createHash("sha256").update(`${FIXTURE_MARKER}:ack`).digest("hex"),
    },
  });

  const actions = [
    "SALES_HANDOFF_CORRECTED",
    "ONBOARDING_ACTIVATED",
    "PROVISIONING_TASK_ATTEMPT_FAILED",
    "PROVISIONING_TASK_RETRIED",
    "PROVISIONING_TASK_COMPLETED",
    "INTERNAL_READINESS_APPROVED",
    "CLIENT_ACCESS_ISSUED",
    "CLIENT_REQUIREMENT_REJECTED",
    "CLIENT_REQUIREMENT_CORRECTED",
    "CLIENT_REQUIREMENTS_COMPLETED",
    "KICKOFF_SCHEDULED",
    "KICKOFF_COMPLETED",
    "DELIVERY_HANDOFF_READY",
    "DELIVERY_HANDOFF_ACKNOWLEDGED",
    "CLIENT_ACCESS_REVOKED",
    "ONBOARDING_COMPLETED",
  ];
  await database.auditEvent.createMany({
    data: actions.map((action, index) => ({
      onboardingId: onboarding.id,
      actorType: "SYSTEM",
      action,
      entityType: "ONBOARDING",
      entityId: onboarding.id,
      metadata: { fixture: FIXTURE_MARKER, sequence: index + 1 },
      correlationId: randomUUID(),
      createdAt: new Date(now.getTime() - (actions.length - index) * oneHour),
    })),
  });

  await database.automationEvent.create({
    data: {
      eventType: "ONBOARDING_ACTIVATED",
      aggregateType: "ONBOARDING",
      aggregateId: onboarding.id,
      payload: {},
      schemaVersion: 1,
      status: "DEAD_LETTER",
      attemptCount: 3,
      maxAttempts: 3,
      availableAt: new Date(now.getTime() - 90 * oneHour),
      occurredAt: new Date(now.getTime() - 90 * oneHour),
      lastErrorCode: "ATTEMPTS_EXHAUSTED",
      lastError: "Fictional transient provider outage; recovered through the dedicated workflow.",
      correlationId: randomUUID(),
      deduplicationKey: `${FIXTURE_MARKER}:DEAD-LETTER`,
    },
  });

  const reminderTemplate = servicePackage.requirementTemplates[0]!;
  const reminderDeliveredAt = new Date(
    now.getTime() - (10 + reminderTemplate.dueOffsetDays) * oneDay,
  );
  const reminderOnboarding = await database.onboarding.create({
    data: {
      clientId: customer.id,
      servicePackageId: servicePackage.id,
      externalDealId: `${FIXTURE_MARKER}:REMINDER`,
      dealStatus: "CLOSED_WON",
      salesHandoffStatus: "COMPLETE",
      commercialGateStatus: "APPROVED",
      status: "CLIENT_AWAITING_ACTION",
      projectManagerId: projectManager.id,
      submittedById: sales.id,
      validatedById: admin.id,
      invoiceTotal: "10000.0000",
      currency: "USD",
      servicePackageNameSnapshot: servicePackage.name,
      activationTypeSnapshot: servicePackage.activationType,
      activationValueSnapshot: servicePackage.activationValue,
      activationRequiredAmount: "3000.0000",
      activationRequirementStatus: "SATISFIED",
      activatedAt: new Date(reminderDeliveredAt.getTime() - oneDay),
      clientAccessDeliveredAt: reminderDeliveredAt,
      requirementsGenerationKey: `${FIXTURE_MARKER}:REMINDER:REQUIREMENTS`,
      requirementsGeneratedAt: reminderDeliveredAt,
    },
  });
  await database.clientRequirement.create({
    data: {
      onboardingId: reminderOnboarding.id,
      templateId: reminderTemplate.id,
      name: reminderTemplate.name,
      description: reminderTemplate.description,
      inputType: reminderTemplate.inputType,
      isRequired: true,
      sequence: 1,
      dueOffsetDays: reminderTemplate.dueOffsetDays,
      dueAt: new Date(reminderDeliveredAt.getTime() + reminderTemplate.dueOffsetDays * oneDay),
      status: "PENDING",
    },
  });

  process.stdout.write(`Created isolated Phase 7 fixture: ${onboarding.id}\n`);
} finally {
  await database.$disconnect();
}

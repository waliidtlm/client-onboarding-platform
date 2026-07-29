import { createHash, randomUUID } from "node:crypto";

import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  acknowledgeDeliveryHandoff,
  markDeliveryHandoffReady,
  saveDeliveryHandoffDraft,
} from "../../src/application/phase6/handoff-service";
import {
  completeKickoff,
  initializeKickoffFromCompletionEvent,
  scheduleKickoff,
  waiveKickoffInvitation,
} from "../../src/application/phase6/kickoff-service";
import {
  ActivationRequirementStatus,
  ActivationType,
  CommercialGateStatus,
  DealStatus,
  NotificationStatus,
  OnboardingStatus,
  PrismaClient,
  SalesHandoffStatus,
} from "../../src/generated/prisma/client";

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) throw new Error("TEST_DATABASE_URL is required");

const client = new PrismaClient({
  adapter: new PrismaPg({ connectionString: databaseUrl }),
});

describe("Phase 6 kickoff and delivery handoff", () => {
  beforeAll(async () => client.$connect());
  afterAll(async () => client.$disconnect());

  it("progresses through the authoritative states with replay-safe commands", async () => {
    const [admin, projectManager, delivery, sales] = await Promise.all([
      client.user.findUniqueOrThrow({ where: { email: "admin@northstar.test" } }),
      client.user.findUniqueOrThrow({ where: { email: "pm@northstar.test" } }),
      client.user.findUniqueOrThrow({ where: { email: "delivery@northstar.test" } }),
      client.user.findUniqueOrThrow({ where: { email: "sales@northstar.test" } }),
    ]);
    const suffix = randomUUID();
    const servicePackage = await client.servicePackage.create({
      data: {
        name: `Phase 6 Integration ${suffix}`,
        description: "Isolated Phase 6 integration package.",
        activationType: ActivationType.DEPOSIT_PERCENTAGE,
        activationValue: "25.0000",
        onboardingSlaTargetHours: 24,
        requirementTemplates: {
          create: {
            name: "Approved brief",
            description: "Approved input.",
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
        companyName: `Phase 6 Integration Client ${suffix}`,
        contactName: "Integration Client",
        contactEmail: `phase6-${suffix}@example.test`,
      },
    });
    const now = new Date();
    const onboarding = await client.onboarding.create({
      data: {
        clientId: customer.id,
        servicePackageId: servicePackage.id,
        externalDealId: `PHASE6-INTEGRATION-${suffix}`,
        dealStatus: DealStatus.CLOSED_WON,
        salesHandoffStatus: SalesHandoffStatus.COMPLETE,
        commercialGateStatus: CommercialGateStatus.APPROVED,
        status: OnboardingStatus.CLIENT_REQUIREMENTS_COMPLETE,
        projectManagerId: projectManager.id,
        submittedById: sales.id,
        validatedById: admin.id,
        invoiceTotal: "1000.0000",
        currency: "USD",
        servicePackageNameSnapshot: servicePackage.name,
        activationTypeSnapshot: ActivationType.DEPOSIT_PERCENTAGE,
        activationValueSnapshot: "25.0000",
        activationRequiredAmount: "250.0000",
        activationRequirementStatus: ActivationRequirementStatus.SATISFIED,
        activatedAt: now,
        requirementsCompletedAt: now,
        slaTargetHoursSnapshot: 24,
        clientAccessTokens: {
          create: {
            tokenHash: createHash("sha256").update(`token:${suffix}`).digest("hex"),
            tokenNonce: "A".repeat(43),
            tokenVersion: 1,
            signingKeyVersion: 1,
            issueSequence: 1,
            issuanceKey: `PHASE6-TOKEN:${suffix}`,
            requestFingerprint: "b".repeat(64),
            expiresAt: new Date(now.getTime() + 86_400_000),
          },
        },
      },
    });
    const accessToken = await client.clientAccessToken.findFirstOrThrow({
      where: { onboardingId: onboarding.id },
    });
    const requirement = await client.clientRequirement.create({
      data: {
        onboardingId: onboarding.id,
        templateId: servicePackage.requirementTemplates[0]!.id,
        name: "Approved brief",
        description: "Approved input.",
        inputType: "TEXT",
        isRequired: true,
        sequence: 1,
        dueOffsetDays: 1,
        status: "APPROVED",
        currentSubmissionVersion: 1,
        approvedById: projectManager.id,
        approvedAt: now,
      },
    });
    await client.requirementSubmission.create({
      data: {
        requirementId: requirement.id,
        submissionVersion: 1,
        textValue: "Approved integration requirement content.",
        submittedViaTokenId: accessToken.id,
        submissionIdempotencyKey: `SUBMISSION:${suffix}`,
        requestFingerprint: createHash("sha256").update(`submission:${suffix}`).digest("hex"),
        submittedAt: now,
        reviewedAt: now,
        reviewedById: projectManager.id,
        reviewDecision: "APPROVED",
      },
    });
    const completionEvent = await client.automationEvent.create({
      data: {
        eventType: "CLIENT_REQUIREMENTS_COMPLETED",
        aggregateType: "ONBOARDING",
        aggregateId: onboarding.id,
        payload: {},
        schemaVersion: 1,
        maxAttempts: 5,
        availableAt: now,
        occurredAt: now,
        correlationId: randomUUID(),
        deduplicationKey: `PHASE6-COMPLETE:${suffix}`,
      },
    });
    const claimRequestId = randomUUID();
    const runId = randomUUID();
    const runKey = `AUTOMATION_RUN:${completionEvent.id}:attempt:1`;
    await client.$transaction([
      client.automationClaimRequest.create({
        data: {
          requestId: claimRequestId,
          workerId: "phase6-integration-worker",
          workflowName: "Phase 6 Integration",
          requestFingerprint: "c".repeat(64),
          supportedEventTypes: ["CLIENT_REQUIREMENTS_COMPLETED"],
          outcome: "CLAIMED",
          automationEventId: completionEvent.id,
          expiresAt: new Date(Date.now() + 86_400_000),
        },
      }),
      client.automationRun.create({
        data: {
          id: runId,
          automationEventId: completionEvent.id,
          workflowName: "Phase 6 Integration",
          workerId: "phase6-integration-worker",
          claimRequestId,
          idempotencyKey: runKey,
          attemptNumber: 1,
          startedAt: new Date(),
        },
      }),
      client.automationEvent.update({
        where: { id: completionEvent.id },
        data: {
          status: "PROCESSING",
          attemptCount: 1,
          claimedBy: "phase6-integration-worker",
          claimedAt: new Date(),
          leaseExpiresAt: new Date(Date.now() + 300_000),
          currentRunId: runId,
        },
      }),
    ]);
    const initialized = await initializeKickoffFromCompletionEvent(
      {
        eventId: completionEvent.id,
        runId,
        idempotencyKey: runKey,
        workerId: "phase6-integration-worker",
        n8nExecutionId: `phase6-init-${suffix}`,
      },
      client,
    );
    expect(initialized).toMatchObject({ ok: true, value: { idempotent: false } });
    const kickoff = await client.kickoff.findUniqueOrThrow({
      where: { onboardingId: onboarding.id },
    });
    const scheduledFor = new Date(Date.now() + 3_600_000);
    const scheduleInput = {
      actorId: projectManager.id,
      onboardingId: onboarding.id,
      expectedKickoffVersion: kickoff.version,
      idempotencyKey: `SCHEDULE:${suffix}`,
      localDate: scheduledFor.toISOString().slice(0, 10),
      localTime: scheduledFor.toISOString().slice(11, 19),
      timezone: "UTC",
      meetingUrl: "https://meet.example.test/phase6",
      meetingLocation: null,
      reason: null,
      correlationId: randomUUID(),
    };
    const scheduled = await scheduleKickoff(scheduleInput, client);
    expect(scheduled).toMatchObject({ ok: true, value: { idempotent: false } });
    expect(await scheduleKickoff(scheduleInput, client)).toMatchObject({
      ok: true,
      value: { idempotent: true },
    });
    const scheduledKickoff = await client.kickoff.findUniqueOrThrow({
      where: { onboardingId: onboarding.id },
    });
    expect(
      await waiveKickoffInvitation(
        {
          actorId: admin.id,
          onboardingId: onboarding.id,
          expectedKickoffVersion: scheduledKickoff.version,
          reason: "Integration test records an explicit delivery waiver.",
          correlationId: randomUUID(),
        },
        client,
      ),
    ).toMatchObject({ ok: true });
    const waivedKickoff = await client.kickoff.findUniqueOrThrow({
      where: { onboardingId: onboarding.id },
    });
    const completionInput = {
      actorId: admin.id,
      onboardingId: onboarding.id,
      expectedKickoffVersion: waivedKickoff.version,
      idempotencyKey: `COMPLETE:${suffix}`,
      outcomeNotes:
        "The integration kickoff confirmed scope, responsibilities, timeline, and immediate next actions.",
      timingOverrideReason:
        "Integration verification intentionally completes before scheduled time.",
      correlationId: randomUUID(),
    };
    const completedKickoff = await completeKickoff(completionInput, client);
    expect(completedKickoff).toMatchObject({ ok: true, value: { idempotent: false } });
    expect(await completeKickoff(completionInput, client)).toMatchObject({
      ok: true,
      value: { idempotent: true },
    });
    const handoff = await client.deliveryHandoff.findUniqueOrThrow({
      where: { onboardingId: onboarding.id },
    });
    expect(
      await saveDeliveryHandoffDraft(
        {
          actorId: projectManager.id,
          onboardingId: onboarding.id,
          expectedHandoffVersion: handoff.version,
          assignedDeliveryId: delivery.id,
          summary:
            "Delivery should begin with the approved brief and kickoff decisions captured in the frozen source.",
          riskNotes: "No blocking risk was identified during integration verification.",
          nextActions: "Review the frozen source and acknowledge ownership.",
          correlationId: randomUUID(),
        },
        client,
      ),
    ).toMatchObject({ ok: true });
    const savedHandoff = await client.deliveryHandoff.findUniqueOrThrow({
      where: { onboardingId: onboarding.id },
    });
    const ready = await markDeliveryHandoffReady(
      {
        actorId: projectManager.id,
        onboardingId: onboarding.id,
        expectedHandoffVersion: savedHandoff.version,
        idempotencyKey: `READY:${suffix}`,
        correlationId: randomUUID(),
      },
      client,
    );
    expect(ready).toMatchObject({ ok: true });
    if (!ready.ok) return;
    await client.$transaction([
      client.notificationLog.update({
        where: { id: ready.value.notificationId },
        data: {
          status: NotificationStatus.SENT,
          attemptCount: 1,
          deliveryAttemptKey: `integration-delivery-${suffix}`,
          deliveryStartedAt: new Date(),
          sentAt: new Date(),
          providerReference: `integration-${suffix}`,
        },
      }),
      client.deliveryHandoff.update({
        where: { onboardingId: onboarding.id },
        data: { status: "NOTIFIED", version: { increment: 1 } },
      }),
    ]);
    const notifiedHandoff = await client.deliveryHandoff.findUniqueOrThrow({
      where: { onboardingId: onboarding.id },
    });
    const currentOnboarding = await client.onboarding.findUniqueOrThrow({
      where: { id: onboarding.id },
    });
    const acknowledged = await acknowledgeDeliveryHandoff(
      {
        actorId: delivery.id,
        onboardingId: onboarding.id,
        expectedHandoffVersion: notifiedHandoff.version,
        expectedOnboardingVersion: currentOnboarding.version,
        idempotencyKey: `ACK:${suffix}`,
        adminExceptionReason: null,
        correlationId: randomUUID(),
      },
      client,
    );
    expect(acknowledged).toMatchObject({ ok: true, value: { idempotent: false } });
    await expect(
      client.onboarding.findUniqueOrThrow({ where: { id: onboarding.id } }),
    ).resolves.toMatchObject({
      status: OnboardingStatus.COMPLETED,
      slaResult: "MET",
    });
    await expect(
      client.clientAccessToken.findFirstOrThrow({ where: { onboardingId: onboarding.id } }),
    ).resolves.toMatchObject({ revocationReason: "ONBOARDING_COMPLETED" });
  });
});

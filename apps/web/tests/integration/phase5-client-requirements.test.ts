import { createHash, randomUUID } from "node:crypto";

import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  ActivationRequirementStatus,
  ActivationType,
  CommercialGateStatus,
  DealStatus,
  OnboardingStatus,
  PrismaClient,
  RequirementInputType,
  SalesHandoffStatus,
} from "../../src/generated/prisma/client";
import {
  manageClientAccess,
  revokeClientAccess,
} from "../../src/application/client-access/access-service";
import { resolveClientAccessEmailUncertainty } from "../../src/application/client-access/access-email-service";
import {
  exchangeClientCapability,
  validateClientSession,
} from "../../src/application/client-access/session-service";
import { claimAutomationEvent } from "../../src/application/automation/claim-service";
import { cancelOnboarding } from "../../src/application/commercial/onboarding-service";
import {
  approveClientRequirement,
  beginRequirementReview,
  rejectClientRequirement,
} from "../../src/application/requirements/review-service";
import { submitClientRequirement } from "../../src/application/requirements/submission-service";
import { reconstructCapabilityToken } from "../../src/domain/client-access/token";
import { clientAccessSigningKey } from "../../src/lib/client-access/keys";
import { getPhase5Detail } from "../../src/lib/onboardings/queries";

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) throw new Error("TEST_DATABASE_URL is required");

const client = new PrismaClient({
  adapter: new PrismaPg({ connectionString: databaseUrl }),
});

async function fixture() {
  const [admin, projectManager, sales, operations] = await Promise.all([
    client.user.findUniqueOrThrow({ where: { email: "admin@northstar.test" } }),
    client.user.findUniqueOrThrow({ where: { email: "pm@northstar.test" } }),
    client.user.findUniqueOrThrow({ where: { email: "sales@northstar.test" } }),
    client.user.findUniqueOrThrow({ where: { email: "operations@northstar.test" } }),
  ]);
  const suffix = randomUUID();
  const servicePackage = await client.servicePackage.create({
    data: {
      name: `Phase 5 Integration ${suffix}`,
      description: "Isolated Phase 5 integration package.",
      activationType: ActivationType.DEPOSIT_PERCENTAGE,
      activationValue: "25.0000",
      requirementTemplates: {
        create: [
          {
            name: "Integration response",
            description: "Provide the integration response.",
            inputType: RequirementInputType.TEXT,
            isRequired: true,
            sequence: 1,
            dueOffsetDays: 3,
          },
          {
            name: "Optional integration note",
            description: "Optional context.",
            inputType: RequirementInputType.TEXT,
            isRequired: false,
            sequence: 2,
            dueOffsetDays: 5,
          },
        ],
      },
    },
  });
  const customer = await client.client.create({
    data: {
      companyName: `Phase 5 Integration Client ${suffix}`,
      contactName: "Integration Client",
      contactEmail: `phase5-${suffix}@example.test`,
    },
  });
  const onboarding = await client.onboarding.create({
    data: {
      clientId: customer.id,
      servicePackageId: servicePackage.id,
      externalDealId: `PHASE5-INTEGRATION-${suffix}`,
      dealStatus: DealStatus.CLOSED_WON,
      salesHandoffStatus: SalesHandoffStatus.COMPLETE,
      commercialGateStatus: CommercialGateStatus.APPROVED,
      commercialGateBlockingReasons: [],
      status: OnboardingStatus.CLIENT_AWAITING_ACTION,
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
      activatedAt: new Date(),
      welcomeEmailSentAt: new Date(),
    },
  });
  return { admin, projectManager, operations, onboarding };
}

describe("Phase 5 client requirements", () => {
  beforeAll(async () => {
    await client.$connect();
  });

  afterAll(async () => {
    await client.$disconnect();
  });

  it("freezes requirements once, replays issuance, and completes review atomically", async () => {
    const { projectManager, operations, onboarding } = await fixture();
    const issuanceKey = `INTEGRATION:${randomUUID()}`;
    const correlationId = randomUUID();
    const first = await manageClientAccess(
      {
        actorId: projectManager.id,
        onboardingId: onboarding.id,
        expectedVersion: onboarding.version,
        issuanceKey,
        operation: "ISSUE",
        correlationId,
      },
      client,
    );
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const replay = await manageClientAccess(
      {
        actorId: projectManager.id,
        onboardingId: onboarding.id,
        expectedVersion: onboarding.version,
        issuanceKey,
        operation: "ISSUE",
        correlationId,
      },
      client,
    );
    expect(replay).toMatchObject({ ok: true, value: { idempotent: true } });
    const requirement = await client.clientRequirement.findFirstOrThrow({
      where: { onboardingId: onboarding.id, isRequired: true },
    });
    expect(requirement.dueAt).toBeNull();

    const submitted = await submitClientRequirement(
      {
        tokenId: first.value.clientAccessTokenId,
        onboardingId: onboarding.id,
        requirementId: requirement.id,
        textValue: "SENSITIVE_SUBMISSION_ONLY",
        urlValue: null,
        fileAssetIds: [],
        submissionIdempotencyKey: `SUBMIT:${randomUUID()}`,
        correlationId: randomUUID(),
      },
      client,
    );
    expect(submitted.ok).toBe(true);
    const operationsView = await getPhase5Detail(
      onboarding.id,
      {
        id: operations.id,
        name: operations.name,
        email: operations.email,
        role: operations.role,
      },
      client,
    );
    expect(operationsView?.contentVisible).toBe(false);
    expect(operationsView?.requirements[0]?.latestSubmission).toBeNull();
    expect(JSON.stringify(operationsView)).not.toContain("SENSITIVE_SUBMISSION_ONLY");
    await expect(
      client.auditEvent.findFirstOrThrow({
        where: {
          onboardingId: onboarding.id,
          action: "CLIENT_REQUIREMENT_SUBMITTED",
        },
      }),
    ).resolves.toMatchObject({
      actorType: "CLIENT",
      actorId: null,
      clientAccessTokenId: first.value.clientAccessTokenId,
    });
    const submittedRequirement = await client.clientRequirement.findUniqueOrThrow({
      where: { id: requirement.id },
    });
    const begun = await beginRequirementReview(
      {
        actorId: projectManager.id,
        onboardingId: onboarding.id,
        requirementId: requirement.id,
        expectedRequirementVersion: submittedRequirement.version,
        expectedSubmissionVersion: submittedRequirement.currentSubmissionVersion,
        correlationId: randomUUID(),
      },
      client,
    );
    expect(begun.ok).toBe(true);
    const reviewing = await client.clientRequirement.findUniqueOrThrow({
      where: { id: requirement.id },
    });
    const rejected = await rejectClientRequirement(
      {
        actorId: projectManager.id,
        onboardingId: onboarding.id,
        requirementId: requirement.id,
        expectedRequirementVersion: reviewing.version,
        expectedSubmissionVersion: reviewing.currentSubmissionVersion,
        reason: "The initial response needs a concrete corrected value.",
        correlationId: randomUUID(),
      },
      client,
    );
    expect(rejected.ok).toBe(true);
    const firstSubmission = await client.requirementSubmission.findFirstOrThrow({
      where: { requirementId: requirement.id, submissionVersion: 1 },
    });
    await expect(
      client.requirementSubmission.update({
        where: { id: firstSubmission.id },
        data: { textValue: "Tampered response" },
      }),
    ).rejects.toThrow();
    const rejectedRequirement = await client.clientRequirement.findUniqueOrThrow({
      where: { id: requirement.id },
    });
    const corrected = await submitClientRequirement(
      {
        tokenId: first.value.clientAccessTokenId,
        onboardingId: onboarding.id,
        requirementId: requirement.id,
        textValue: "Corrected integration response",
        urlValue: null,
        fileAssetIds: [],
        submissionIdempotencyKey: `CORRECTION:${randomUUID()}`,
        correlationId: randomUUID(),
      },
      client,
    );
    expect(corrected).toMatchObject({
      ok: true,
      value: { submissionVersion: 2 },
    });
    const versions = await client.requirementSubmission.findMany({
      where: { requirementId: requirement.id },
      orderBy: { submissionVersion: "asc" },
      select: { submissionVersion: true, textValue: true },
    });
    expect(versions).toEqual([
      { submissionVersion: 1, textValue: "SENSITIVE_SUBMISSION_ONLY" },
      { submissionVersion: 2, textValue: "Corrected integration response" },
    ]);
    const correctedRequirement = await client.clientRequirement.findUniqueOrThrow({
      where: { id: rejectedRequirement.id },
    });
    const correctedReview = await beginRequirementReview(
      {
        actorId: projectManager.id,
        onboardingId: onboarding.id,
        requirementId: requirement.id,
        expectedRequirementVersion: correctedRequirement.version,
        expectedSubmissionVersion: 2,
        correlationId: randomUUID(),
      },
      client,
    );
    expect(correctedReview.ok).toBe(true);
    const approving = await client.clientRequirement.findUniqueOrThrow({
      where: { id: requirement.id },
    });
    const approved = await approveClientRequirement(
      {
        actorId: projectManager.id,
        onboardingId: onboarding.id,
        requirementId: requirement.id,
        expectedRequirementVersion: approving.version,
        expectedSubmissionVersion: 2,
        correlationId: randomUUID(),
      },
      client,
    );
    expect(approved.ok).toBe(true);
    await expect(
      client.onboarding.findUniqueOrThrow({ where: { id: onboarding.id } }),
    ).resolves.toMatchObject({
      status: OnboardingStatus.CLIENT_REQUIREMENTS_COMPLETE,
      requirementsCompletedAt: expect.any(Date),
    });
    await expect(
      client.clientRequirement.findFirstOrThrow({
        where: { onboardingId: onboarding.id, isRequired: false },
      }),
    ).resolves.toMatchObject({ status: "PENDING" });
    await expect(
      client.automationEvent.count({
        where: {
          aggregateId: onboarding.id,
          eventType: "CLIENT_REQUIREMENTS_COMPLETED",
          status: "PENDING",
        },
      }),
    ).resolves.toBe(1);
    const completion = await client.automationEvent.findFirstOrThrow({
      where: {
        aggregateId: onboarding.id,
        eventType: "CLIENT_REQUIREMENTS_COMPLETED",
      },
    });
    await client.automationEvent.updateMany({
      where: { id: { not: completion.id }, status: "PENDING" },
      data: { availableAt: new Date("2099-01-01T00:00:00.000Z") },
    });
    const phase4Claim = await claimAutomationEvent(
      {
        requestId: randomUUID(),
        workerId: "phase4-integration-worker",
        workflowName: "Phase 4 Integration Consumer",
        supportedEventTypes: [
          "ONBOARDING_ACTIVATED",
          "PROVISIONING_TASK_REQUESTED",
          "WELCOME_EMAIL_REQUESTED",
        ],
      },
      client,
    );
    expect(phase4Claim).toMatchObject({ ok: true, value: { kind: "EMPTY" } });
    await expect(
      client.automationEvent.findUniqueOrThrow({ where: { id: completion.id } }),
    ).resolves.toMatchObject({ status: "PENDING", currentRunId: null });
  });

  it("serializes competing issuance and revokes the survivor on cancellation", async () => {
    const { admin, projectManager, onboarding } = await fixture();
    const inputs = [randomUUID(), randomUUID()].map((key) => ({
      actorId: projectManager.id,
      onboardingId: onboarding.id,
      expectedVersion: onboarding.version,
      issuanceKey: `CONCURRENT:${key}`,
      operation: "ISSUE",
      correlationId: randomUUID(),
    }));
    const results = await Promise.all(inputs.map((input) => manageClientAccess(input, client)));
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => !result.ok)).toHaveLength(1);
    expect(
      await client.clientAccessToken.count({
        where: { onboardingId: onboarding.id, revokedAt: null },
      }),
    ).toBe(1);
    const current = await client.onboarding.findUniqueOrThrow({
      where: { id: onboarding.id },
    });
    const cancelled = await cancelOnboarding(
      {
        actorId: admin.id,
        onboardingId: onboarding.id,
        expectedVersion: current.version,
        reason: "Integration cancellation invalidates all client capabilities.",
        correlationId: randomUUID(),
      },
      client,
    );
    expect(cancelled.ok).toBe(true);
    expect(
      await client.clientAccessToken.count({
        where: { onboardingId: onboarding.id, revokedAt: null },
      }),
    ).toBe(0);
    await expect(
      client.automationEvent.findFirstOrThrow({
        where: { aggregateId: onboarding.id, eventType: "CLIENT_ACCESS_EMAIL_REQUESTED" },
      }),
    ).resolves.toMatchObject({
      status: "FAILED",
      lastErrorCode: "ONBOARDING_CANCELLED",
    });
  });

  it("keeps uncertain delivery undated, confirms dates once, and preserves them on reissue", async () => {
    const { admin, projectManager, onboarding } = await fixture();
    const issued = await manageClientAccess(
      {
        actorId: projectManager.id,
        onboardingId: onboarding.id,
        expectedVersion: onboarding.version,
        issuanceKey: `DUE-DATE:${randomUUID()}`,
        operation: "ISSUE",
        correlationId: randomUUID(),
      },
      client,
    );
    expect(issued.ok).toBe(true);
    if (!issued.ok) return;
    await client.notificationLog.update({
      where: { id: issued.value.notificationId },
      data: {
        status: "DELIVERY_UNCERTAIN",
        failureReason: "Integration ambiguity.",
        deliveryAttemptKey: `integration-${randomUUID()}`,
        deliveryStartedAt: new Date(),
      },
    });
    await client.automationEvent.update({
      where: { id: issued.value.eventId },
      data: {
        status: "FAILED",
        lastErrorCode: "EMAIL_DELIVERY_UNCERTAIN",
        lastError: "Integration ambiguity.",
      },
    });
    await expect(
      client.clientRequirement.findFirstOrThrow({
        where: { onboardingId: onboarding.id, isRequired: true },
      }),
    ).resolves.toMatchObject({ dueAt: null });

    const blockedReissue = await manageClientAccess(
      {
        actorId: projectManager.id,
        onboardingId: onboarding.id,
        expectedVersion: (
          await client.onboarding.findUniqueOrThrow({ where: { id: onboarding.id } })
        ).version,
        issuanceKey: `BLOCKED-REISSUE:${randomUUID()}`,
        operation: "REISSUE",
        correlationId: randomUUID(),
      },
      client,
    );
    expect(blockedReissue).toMatchObject({
      ok: false,
      error: { code: "EMAIL_DELIVERY_CONFLICT" },
    });

    const resend = await resolveClientAccessEmailUncertainty(
      {
        actorId: admin.id,
        notificationId: issued.value.notificationId,
        action: "AUTHORIZE_RESEND",
        providerReference: null,
        reason: "Administrator authorized one controlled delivery retry.",
        correlationId: randomUUID(),
      },
      client,
    );
    expect(resend).toMatchObject({
      ok: true,
      value: { datesInitialized: false },
    });
    await expect(
      client.clientRequirement.findFirstOrThrow({
        where: { onboardingId: onboarding.id, isRequired: true },
      }),
    ).resolves.toMatchObject({ dueAt: null });
    await client.notificationLog.update({
      where: { id: issued.value.notificationId },
      data: {
        status: "DELIVERY_UNCERTAIN",
        failureReason: "Second integration ambiguity.",
        deliveryAttemptKey: `integration-${randomUUID()}`,
        deliveryStartedAt: new Date(),
      },
    });
    await client.automationEvent.update({
      where: { id: issued.value.eventId },
      data: {
        status: "FAILED",
        lastErrorCode: "EMAIL_DELIVERY_UNCERTAIN",
        lastError: "Second integration ambiguity.",
      },
    });

    const confirmed = await resolveClientAccessEmailUncertainty(
      {
        actorId: admin.id,
        notificationId: issued.value.notificationId,
        action: "CONFIRM_SENT",
        providerReference: "integration-provider-reference",
        reason: "Administrator verified delivery through the provider.",
        correlationId: randomUUID(),
      },
      client,
    );
    expect(confirmed).toMatchObject({
      ok: true,
      value: { datesInitialized: true },
    });
    const delivered = await client.onboarding.findUniqueOrThrow({
      where: { id: onboarding.id },
    });
    const dated = await client.clientRequirement.findFirstOrThrow({
      where: { onboardingId: onboarding.id, isRequired: true },
    });
    expect(delivered.clientAccessDeliveredAt).toBeInstanceOf(Date);
    expect(dated.dueAt?.getTime()).toBe(
      delivered.clientAccessDeliveredAt!.getTime() + dated.dueOffsetDays * 86_400_000,
    );

    const reissued = await manageClientAccess(
      {
        actorId: projectManager.id,
        onboardingId: onboarding.id,
        expectedVersion: delivered.version,
        issuanceKey: `REISSUE:${randomUUID()}`,
        operation: "REISSUE",
        correlationId: randomUUID(),
      },
      client,
    );
    expect(reissued.ok).toBe(true);
    const afterReissue = await client.clientRequirement.findFirstOrThrow({
      where: { onboardingId: onboarding.id, isRequired: true },
    });
    const onboardingAfterReissue = await client.onboarding.findUniqueOrThrow({
      where: { id: onboarding.id },
    });
    expect(afterReissue.dueAt?.getTime()).toBe(dated.dueAt?.getTime());
    expect(onboardingAfterReissue.clientAccessDeliveredAt?.getTime()).toBe(
      delivered.clientAccessDeliveredAt?.getTime(),
    );
    await expect(
      client.clientRequirement.update({
        where: { id: afterReissue.id },
        data: {
          dueAt: new Date(afterReissue.dueAt!.getTime() + 86_400_000),
          version: { increment: 1 },
        },
      }),
    ).rejects.toThrow();
    await client.packageRequirementTemplate.update({
      where: { id: afterReissue.templateId },
      data: { dueOffsetDays: afterReissue.dueOffsetDays + 10 },
    });
    await expect(
      client.clientRequirement.findUniqueOrThrow({ where: { id: afterReissue.id } }),
    ).resolves.toMatchObject({
      dueOffsetDays: afterReissue.dueOffsetDays,
      dueAt: afterReissue.dueAt,
    });
  });

  it("invalidates existing sessions after replacement, revocation, and cancellation", async () => {
    const { admin, projectManager, onboarding } = await fixture();
    const issue = async (operation: "ISSUE" | "REISSUE", label: string) => {
      const current = await client.onboarding.findUniqueOrThrow({
        where: { id: onboarding.id },
      });
      const result = await manageClientAccess(
        {
          actorId: projectManager.id,
          onboardingId: onboarding.id,
          expectedVersion: current.version,
          issuanceKey: `${label}:${randomUUID()}`,
          operation,
          correlationId: randomUUID(),
        },
        client,
      );
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(result.error.code);
      return result.value.clientAccessTokenId;
    };
    const sessionFor = async (tokenId: string) => {
      const record = await client.clientAccessToken.findUniqueOrThrow({
        where: { id: tokenId },
      });
      const key = clientAccessSigningKey(record.signingKeyVersion);
      expect(key).not.toBeNull();
      const rawToken = reconstructCapabilityToken(record, key!);
      expect(record.tokenHash).toBe(createHash("sha256").update(rawToken).digest("hex"));
      expect(JSON.stringify(record)).not.toContain(rawToken);
      const notification = await client.notificationLog.findFirstOrThrow({
        where: { clientAccessTokenId: tokenId },
      });
      const persistedReferences = await Promise.all([
        Promise.resolve(notification),
        client.automationEvent.findFirst({
          where: { deduplicationKey: notification.idempotencyKey },
        }),
        client.auditEvent.findMany({ where: { clientAccessTokenId: tokenId } }),
      ]);
      expect(JSON.stringify(persistedReferences)).not.toContain(rawToken);
      const exchanged = await exchangeClientCapability(rawToken, client);
      expect(exchanged && !exchanged.rateLimited).toBeTruthy();
      if (!exchanged || exchanged.rateLimited) throw new Error("Session exchange failed");
      return exchanged.cookieValue;
    };

    const firstTokenId = await issue("ISSUE", "SESSION-ISSUE");
    const firstCookie = await sessionFor(firstTokenId);
    expect(await validateClientSession(firstCookie, null, false, client)).not.toBeNull();

    const secondTokenId = await issue("REISSUE", "SESSION-REISSUE");
    expect(await validateClientSession(firstCookie, null, false, client)).toBeNull();
    const secondCookie = await sessionFor(secondTokenId);

    const beforeRevoke = await client.onboarding.findUniqueOrThrow({
      where: { id: onboarding.id },
    });
    const revoked = await revokeClientAccess(
      {
        actorId: projectManager.id,
        onboardingId: onboarding.id,
        expectedVersion: beforeRevoke.version,
        reason: "Integration revocation invalidates the current session.",
        correlationId: randomUUID(),
      },
      client,
    );
    expect(revoked.ok).toBe(true);
    expect(await validateClientSession(secondCookie, null, false, client)).toBeNull();

    const thirdTokenId = await issue("ISSUE", "SESSION-REISSUE-AFTER-REVOCATION");
    const thirdCookie = await sessionFor(thirdTokenId);
    const beforeCancel = await client.onboarding.findUniqueOrThrow({
      where: { id: onboarding.id },
    });
    const cancelled = await cancelOnboarding(
      {
        actorId: admin.id,
        onboardingId: onboarding.id,
        expectedVersion: beforeCancel.version,
        reason: "Integration cancellation invalidates the current session.",
        correlationId: randomUUID(),
      },
      client,
    );
    expect(cancelled.ok).toBe(true);
    expect(await validateClientSession(thirdCookie, null, false, client)).toBeNull();
  });
});

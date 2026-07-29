import {
  AuditActorType,
  AutomationEventStatus,
  OnboardingStatus,
  Prisma,
  RequirementReviewDecision,
  Role,
  type PrismaClient,
} from "@/generated/prisma/client";
import { appendAuditEvent } from "@/application/commercial/audit";
import {
  executeService,
  parseInput,
  reject,
  requireActor,
} from "@/application/commercial/service-support";
import {
  approveRequirementSchema,
  beginRequirementReviewSchema,
  rejectRequirementSchema,
} from "@/application/requirements/contracts";
import { calculateRequirementCompleteness } from "@/domain/requirements/completeness";
import { requirementsCompletedEventKey } from "@/domain/requirements/idempotency";
import type { Result } from "@/domain/errors";
import { prisma } from "@/lib/database";
import { getServerEnvironment } from "@/lib/env";

async function loadAuthorizedReview(
  tx: Prisma.TransactionClient,
  input: { actorId: string; onboardingId: string; requirementId: string },
) {
  const actor = await requireActor(tx, input.actorId, [Role.ADMIN, Role.PROJECT_MANAGER]);
  await tx.$queryRaw(Prisma.sql`
    SELECT "id" FROM "Onboarding"
    WHERE "id" = ${input.onboardingId}::uuid
    FOR UPDATE
  `);
  const onboarding = await tx.onboarding.findUnique({
    where: { id: input.onboardingId },
    include: { projectManager: true },
  });
  if (!onboarding) reject("NOT_FOUND", "The onboarding does not exist.");
  if (
    actor.role === Role.PROJECT_MANAGER &&
    (onboarding.projectManagerId !== actor.id || !onboarding.projectManager?.isActive)
  ) {
    reject("ACCESS_DENIED", "Only the assigned active Project Manager may review requirements.");
  }
  if (
    onboarding.status !== OnboardingStatus.CLIENT_AWAITING_ACTION &&
    onboarding.status !== OnboardingStatus.CLIENT_REQUIREMENTS_COMPLETE
  ) {
    reject("INVALID_TRANSITION", "The onboarding is not in client-requirements review.");
  }
  await tx.$queryRaw(Prisma.sql`
    SELECT "id" FROM "ClientRequirement"
    WHERE "id" = ${input.requirementId}::uuid
    FOR UPDATE
  `);
  const requirement = await tx.clientRequirement.findUnique({
    where: { id: input.requirementId },
  });
  if (!requirement || requirement.onboardingId !== onboarding.id) {
    reject("NOT_FOUND", "The client requirement does not exist.");
  }
  return { actor, onboarding, requirement };
}

export async function beginRequirementReview(rawInput: unknown, database: PrismaClient = prisma) {
  return executeService(async () => {
    const input = parseInput(beginRequirementReviewSchema.safeParse(rawInput));
    return database.$transaction(
      async (tx) => {
        const { actor, onboarding, requirement } = await loadAuthorizedReview(tx, input);
        if (
          requirement.status === "UNDER_REVIEW" &&
          requirement.reviewingSubmissionVersion === input.expectedSubmissionVersion &&
          requirement.currentSubmissionVersion === input.expectedSubmissionVersion &&
          requirement.version === input.expectedRequirementVersion + 1
        ) {
          return { requirementId: requirement.id, version: requirement.version, idempotent: true };
        }
        if (
          requirement.status !== "SUBMITTED" ||
          requirement.version !== input.expectedRequirementVersion ||
          requirement.currentSubmissionVersion !== input.expectedSubmissionVersion
        ) {
          reject("REQUIREMENT_REVIEW_CONFLICT", "The requirement review is stale.");
        }
        const submission = await tx.requirementSubmission.findUnique({
          where: {
            requirementId_submissionVersion: {
              requirementId: requirement.id,
              submissionVersion: requirement.currentSubmissionVersion,
            },
          },
        });
        if (!submission || submission.reviewDecision) {
          reject("REQUIREMENT_REVIEW_CONFLICT", "The latest submission is not reviewable.");
        }
        await tx.clientRequirement.update({
          where: { id: requirement.id },
          data: {
            status: "UNDER_REVIEW",
            reviewingSubmissionVersion: submission.submissionVersion,
            version: { increment: 1 },
          },
        });
        await appendAuditEvent(tx, {
          onboardingId: onboarding.id,
          actorType: AuditActorType.STAFF,
          actorId: actor.id,
          action: "CLIENT_REQUIREMENT_REVIEW_STARTED",
          entityType: "CLIENT_REQUIREMENT",
          entityId: requirement.id,
          previousValue: { status: requirement.status },
          newValue: {
            status: "UNDER_REVIEW",
            submissionVersion: submission.submissionVersion,
          },
          correlationId: input.correlationId,
        });
        return {
          requirementId: requirement.id,
          version: requirement.version + 1,
          idempotent: false,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  });
}

async function decideRequirement(
  rawInput: unknown,
  decision: RequirementReviewDecision,
  database: PrismaClient,
) {
  let input: {
    actorId: string;
    onboardingId: string;
    requirementId: string;
    expectedRequirementVersion: number;
    expectedSubmissionVersion: number;
    correlationId: string;
  };
  let reason: string | null;
  if (decision === RequirementReviewDecision.APPROVED) {
    input = parseInput(approveRequirementSchema.safeParse(rawInput));
    reason = null;
  } else {
    const rejectionInput = parseInput(rejectRequirementSchema.safeParse(rawInput));
    input = rejectionInput;
    reason = rejectionInput.reason;
  }
  const environment = getServerEnvironment();
  return database.$transaction(
    async (tx) => {
      const { actor, onboarding, requirement } = await loadAuthorizedReview(tx, input);
      const latest = await tx.requirementSubmission.findUnique({
        where: {
          requirementId_submissionVersion: {
            requirementId: requirement.id,
            submissionVersion: input.expectedSubmissionVersion,
          },
        },
      });
      if (
        latest?.reviewDecision === decision &&
        latest.reviewedById === actor.id &&
        (latest.reviewReason ?? null) === reason &&
        ((decision === RequirementReviewDecision.APPROVED && requirement.status === "APPROVED") ||
          (decision === RequirementReviewDecision.REJECTED && requirement.status === "REJECTED"))
      ) {
        return {
          requirementId: requirement.id,
          status: requirement.status,
          onboardingStatus: onboarding.status,
          completionEventId: null,
          idempotent: true,
        };
      }
      if (
        !latest ||
        latest.reviewDecision ||
        requirement.status !== "UNDER_REVIEW" ||
        requirement.version !== input.expectedRequirementVersion ||
        requirement.currentSubmissionVersion !== input.expectedSubmissionVersion ||
        requirement.reviewingSubmissionVersion !== input.expectedSubmissionVersion
      ) {
        reject("REQUIREMENT_REVIEW_CONFLICT", "The review decision is stale or conflicting.");
      }
      const now = new Date();
      await tx.requirementSubmission.update({
        where: { id: latest.id },
        data: {
          reviewedAt: now,
          reviewedById: actor.id,
          reviewDecision: decision,
          reviewReason: reason,
        },
      });
      await tx.clientRequirement.update({
        where: { id: requirement.id },
        data:
          decision === RequirementReviewDecision.APPROVED
            ? {
                status: "APPROVED",
                reviewingSubmissionVersion: null,
                approvedById: actor.id,
                approvedAt: now,
                version: { increment: 1 },
              }
            : {
                status: "REJECTED",
                reviewingSubmissionVersion: null,
                approvedById: null,
                approvedAt: null,
                version: { increment: 1 },
              },
      });
      await appendAuditEvent(tx, {
        onboardingId: onboarding.id,
        actorType: AuditActorType.STAFF,
        actorId: actor.id,
        action:
          decision === RequirementReviewDecision.APPROVED
            ? "CLIENT_REQUIREMENT_APPROVED"
            : "CLIENT_REQUIREMENT_REJECTED",
        entityType: "CLIENT_REQUIREMENT",
        entityId: requirement.id,
        previousValue: {
          status: "UNDER_REVIEW",
          submissionVersion: latest.submissionVersion,
        },
        newValue: {
          status: decision === RequirementReviewDecision.APPROVED ? "APPROVED" : "REJECTED",
          submissionVersion: latest.submissionVersion,
        },
        metadata: {
          submissionId: latest.id,
          reasonProvided: Boolean(reason),
        },
        correlationId: input.correlationId,
      });
      let completionEventId: string | null = null;
      let onboardingStatus = onboarding.status;
      if (decision === RequirementReviewDecision.APPROVED) {
        const requirements = await tx.clientRequirement.findMany({
          where: { onboardingId: onboarding.id },
          orderBy: { sequence: "asc" },
        });
        const completeness = calculateRequirementCompleteness(requirements);
        if (completeness.configurationError) {
          reject(
            "REQUIREMENT_CONFIGURATION_ERROR",
            "The onboarding has no mandatory client requirements.",
          );
        }
        if (
          completeness.complete &&
          onboarding.status === OnboardingStatus.CLIENT_AWAITING_ACTION
        ) {
          await tx.onboarding.update({
            where: { id: onboarding.id },
            data: {
              status: OnboardingStatus.CLIENT_REQUIREMENTS_COMPLETE,
              requirementsCompletedAt: onboarding.requirementsCompletedAt ?? now,
              version: { increment: 1 },
            },
          });
          await appendAuditEvent(tx, {
            onboardingId: onboarding.id,
            actorType: AuditActorType.SYSTEM,
            action: "ALL_MANDATORY_CLIENT_REQUIREMENTS_COMPLETED",
            entityType: "ONBOARDING",
            entityId: onboarding.id,
            previousValue: { status: OnboardingStatus.CLIENT_AWAITING_ACTION },
            newValue: {
              status: OnboardingStatus.CLIENT_REQUIREMENTS_COMPLETE,
              mandatoryCount: completeness.mandatoryCount,
              approvedMandatoryCount: completeness.approvedMandatoryCount,
            },
            metadata: { triggeringRequirementId: requirement.id },
            correlationId: input.correlationId,
          });
          const completionEvent = await tx.automationEvent.upsert({
            where: { deduplicationKey: requirementsCompletedEventKey(onboarding.id) },
            create: {
              eventType: "CLIENT_REQUIREMENTS_COMPLETED",
              aggregateType: "ONBOARDING",
              aggregateId: onboarding.id,
              payload: {},
              schemaVersion: 1,
              status: AutomationEventStatus.PENDING,
              maxAttempts: environment.AUTOMATION_MAX_ATTEMPTS,
              availableAt: now,
              occurredAt: now,
              correlationId: input.correlationId,
              deduplicationKey: requirementsCompletedEventKey(onboarding.id),
            },
            update: {},
          });
          completionEventId = completionEvent.id;
          onboardingStatus = OnboardingStatus.CLIENT_REQUIREMENTS_COMPLETE;
        }
      }
      return {
        requirementId: requirement.id,
        status: decision === RequirementReviewDecision.APPROVED ? "APPROVED" : "REJECTED",
        onboardingStatus,
        completionEventId,
        idempotent: false,
      };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}

export async function approveClientRequirement(
  rawInput: unknown,
  database: PrismaClient = prisma,
): Promise<Result<Awaited<ReturnType<typeof decideRequirement>>>> {
  return executeService(() =>
    decideRequirement(rawInput, RequirementReviewDecision.APPROVED, database),
  );
}

export async function rejectClientRequirement(
  rawInput: unknown,
  database: PrismaClient = prisma,
): Promise<Result<Awaited<ReturnType<typeof decideRequirement>>>> {
  return executeService(() =>
    decideRequirement(rawInput, RequirementReviewDecision.REJECTED, database),
  );
}

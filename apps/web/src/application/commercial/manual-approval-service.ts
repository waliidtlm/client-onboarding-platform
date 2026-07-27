import {
  ActivationType,
  AuditActorType,
  OnboardingStatus,
  Prisma,
  Role,
} from "@/generated/prisma/client";
import { prisma } from "@/lib/database";
import { appendAuditEvent } from "@/application/commercial/audit";
import { refreshCommercialState } from "@/application/commercial/commercial-gate-service";
import { manualApprovalSchema, revokeManualApprovalSchema } from "@/application/commercial/schemas";
import {
  executeService,
  parseInput,
  reject,
  requireActor,
  type DatabaseClient,
} from "@/application/commercial/service-support";
import type { CommercialMutationResult } from "@/application/commercial/types";
import type { Result } from "@/domain/errors";

export async function approveManualActivationRequirement(
  rawInput: unknown,
  database: DatabaseClient = prisma,
): Promise<Result<CommercialMutationResult>> {
  return executeService(async () => {
    const input = parseInput(manualApprovalSchema.safeParse(rawInput));
    return database.$transaction(
      async (tx) => {
        await requireActor(tx, input.actorId, [Role.ADMIN, Role.FINANCE]);
        const onboarding = await tx.onboarding.findUnique({
          where: { id: input.onboardingId },
        });
        if (!onboarding) reject("NOT_FOUND", "The onboarding does not exist.");
        if (onboarding.version !== input.expectedVersion) {
          reject("VERSION_CONFLICT", "The onboarding changed. Refresh and retry.");
        }
        if (onboarding.activationTypeSnapshot !== ActivationType.MANUAL_APPROVAL) {
          reject("INVALID_TRANSITION", "This package does not use manual activation approval.");
        }
        if (onboarding.status !== OnboardingStatus.COMMERCIAL_PENDING || onboarding.activatedAt) {
          reject("INVALID_TRANSITION", "Manual approval cannot change after activation.");
        }
        if (onboarding.manualActivationApprovedAt && !onboarding.manualActivationRevokedAt) {
          return refreshCommercialState(tx, {
            onboardingId: onboarding.id,
            correlationId: input.correlationId,
            triggeredByActorId: input.actorId,
            forceVersionIncrement: false,
          });
        }

        const approvedAt = new Date();
        await tx.onboarding.update({
          where: { id: onboarding.id },
          data: {
            manualActivationApprovedById: input.actorId,
            manualActivationApprovedAt: approvedAt,
            manualActivationRevokedById: null,
            manualActivationRevokedAt: null,
            manualActivationRevocationReason: null,
          },
        });
        await appendAuditEvent(tx, {
          onboardingId: onboarding.id,
          actorType: AuditActorType.STAFF,
          actorId: input.actorId,
          action: "MANUAL_ACTIVATION_APPROVED",
          entityType: "ONBOARDING",
          entityId: onboarding.id,
          newValue: { approvedAt: approvedAt.toISOString() },
          correlationId: input.correlationId,
        });
        return refreshCommercialState(tx, {
          onboardingId: onboarding.id,
          expectedVersion: input.expectedVersion,
          correlationId: input.correlationId,
          triggeredByActorId: input.actorId,
          forceVersionIncrement: true,
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  });
}

export async function revokeManualActivationRequirement(
  rawInput: unknown,
  database: DatabaseClient = prisma,
): Promise<Result<CommercialMutationResult>> {
  return executeService(async () => {
    const input = parseInput(revokeManualApprovalSchema.safeParse(rawInput));
    return database.$transaction(
      async (tx) => {
        await requireActor(tx, input.actorId, [Role.ADMIN, Role.FINANCE]);
        const onboarding = await tx.onboarding.findUnique({
          where: { id: input.onboardingId },
        });
        if (!onboarding) reject("NOT_FOUND", "The onboarding does not exist.");
        if (onboarding.version !== input.expectedVersion) {
          reject("VERSION_CONFLICT", "The onboarding changed. Refresh and retry.");
        }
        if (onboarding.status !== OnboardingStatus.COMMERCIAL_PENDING || onboarding.activatedAt) {
          reject("INVALID_TRANSITION", "Manual approval can be revoked only before activation.");
        }
        if (!onboarding.manualActivationApprovedAt) {
          reject("INVALID_TRANSITION", "There is no manual approval to revoke.");
        }
        if (
          onboarding.manualActivationRevokedAt &&
          onboarding.manualActivationRevocationReason === input.reason
        ) {
          return refreshCommercialState(tx, {
            onboardingId: onboarding.id,
            correlationId: input.correlationId,
            triggeredByActorId: input.actorId,
            forceVersionIncrement: false,
          });
        }

        const revokedAt = new Date();
        await tx.onboarding.update({
          where: { id: onboarding.id },
          data: {
            manualActivationRevokedById: input.actorId,
            manualActivationRevokedAt: revokedAt,
            manualActivationRevocationReason: input.reason,
          },
        });
        await appendAuditEvent(tx, {
          onboardingId: onboarding.id,
          actorType: AuditActorType.STAFF,
          actorId: input.actorId,
          action: "MANUAL_ACTIVATION_REVOKED",
          entityType: "ONBOARDING",
          entityId: onboarding.id,
          previousValue: { approvedAt: onboarding.manualActivationApprovedAt.toISOString() },
          newValue: { revokedAt: revokedAt.toISOString() },
          metadata: { reasonProvided: true },
          correlationId: input.correlationId,
        });
        return refreshCommercialState(tx, {
          onboardingId: onboarding.id,
          expectedVersion: input.expectedVersion,
          correlationId: input.correlationId,
          triggeredByActorId: input.actorId,
          forceVersionIncrement: true,
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  });
}

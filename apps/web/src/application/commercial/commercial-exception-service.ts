import {
  AuditActorType,
  CommercialExceptionStatus,
  OnboardingStatus,
  Prisma,
  Role,
} from "@/generated/prisma/client";
import { prisma } from "@/lib/database";
import { appendAuditEvent } from "@/application/commercial/audit";
import { refreshCommercialState } from "@/application/commercial/commercial-gate-service";
import {
  commercialExceptionSchema,
  resolveCommercialExceptionSchema,
} from "@/application/commercial/schemas";
import {
  executeService,
  parseInput,
  reject,
  requireActor,
  type DatabaseClient,
} from "@/application/commercial/service-support";
import type { CommercialMutationResult } from "@/application/commercial/types";
import type { Result } from "@/domain/errors";

export async function openCommercialException(
  rawInput: unknown,
  database: DatabaseClient = prisma,
): Promise<Result<CommercialMutationResult>> {
  return executeService(async () => {
    const input = parseInput(commercialExceptionSchema.safeParse(rawInput));
    return database.$transaction(
      async (tx) => {
        await requireActor(tx, input.actorId, [Role.ADMIN]);
        const onboarding = await tx.onboarding.findUnique({
          where: { id: input.onboardingId },
        });
        if (!onboarding) reject("NOT_FOUND", "The onboarding does not exist.");
        if (onboarding.version !== input.expectedVersion) {
          reject("VERSION_CONFLICT", "The onboarding changed. Refresh and retry.");
        }
        if (onboarding.status !== OnboardingStatus.COMMERCIAL_PENDING) {
          reject("INVALID_TRANSITION", "Commercial exceptions can open only before activation.");
        }

        const exception = await tx.commercialException.create({
          data: {
            onboardingId: onboarding.id,
            reason: input.reason,
            createdById: input.actorId,
          },
        });
        await appendAuditEvent(tx, {
          onboardingId: onboarding.id,
          actorType: AuditActorType.STAFF,
          actorId: input.actorId,
          action: "COMMERCIAL_EXCEPTION_OPENED",
          entityType: "COMMERCIAL_EXCEPTION",
          entityId: exception.id,
          newValue: { status: exception.status },
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

export async function resolveCommercialException(
  rawInput: unknown,
  database: DatabaseClient = prisma,
): Promise<Result<CommercialMutationResult>> {
  return executeService(async () => {
    const input = parseInput(resolveCommercialExceptionSchema.safeParse(rawInput));
    return database.$transaction(
      async (tx) => {
        await requireActor(tx, input.actorId, [Role.ADMIN]);
        const onboarding = await tx.onboarding.findUnique({
          where: { id: input.onboardingId },
        });
        if (!onboarding) reject("NOT_FOUND", "The onboarding does not exist.");
        if (onboarding.version !== input.expectedVersion) {
          reject("VERSION_CONFLICT", "The onboarding changed. Refresh and retry.");
        }
        const exception = await tx.commercialException.findUnique({
          where: { id: input.exceptionId },
        });
        if (!exception || exception.onboardingId !== onboarding.id) {
          reject("NOT_FOUND", "The commercial exception does not exist.");
        }
        if (exception.status !== CommercialExceptionStatus.OPEN) {
          if (
            exception.status === input.resolution &&
            exception.resolutionNote === input.resolutionNote
          ) {
            return refreshCommercialState(tx, {
              onboardingId: onboarding.id,
              correlationId: input.correlationId,
              triggeredByActorId: input.actorId,
              forceVersionIncrement: false,
            });
          }
          reject("INVALID_TRANSITION", "The commercial exception is already resolved.");
        }

        const resolvedAt = new Date();
        await tx.commercialException.update({
          where: { id: exception.id },
          data: {
            status: input.resolution,
            resolutionNote: input.resolutionNote,
            resolvedById: input.actorId,
            resolvedAt,
          },
        });
        await appendAuditEvent(tx, {
          onboardingId: onboarding.id,
          actorType: AuditActorType.STAFF,
          actorId: input.actorId,
          action: "COMMERCIAL_EXCEPTION_RESOLVED",
          entityType: "COMMERCIAL_EXCEPTION",
          entityId: exception.id,
          previousValue: { status: exception.status },
          newValue: { status: input.resolution, resolvedAt: resolvedAt.toISOString() },
          metadata: { resolutionNoteProvided: true },
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

import {
  AuditActorType,
  ContractStatus,
  OnboardingStatus,
  Prisma,
  Role,
} from "@/generated/prisma/client";
import { prisma } from "@/lib/database";
import { appendAuditEvent } from "@/application/commercial/audit";
import { refreshCommercialState } from "@/application/commercial/commercial-gate-service";
import { updateContractSchema } from "@/application/commercial/schemas";
import {
  executeService,
  parseInput,
  reject,
  requireActor,
  type DatabaseClient,
} from "@/application/commercial/service-support";
import type { CommercialMutationResult } from "@/application/commercial/types";
import { evaluateContractTransition } from "@/domain/commercial/transitions";
import type { Result } from "@/domain/errors";

export async function updateContractStatus(
  rawInput: unknown,
  database: DatabaseClient = prisma,
): Promise<Result<CommercialMutationResult>> {
  return executeService(async () => {
    const input = parseInput(updateContractSchema.safeParse(rawInput));
    return database.$transaction(
      async (tx) => {
        await requireActor(tx, input.actorId, [Role.ADMIN, Role.OPERATIONS]);
        const onboarding = await tx.onboarding.findUnique({
          where: { id: input.onboardingId },
          include: { contracts: { orderBy: { versionNumber: "desc" }, take: 1 } },
        });
        if (!onboarding) reject("NOT_FOUND", "The onboarding does not exist.");
        if (onboarding.version !== input.expectedVersion) {
          reject("VERSION_CONFLICT", "The onboarding changed. Refresh and retry.");
        }
        if (
          onboarding.status !== OnboardingStatus.COMMERCIAL_PENDING &&
          onboarding.status !== OnboardingStatus.SALES_HANDOFF_INCOMPLETE
        ) {
          reject("INVALID_TRANSITION", "Contract authority cannot change after activation.");
        }

        const current = onboarding.contracts[0];
        if (!current) reject("NOT_FOUND", "The current contract does not exist.");
        const transition = evaluateContractTransition(current.status, input.targetStatus);
        if (!transition.allowed) {
          reject(
            "INVALID_TRANSITION",
            `${current.status} cannot transition to ${input.targetStatus}.`,
          );
        }
        if (input.targetStatus === ContractStatus.REVISION_REQUESTED && !input.revisionReason) {
          reject("INVALID_INPUT", "A contract revision reason is required.");
        }

        if (current.status === input.targetStatus) {
          return refreshCommercialState(tx, {
            onboardingId: onboarding.id,
            correlationId: input.correlationId,
            triggeredByActorId: input.actorId,
            forceVersionIncrement: false,
          });
        }

        const contract = transition.createsVersion
          ? await tx.contract.create({
              data: {
                onboardingId: onboarding.id,
                status: input.targetStatus,
                versionNumber: current.versionNumber + 1,
                signatureDeadline: input.signatureDeadline
                  ? new Date(input.signatureDeadline)
                  : null,
                revisionReason: input.revisionReason,
                externalReference: input.externalReference,
              },
            })
          : await tx.contract.update({
              where: { id: current.id },
              data: {
                status: input.targetStatus,
                signatureDeadline: input.signatureDeadline
                  ? new Date(input.signatureDeadline)
                  : current.signatureDeadline,
                revisionReason:
                  input.targetStatus === ContractStatus.REVISION_REQUESTED
                    ? input.revisionReason
                    : current.revisionReason,
                externalReference: input.externalReference ?? current.externalReference,
                signedAt:
                  input.targetStatus === ContractStatus.SIGNED ? new Date() : current.signedAt,
              },
            });

        await appendAuditEvent(tx, {
          onboardingId: onboarding.id,
          actorType: AuditActorType.STAFF,
          actorId: input.actorId,
          action: transition.createsVersion
            ? "CONTRACT_VERSION_CREATED"
            : "CONTRACT_STATUS_UPDATED",
          entityType: "CONTRACT",
          entityId: contract.id,
          previousValue: {
            contractId: current.id,
            status: current.status,
            versionNumber: current.versionNumber,
          },
          newValue: {
            contractId: contract.id,
            status: contract.status,
            versionNumber: contract.versionNumber,
          },
          metadata: { revisionReasonProvided: Boolean(input.revisionReason) },
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

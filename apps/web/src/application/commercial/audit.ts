import { AuditActorType, Prisma } from "@/generated/prisma/client";
import type { TransactionClient } from "@/application/commercial/service-support";

type SafeAuditValue = Record<string, string | number | boolean | null | readonly string[]>;

export async function appendAuditEvent(
  tx: TransactionClient,
  input: Readonly<{
    onboardingId: string;
    actorType: AuditActorType;
    actorId?: string | null;
    action: string;
    entityType: string;
    entityId: string;
    previousValue?: SafeAuditValue | null;
    newValue?: SafeAuditValue | null;
    metadata?: SafeAuditValue | null;
    correlationId: string;
  }>,
): Promise<void> {
  await tx.auditEvent.create({
    data: {
      onboardingId: input.onboardingId,
      actorType: input.actorType,
      actorId: input.actorId ?? null,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      previousValue: input.previousValue ?? Prisma.JsonNull,
      newValue: input.newValue ?? Prisma.JsonNull,
      metadata: input.metadata ?? Prisma.JsonNull,
      correlationId: input.correlationId,
    },
  });
}

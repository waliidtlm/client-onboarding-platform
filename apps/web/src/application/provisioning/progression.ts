import { AuditActorType, OnboardingStatus } from "@/generated/prisma/client";
import type { TransactionClient } from "@/application/commercial/service-support";
import { appendAuditEvent } from "@/application/commercial/audit";
import { appendProvisioningTaskRequestedEvent } from "@/application/automation/event-service";
import { findNextEligibleProvisioningTask } from "@/domain/provisioning/sequential-eligibility";
import { mayEnterInternalReview } from "@/domain/provisioning/readiness";

export async function progressProvisioning(
  tx: TransactionClient,
  input: Readonly<{
    onboardingId: string;
    correlationId: string;
    now: Date;
    eventMaxAttempts: number;
  }>,
): Promise<{
  nextTaskEventId: string | null;
  onboardingStatus: OnboardingStatus;
}> {
  const onboarding = await tx.onboarding.findUniqueOrThrow({
    where: { id: input.onboardingId },
    include: { provisioningTasks: { orderBy: { sequence: "asc" } } },
  });
  const next = findNextEligibleProvisioningTask(onboarding.provisioningTasks);
  if (next) {
    const event = await appendProvisioningTaskRequestedEvent(tx, {
      onboardingId: onboarding.id,
      taskId: next.id,
      correlationId: input.correlationId,
      occurredAt: input.now,
      maxAttempts: input.eventMaxAttempts,
    });
    return { nextTaskEventId: event.eventId, onboardingStatus: onboarding.status };
  }
  if (
    onboarding.status === OnboardingStatus.INTERNAL_SETUP &&
    mayEnterInternalReview(onboarding.provisioningTasks)
  ) {
    await tx.onboarding.update({
      where: { id: onboarding.id },
      data: { status: OnboardingStatus.INTERNAL_REVIEW, version: { increment: 1 } },
    });
    await appendAuditEvent(tx, {
      onboardingId: onboarding.id,
      actorType: AuditActorType.SYSTEM,
      action: "PROVISIONING_READY_FOR_INTERNAL_REVIEW",
      entityType: "ONBOARDING",
      entityId: onboarding.id,
      previousValue: { status: OnboardingStatus.INTERNAL_SETUP },
      newValue: { status: OnboardingStatus.INTERNAL_REVIEW },
      correlationId: input.correlationId,
    });
    return {
      nextTaskEventId: null,
      onboardingStatus: OnboardingStatus.INTERNAL_REVIEW,
    };
  }
  return { nextTaskEventId: null, onboardingStatus: onboarding.status };
}

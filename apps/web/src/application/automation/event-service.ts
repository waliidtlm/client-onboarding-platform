import type { Prisma } from "@/generated/prisma/client";

import type { TransactionClient } from "@/application/commercial/service-support";
import {
  onboardingActivatedDeduplicationKey,
  SUPPORTED_AUTOMATION_EVENT_TYPE,
  SUPPORTED_AUTOMATION_SCHEMA_VERSION,
} from "@/domain/automation/idempotency";
import type { AutomationEventEnvelope } from "@/application/automation/types";

export function toAutomationEventEnvelope(
  event: Readonly<{
    id: string;
    eventType: string;
    aggregateType: string;
    aggregateId: string;
    occurredAt: Date;
    correlationId: string;
    schemaVersion: number;
  }>,
): AutomationEventEnvelope {
  return {
    eventId: event.id,
    eventType: event.eventType,
    aggregateType: event.aggregateType,
    aggregateId: event.aggregateId,
    occurredAt: event.occurredAt.toISOString(),
    correlationId: event.correlationId,
    schemaVersion: event.schemaVersion,
    payload: {},
  };
}

export async function appendOnboardingActivatedEvent(
  tx: TransactionClient,
  input: Readonly<{
    onboardingId: string;
    correlationId: string;
    occurredAt: Date;
    maxAttempts: number;
  }>,
): Promise<AutomationEventEnvelope> {
  const event = await tx.automationEvent.create({
    data: {
      eventType: SUPPORTED_AUTOMATION_EVENT_TYPE,
      aggregateType: "ONBOARDING",
      aggregateId: input.onboardingId,
      payload: {} as Prisma.InputJsonObject,
      schemaVersion: SUPPORTED_AUTOMATION_SCHEMA_VERSION,
      maxAttempts: input.maxAttempts,
      availableAt: input.occurredAt,
      occurredAt: input.occurredAt,
      correlationId: input.correlationId,
      deduplicationKey: onboardingActivatedDeduplicationKey(input.onboardingId),
    },
  });
  return toAutomationEventEnvelope(event);
}

export async function findOnboardingActivatedEvent(
  tx: TransactionClient,
  onboardingId: string,
): Promise<AutomationEventEnvelope | null> {
  const event = await tx.automationEvent.findUnique({
    where: { deduplicationKey: onboardingActivatedDeduplicationKey(onboardingId) },
  });
  return event ? toAutomationEventEnvelope(event) : null;
}

import type { Prisma } from "@/generated/prisma/client";

import type { TransactionClient } from "@/application/commercial/service-support";
import {
  onboardingActivatedDeduplicationKey,
  SUPPORTED_AUTOMATION_EVENT_TYPE,
  SUPPORTED_AUTOMATION_SCHEMA_VERSION,
} from "@/domain/automation/idempotency";
import {
  provisioningTaskEventDeduplicationKey,
  welcomeEmailDeduplicationKey,
} from "@/domain/provisioning/idempotency";
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
    payload: unknown;
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
    payload: event.payload as Record<string, string>,
  };
}

export async function appendProvisioningTaskRequestedEvent(
  tx: TransactionClient,
  input: Readonly<{
    onboardingId: string;
    taskId: string;
    correlationId: string;
    occurredAt: Date;
    maxAttempts: number;
  }>,
): Promise<AutomationEventEnvelope> {
  const event = await tx.automationEvent.upsert({
    where: { deduplicationKey: provisioningTaskEventDeduplicationKey(input.taskId) },
    create: {
      eventType: "PROVISIONING_TASK_REQUESTED",
      aggregateType: "ONBOARDING",
      aggregateId: input.onboardingId,
      payload: { taskId: input.taskId },
      schemaVersion: 1,
      maxAttempts: input.maxAttempts,
      availableAt: input.occurredAt,
      occurredAt: input.occurredAt,
      correlationId: input.correlationId,
      deduplicationKey: provisioningTaskEventDeduplicationKey(input.taskId),
    },
    update: {},
  });
  return toAutomationEventEnvelope(event);
}

export async function appendWelcomeEmailRequestedEvent(
  tx: TransactionClient,
  input: Readonly<{
    onboardingId: string;
    notificationId: string;
    correlationId: string;
    occurredAt: Date;
    maxAttempts: number;
  }>,
): Promise<AutomationEventEnvelope> {
  const event = await tx.automationEvent.upsert({
    where: { deduplicationKey: welcomeEmailDeduplicationKey(input.onboardingId) },
    create: {
      eventType: "WELCOME_EMAIL_REQUESTED",
      aggregateType: "ONBOARDING",
      aggregateId: input.onboardingId,
      payload: { notificationId: input.notificationId },
      schemaVersion: 1,
      maxAttempts: input.maxAttempts,
      availableAt: input.occurredAt,
      occurredAt: input.occurredAt,
      correlationId: input.correlationId,
      deduplicationKey: welcomeEmailDeduplicationKey(input.onboardingId),
    },
    update: {},
  });
  return toAutomationEventEnvelope(event);
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

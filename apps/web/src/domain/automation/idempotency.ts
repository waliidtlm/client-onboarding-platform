export const SUPPORTED_AUTOMATION_EVENT_TYPE = "ONBOARDING_ACTIVATED";
export const SUPPORTED_AUTOMATION_SCHEMA_VERSION = 1;
export const SUPPORTED_AUTOMATION_EVENT_TYPES = [
  "ONBOARDING_ACTIVATED",
  "PROVISIONING_TASK_REQUESTED",
  "WELCOME_EMAIL_REQUESTED",
  "CLIENT_ACCESS_EMAIL_REQUESTED",
  "CLIENT_REQUIREMENTS_COMPLETED",
  "KICKOFF_INVITATION_REQUESTED",
  "DELIVERY_HANDOFF_NOTIFICATION_REQUESTED",
  "PHASE6_CANCELLATION_NOTIFICATION_REQUESTED",
  "REMINDER_NOTIFICATION_REQUESTED",
] as const;

export type SupportedAutomationEventType = (typeof SUPPORTED_AUTOMATION_EVENT_TYPES)[number];

export function onboardingActivatedDeduplicationKey(onboardingId: string): string {
  return `ONBOARDING_ACTIVATED:${onboardingId}:v1`;
}

export function automationRunIdempotencyKey(eventId: string, attemptNumber: number): string {
  return `AUTOMATION_RUN:${eventId}:attempt:${attemptNumber}`;
}

export function isSupportedAutomationEnvelope(
  input: Readonly<{
    eventType: string;
    aggregateType: string;
    schemaVersion: number;
  }>,
): boolean {
  return (
    SUPPORTED_AUTOMATION_EVENT_TYPES.includes(input.eventType as SupportedAutomationEventType) &&
    input.aggregateType === "ONBOARDING" &&
    input.schemaVersion === SUPPORTED_AUTOMATION_SCHEMA_VERSION
  );
}

export function automationEventPayloadIsValid(
  eventType: string,
  payload: unknown,
): payload is Record<string, string> {
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) return false;
  const record = payload as Record<string, unknown>;
  if (eventType === "ONBOARDING_ACTIVATED") return Object.keys(record).length === 0;
  if (eventType === "PROVISIONING_TASK_REQUESTED") {
    return (
      Object.keys(record).length === 1 &&
      typeof record.taskId === "string" &&
      /^[0-9a-f-]{36}$/i.test(record.taskId)
    );
  }
  if (eventType === "WELCOME_EMAIL_REQUESTED") {
    return (
      Object.keys(record).length === 1 &&
      typeof record.notificationId === "string" &&
      /^[0-9a-f-]{36}$/i.test(record.notificationId)
    );
  }
  if (eventType === "CLIENT_ACCESS_EMAIL_REQUESTED") {
    return (
      Object.keys(record).length === 1 &&
      typeof record.notificationId === "string" &&
      /^[0-9a-f-]{36}$/i.test(record.notificationId)
    );
  }
  if (eventType === "CLIENT_REQUIREMENTS_COMPLETED") {
    return Object.keys(record).length === 0;
  }
  if (
    eventType === "KICKOFF_INVITATION_REQUESTED" ||
    eventType === "DELIVERY_HANDOFF_NOTIFICATION_REQUESTED" ||
    eventType === "PHASE6_CANCELLATION_NOTIFICATION_REQUESTED"
  ) {
    return (
      Object.keys(record).length === 1 &&
      typeof record.notificationId === "string" &&
      /^[0-9a-f-]{36}$/i.test(record.notificationId)
    );
  }
  if (eventType === "REMINDER_NOTIFICATION_REQUESTED") {
    return (
      Object.keys(record).length === 4 &&
      typeof record.notificationId === "string" &&
      /^[0-9a-f-]{36}$/i.test(record.notificationId) &&
      typeof record.category === "string" &&
      [
        "CLIENT_REQUIREMENT",
        "PROVISIONING_MANUAL_REVIEW",
        "KICKOFF_UNSCHEDULED",
        "DELIVERY_HANDOFF_UNACKNOWLEDGED",
      ].includes(record.category) &&
      typeof record.subjectId === "string" &&
      /^[0-9a-f-]{36}$/i.test(record.subjectId) &&
      typeof record.policyWindow === "string" &&
      /^[A-Z0-9_]+$/.test(record.policyWindow)
    );
  }
  return false;
}

export function canonicalizeJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalizeJson).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalizeJson(record[key])}`)
    .join(",")}}`;
}

export function normalizedJsonEqual(left: unknown, right: unknown): boolean {
  return canonicalizeJson(left) === canonicalizeJson(right);
}

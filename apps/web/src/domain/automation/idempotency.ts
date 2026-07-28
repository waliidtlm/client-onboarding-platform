export const SUPPORTED_AUTOMATION_EVENT_TYPE = "ONBOARDING_ACTIVATED";
export const SUPPORTED_AUTOMATION_SCHEMA_VERSION = 1;

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
    input.eventType === SUPPORTED_AUTOMATION_EVENT_TYPE &&
    input.aggregateType === "ONBOARDING" &&
    input.schemaVersion === SUPPORTED_AUTOMATION_SCHEMA_VERSION
  );
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

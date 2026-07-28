export const ONBOARDING_ACTIVATED_EVENT = "ONBOARDING_ACTIVATED";
export const PROVISIONING_TASK_REQUESTED_EVENT = "PROVISIONING_TASK_REQUESTED";
export const WELCOME_EMAIL_REQUESTED_EVENT = "WELCOME_EMAIL_REQUESTED";
export const PHASE_4_EVENT_SCHEMA_VERSION = 1;

export function provisioningTaskIdempotencyKey(taskId: string): string {
  return `PROVISION:${taskId}`;
}

export function provisioningTaskEventDeduplicationKey(taskId: string): string {
  return `PROVISIONING_TASK_REQUESTED:${taskId}:v1`;
}

export function welcomeEmailDeduplicationKey(onboardingId: string): string {
  return `WELCOME_EMAIL:${onboardingId}:v1`;
}

export function welcomeMessageKey(onboardingId: string): string {
  return `WELCOME_MESSAGE:${onboardingId}:v1`;
}

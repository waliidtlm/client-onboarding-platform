import { createHash } from "node:crypto";

import { canonicalizeJson } from "@/domain/automation/idempotency";

export function phase6Fingerprint(value: unknown): string {
  return createHash("sha256").update(canonicalizeJson(value)).digest("hex");
}

export function kickoffInvitationKey(kickoffId: string, revision: number): string {
  return `KICKOFF_INVITATION:${kickoffId}:revision:${revision}`;
}

export function deliveryHandoffNotificationKey(handoffId: string, revision: number): string {
  return `DELIVERY_HANDOFF:${handoffId}:revision:${revision}`;
}

export function phase6CancellationNotificationKey(onboardingId: string, revision: number): string {
  return `PHASE6_CANCELLATION:${onboardingId}:revision:${revision}`;
}

export function phase6EventKey(notificationId: string, eventType: string): string {
  return `${eventType}:${notificationId}:v1`;
}

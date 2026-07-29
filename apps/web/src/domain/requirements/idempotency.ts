import { createHash } from "node:crypto";

import { canonicalizeJson } from "@/domain/automation/idempotency";

export function requestFingerprint(value: unknown): string {
  return createHash("sha256").update(canonicalizeJson(value)).digest("hex");
}

export function requirementGenerationKey(onboardingId: string): string {
  return `GENERATE_REQUIREMENTS:${onboardingId}:v1`;
}

export function clientAccessEmailKey(tokenId: string): string {
  return `CLIENT_ACCESS_EMAIL:${tokenId}:v1`;
}

export function clientAccessMessageKey(tokenId: string): string {
  return `CLIENT_ACCESS_MESSAGE:${tokenId}:v1`;
}

export function requirementsCompletedEventKey(onboardingId: string): string {
  return `CLIENT_REQUIREMENTS_COMPLETED:${onboardingId}:v1`;
}

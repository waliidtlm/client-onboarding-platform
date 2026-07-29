"use server";

import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";

import {
  acknowledgeDeliveryHandoff,
  markDeliveryHandoffReady,
  reassignDeliveryHandoff,
  saveDeliveryHandoffDraft,
} from "@/application/phase6/handoff-service";
import {
  completeKickoff,
  scheduleKickoff,
  waiveKickoffInvitation,
} from "@/application/phase6/kickoff-service";
import { resolvePhase6NotificationUncertainty } from "@/application/phase6/notification-service";
import { getCurrentStaff } from "@/lib/auth/authorization";

function stringValue(data: FormData, key: string): string {
  return String(data.get(key) ?? "").trim();
}

function nullable(data: FormData, key: string): string | null {
  return stringValue(data, key) || null;
}

function finish(
  onboardingId: string,
  result: { ok: boolean; error?: { message: string } },
  success: string,
): never {
  const message = result.ok ? success : (result.error?.message ?? "The action failed.");
  redirect(
    `/onboardings/${onboardingId}?${result.ok ? "success" : "error"}=${encodeURIComponent(message)}`,
  );
}

async function actor() {
  const staff = await getCurrentStaff();
  if (!staff) redirect("/signin");
  return staff;
}

export async function scheduleKickoffAction(data: FormData) {
  const staff = await actor();
  const onboardingId = stringValue(data, "onboardingId");
  const result = await scheduleKickoff({
    actorId: staff.id,
    onboardingId,
    expectedKickoffVersion: Number(stringValue(data, "expectedKickoffVersion")),
    idempotencyKey: stringValue(data, "idempotencyKey"),
    localDate: stringValue(data, "localDate"),
    localTime: stringValue(data, "localTime"),
    timezone: stringValue(data, "timezone"),
    ambiguityChoice: nullable(data, "ambiguityChoice") ?? undefined,
    meetingUrl: nullable(data, "meetingUrl"),
    meetingLocation: nullable(data, "meetingLocation"),
    reason: nullable(data, "reason"),
    correlationId: randomUUID(),
  });
  finish(onboardingId, result, "Kickoff schedule saved and invitation queued.");
}

export async function waiveKickoffInvitationAction(data: FormData) {
  const staff = await actor();
  const onboardingId = stringValue(data, "onboardingId");
  const result = await waiveKickoffInvitation({
    actorId: staff.id,
    onboardingId,
    expectedKickoffVersion: Number(stringValue(data, "expectedKickoffVersion")),
    reason: stringValue(data, "reason"),
    correlationId: randomUUID(),
  });
  finish(onboardingId, result, "Invitation delivery waiver recorded.");
}

export async function completeKickoffAction(data: FormData) {
  const staff = await actor();
  const onboardingId = stringValue(data, "onboardingId");
  const result = await completeKickoff({
    actorId: staff.id,
    onboardingId,
    expectedKickoffVersion: Number(stringValue(data, "expectedKickoffVersion")),
    idempotencyKey: stringValue(data, "idempotencyKey"),
    outcomeNotes: stringValue(data, "outcomeNotes"),
    timingOverrideReason: nullable(data, "timingOverrideReason"),
    correlationId: randomUUID(),
  });
  finish(onboardingId, result, "Kickoff completed and delivery handoff draft created.");
}

export async function saveHandoffDraftAction(data: FormData) {
  const staff = await actor();
  const onboardingId = stringValue(data, "onboardingId");
  const result = await saveDeliveryHandoffDraft({
    actorId: staff.id,
    onboardingId,
    expectedHandoffVersion: Number(stringValue(data, "expectedHandoffVersion")),
    assignedDeliveryId: nullable(data, "assignedDeliveryId"),
    summary: nullable(data, "summary"),
    riskNotes: nullable(data, "riskNotes"),
    nextActions: nullable(data, "nextActions"),
    correlationId: randomUUID(),
  });
  finish(onboardingId, result, "Delivery handoff draft saved.");
}

export async function markHandoffReadyAction(data: FormData) {
  const staff = await actor();
  const onboardingId = stringValue(data, "onboardingId");
  const result = await markDeliveryHandoffReady({
    actorId: staff.id,
    onboardingId,
    expectedHandoffVersion: Number(stringValue(data, "expectedHandoffVersion")),
    idempotencyKey: stringValue(data, "idempotencyKey"),
    correlationId: randomUUID(),
  });
  finish(onboardingId, result, "Handoff marked ready and Delivery notification queued.");
}

export async function reassignHandoffAction(data: FormData) {
  const staff = await actor();
  const onboardingId = stringValue(data, "onboardingId");
  const result = await reassignDeliveryHandoff({
    actorId: staff.id,
    onboardingId,
    expectedHandoffVersion: Number(stringValue(data, "expectedHandoffVersion")),
    assignedDeliveryId: stringValue(data, "assignedDeliveryId"),
    reason: stringValue(data, "reason"),
    idempotencyKey: stringValue(data, "idempotencyKey"),
    correlationId: randomUUID(),
  });
  finish(onboardingId, result, "Delivery handoff reassigned and notification queued.");
}

export async function acknowledgeHandoffAction(data: FormData) {
  const staff = await actor();
  const onboardingId = stringValue(data, "onboardingId");
  const result = await acknowledgeDeliveryHandoff({
    actorId: staff.id,
    onboardingId,
    expectedHandoffVersion: Number(stringValue(data, "expectedHandoffVersion")),
    expectedOnboardingVersion: Number(stringValue(data, "expectedOnboardingVersion")),
    idempotencyKey: stringValue(data, "idempotencyKey"),
    adminExceptionReason: nullable(data, "adminExceptionReason"),
    correlationId: randomUUID(),
  });
  finish(onboardingId, result, "Delivery handoff acknowledged and onboarding completed.");
}

export async function resolvePhase6NotificationAction(data: FormData) {
  const staff = await actor();
  const onboardingId = stringValue(data, "onboardingId");
  const result = await resolvePhase6NotificationUncertainty({
    actorId: staff.id,
    notificationId: stringValue(data, "notificationId"),
    expectedOnboardingVersion: Number(stringValue(data, "expectedOnboardingVersion")),
    decision: stringValue(data, "decision"),
    providerReference: nullable(data, "providerReference"),
    reason: stringValue(data, "reason"),
    correlationId: randomUUID(),
  });
  finish(onboardingId, result, "Notification uncertainty resolved.");
}

"use server";

import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import {
  openCommercialException,
  resolveCommercialException,
} from "@/application/commercial/commercial-exception-service";
import { recalculateCommercialGate } from "@/application/commercial/commercial-gate-service";
import { updateContractStatus } from "@/application/commercial/contract-service";
import { issueActivationInvoice } from "@/application/commercial/invoice-service";
import {
  approveManualActivationRequirement,
  revokeManualActivationRequirement,
} from "@/application/commercial/manual-approval-service";
import { cancelOnboarding } from "@/application/commercial/onboarding-service";
import { recordPayment, reviewPayment } from "@/application/commercial/payment-service";
import {
  correctSalesHandoff,
  createOnboardingFromSalesHandoff,
  updateDealStatus,
} from "@/application/commercial/sales-handoff-service";
import type { CommercialActionState } from "@/application/commercial/action-state";
import { Permission, requirePermission } from "@/lib/auth/authorization";
import type { Result } from "@/domain/errors";
import type { CommercialMutationResult } from "@/application/commercial/types";

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}

function nullableText(formData: FormData, name: string): string | null {
  return text(formData, name) || null;
}

function integer(formData: FormData, name: string): number {
  return Number.parseInt(text(formData, name), 10);
}

function dateAtEndOfDay(value: string): string {
  if (!value) return value;
  return new Date(`${value}T23:59:59.000Z`).toISOString();
}

function failureState(
  result: Extract<Result<CommercialMutationResult>, { ok: false }>,
): CommercialActionState {
  return {
    ok: false,
    message: result.error.message,
    errorCode: result.error.code,
    ...(result.error.fieldErrors ? { fieldErrors: result.error.fieldErrors } : {}),
  };
}

function finish(
  result: Result<CommercialMutationResult>,
  onboardingId: string,
  message: string,
): CommercialActionState {
  if (!result.ok) return failureState(result);
  revalidatePath("/onboardings");
  revalidatePath(`/onboardings/${onboardingId}`);
  redirect(`/onboardings/${onboardingId}?success=${encodeURIComponent(message)}`);
}

export async function createSalesHandoffAction(
  _previous: CommercialActionState,
  formData: FormData,
): Promise<CommercialActionState> {
  const staff = await requirePermission(Permission.SALES_HANDOFF_MUTATE, "/onboardings/new");
  const result = await createOnboardingFromSalesHandoff({
    actorId: staff.id,
    correlationId: randomUUID(),
    submissionKey: text(formData, "submissionKey"),
    externalDealId: nullableText(formData, "externalDealId"),
    clientMode: nullableText(formData, "clientMode"),
    existingClientId: nullableText(formData, "existingClientId"),
    newClientCompanyName: nullableText(formData, "newClientCompanyName"),
    newClientContactName: nullableText(formData, "newClientContactName"),
    newClientContactEmail: nullableText(formData, "newClientContactEmail"),
    newClientContactPhone: nullableText(formData, "newClientContactPhone"),
    servicePackageId: nullableText(formData, "servicePackageId"),
    dealStatus: nullableText(formData, "dealStatus"),
    agreedTotal: nullableText(formData, "agreedTotal"),
    currency: nullableText(formData, "currency"),
    salesNotes: nullableText(formData, "salesNotes"),
  });

  if (!result.ok) return failureState(result);
  revalidatePath("/onboardings");
  redirect(
    result.value.status === "SALES_HANDOFF_INCOMPLETE"
      ? `/onboardings/${result.value.onboardingId}/handoff`
      : `/onboardings/${result.value.onboardingId}?success=Sales%20handoff%20submitted`,
  );
}

export async function correctSalesHandoffAction(
  _previous: CommercialActionState,
  formData: FormData,
): Promise<CommercialActionState> {
  const onboardingId = text(formData, "onboardingId");
  const staff = await requirePermission(
    Permission.SALES_HANDOFF_MUTATE,
    `/onboardings/${onboardingId}/handoff`,
  );
  const result = await correctSalesHandoff({
    actorId: staff.id,
    correlationId: randomUUID(),
    onboardingId,
    expectedVersion: integer(formData, "expectedVersion"),
    externalDealId: nullableText(formData, "externalDealId"),
    clientMode: nullableText(formData, "clientMode"),
    existingClientId: nullableText(formData, "existingClientId"),
    newClientCompanyName: nullableText(formData, "newClientCompanyName"),
    newClientContactName: nullableText(formData, "newClientContactName"),
    newClientContactEmail: nullableText(formData, "newClientContactEmail"),
    newClientContactPhone: nullableText(formData, "newClientContactPhone"),
    servicePackageId: nullableText(formData, "servicePackageId"),
    dealStatus: nullableText(formData, "dealStatus"),
    agreedTotal: nullableText(formData, "agreedTotal"),
    currency: nullableText(formData, "currency"),
    salesNotes: nullableText(formData, "salesNotes"),
  });
  if (!result.ok) return failureState(result);
  revalidatePath("/onboardings");
  redirect(
    result.value.status === "SALES_HANDOFF_INCOMPLETE"
      ? `/onboardings/${onboardingId}/handoff?error=Handoff%20still%20needs%20correction`
      : `/onboardings/${onboardingId}?success=Sales%20handoff%20validated`,
  );
}

export async function updateDealStatusAction(
  _previous: CommercialActionState,
  formData: FormData,
): Promise<CommercialActionState> {
  const onboardingId = text(formData, "onboardingId");
  const staff = await requirePermission(
    Permission.DEAL_STATUS_UPDATE,
    `/onboardings/${onboardingId}`,
  );
  const result = await updateDealStatus({
    actorId: staff.id,
    correlationId: randomUUID(),
    onboardingId,
    expectedVersion: integer(formData, "expectedVersion"),
    dealStatus: text(formData, "dealStatus"),
  });
  return finish(result, onboardingId, "Deal status updated");
}

export async function updateContractStatusAction(
  _previous: CommercialActionState,
  formData: FormData,
): Promise<CommercialActionState> {
  const onboardingId = text(formData, "onboardingId");
  const staff = await requirePermission(Permission.CONTRACT_UPDATE, `/onboardings/${onboardingId}`);
  const deadline = text(formData, "signatureDeadline");
  const result = await updateContractStatus({
    actorId: staff.id,
    correlationId: randomUUID(),
    onboardingId,
    expectedVersion: integer(formData, "expectedVersion"),
    targetStatus: text(formData, "targetStatus"),
    revisionReason: nullableText(formData, "revisionReason"),
    signatureDeadline: deadline ? dateAtEndOfDay(deadline) : null,
    externalReference: nullableText(formData, "externalReference"),
  });
  return finish(result, onboardingId, "Contract updated");
}

export async function issueActivationInvoiceAction(
  _previous: CommercialActionState,
  formData: FormData,
): Promise<CommercialActionState> {
  const onboardingId = text(formData, "onboardingId");
  const staff = await requirePermission(Permission.INVOICE_ISSUE, `/onboardings/${onboardingId}`);
  const result = await issueActivationInvoice({
    actorId: staff.id,
    correlationId: randomUUID(),
    onboardingId,
    expectedVersion: integer(formData, "expectedVersion"),
    invoiceNumber: text(formData, "invoiceNumber"),
    dueAt: dateAtEndOfDay(text(formData, "dueAt")),
  });
  return finish(result, onboardingId, "Activation invoice issued");
}

export async function recordPaymentAction(
  _previous: CommercialActionState,
  formData: FormData,
): Promise<CommercialActionState> {
  const onboardingId = text(formData, "onboardingId");
  const staff = await requirePermission(Permission.PAYMENT_RECORD, `/onboardings/${onboardingId}`);
  const result = await recordPayment({
    actorId: staff.id,
    correlationId: randomUUID(),
    onboardingId,
    expectedVersion: integer(formData, "expectedVersion"),
    recordingKey: text(formData, "recordingKey"),
    originalAmount: text(formData, "originalAmount"),
    currency: text(formData, "currency"),
    externalReference: nullableText(formData, "externalReference"),
  });
  return finish(result, onboardingId, "Payment recorded for Finance review");
}

export async function reviewPaymentAction(
  _previous: CommercialActionState,
  formData: FormData,
): Promise<CommercialActionState> {
  const onboardingId = text(formData, "onboardingId");
  const staff = await requirePermission(Permission.PAYMENT_REVIEW, `/onboardings/${onboardingId}`);
  const result = await reviewPayment({
    actorId: staff.id,
    correlationId: randomUUID(),
    onboardingId,
    expectedVersion: integer(formData, "expectedVersion"),
    paymentId: text(formData, "paymentId"),
    expectedPaymentVersion: integer(formData, "expectedPaymentVersion"),
    decision: text(formData, "decision"),
    verifiedAmount: nullableText(formData, "verifiedAmount"),
    discrepancyReason: nullableText(formData, "discrepancyReason"),
  });
  return finish(result, onboardingId, "Payment review saved");
}

export async function approveManualActivationAction(
  _previous: CommercialActionState,
  formData: FormData,
): Promise<CommercialActionState> {
  const onboardingId = text(formData, "onboardingId");
  const staff = await requirePermission(
    Permission.MANUAL_ACTIVATION_APPROVE,
    `/onboardings/${onboardingId}`,
  );
  return finish(
    await approveManualActivationRequirement({
      actorId: staff.id,
      correlationId: randomUUID(),
      onboardingId,
      expectedVersion: integer(formData, "expectedVersion"),
    }),
    onboardingId,
    "Manual activation approved",
  );
}

export async function revokeManualActivationAction(
  _previous: CommercialActionState,
  formData: FormData,
): Promise<CommercialActionState> {
  const onboardingId = text(formData, "onboardingId");
  const staff = await requirePermission(
    Permission.MANUAL_ACTIVATION_APPROVE,
    `/onboardings/${onboardingId}`,
  );
  return finish(
    await revokeManualActivationRequirement({
      actorId: staff.id,
      correlationId: randomUUID(),
      onboardingId,
      expectedVersion: integer(formData, "expectedVersion"),
      reason: text(formData, "reason"),
    }),
    onboardingId,
    "Manual activation approval revoked",
  );
}

export async function openCommercialExceptionAction(
  _previous: CommercialActionState,
  formData: FormData,
): Promise<CommercialActionState> {
  const onboardingId = text(formData, "onboardingId");
  const staff = await requirePermission(
    Permission.COMMERCIAL_EXCEPTION_MANAGE,
    `/onboardings/${onboardingId}`,
  );
  return finish(
    await openCommercialException({
      actorId: staff.id,
      correlationId: randomUUID(),
      onboardingId,
      expectedVersion: integer(formData, "expectedVersion"),
      reason: text(formData, "reason"),
    }),
    onboardingId,
    "Commercial exception opened",
  );
}

export async function resolveCommercialExceptionAction(
  _previous: CommercialActionState,
  formData: FormData,
): Promise<CommercialActionState> {
  const onboardingId = text(formData, "onboardingId");
  const staff = await requirePermission(
    Permission.COMMERCIAL_EXCEPTION_MANAGE,
    `/onboardings/${onboardingId}`,
  );
  return finish(
    await resolveCommercialException({
      actorId: staff.id,
      correlationId: randomUUID(),
      onboardingId,
      expectedVersion: integer(formData, "expectedVersion"),
      exceptionId: text(formData, "exceptionId"),
      resolution: text(formData, "resolution"),
      resolutionNote: text(formData, "resolutionNote"),
    }),
    onboardingId,
    "Commercial exception resolved",
  );
}

export async function cancelOnboardingAction(
  _previous: CommercialActionState,
  formData: FormData,
): Promise<CommercialActionState> {
  const onboardingId = text(formData, "onboardingId");
  const staff = await requirePermission(
    Permission.ONBOARDING_CANCEL,
    `/onboardings/${onboardingId}`,
  );
  return finish(
    await cancelOnboarding({
      actorId: staff.id,
      correlationId: randomUUID(),
      onboardingId,
      expectedVersion: integer(formData, "expectedVersion"),
      reason: text(formData, "reason"),
    }),
    onboardingId,
    "Onboarding cancelled",
  );
}

export async function recalculateCommercialGateAction(
  _previous: CommercialActionState,
  formData: FormData,
): Promise<CommercialActionState> {
  const onboardingId = text(formData, "onboardingId");
  const staff = await requirePermission(
    Permission.COMMERCIAL_GATE_RECALCULATE,
    `/onboardings/${onboardingId}`,
  );
  return finish(
    await recalculateCommercialGate({
      actorId: staff.id,
      correlationId: randomUUID(),
      onboardingId,
      expectedVersion: integer(formData, "expectedVersion"),
    }),
    onboardingId,
    "Commercial Gate recalculated",
  );
}

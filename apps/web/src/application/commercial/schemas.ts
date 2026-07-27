import { z } from "zod";

import {
  CommercialExceptionStatus,
  ContractStatus,
  DealStatus,
  PaymentVerificationStatus,
  SalesHandoffClientMode,
} from "@/generated/prisma/client";

const nullableText = (maximum: number) =>
  z
    .string()
    .trim()
    .max(maximum)
    .nullable()
    .transform((value) => (value ? value : null));

const nullableUuid = z.uuid().nullable();
const moneyString = z
  .string()
  .trim()
  .regex(/^\d{1,15}(?:\.\d{1,4})?$/);
const currency = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3}$/);

export const createHandoffSchema = z.object({
  actorId: z.uuid(),
  correlationId: z.uuid(),
  submissionKey: z.string().trim().min(8).max(100),
  externalDealId: nullableText(200),
  clientMode: z.enum(SalesHandoffClientMode).nullable(),
  existingClientId: nullableUuid,
  newClientCompanyName: nullableText(200),
  newClientContactName: nullableText(200),
  newClientContactEmail: z.email().max(320).nullable(),
  newClientContactPhone: nullableText(50),
  servicePackageId: nullableUuid,
  dealStatus: z.enum(DealStatus).nullable(),
  agreedTotal: moneyString.nullable(),
  currency: currency.nullable(),
  salesNotes: nullableText(4000),
});

export const correctHandoffSchema = createHandoffSchema.omit({ submissionKey: true }).extend({
  onboardingId: z.uuid(),
  expectedVersion: z.int().positive(),
});

export const updateDealStatusSchema = z.object({
  actorId: z.uuid(),
  correlationId: z.uuid(),
  onboardingId: z.uuid(),
  expectedVersion: z.int().positive(),
  dealStatus: z.enum(DealStatus),
});

export const updateContractSchema = z.object({
  actorId: z.uuid(),
  correlationId: z.uuid(),
  onboardingId: z.uuid(),
  expectedVersion: z.int().positive(),
  targetStatus: z.enum(ContractStatus),
  revisionReason: nullableText(2000),
  signatureDeadline: z.iso.datetime().nullable(),
  externalReference: nullableText(200),
});

export const issueInvoiceSchema = z.object({
  actorId: z.uuid(),
  correlationId: z.uuid(),
  onboardingId: z.uuid(),
  expectedVersion: z.int().positive(),
  invoiceNumber: z.string().trim().min(1).max(100),
  dueAt: z.iso.datetime(),
});

export const recordPaymentSchema = z.object({
  actorId: z.uuid(),
  correlationId: z.uuid(),
  onboardingId: z.uuid(),
  expectedVersion: z.int().positive(),
  recordingKey: z.string().trim().min(8).max(100),
  originalAmount: moneyString,
  currency,
  externalReference: nullableText(200),
});

export const reviewPaymentSchema = z.object({
  actorId: z.uuid(),
  correlationId: z.uuid(),
  onboardingId: z.uuid(),
  expectedVersion: z.int().positive(),
  paymentId: z.uuid(),
  expectedPaymentVersion: z.int().positive(),
  decision: z.enum([
    PaymentVerificationStatus.VERIFIED,
    PaymentVerificationStatus.REVIEW_REQUIRED,
    PaymentVerificationStatus.REJECTED,
  ]),
  verifiedAmount: moneyString.nullable(),
  discrepancyReason: nullableText(2000),
});

export const manualApprovalSchema = z.object({
  actorId: z.uuid(),
  correlationId: z.uuid(),
  onboardingId: z.uuid(),
  expectedVersion: z.int().positive(),
});

export const revokeManualApprovalSchema = manualApprovalSchema.extend({
  reason: z.string().trim().min(1).max(2000),
});

export const commercialExceptionSchema = z.object({
  actorId: z.uuid(),
  correlationId: z.uuid(),
  onboardingId: z.uuid(),
  expectedVersion: z.int().positive(),
  reason: z.string().trim().min(1).max(2000),
});

export const resolveCommercialExceptionSchema = z.object({
  actorId: z.uuid(),
  correlationId: z.uuid(),
  onboardingId: z.uuid(),
  expectedVersion: z.int().positive(),
  exceptionId: z.uuid(),
  resolution: z.enum([CommercialExceptionStatus.RESOLVED, CommercialExceptionStatus.REJECTED]),
  resolutionNote: z.string().trim().min(1).max(2000),
});

export const cancelOnboardingSchema = z.object({
  actorId: z.uuid(),
  correlationId: z.uuid(),
  onboardingId: z.uuid(),
  expectedVersion: z.int().positive(),
  reason: z.string().trim().min(1).max(2000),
});

export const recalculateGateSchema = z.object({
  actorId: z.uuid(),
  correlationId: z.uuid(),
  onboardingId: z.uuid(),
  expectedVersion: z.int().positive().optional(),
});

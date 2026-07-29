import { z } from "zod";

const safeIdentifier = z
  .string()
  .trim()
  .min(1)
  .max(255)
  .regex(/^[A-Za-z0-9._:-]+$/);

export const machineRunSchema = z.object({
  eventId: z.uuid(),
  runId: z.uuid(),
  idempotencyKey: safeIdentifier,
  workerId: safeIdentifier.max(100),
  n8nExecutionId: safeIdentifier.max(100),
});

export const initializeProvisioningSchema = machineRunSchema;

export const startProvisioningTaskSchema = machineRunSchema.extend({
  taskId: z.uuid(),
  expectedTaskVersion: z.int().positive(),
});

export const executeSandboxTaskSchema = startProvisioningTaskSchema.extend({
  attemptId: z.uuid(),
  attemptNumber: z.int().positive(),
});

export const completeProvisioningTaskSchema = executeSandboxTaskSchema.extend({
  externalReference: z.string().trim().min(1).max(500),
});

export const failProvisioningTaskSchema = executeSandboxTaskSchema.extend({
  errorCode: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .regex(/^[A-Z0-9_]+$/),
  errorMessage: z.string().trim().min(1).max(1000),
  retryable: z.boolean(),
});

export const assignProjectManagerSchema = z.object({
  actorId: z.uuid(),
  onboardingId: z.uuid(),
  projectManagerId: z.uuid(),
  expectedVersion: z.int().positive(),
  correlationId: z.uuid(),
});

export const manualTaskResolutionSchema = z.object({
  actorId: z.uuid(),
  onboardingId: z.uuid(),
  taskId: z.uuid(),
  expectedTaskVersion: z.int().positive(),
  reason: z.string().trim().min(1).max(2000),
  correlationId: z.uuid(),
});

export const approveInternalReadinessSchema = z.object({
  actorId: z.uuid(),
  onboardingId: z.uuid(),
  expectedVersion: z.int().positive(),
  note: z.string().trim().max(2000).nullable(),
  correlationId: z.uuid(),
});

export const beginWelcomeDeliverySchema = machineRunSchema.extend({
  notificationId: z.uuid(),
});

export const recordWelcomeDeliverySchema = beginWelcomeDeliverySchema.extend({
  outcome: z.enum(["SENT", "REJECTED", "DELIVERY_UNCERTAIN"]),
  providerReference: z.string().trim().min(1).max(500).nullable(),
  errorCode: z
    .string()
    .trim()
    .max(100)
    .regex(/^[A-Z0-9_]*$/),
  errorMessage: z.string().trim().max(1000),
  retryable: z.boolean(),
});

export const deliverClientAccessEmailSchema = machineRunSchema;

export const resolveWelcomeUncertaintySchema = z.object({
  actorId: z.uuid(),
  notificationId: z.uuid(),
  action: z.enum(["CONFIRM_SENT", "AUTHORIZE_RESEND"]),
  providerReference: z.string().trim().min(1).max(500).nullable(),
  reason: z.string().trim().min(10).max(2000),
  correlationId: z.uuid(),
});

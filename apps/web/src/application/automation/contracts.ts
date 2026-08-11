import { z } from "zod";

const safeIdentifier = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(/^[A-Za-z0-9._:-]+$/);

export const claimAutomationSchema = z
  .object({
    requestId: z.uuid(),
    workerId: safeIdentifier.max(100),
    workflowName: z.string().trim().min(1).max(200),
    supportedEventTypes: z
      .array(
        z.enum([
          "ONBOARDING_ACTIVATED",
          "PROVISIONING_TASK_REQUESTED",
          "WELCOME_EMAIL_REQUESTED",
          "CLIENT_ACCESS_EMAIL_REQUESTED",
          "CLIENT_REQUIREMENTS_COMPLETED",
          "KICKOFF_INVITATION_REQUESTED",
          "DELIVERY_HANDOFF_NOTIFICATION_REQUESTED",
          "PHASE6_CANCELLATION_NOTIFICATION_REQUESTED",
          "REMINDER_NOTIFICATION_REQUESTED",
        ]),
      )
      .min(1)
      .max(11)
      .refine((value) => new Set(value).size === value.length, "Event types must be unique"),
  })
  .strict();

export const automationContextAccessSchema = z
  .object({
    runId: z.uuid(),
    idempotencyKey: safeIdentifier.max(255),
    workerId: safeIdentifier.max(100),
  })
  .strict();

const externalReferencesSchema = z
  .record(z.string().min(1).max(100), z.string().trim().min(1).max(500))
  .refine((value) => Object.keys(value).length <= 10, "At most 10 references are allowed");

export const automationCallbackSchema = z
  .object({
    eventId: z.uuid(),
    runId: z.uuid(),
    idempotencyKey: safeIdentifier.max(255),
    workerId: safeIdentifier.max(100),
    n8nExecutionId: safeIdentifier.max(100),
    resultStatus: z.literal("COMPLETED"),
    externalReferences: externalReferencesSchema.default({}),
  })
  .strict();

export const automationFailureSchema = z
  .object({
    eventId: z.uuid(),
    runId: z.uuid(),
    idempotencyKey: safeIdentifier.max(255),
    workerId: safeIdentifier.max(100),
    n8nExecutionId: safeIdentifier.max(100),
    failedNode: z.string().trim().min(1).max(200).nullable().default(null),
    errorCode: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .regex(/^[A-Z0-9_]+$/),
    errorMessage: z.string().trim().min(1).max(1000),
    classification: z.enum(["RETRYABLE", "OPERATOR_REMEDIABLE", "PERMANENT"]),
    reportedAt: z.iso.datetime().optional(),
  })
  .strict();

export const manualRetryAutomationSchema = z
  .object({
    actorId: z.uuid(),
    eventId: z.uuid(),
    reason: z.string().trim().min(10).max(500),
    correlationId: z.uuid(),
  })
  .strict();

export type ClaimAutomationInput = z.infer<typeof claimAutomationSchema>;
export type AutomationContextAccessInput = z.infer<typeof automationContextAccessSchema>;
export type AutomationCallbackInput = z.infer<typeof automationCallbackSchema>;
export type AutomationFailureInput = z.infer<typeof automationFailureSchema>;

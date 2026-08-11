import { z } from "zod";

const safeIdentifier = z
  .string()
  .trim()
  .min(1)
  .max(255)
  .regex(/^[A-Za-z0-9._:-]+$/);

export const evaluateRemindersSchema = z
  .object({
    requestId: z.uuid(),
  })
  .strict();

export const deliverReminderSchema = z
  .object({
    eventId: z.uuid(),
    runId: z.uuid(),
    idempotencyKey: safeIdentifier,
    workerId: safeIdentifier.max(100),
    n8nExecutionId: safeIdentifier.max(100),
  })
  .strict();

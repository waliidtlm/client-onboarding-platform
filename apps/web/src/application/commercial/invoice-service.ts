import {
  AuditActorType,
  InvoiceStatus,
  OnboardingStatus,
  Prisma,
  Role,
} from "@/generated/prisma/client";
import { prisma } from "@/lib/database";
import { appendAuditEvent } from "@/application/commercial/audit";
import { refreshCommercialState } from "@/application/commercial/commercial-gate-service";
import { issueInvoiceSchema } from "@/application/commercial/schemas";
import {
  executeService,
  parseInput,
  reject,
  requireActor,
  type DatabaseClient,
} from "@/application/commercial/service-support";
import type { CommercialMutationResult } from "@/application/commercial/types";
import type { Result } from "@/domain/errors";

export async function issueActivationInvoice(
  rawInput: unknown,
  database: DatabaseClient = prisma,
): Promise<Result<CommercialMutationResult>> {
  return executeService(async () => {
    const input = parseInput(issueInvoiceSchema.safeParse(rawInput));
    return database.$transaction(
      async (tx) => {
        await requireActor(tx, input.actorId, [Role.ADMIN, Role.FINANCE]);
        const onboarding = await tx.onboarding.findUnique({
          where: { id: input.onboardingId },
          include: { activationInvoice: true },
        });
        if (!onboarding?.activationInvoice) {
          reject("NOT_FOUND", "The draft activation invoice does not exist.");
        }
        if (onboarding.version !== input.expectedVersion) {
          reject("VERSION_CONFLICT", "The onboarding changed. Refresh and retry.");
        }
        if (onboarding.status !== OnboardingStatus.COMMERCIAL_PENDING) {
          reject("INVALID_TRANSITION", "The activation invoice cannot be issued in this state.");
        }

        const invoice = onboarding.activationInvoice;
        const dueAt = new Date(input.dueAt);
        if (invoice.status !== InvoiceStatus.DRAFT) {
          if (
            invoice.invoiceNumber === input.invoiceNumber &&
            invoice.dueAt?.getTime() === dueAt.getTime()
          ) {
            return refreshCommercialState(tx, {
              onboardingId: onboarding.id,
              correlationId: input.correlationId,
              triggeredByActorId: input.actorId,
              forceVersionIncrement: false,
            });
          }
          reject("INVALID_TRANSITION", "Only a draft activation invoice can be issued.");
        }
        if (invoice.currency !== onboarding.currency) {
          reject("CONFIGURATION_ERROR", "Invoice currency does not match the commercial snapshot.");
        }

        await tx.invoice.update({
          where: { id: invoice.id },
          data: {
            invoiceNumber: input.invoiceNumber,
            dueAt,
            status: InvoiceStatus.ISSUED,
          },
        });
        await appendAuditEvent(tx, {
          onboardingId: onboarding.id,
          actorType: AuditActorType.STAFF,
          actorId: input.actorId,
          action: "ACTIVATION_INVOICE_ISSUED",
          entityType: "INVOICE",
          entityId: invoice.id,
          previousValue: {
            status: invoice.status,
            invoiceNumber: invoice.invoiceNumber,
            dueAt: invoice.dueAt?.toISOString() ?? null,
          },
          newValue: {
            status: InvoiceStatus.ISSUED,
            invoiceNumber: input.invoiceNumber,
            dueAt: dueAt.toISOString(),
          },
          correlationId: input.correlationId,
        });

        return refreshCommercialState(tx, {
          onboardingId: onboarding.id,
          expectedVersion: input.expectedVersion,
          correlationId: input.correlationId,
          triggeredByActorId: input.actorId,
          forceVersionIncrement: true,
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  });
}

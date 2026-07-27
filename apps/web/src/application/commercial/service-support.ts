import type { Role } from "@/generated/prisma/client";
import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { failure, type DomainError, type DomainErrorCode, type Result } from "@/domain/errors";

export type TransactionClient = Prisma.TransactionClient;
export type DatabaseClient = PrismaClient;

export class ServiceFailure extends Error {
  constructor(readonly domainError: DomainError) {
    super(domainError.message);
  }
}

export function reject(
  code: DomainErrorCode,
  message: string,
  fieldErrors?: Readonly<Record<string, readonly string[]>>,
): never {
  throw new ServiceFailure({
    code,
    message,
    ...(fieldErrors ? { fieldErrors } : {}),
  });
}

export async function requireActor(
  tx: TransactionClient,
  actorId: string,
  allowedRoles: readonly Role[],
): Promise<{ id: string; role: Role }> {
  const actor = await tx.user.findUnique({
    where: { id: actorId },
    select: { id: true, role: true, isActive: true },
  });

  if (!actor?.isActive || !allowedRoles.includes(actor.role)) {
    reject("ACCESS_DENIED", "You are not authorized to perform this action.");
  }

  return actor;
}

export async function executeService<T>(work: () => Promise<T>): Promise<Result<T>> {
  try {
    return { ok: true, value: await work() };
  } catch (error) {
    if (error instanceof ServiceFailure) {
      return { ok: false, error: error.domainError };
    }

    const databaseError = error as {
      code?: string;
      meta?: { target?: string[] | string; constraint?: string };
    };
    if (databaseError.code === "P2002") {
      const target = `${JSON.stringify(databaseError.meta ?? {})} ${String(error)}`;
      if (target.includes("submissionKey")) {
        return failure("DUPLICATE_RECORDING_KEY", "This submission was already recorded.");
      }
      if (target.includes("externalDealId")) {
        return failure(
          "DUPLICATE_EXTERNAL_DEAL",
          "An onboarding already uses this external deal reference.",
        );
      }
      if (target.includes("invoiceNumber")) {
        return failure("DUPLICATE_INVOICE_NUMBER", "This invoice number is already in use.");
      }
      if (target.includes("companyName")) {
        return failure(
          "DUPLICATE_CLIENT",
          "A client with this company name already exists. Select the existing client.",
        );
      }
    }
    if (databaseError.code === "P2034") {
      return failure(
        "VERSION_CONFLICT",
        "Another commercial update completed first. Refresh and try again.",
      );
    }

    throw error;
  }
}

export function parseInput<T>(
  parsed:
    | { success: true; data: T }
    | { success: false; error: { flatten(): { fieldErrors: Record<string, string[]> } } },
): T {
  if (!parsed.success) {
    reject(
      "INVALID_INPUT",
      "The submitted information is invalid.",
      parsed.error.flatten().fieldErrors,
    );
  }
  return parsed.data;
}

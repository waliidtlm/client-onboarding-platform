import type { DealStatus, SalesHandoffClientMode } from "@/generated/prisma/client";

export type HandoffCompletenessInput = Readonly<{
  externalDealId: string | null;
  clientMode: SalesHandoffClientMode | null;
  existingClientId: string | null;
  newClientCompanyName: string | null;
  newClientContactName: string | null;
  newClientContactEmail: string | null;
  servicePackageId: string | null;
  dealStatus: DealStatus | null;
  agreedTotal: { gt(value: number): boolean } | null;
  currency: string | null;
}>;

export type HandoffFieldErrors = Readonly<Record<string, readonly string[]>>;

export function validateHandoffCompleteness(input: HandoffCompletenessInput): HandoffFieldErrors {
  const errors: Record<string, string[]> = {};
  const add = (field: string, message: string) => {
    errors[field] = [...(errors[field] ?? []), message];
  };

  if (!input.externalDealId?.trim()) add("externalDealId", "External deal reference is required.");
  if (!input.clientMode) add("clientMode", "Choose an existing or new client.");

  if (input.clientMode === "EXISTING" && !input.existingClientId) {
    add("existingClientId", "Select an existing client.");
  }
  if (input.clientMode === "NEW") {
    if (!input.newClientCompanyName?.trim()) {
      add("newClientCompanyName", "Company name is required.");
    }
    if (!input.newClientContactName?.trim()) {
      add("newClientContactName", "Contact name is required.");
    }
    if (!input.newClientContactEmail?.trim()) {
      add("newClientContactEmail", "Contact email is required.");
    }
  }

  if (!input.servicePackageId) add("servicePackageId", "Select an active service package.");
  if (!input.dealStatus) add("dealStatus", "Deal status is required.");
  if (!input.agreedTotal || !input.agreedTotal.gt(0)) {
    add("agreedTotal", "Agreed total must be greater than zero.");
  }
  if (!input.currency || !/^[A-Z]{3}$/.test(input.currency)) {
    add("currency", "Currency must be a three-letter uppercase ISO code.");
  }

  return errors;
}

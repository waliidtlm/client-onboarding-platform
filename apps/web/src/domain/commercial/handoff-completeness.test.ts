import { describe, expect, it } from "vitest";

import { DealStatus, Prisma } from "@/generated/prisma/client";
import { validateHandoffCompleteness } from "@/domain/commercial/handoff-completeness";

const complete = {
  externalDealId: "DEAL-1",
  clientMode: "EXISTING" as const,
  existingClientId: "client-id",
  newClientCompanyName: null,
  newClientContactName: null,
  newClientContactEmail: null,
  servicePackageId: "package-id",
  dealStatus: DealStatus.CLOSED_WON,
  agreedTotal: new Prisma.Decimal("10000"),
  currency: "USD",
};

describe("handoff completeness", () => {
  it("accepts an existing client", () => {
    expect(validateHandoffCompleteness(complete)).toEqual({});
  });

  it("accepts complete new-client data", () => {
    expect(
      validateHandoffCompleteness({
        ...complete,
        clientMode: "NEW",
        existingClientId: null,
        newClientCompanyName: "New Company",
        newClientContactName: "New Contact",
        newClientContactEmail: "contact@example.test",
      }),
    ).toEqual({});
  });

  it("returns clear errors for every missing field", () => {
    const errors = validateHandoffCompleteness({
      externalDealId: null,
      clientMode: null,
      existingClientId: null,
      newClientCompanyName: null,
      newClientContactName: null,
      newClientContactEmail: null,
      servicePackageId: null,
      dealStatus: null,
      agreedTotal: null,
      currency: null,
    });

    expect(Object.keys(errors).sort()).toEqual(
      [
        "agreedTotal",
        "clientMode",
        "currency",
        "dealStatus",
        "externalDealId",
        "servicePackageId",
      ].sort(),
    );
  });
});

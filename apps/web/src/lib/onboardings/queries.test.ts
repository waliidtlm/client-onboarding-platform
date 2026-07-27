import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  ActivationRequirementStatus,
  ActivationType,
  CommercialGateStatus,
  DealStatus,
  OnboardingStatus,
  Role,
  SalesHandoffStatus,
} from "@/generated/prisma/client";
import { getOnboardingDetail } from "@/lib/onboardings/queries";

const databaseMocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  findUniqueOrThrow: vi.fn(),
}));

vi.mock("@/lib/database", () => ({
  prisma: {
    onboarding: databaseMocks,
  },
}));

describe("onboarding query authorization", () => {
  beforeEach(() => {
    databaseMocks.findUnique.mockReset();
    databaseMocks.findUniqueOrThrow.mockReset();
    databaseMocks.findUnique.mockResolvedValue({
      id: "onboarding-id",
      externalDealId: "DEAL-ATLAS-2026-001",
      dealStatus: DealStatus.CLOSED_WON,
      salesHandoffStatus: SalesHandoffStatus.COMPLETE,
      status: OnboardingStatus.COMMERCIAL_PENDING,
      commercialGateStatus: CommercialGateStatus.BLOCKED,
      activationRequirementStatus: ActivationRequirementStatus.NOT_SATISFIED,
      version: 1,
      createdAt: new Date("2026-07-27T00:00:00.000Z"),
      client: {
        companyName: "Atlas Fitness Studio",
        contactName: "Jordan Atlas",
        contactEmail: "operations@atlas-fitness.test",
      },
      servicePackage: {
        name: "Paid Growth Launch",
        description: "Paid-growth launch package",
        activationType: ActivationType.DEPOSIT_PERCENTAGE,
        activationValue: { toFixed: () => "30.0000" },
        provisioningTemplates: [],
        requirementTemplates: [],
      },
      projectManager: null,
    });
  });

  it("does not query monetary, contract, invoice, or payment data for Delivery", async () => {
    const result = await getOnboardingDetail("onboarding-id", {
      id: "delivery-id",
      name: "Northstar Delivery",
      email: "delivery@northstar.test",
      role: Role.DELIVERY,
    });

    expect(databaseMocks.findUnique).toHaveBeenCalledTimes(1);
    expect(databaseMocks.findUniqueOrThrow).not.toHaveBeenCalled();

    const query = databaseMocks.findUnique.mock.calls[0]?.[0];
    expect(query.select).not.toHaveProperty("invoiceTotal");
    expect(query.select).not.toHaveProperty("activationRequiredAmount");
    expect(query.select).not.toHaveProperty("currency");
    expect(query.select).not.toHaveProperty("contracts");
    expect(query.select).not.toHaveProperty("invoices");
    expect(result?.commercial).toBeNull();
  });
});

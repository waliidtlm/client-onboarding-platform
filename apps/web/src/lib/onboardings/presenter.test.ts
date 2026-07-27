import { describe, expect, it } from "vitest";

import {
  ActivationRequirementStatus,
  CommercialGateStatus,
  OnboardingStatus,
} from "@/generated/prisma/client";
import { formatMoney, presentStoredStatus } from "@/lib/onboardings/presenter";

describe("onboarding presentation", () => {
  it("describes the stored unsatisfied activation requirement without calculating the gate", () => {
    expect(
      presentStoredStatus({
        status: OnboardingStatus.COMMERCIAL_PENDING,
        commercialGateStatus: CommercialGateStatus.BLOCKED,
        activationRequirementStatus: ActivationRequirementStatus.NOT_SATISFIED,
      }),
    ).toEqual({
      currentBlocker: "Waiting for activation requirement",
      nextAction: "Continue commercial processing",
    });
  });

  it("formats decimal-compatible values without converting to a JavaScript number", () => {
    const amount = { toFixed: () => "2000.00" };
    expect(formatMoney(amount, "USD")).toBe("USD 2000.00");
  });
});

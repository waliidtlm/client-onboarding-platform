import { describe, expect, it } from "vitest";

import { Role } from "@/generated/prisma/client";
import { can, Permission } from "@/lib/auth/authorization";

describe("role authorization", () => {
  it.each(Object.values(Role))("allows %s to view the onboarding list", (role) => {
    expect(can(Permission.ONBOARDING_READ, role)).toBe(true);
  });

  it("blocks Delivery from commercial information", () => {
    expect(can(Permission.COMMERCIAL_READ, Role.DELIVERY)).toBe(false);
  });

  it.each([Role.ADMIN, Role.SALES, Role.OPERATIONS, Role.FINANCE, Role.PROJECT_MANAGER])(
    "allows %s to view commercial information",
    (role) => {
      expect(can(Permission.COMMERCIAL_READ, role)).toBe(true);
    },
  );

  const mutationMatrix = [
    [Permission.SALES_HANDOFF_MUTATE, [Role.ADMIN, Role.SALES]],
    [Permission.DEAL_STATUS_UPDATE, [Role.ADMIN, Role.SALES]],
    [Permission.CONTRACT_UPDATE, [Role.ADMIN, Role.OPERATIONS]],
    [Permission.INVOICE_ISSUE, [Role.ADMIN, Role.FINANCE]],
    [Permission.PAYMENT_RECORD, [Role.ADMIN, Role.FINANCE]],
    [Permission.PAYMENT_REVIEW, [Role.ADMIN, Role.FINANCE]],
    [Permission.MANUAL_ACTIVATION_APPROVE, [Role.ADMIN, Role.FINANCE]],
    [Permission.COMMERCIAL_GATE_RECALCULATE, [Role.ADMIN]],
    [Permission.COMMERCIAL_EXCEPTION_MANAGE, [Role.ADMIN]],
    [Permission.ONBOARDING_CANCEL, [Role.ADMIN, Role.OPERATIONS]],
  ] as const;

  it.each(mutationMatrix)("enforces the role matrix for %s", (permission, allowedRoles) => {
    for (const role of Object.values(Role)) {
      expect(can(permission, role)).toBe(allowedRoles.includes(role as never));
    }
  });
});

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
});

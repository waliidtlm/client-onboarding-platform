import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";

import { authOptions } from "@/auth/options";
import { Role } from "@/generated/prisma/client";
import { prisma } from "@/lib/database";

export enum Permission {
  DASHBOARD_READ = "DASHBOARD_READ",
  ONBOARDING_READ = "ONBOARDING_READ",
  PACKAGE_CONFIGURATION_READ = "PACKAGE_CONFIGURATION_READ",
  COMMERCIAL_READ = "COMMERCIAL_READ",
}

const allRoles = [
  Role.ADMIN,
  Role.SALES,
  Role.OPERATIONS,
  Role.FINANCE,
  Role.PROJECT_MANAGER,
  Role.DELIVERY,
] as const;

const permissionRoles: Record<Permission, readonly Role[]> = {
  [Permission.DASHBOARD_READ]: allRoles,
  [Permission.ONBOARDING_READ]: allRoles,
  [Permission.PACKAGE_CONFIGURATION_READ]: allRoles,
  [Permission.COMMERCIAL_READ]: [
    Role.ADMIN,
    Role.SALES,
    Role.OPERATIONS,
    Role.FINANCE,
    Role.PROJECT_MANAGER,
  ],
};

export type CurrentStaff = Readonly<{
  id: string;
  name: string;
  email: string;
  role: Role;
}>;

export function can(permission: Permission, role: Role): boolean {
  return permissionRoles[permission].includes(role);
}

export async function getCurrentStaff(): Promise<CurrentStaff | null> {
  const session = await getServerSession(authOptions);
  const sessionUserId = session?.user?.id;

  if (!sessionUserId) {
    return null;
  }

  const user = await prisma.user.findUnique({
    where: { id: sessionUserId },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      isActive: true,
    },
  });

  if (!user?.isActive) {
    return null;
  }

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
  };
}

export async function requireAuthenticatedStaff(callbackUrl = "/dashboard"): Promise<CurrentStaff> {
  const staff = await getCurrentStaff();

  if (!staff) {
    redirect(`/signin?callbackUrl=${encodeURIComponent(callbackUrl)}`);
  }

  return staff;
}

export async function requirePermission(
  permission: Permission,
  callbackUrl = "/dashboard",
): Promise<CurrentStaff> {
  const staff = await requireAuthenticatedStaff(callbackUrl);

  if (!can(permission, staff.role)) {
    redirect("/access-denied");
  }

  return staff;
}

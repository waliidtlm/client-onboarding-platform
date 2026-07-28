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
  COMMERCIAL_AUDIT_READ = "COMMERCIAL_AUDIT_READ",
  SALES_HANDOFF_MUTATE = "SALES_HANDOFF_MUTATE",
  DEAL_STATUS_UPDATE = "DEAL_STATUS_UPDATE",
  CONTRACT_UPDATE = "CONTRACT_UPDATE",
  INVOICE_ISSUE = "INVOICE_ISSUE",
  PAYMENT_RECORD = "PAYMENT_RECORD",
  PAYMENT_REVIEW = "PAYMENT_REVIEW",
  MANUAL_ACTIVATION_APPROVE = "MANUAL_ACTIVATION_APPROVE",
  COMMERCIAL_GATE_RECALCULATE = "COMMERCIAL_GATE_RECALCULATE",
  COMMERCIAL_EXCEPTION_MANAGE = "COMMERCIAL_EXCEPTION_MANAGE",
  ONBOARDING_CANCEL = "ONBOARDING_CANCEL",
  AUTOMATION_RECOVERY_READ = "AUTOMATION_RECOVERY_READ",
  AUTOMATION_RETRY = "AUTOMATION_RETRY",
  PROJECT_MANAGER_ASSIGN = "PROJECT_MANAGER_ASSIGN",
  PROVISIONING_READ = "PROVISIONING_READ",
  PROVISIONING_RESOLVE = "PROVISIONING_RESOLVE",
  INTERNAL_READINESS_APPROVE = "INTERNAL_READINESS_APPROVE",
  EMAIL_UNCERTAINTY_RESOLVE = "EMAIL_UNCERTAINTY_RESOLVE",
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
  [Permission.COMMERCIAL_AUDIT_READ]: [
    Role.ADMIN,
    Role.SALES,
    Role.OPERATIONS,
    Role.FINANCE,
    Role.PROJECT_MANAGER,
  ],
  [Permission.SALES_HANDOFF_MUTATE]: [Role.ADMIN, Role.SALES],
  [Permission.DEAL_STATUS_UPDATE]: [Role.ADMIN, Role.SALES],
  [Permission.CONTRACT_UPDATE]: [Role.ADMIN, Role.OPERATIONS],
  [Permission.INVOICE_ISSUE]: [Role.ADMIN, Role.FINANCE],
  [Permission.PAYMENT_RECORD]: [Role.ADMIN, Role.FINANCE],
  [Permission.PAYMENT_REVIEW]: [Role.ADMIN, Role.FINANCE],
  [Permission.MANUAL_ACTIVATION_APPROVE]: [Role.ADMIN, Role.FINANCE],
  [Permission.COMMERCIAL_GATE_RECALCULATE]: [Role.ADMIN],
  [Permission.COMMERCIAL_EXCEPTION_MANAGE]: [Role.ADMIN],
  [Permission.ONBOARDING_CANCEL]: [Role.ADMIN, Role.OPERATIONS],
  [Permission.AUTOMATION_RECOVERY_READ]: [Role.ADMIN],
  [Permission.AUTOMATION_RETRY]: [Role.ADMIN],
  [Permission.PROJECT_MANAGER_ASSIGN]: [Role.ADMIN, Role.OPERATIONS],
  [Permission.PROVISIONING_READ]: [Role.ADMIN, Role.OPERATIONS, Role.PROJECT_MANAGER],
  [Permission.PROVISIONING_RESOLVE]: [Role.ADMIN, Role.PROJECT_MANAGER],
  [Permission.INTERNAL_READINESS_APPROVE]: [Role.ADMIN, Role.PROJECT_MANAGER],
  [Permission.EMAIL_UNCERTAINTY_RESOLVE]: [Role.ADMIN],
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

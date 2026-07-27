import Link from "next/link";
import type { ReactNode } from "react";

import { SignOutControl } from "@/components/sign-out-control";
import { Permission, requirePermission } from "@/lib/auth/authorization";

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const staff = await requirePermission(Permission.DASHBOARD_READ);

  return (
    <div className="dashboard-shell">
      <header className="dashboard-header">
        <div>
          <p className="eyebrow">Northstar Growth Agency</p>
          <Link className="brand" href="/dashboard">
            Client Onboarding
          </Link>
        </div>
        <nav aria-label="Primary navigation">
          <Link href="/dashboard">Dashboard</Link>
          <Link href="/onboardings">Onboardings</Link>
        </nav>
        <div className="staff-summary">
          <span>{staff.name}</span>
          <small>{staff.role.replaceAll("_", " ")}</small>
          <SignOutControl />
        </div>
      </header>
      <main className="dashboard-content">{children}</main>
    </div>
  );
}

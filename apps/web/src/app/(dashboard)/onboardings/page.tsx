import Link from "next/link";

import { Permission, requirePermission } from "@/lib/auth/authorization";
import { listOnboardings } from "@/lib/onboardings/queries";

export default async function OnboardingsPage() {
  const staff = await requirePermission(Permission.ONBOARDING_READ, "/onboardings");
  const onboardings = await listOnboardings();

  return (
    <section>
      <p className="eyebrow">Authoritative records</p>
      <h1>Onboardings</h1>
      {["ADMIN", "SALES"].includes(staff.role) ? (
        <Link className="button-link" href="/onboardings/new">
          New sales handoff
        </Link>
      ) : null}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Client</th>
              <th>Package</th>
              <th>Project Manager</th>
              <th>Onboarding Status</th>
              <th>Commercial Gate</th>
              <th>Current Blocker</th>
              <th>Next Action</th>
              <th>Created Date</th>
            </tr>
          </thead>
          <tbody>
            {onboardings.map((onboarding) => (
              <tr key={onboarding.id}>
                <td>
                  <Link href={`/onboardings/${onboarding.id}`}>{onboarding.client}</Link>
                </td>
                <td>{onboarding.servicePackage}</td>
                <td>{onboarding.projectManager}</td>
                <td>
                  <span className="status">{onboarding.status.replaceAll("_", " ")}</span>
                </td>
                <td>{onboarding.commercialGateStatus}</td>
                <td>{onboarding.currentBlocker}</td>
                <td>{onboarding.nextAction}</td>
                <td>{onboarding.createdAt.slice(0, 10)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

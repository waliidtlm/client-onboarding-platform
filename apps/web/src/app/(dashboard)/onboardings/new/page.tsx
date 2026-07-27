import { randomUUID } from "node:crypto";

import { SalesHandoffForm } from "@/components/commercial/sales-handoff-form";
import { Permission, requirePermission } from "@/lib/auth/authorization";
import { getSalesHandoffFormData } from "@/lib/onboardings/queries";

export default async function NewSalesHandoffPage() {
  await requirePermission(Permission.SALES_HANDOFF_MUTATE, "/onboardings/new");
  const data = await getSalesHandoffFormData();

  return (
    <section>
      <p className="eyebrow">Sales handoff</p>
      <h1>Create an inactive onboarding</h1>
      <p className="lead">
        Record what Sales agreed. Missing information remains editable and cannot pass the
        Commercial Gate.
      </p>
      <article className="detail-card">
        <SalesHandoffForm
          clients={data.clients.map((client) => ({ id: client.id, name: client.companyName }))}
          packages={data.packages}
          submissionKey={randomUUID()}
        />
      </article>
    </section>
  );
}

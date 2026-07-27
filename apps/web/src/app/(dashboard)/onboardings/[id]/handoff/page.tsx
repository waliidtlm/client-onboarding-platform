import { notFound } from "next/navigation";

import { SalesHandoffForm } from "@/components/commercial/sales-handoff-form";
import { Permission, requirePermission } from "@/lib/auth/authorization";
import { getSalesHandoffFormData } from "@/lib/onboardings/queries";

type HandoffCorrectionPageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
};

export default async function HandoffCorrectionPage({
  params,
  searchParams,
}: HandoffCorrectionPageProps) {
  const { id } = await params;
  const { error } = await searchParams;
  await requirePermission(Permission.SALES_HANDOFF_MUTATE, `/onboardings/${id}/handoff`);
  const data = await getSalesHandoffFormData(id);

  if (!data.handoff) notFound();

  return (
    <section>
      <p className="eyebrow">Sales correction</p>
      <h1>Correct the incomplete handoff</h1>
      {error ? <p className="notice notice-error">{error}</p> : null}
      <article className="detail-card">
        <SalesHandoffForm
          clients={data.clients.map((client) => ({ id: client.id, name: client.companyName }))}
          defaults={{
            onboardingId: id,
            expectedVersion: data.handoff.onboarding.version,
            externalDealId: data.handoff.externalDealId,
            clientMode: data.handoff.clientMode,
            existingClientId: data.handoff.existingClientId,
            newClientCompanyName: data.handoff.newClientCompanyName,
            newClientContactName: data.handoff.newClientContactName,
            newClientContactEmail: data.handoff.newClientContactEmail,
            newClientContactPhone: data.handoff.newClientContactPhone,
            servicePackageId: data.handoff.servicePackageId,
            dealStatus: data.handoff.dealStatus,
            agreedTotal: data.handoff.agreedTotal,
            currency: data.handoff.currency,
            salesNotes: data.handoff.salesNotes,
            validationErrors: data.handoff.validationErrors,
          }}
          packages={data.packages}
          submissionKey={data.handoff.submissionKey}
        />
      </article>
    </section>
  );
}

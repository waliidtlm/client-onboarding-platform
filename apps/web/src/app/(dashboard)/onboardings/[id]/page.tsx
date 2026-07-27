import { notFound } from "next/navigation";

import { Permission, requirePermission } from "@/lib/auth/authorization";
import { getOnboardingDetail } from "@/lib/onboardings/queries";

type OnboardingDetailPageProps = {
  params: Promise<{ id: string }>;
};

export default async function OnboardingDetailPage({ params }: OnboardingDetailPageProps) {
  const { id } = await params;
  const staff = await requirePermission(Permission.ONBOARDING_READ, `/onboardings/${id}`);
  const onboarding = await getOnboardingDetail(id, staff);

  if (!onboarding) {
    notFound();
  }

  return (
    <section>
      <p className="eyebrow">Onboarding detail</p>
      <h1>{onboarding.client}</h1>
      <p className="lead">{onboarding.servicePackage}</p>

      <div className="summary-grid">
        <article>
          <span>Status</span>
          <strong>{onboarding.status.replaceAll("_", " ")}</strong>
        </article>
        <article>
          <span>Commercial Gate</span>
          <strong>{onboarding.commercialGateStatus}</strong>
        </article>
        <article>
          <span>Current blocker</span>
          <strong>{onboarding.currentBlocker}</strong>
        </article>
        <article>
          <span>Next action</span>
          <strong>{onboarding.nextAction}</strong>
        </article>
      </div>

      <article className="detail-card">
        <h2>Overview</h2>
        <dl>
          <div>
            <dt>External deal</dt>
            <dd>{onboarding.externalDealId ?? "Not recorded"}</dd>
          </div>
          <div>
            <dt>Deal status</dt>
            <dd>{onboarding.dealStatus}</dd>
          </div>
          <div>
            <dt>Sales handoff</dt>
            <dd>{onboarding.salesHandoffStatus}</dd>
          </div>
          <div>
            <dt>Project Manager</dt>
            <dd>{onboarding.projectManager}</dd>
          </div>
          <div>
            <dt>Contact</dt>
            <dd>
              {onboarding.clientContact.name} · {onboarding.clientContact.email}
            </dd>
          </div>
          <div>
            <dt>Record version</dt>
            <dd>{onboarding.version}</dd>
          </div>
        </dl>
      </article>

      {onboarding.commercial ? (
        <article className="detail-card">
          <h2>Commercial</h2>
          <dl>
            <div>
              <dt>Invoice total</dt>
              <dd>{onboarding.commercial.invoiceTotal}</dd>
            </div>
            <div>
              <dt>Activation required</dt>
              <dd>{onboarding.commercial.activationRequiredAmount}</dd>
            </div>
            <div>
              <dt>Activation requirement</dt>
              <dd>{onboarding.activationRequirementStatus}</dd>
            </div>
            <div>
              <dt>Current contract</dt>
              <dd>
                {onboarding.commercial.currentContract
                  ? `Version ${onboarding.commercial.currentContract.versionNumber} · ${onboarding.commercial.currentContract.status}`
                  : "Not recorded"}
              </dd>
            </div>
          </dl>
          {onboarding.commercial.invoices.map((invoice) => (
            <div className="commercial-record" key={invoice.id}>
              <strong>
                {invoice.invoiceNumber} · {invoice.totalAmount} · {invoice.status}
              </strong>
              {invoice.payments.map((payment) => (
                <p key={payment.id}>
                  Payment {payment.originalAmount}; verified {payment.verifiedAmount ?? "not yet"} ·{" "}
                  {payment.verificationStatus}
                </p>
              ))}
            </div>
          ))}
        </article>
      ) : (
        <article className="detail-card restricted" data-testid="commercial-restricted">
          <h2>Commercial</h2>
          <p>Your role does not permit access to commercial details.</p>
        </article>
      )}

      <article className="detail-card">
        <h2>Package configuration</h2>
        <p>{onboarding.packageConfiguration.description}</p>
        <p>
          Activation policy: {onboarding.packageConfiguration.activationType} ·{" "}
          {onboarding.packageConfiguration.activationValue}
        </p>
        <div className="configuration-grid">
          <div>
            <h3>Future provisioning templates</h3>
            <ol>
              {onboarding.packageConfiguration.provisioningTemplates.map((template) => (
                <li key={template.id}>{template.name}</li>
              ))}
            </ol>
          </div>
          <div>
            <h3>Future client requirements</h3>
            <ol>
              {onboarding.packageConfiguration.requirementTemplates.map((template) => (
                <li key={template.id}>
                  {template.name} {template.isRequired ? "(required)" : "(optional)"}
                </li>
              ))}
            </ol>
          </div>
        </div>
      </article>
    </section>
  );
}

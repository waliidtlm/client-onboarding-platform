import { randomUUID } from "node:crypto";
import Link from "next/link";
import { notFound } from "next/navigation";

import { AuditTimeline } from "@/components/commercial/audit-timeline";
import { CommercialExceptionControls } from "@/components/commercial/commercial-exception-controls";
import { CommercialGatePanel } from "@/components/commercial/commercial-gate-panel";
import { ContractControls } from "@/components/commercial/contract-controls";
import { PaymentControls } from "@/components/commercial/payment-controls";
import { ProjectManagerAssignment } from "@/components/provisioning/project-manager-assignment";
import { ProvisioningPanel } from "@/components/provisioning/provisioning-panel";
import { can, Permission, requirePermission } from "@/lib/auth/authorization";
import { getOnboardingDetail, listActiveProjectManagers } from "@/lib/onboardings/queries";

type OnboardingDetailPageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ success?: string; error?: string }>;
};

export default async function OnboardingDetailPage({
  params,
  searchParams,
}: OnboardingDetailPageProps) {
  const { id } = await params;
  const { success, error } = await searchParams;
  const staff = await requirePermission(Permission.ONBOARDING_READ, `/onboardings/${id}`);
  const [onboarding, projectManagers] = await Promise.all([
    getOnboardingDetail(id, staff),
    can(Permission.PROJECT_MANAGER_ASSIGN, staff.role)
      ? listActiveProjectManagers()
      : Promise.resolve([]),
  ]);

  if (!onboarding) notFound();

  const commercial = onboarding.commercial;
  const activationInvoice =
    commercial?.invoices.find((invoice) => invoice.isActivationInvoice) ?? null;

  return (
    <section>
      <p className="eyebrow">Onboarding detail</p>
      <h1>{onboarding.client}</h1>
      <p className="lead">{onboarding.servicePackage}</p>
      {success ? <p className="notice notice-success">{success}</p> : null}
      {error ? <p className="notice notice-error">{error}</p> : null}

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
            <dd>{onboarding.dealStatus ?? "Not supplied"}</dd>
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
        {can(Permission.PROJECT_MANAGER_ASSIGN, staff.role) &&
        ["READY_FOR_ONBOARDING", "INTERNAL_SETUP", "INTERNAL_REVIEW"].includes(
          onboarding.status,
        ) ? (
          <ProjectManagerAssignment
            onboardingId={id}
            version={onboarding.version}
            currentProjectManagerId={onboarding.projectManagerDetail?.id ?? null}
            projectManagers={projectManagers}
          />
        ) : null}
        {onboarding.salesHandoffStatus === "INCOMPLETE" &&
        can(Permission.SALES_HANDOFF_MUTATE, staff.role) ? (
          <p>
            <Link className="button-link" href={`/onboardings/${id}/handoff`}>
              Correct sales handoff
            </Link>
          </p>
        ) : null}
      </article>

      {commercial ? (
        <>
          <article className="detail-card">
            <h2>Commercial Gate</h2>
            <dl>
              <div>
                <dt>Agreed total</dt>
                <dd>{commercial.invoiceTotal ?? "Awaiting valid handoff"}</dd>
              </div>
              <div>
                <dt>Activation required</dt>
                <dd>{commercial.activationRequiredAmount ?? "Manual or not ready"}</dd>
              </div>
              <div>
                <dt>Activation requirement</dt>
                <dd>{onboarding.activationRequirementStatus}</dd>
              </div>
              <div>
                <dt>Package policy snapshot</dt>
                <dd>
                  {commercial.activationTypeSnapshot ?? "Not captured"}{" "}
                  {commercial.activationValueSnapshot ?? ""}
                </dd>
              </div>
            </dl>
            <CommercialGatePanel
              activationType={commercial.activationTypeSnapshot}
              blockers={onboarding.commercialGateBlockingReasons}
              canApproveManual={can(Permission.MANUAL_ACTIVATION_APPROVE, staff.role)}
              canCancel={can(Permission.ONBOARDING_CANCEL, staff.role)}
              canRecalculate={can(Permission.COMMERCIAL_GATE_RECALCULATE, staff.role)}
              canUpdateDeal={can(Permission.DEAL_STATUS_UPDATE, staff.role)}
              dealStatus={onboarding.dealStatus}
              gateStatus={onboarding.commercialGateStatus}
              manualApprovalActive={commercial.manualApprovalActive}
              onboardingId={id}
              onboardingStatus={onboarding.status}
              version={onboarding.version}
            />
          </article>

          <article className="detail-card">
            <h2>Contract</h2>
            {commercial.contracts.map((contract) => (
              <p key={contract.id}>
                Version {contract.versionNumber} · {contract.status}
                {contract.signedAt ? ` · signed ${contract.signedAt.slice(0, 10)}` : ""}
              </p>
            ))}
            {commercial.currentContract && can(Permission.CONTRACT_UPDATE, staff.role) ? (
              <ContractControls
                currentStatus={commercial.currentContract.status}
                onboardingId={id}
                version={onboarding.version}
              />
            ) : null}
          </article>

          <article className="detail-card">
            <h2>Invoice and payments</h2>
            <PaymentControls
              canIssue={can(Permission.INVOICE_ISSUE, staff.role)}
              canRecord={can(Permission.PAYMENT_RECORD, staff.role)}
              canReview={can(Permission.PAYMENT_REVIEW, staff.role)}
              currency={commercial.currency ?? "USD"}
              invoice={activationInvoice}
              onboardingId={id}
              recordingKey={randomUUID()}
              version={onboarding.version}
            />
          </article>

          {can(Permission.COMMERCIAL_EXCEPTION_MANAGE, staff.role) ? (
            <article className="detail-card">
              <h2>Commercial exceptions</h2>
              <CommercialExceptionControls
                exceptions={commercial.exceptions}
                onboardingId={id}
                version={onboarding.version}
              />
            </article>
          ) : null}

          <article className="detail-card">
            <h2>Phase 2 audit timeline</h2>
            <AuditTimeline events={commercial.auditEvents} />
          </article>
        </>
      ) : (
        <article className="detail-card restricted" data-testid="commercial-restricted">
          <h2>Commercial</h2>
          <p>Your role does not permit access to commercial details.</p>
        </article>
      )}

      {onboarding.provisioning ? (
        <>
          <ProvisioningPanel
            onboardingId={id}
            onboardingStatus={onboarding.status}
            onboardingVersion={onboarding.version}
            tasks={onboarding.provisioning.tasks}
            readiness={onboarding.provisioning.readiness}
            canResolve={
              can(Permission.PROVISIONING_RESOLVE, staff.role) &&
              (staff.role !== "PROJECT_MANAGER" || onboarding.projectManagerDetail?.id === staff.id)
            }
            canApprove={
              can(Permission.INTERNAL_READINESS_APPROVE, staff.role) &&
              (staff.role !== "PROJECT_MANAGER" || onboarding.projectManagerDetail?.id === staff.id)
            }
            canResolveEmail={can(Permission.EMAIL_UNCERTAINTY_RESOLVE, staff.role)}
            internalReadinessApprovedAt={onboarding.provisioning.internalReadinessApprovedAt}
            welcomeEmail={onboarding.provisioning.welcomeEmail}
          />
          <article className="detail-card">
            <h2>Phase 4 audit timeline</h2>
            <AuditTimeline events={onboarding.provisioning.auditEvents} />
          </article>
        </>
      ) : ["READY_FOR_ONBOARDING", "INTERNAL_SETUP", "INTERNAL_REVIEW"].includes(
          onboarding.status,
        ) ? (
        <article className="detail-card restricted" data-testid="provisioning-restricted">
          <h2>Provisioning</h2>
          <p>Your role or assignment does not permit access to provisioning details.</p>
        </article>
      ) : null}

      <article className="detail-card">
        <h2>Package configuration</h2>
        <p>{onboarding.packageConfiguration.description}</p>
        <p>
          Activation policy: {onboarding.packageConfiguration.activationType ?? "Not selected"} ·{" "}
          {onboarding.packageConfiguration.activationValue ?? "Not selected"}
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

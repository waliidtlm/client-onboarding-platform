import { randomUUID } from "node:crypto";

import {
  beginRequirementReviewAction,
  decideRequirementAction,
  manageClientAccessAction,
  resolveClientAccessEmailAction,
  revokeClientAccessAction,
} from "@/app/(dashboard)/onboardings/actions";
import { AuditTimeline } from "@/components/commercial/audit-timeline";

type StaffSubmission = {
  submissionVersion: number;
  submittedAt: string;
  textValue: string | null;
  urlValue: string | null;
  reviewReason: string | null;
  fileCount: number;
  files: readonly {
    id: string;
    originalFilename: string;
    sizeBytes: string;
  }[];
};

type Phase5Detail = {
  requirementsGeneratedAt: string | null;
  clientAccessDeliveredAt: string | null;
  requirementsCompletedAt: string | null;
  contentVisible: boolean;
  requirements: readonly {
    id: string;
    name: string;
    description: string;
    inputType: string;
    isRequired: boolean;
    dueAt: string | null;
    status: string;
    version: number;
    currentSubmissionVersion: number;
    latestSubmission: StaffSubmission | null;
    previousSubmissions: readonly StaffSubmission[];
  }[];
  tokens: readonly {
    id: string;
    issueSequence: number;
    expiresAt: string;
    revokedAt: string | null;
    revocationReason: string | null;
    notification: {
      id: string;
      status: string;
      recipient: string;
      attemptCount: number;
      providerReference: string | null;
      failureReason: string | null;
    } | null;
  }[];
  auditEvents: readonly {
    id: string;
    actorType: string;
    actorName: string;
    action: string;
    entityType: string;
    createdAt: string;
  }[];
};

export function StaffRequirementsPanel({
  onboardingId,
  onboardingStatus,
  onboardingVersion,
  detail,
  canManage,
  canReview,
  canResolveEmail,
}: {
  onboardingId: string;
  onboardingStatus: string;
  onboardingVersion: number;
  detail: Phase5Detail;
  canManage: boolean;
  canReview: boolean;
  canResolveEmail: boolean;
}) {
  const activeToken = detail.tokens.find((token) => !token.revokedAt);
  return (
    <>
      <article className="detail-card">
        <h2>Secure client access</h2>
        <dl>
          <div>
            <dt>Requirements frozen</dt>
            <dd>{detail.requirementsGeneratedAt ?? "Not generated"}</dd>
          </div>
          <div>
            <dt>Access delivered</dt>
            <dd>{detail.clientAccessDeliveredAt ?? "Not confirmed"}</dd>
          </div>
          <div>
            <dt>Required items complete</dt>
            <dd>{detail.requirementsCompletedAt ?? "Not complete"}</dd>
          </div>
        </dl>
        {canManage && onboardingStatus === "CLIENT_AWAITING_ACTION" ? (
          <div className="manual-resolution-grid">
            <form action={manageClientAccessAction} className="inline-form">
              <input name="onboardingId" type="hidden" value={onboardingId} />
              <input name="expectedVersion" type="hidden" value={onboardingVersion} />
              <input name="issuanceKey" type="hidden" value={randomUUID()} />
              <input name="operation" type="hidden" value={activeToken ? "REISSUE" : "ISSUE"} />
              <p>
                {activeToken
                  ? "Reissue immediately revokes the current link."
                  : "Issuing freezes requirements and queues the access email."}
              </p>
              <button type="submit">
                {activeToken ? "Reissue secure access" : "Issue secure access"}
              </button>
            </form>
            {activeToken ? (
              <form action={revokeClientAccessAction} className="inline-form">
                <input name="onboardingId" type="hidden" value={onboardingId} />
                <input name="expectedVersion" type="hidden" value={onboardingVersion} />
                <label>
                  Revocation reason
                  <textarea minLength={10} name="reason" required />
                </label>
                <button className="button-danger" type="submit">
                  Revoke access
                </button>
              </form>
            ) : null}
          </div>
        ) : null}
        {detail.tokens.map((token) => (
          <div className="notice" key={token.id}>
            <p>
              Link #{token.issueSequence}: {token.revokedAt ? "revoked" : "active"} · expires{" "}
              {token.expiresAt}
            </p>
            {token.notification ? (
              <p>
                Email: {token.notification.status.replaceAll("_", " ")} · recipient{" "}
                {token.notification.recipient} · attempts {token.notification.attemptCount}
              </p>
            ) : null}
            {token.revocationReason ? <p>{token.revocationReason}</p> : null}
            {token.notification?.failureReason ? <p>{token.notification.failureReason}</p> : null}
            {canResolveEmail && token.notification?.status === "DELIVERY_UNCERTAIN" ? (
              <div className="manual-resolution-grid">
                {["CONFIRM_SENT", "AUTHORIZE_RESEND"].map((action) => (
                  <form
                    action={resolveClientAccessEmailAction}
                    className="inline-form"
                    key={action}
                  >
                    <input name="onboardingId" type="hidden" value={onboardingId} />
                    <input name="notificationId" type="hidden" value={token.notification!.id} />
                    <input name="resolutionAction" type="hidden" value={action} />
                    {action === "CONFIRM_SENT" ? (
                      <label>
                        Provider reference (optional)
                        <input name="providerReference" />
                      </label>
                    ) : null}
                    <label>
                      Decision reason
                      <textarea minLength={10} name="reason" required />
                    </label>
                    <button type="submit">
                      {action === "CONFIRM_SENT" ? "Confirm sent" : "Authorize one resend"}
                    </button>
                  </form>
                ))}
              </div>
            ) : null}
          </div>
        ))}
      </article>

      <article className="detail-card">
        <h2>Client requirements</h2>
        {!detail.contentVisible ? (
          <p className="notice">
            Operations visibility is metadata-only. Submission text, links, filenames, and file
            contents are restricted.
          </p>
        ) : null}
        <ol className="provisioning-list">
          {detail.requirements.map((requirement) => (
            <li
              className={`provisioning-task status-${requirement.status.toLowerCase()}`}
              key={requirement.id}
            >
              <p className="task-sequence">
                {requirement.isRequired ? "Required" : "Optional"} · {requirement.inputType}
                {requirement.dueAt ? ` · due ${requirement.dueAt}` : ""}
              </p>
              <h3>{requirement.name}</h3>
              <p>{requirement.description}</p>
              <p>
                Status: <strong>{requirement.status.replaceAll("_", " ")}</strong> · submissions{" "}
                {requirement.currentSubmissionVersion}
              </p>
              {requirement.latestSubmission ? (
                <div className="client-submission">
                  <p>Submitted {requirement.latestSubmission.submittedAt}</p>
                  {requirement.latestSubmission.textValue ? (
                    <p>{requirement.latestSubmission.textValue}</p>
                  ) : null}
                  {requirement.latestSubmission.urlValue ? (
                    <p>
                      <a
                        href={requirement.latestSubmission.urlValue}
                        rel="noopener noreferrer"
                        target="_blank"
                      >
                        Open submitted link
                      </a>
                    </p>
                  ) : null}
                  {requirement.latestSubmission.files.map((file) => (
                    <p key={file.id}>
                      <a href={`/api/staff/files/${file.id}`}>Download {file.originalFilename}</a>
                    </p>
                  ))}
                  {requirement.latestSubmission.reviewReason ? (
                    <p>Review reason: {requirement.latestSubmission.reviewReason}</p>
                  ) : null}
                </div>
              ) : null}
              {detail.contentVisible && requirement.previousSubmissions.length > 0 ? (
                <details>
                  <summary>Previous submissions ({requirement.previousSubmissions.length})</summary>
                  {requirement.previousSubmissions.map((submission) => (
                    <div className="client-submission" key={submission.submissionVersion}>
                      <p>
                        Version {submission.submissionVersion} · submitted {submission.submittedAt}
                      </p>
                      {submission.textValue ? <p>{submission.textValue}</p> : null}
                      {submission.urlValue ? (
                        <p>
                          <a href={submission.urlValue} rel="noopener noreferrer" target="_blank">
                            Open submitted link
                          </a>
                        </p>
                      ) : null}
                      {submission.files.map((file) => (
                        <p key={file.id}>
                          <a href={`/api/staff/files/${file.id}`}>
                            Download {file.originalFilename}
                          </a>
                        </p>
                      ))}
                      {submission.reviewReason ? (
                        <p>Review reason: {submission.reviewReason}</p>
                      ) : null}
                    </div>
                  ))}
                </details>
              ) : null}
              {canReview && requirement.status === "SUBMITTED" && requirement.latestSubmission ? (
                <form action={beginRequirementReviewAction}>
                  <input name="onboardingId" type="hidden" value={onboardingId} />
                  <input name="requirementId" type="hidden" value={requirement.id} />
                  <input
                    name="expectedRequirementVersion"
                    type="hidden"
                    value={requirement.version}
                  />
                  <input
                    name="expectedSubmissionVersion"
                    type="hidden"
                    value={requirement.latestSubmission.submissionVersion}
                  />
                  <button type="submit">Begin review</button>
                </form>
              ) : null}
              {canReview &&
              requirement.status === "UNDER_REVIEW" &&
              requirement.latestSubmission ? (
                <div className="manual-resolution-grid">
                  <form action={decideRequirementAction}>
                    <input name="onboardingId" type="hidden" value={onboardingId} />
                    <input name="requirementId" type="hidden" value={requirement.id} />
                    <input
                      name="expectedRequirementVersion"
                      type="hidden"
                      value={requirement.version}
                    />
                    <input
                      name="expectedSubmissionVersion"
                      type="hidden"
                      value={requirement.latestSubmission.submissionVersion}
                    />
                    <input name="decision" type="hidden" value="APPROVE" />
                    <button type="submit">Approve</button>
                  </form>
                  <form action={decideRequirementAction} className="inline-form">
                    <input name="onboardingId" type="hidden" value={onboardingId} />
                    <input name="requirementId" type="hidden" value={requirement.id} />
                    <input
                      name="expectedRequirementVersion"
                      type="hidden"
                      value={requirement.version}
                    />
                    <input
                      name="expectedSubmissionVersion"
                      type="hidden"
                      value={requirement.latestSubmission.submissionVersion}
                    />
                    <input name="decision" type="hidden" value="REJECT" />
                    <label>
                      Revision reason
                      <textarea minLength={10} name="reason" required />
                    </label>
                    <button className="button-danger" type="submit">
                      Request revision
                    </button>
                  </form>
                </div>
              ) : null}
            </li>
          ))}
        </ol>
      </article>

      <article className="detail-card">
        <h2>Phase 5 audit timeline</h2>
        <AuditTimeline events={detail.auditEvents} />
      </article>
    </>
  );
}

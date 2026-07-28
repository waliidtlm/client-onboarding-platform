import {
  acceptProvisioningTaskAction,
  approveInternalReadinessAction,
  resolveWelcomeUncertaintyAction,
  retryProvisioningTaskAction,
} from "@/app/(dashboard)/onboardings/actions";

type Task = Readonly<{
  id: string;
  name: string;
  description: string;
  sequence: number;
  isRequired: boolean;
  status: string;
  attemptCount: number;
  maxAttempts: number;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  externalReference: string | null;
  version: number;
  manualAcceptanceReason: string | null;
  manuallyAcceptedBy: { name: string } | null;
}>;

const statusLabels: Record<string, string> = {
  COMPLETED: "Completed automatically",
  PENDING: "Waiting",
  IN_PROGRESS: "Running",
  MANUAL_REVIEW_REQUIRED: "Needs manual review",
  MANUALLY_ACCEPTED: "Accepted manually",
  FAILED: "Waiting for authorized retry",
};

export function ProvisioningPanel({
  onboardingId,
  onboardingStatus,
  onboardingVersion,
  tasks,
  readiness,
  canResolve,
  canApprove,
  internalReadinessApprovedAt,
  welcomeEmail,
  canResolveEmail,
}: Readonly<{
  onboardingId: string;
  onboardingStatus: string;
  onboardingVersion: number;
  tasks: readonly Task[];
  readiness: Readonly<{
    ready: boolean;
    requiredTaskCount: number;
    blockers: readonly Readonly<{ taskId: string | null; reason: string }>[];
    optionalWarnings: readonly Readonly<{ taskId: string; status: string }>[];
  }>;
  canResolve: boolean;
  canApprove: boolean;
  internalReadinessApprovedAt: string | null;
  welcomeEmail: Readonly<{
    id: string;
    status: string;
    recipient: string;
    attemptCount: number;
    providerReference: string | null;
    failureReason: string | null;
  }> | null;
  canResolveEmail: boolean;
}>) {
  return (
    <>
      <article className="detail-card">
        <h2>Provisioning</h2>
        <p>
          Provider: <strong>Local sandbox resource</strong>. These references do not represent
          Google Drive, ClickUp, Slack, CRM, or other real external systems.
        </p>
        {tasks.length === 0 ? (
          <p>Provisioning task snapshots have not been generated.</p>
        ) : (
          <ol className="provisioning-list">
            {tasks.map((task, index) => {
              const blocked =
                task.status === "PENDING" &&
                tasks
                  .slice(0, index)
                  .some(
                    (earlier) =>
                      !["COMPLETED", "MANUALLY_ACCEPTED"].includes(earlier.status) &&
                      !(!earlier.isRequired && earlier.status === "MANUAL_REVIEW_REQUIRED"),
                  );
              return (
                <li
                  key={task.id}
                  className={`provisioning-task status-${task.status.toLowerCase()}`}
                >
                  <div>
                    <span className="task-sequence">Task {task.sequence}</span>
                    <h3>{task.name}</h3>
                    <p>{task.description}</p>
                  </div>
                  <dl>
                    <div>
                      <dt>Status</dt>
                      <dd>{blocked ? "Blocked by earlier task" : statusLabels[task.status]}</dd>
                    </div>
                    <div>
                      <dt>Attempts</dt>
                      <dd>
                        {task.attemptCount} / {task.maxAttempts}
                      </dd>
                    </div>
                    <div>
                      <dt>Requirement</dt>
                      <dd>{task.isRequired ? "Required" : "Optional"}</dd>
                    </div>
                    <div>
                      <dt>External reference</dt>
                      <dd>{task.externalReference ?? "Not created"}</dd>
                    </div>
                  </dl>
                  {task.lastErrorCode ? (
                    <p className="notice notice-error">
                      {task.lastErrorCode}: {task.lastErrorMessage}
                    </p>
                  ) : null}
                  {task.manualAcceptanceReason ? (
                    <p>
                      Accepted by {task.manuallyAcceptedBy?.name ?? "authorized staff"}:{" "}
                      {task.manualAcceptanceReason}
                    </p>
                  ) : null}
                  {canResolve && task.status === "MANUAL_REVIEW_REQUIRED" ? (
                    <div className="manual-resolution-grid">
                      <form action={retryProvisioningTaskAction} className="inline-form">
                        <input type="hidden" name="onboardingId" value={onboardingId} />
                        <input type="hidden" name="taskId" value={task.id} />
                        <input type="hidden" name="expectedTaskVersion" value={task.version} />
                        <label>
                          Retry reason
                          <textarea name="reason" required maxLength={2000} />
                        </label>
                        <button type="submit">Authorize one retry</button>
                      </form>
                      <form action={acceptProvisioningTaskAction} className="inline-form">
                        <input type="hidden" name="onboardingId" value={onboardingId} />
                        <input type="hidden" name="taskId" value={task.id} />
                        <input type="hidden" name="expectedTaskVersion" value={task.version} />
                        <label>
                          Manual acceptance reason
                          <textarea name="reason" required maxLength={2000} />
                        </label>
                        <button type="submit">Accept manually</button>
                      </form>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ol>
        )}
      </article>

      <article className="detail-card">
        <h2>Internal readiness</h2>
        <p>
          Required tasks: {readiness.requiredTaskCount}. Readiness:{" "}
          <strong>{readiness.ready ? "Ready for PM control" : "Blocked"}</strong>.
        </p>
        {readiness.blockers.length ? (
          <ul>
            {readiness.blockers.map((blocker) => (
              <li key={`${blocker.taskId}-${blocker.reason}`}>
                {blocker.reason.replaceAll("_", " ")}
              </li>
            ))}
          </ul>
        ) : null}
        {readiness.optionalWarnings.length ? (
          <p className="notice">
            Optional provisioning exceptions remain visible and do not block required readiness.
          </p>
        ) : null}
        {internalReadinessApprovedAt ? (
          <p>Approved at {internalReadinessApprovedAt.replace("T", " ").slice(0, 19)} UTC.</p>
        ) : canApprove && onboardingStatus === "INTERNAL_REVIEW" && readiness.ready ? (
          <form action={approveInternalReadinessAction} className="inline-form">
            <input type="hidden" name="onboardingId" value={onboardingId} />
            <input type="hidden" name="expectedVersion" value={onboardingVersion} />
            <label>
              Optional PM note
              <textarea name="note" maxLength={2000} />
            </label>
            <button type="submit">Approve internal readiness</button>
          </form>
        ) : (
          <p>PM approval becomes available only after required provisioning is ready.</p>
        )}
      </article>

      <article className="detail-card">
        <h2>Welcome email</h2>
        {welcomeEmail ? (
          <>
            <p>
              Status: <strong>{welcomeEmail.status.replaceAll("_", " ")}</strong> · Recipient:{" "}
              {welcomeEmail.recipient} · Attempts: {welcomeEmail.attemptCount}
            </p>
            <p>Provider reference: {welcomeEmail.providerReference ?? "Not recorded"}</p>
            {welcomeEmail.failureReason ? <p>{welcomeEmail.failureReason}</p> : null}
            {canResolveEmail && welcomeEmail.status === "DELIVERY_UNCERTAIN" ? (
              <div className="manual-resolution-grid">
                {["CONFIRM_SENT", "AUTHORIZE_RESEND"].map((action) => (
                  <form
                    key={action}
                    action={resolveWelcomeUncertaintyAction}
                    className="inline-form"
                  >
                    <input type="hidden" name="onboardingId" value={onboardingId} />
                    <input type="hidden" name="notificationId" value={welcomeEmail.id} />
                    <input type="hidden" name="resolutionAction" value={action} />
                    {action === "CONFIRM_SENT" ? (
                      <label>
                        Provider/Mailpit reference
                        <input name="providerReference" maxLength={500} />
                      </label>
                    ) : null}
                    <label>
                      Required resolution reason
                      <textarea name="reason" required minLength={10} maxLength={2000} />
                    </label>
                    <button type="submit">
                      {action === "CONFIRM_SENT" ? "Confirm sent" : "Authorize one resend"}
                    </button>
                  </form>
                ))}
              </div>
            ) : null}
          </>
        ) : (
          <p>No welcome email has been requested.</p>
        )}
      </article>
    </>
  );
}

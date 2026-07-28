import { retryAutomationEventAction } from "@/app/(dashboard)/automation-events/actions";
import { Permission, requirePermission } from "@/lib/auth/authorization";
import { listAutomationEventsForRecovery } from "@/lib/automation/queries";

export default async function AutomationEventsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; success?: string }>;
}) {
  await requirePermission(Permission.AUTOMATION_RECOVERY_READ, "/automation-events");
  const [events, query] = await Promise.all([listAutomationEventsForRecovery(), searchParams]);
  return (
    <section>
      <p className="eyebrow">Admin recovery</p>
      <h1>Automation events</h1>
      <p className="lead">
        Review failed automation attempts without changing the onboarding business record.
      </p>
      {query.success ? <p className="notice notice-success">{query.success}</p> : null}
      {query.error ? <p className="notice notice-error">{query.error}</p> : null}
      {events.length === 0 ? <p>No automation events have been recorded.</p> : null}
      {events.map((event) => (
        <article
          className="detail-card"
          data-testid={`automation-event-${event.id}`}
          key={event.id}
        >
          <h2>{event.eventType.replaceAll("_", " ")}</h2>
          <dl>
            <div>
              <dt>Client</dt>
              <dd>{event.clientCompanyName}</dd>
            </div>
            <div>
              <dt>Status</dt>
              <dd>{event.status}</dd>
            </div>
            <div>
              <dt>Attempts</dt>
              <dd>
                {event.attemptCount} / {event.maxAttempts}
              </dd>
            </div>
            <div>
              <dt>Last error</dt>
              <dd>{event.lastErrorCode ?? "None"}</dd>
            </div>
          </dl>
          {event.lastError ? <p>{event.lastError}</p> : null}
          <h3>Attempt history</h3>
          {event.runs.length === 0 ? (
            <p>No attempts yet.</p>
          ) : (
            <ol className="audit-timeline">
              {event.runs.map((run) => (
                <li key={run.id}>
                  Attempt {run.attemptNumber}: {run.status}
                  <span>Worker: {run.workerId}</span>
                  <span>n8n execution: {run.n8nExecutionId ?? "Not reported"}</span>
                  {run.errorCode ? (
                    <span>
                      {run.errorCode}: {run.errorMessage}
                    </span>
                  ) : null}
                </li>
              ))}
            </ol>
          )}
          {event.canRetry ? (
            <form action={retryAutomationEventAction} className="inline-form">
              <input name="eventId" type="hidden" value={event.id} />
              <label>
                Reviewed recovery reason
                <input minLength={10} name="reason" required />
              </label>
              <button type="submit">Request automation retry</button>
            </form>
          ) : null}
        </article>
      ))}
    </section>
  );
}

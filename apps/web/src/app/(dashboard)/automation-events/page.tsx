import { retryAutomationEventAction } from "@/app/(dashboard)/automation-events/actions";
import Link from "next/link";
import { Permission, requirePermission } from "@/lib/auth/authorization";
import { listAutomationEventsForRecovery } from "@/lib/automation/queries";

export default async function AutomationEventsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; success?: string; status?: string }>;
}) {
  await requirePermission(Permission.AUTOMATION_RECOVERY_READ, "/automation-events");
  const query = await searchParams;
  const recovery = await listAutomationEventsForRecovery(query.status);
  const events = recovery.events;
  return (
    <section>
      <p className="eyebrow">Admin recovery</p>
      <h1>Automation events</h1>
      <p className="lead">
        Review failed automation attempts without changing the onboarding business record.
      </p>
      {query.success ? <p className="notice notice-success">{query.success}</p> : null}
      {query.error ? <p className="notice notice-error">{query.error}</p> : null}
      <form action="/automation-events" className="inline-form" method="get">
        <label>
          Status
          <select defaultValue={recovery.selectedStatus} name="status">
            <option value="ACTION_REQUIRED">Failed and dead-letter</option>
            <option value="FAILED">Failed</option>
            <option value="DEAD_LETTER">Dead-letter</option>
            <option value="PENDING">Pending</option>
            <option value="PROCESSING">Processing</option>
            <option value="COMPLETED">Completed</option>
            <option value="ALL">All statuses</option>
          </select>
        </label>
        <button type="submit">Apply filter</button>
      </form>
      {events.length === 0 ? <p>No automation events match this filter.</p> : null}
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
              <dd>
                <Link href={`/onboardings/${event.onboardingId}`}>{event.clientCompanyName}</Link>
              </dd>
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
            <div>
              <dt>Last failure</dt>
              <dd>
                {event.lastFailureAt
                  ? `${event.lastFailureAt.replace("T", " ").slice(0, 19)} UTC`
                  : "Not recorded"}
              </dd>
            </div>
          </dl>
          <p>
            <strong>Safe failure summary:</strong> {event.safeFailureSummary}
          </p>
          <p>
            <strong>Recommended action:</strong> {event.recommendedAction}
          </p>
          {event.recoveryHref === "ONBOARDING" ? (
            <p>
              <Link href={`/onboardings/${event.onboardingId}`}>Open onboarding recovery</Link>
            </p>
          ) : null}
          <h3>Attempt history</h3>
          {event.runs.length === 0 ? (
            <p>No attempts yet.</p>
          ) : (
            <ol className="audit-timeline">
              {event.runs.map((run) => (
                <li key={run.id}>
                  Attempt {run.attemptNumber}: {run.status}
                  {run.errorCode ? <span>{run.errorCode}</span> : null}
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

export function AuditTimeline({
  events,
}: Readonly<{
  events: readonly Readonly<{
    id: string;
    actorType: string;
    actorName: string;
    action: string;
    entityType: string;
    createdAt: string;
  }>[];
}>) {
  return events.length ? (
    <ol className="audit-timeline">
      {events.map((event) => (
        <li key={event.id}>
          <strong>{event.action.replaceAll("_", " ")}</strong>
          <span>
            {event.actorName} · {event.actorType} · {event.entityType}
          </span>
          <time dateTime={event.createdAt}>
            {event.createdAt.replace("T", " ").slice(0, 19)} UTC
          </time>
        </li>
      ))}
    </ol>
  ) : (
    <p>No Phase 2 audit events have been recorded.</p>
  );
}

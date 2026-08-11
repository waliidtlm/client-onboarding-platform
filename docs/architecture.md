# Architecture and data model

## Runtime boundary

```mermaid
flowchart LR
  Staff["Agency staff"] --> Web["Next.js application"]
  Client["Client portal"] --> Web
  Web --> AppDB[("Application PostgreSQL")]
  Web --> Storage["Private object storage"]
  Web --> SMTP["SMTP delivery"]
  Scheduler["n8n scheduler and workers"] -->|"signed narrow APIs"| Web
  Scheduler --> N8nDB[("Separate n8n PostgreSQL")]
  Web -->|"outbox events"| AppDB
```

The application owns state transitions, reminder policy, recipient selection, idempotency, and
delivery eligibility. n8n schedules evaluation, claims durable events, and calls narrow
application endpoints. It has no application-database credentials.

## Core entities

```mermaid
erDiagram
  CLIENT ||--o{ ONBOARDING : has
  SERVICE_PACKAGE ||--o{ ONBOARDING : configures
  USER ||--o{ ONBOARDING : manages
  ONBOARDING ||--o{ CLIENT_REQUIREMENT : requires
  CLIENT_REQUIREMENT ||--o{ REQUIREMENT_SUBMISSION : versions
  ONBOARDING ||--o{ PROVISIONING_TASK : provisions
  ONBOARDING ||--o| KICKOFF : schedules
  ONBOARDING ||--o| DELIVERY_HANDOFF : transfers
  ONBOARDING ||--o{ NOTIFICATION_LOG : freezes
  ONBOARDING ||--o{ AUTOMATION_EVENT : emits
  AUTOMATION_EVENT ||--o{ AUTOMATION_RUN : attempts
  ONBOARDING ||--o{ AUDIT_EVENT : records
```

Sensitive client tokens are stored as hashes plus reconstruction components. Audit presentation
selects safe fields; it does not expose stored before/after JSON to Delivery users.

## Phase 7 reminder loop

```mermaid
sequenceDiagram
  participant Timer as n8n 15-minute trigger
  participant App as Application API
  participant DB as Application PostgreSQL
  participant Mail as SMTP
  Timer->>App: Evaluate reminders
  App->>DB: Lock, evaluate policy, create deterministic notifications and events
  Timer->>App: Claim REMINDER_NOTIFICATION_REQUESTED
  App->>DB: Lease one event
  Timer->>App: Deliver by IDs only
  App->>DB: Recheck stop condition
  App->>Mail: Send frozen message
  App->>DB: Record result and audit event
```

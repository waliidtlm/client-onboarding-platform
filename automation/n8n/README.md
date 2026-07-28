# Phase 4 n8n workflows

The three committed exports are deliberately inactive:

- `phase3-onboarding-activation-consumer.json` is retained for execution-history evidence. Do not
  delete it during Phase 4 verification.
- `phase3-automation-error-handler.json` is a fallback reporter when a failed execution carries
  reliable run identifiers.
- `phase4-internal-onboarding-and-provisioning.json` claims and processes at most one of the three
  approved event types: `ONBOARDING_ACTIVATED`, `PROVISIONING_TASK_REQUESTED`, or
  `WELCOME_EMAIL_REQUESTED`.

The application remains authoritative. The Phase 4 consumer follows typed instructions and calls
run-bound application APIs. It does not connect to the application database or decide task
sequence, readiness, retry classification, authorization, optional-task policy, or state
transitions. Each task uses one durable event; event retries reuse that event.

## Security model

Every request uses both a bearer token and a timestamped HMAC-SHA256 signature. Claim request IDs,
run idempotency keys, and event IDs are replay controls or identifiers; none authenticates a
caller.

The pinned n8n `2.32.5` Code node blocks environment access and built-in modules by default, and
its task-runner sandbox does not expose `fetch`. The Compose service explicitly permits
environment access plus only the Node `crypto`, `http`, and `https` built-ins so each workflow can
sign and send a request without placing credentials in workflow JSON or node output. Keep the n8n
editor private, use a trusted owner account, and provide the container only:

- its own isolated n8n database credentials and encryption key;
- `AUTOMATION_API_BASE_URL`;
- `AUTOMATION_SERVICE_TOKEN`;
- `AUTOMATION_HMAC_SECRET`;
- `AUTOMATION_WORKER_ID`.

Do not add application database credentials to n8n. Rotate the token and HMAC secret together if
workflow history, logs, or editor access may have exposed them.

## Validate and import

Validate the export contract:

```powershell
pnpm.cmd n8n:validate
```

Import the shared handler first, then the Phase 4 consumer:

```powershell
docker compose --env-file .env exec n8n n8n import:workflow --input=/workflows/phase3-automation-error-handler.json
docker compose --env-file .env exec n8n n8n import:workflow --input=/workflows/phase4-internal-onboarding-and-provisioning.json
```

In the local n8n editor, create an SMTP credential that targets `mailpit:1025`, with TLS disabled
and no host port. Attach it to **Send Frozen Welcome Email**. This credential is local operational
state: never add it to workflow JSON, `.env.example`, source, logs, or execution output.

Before activation:

1. Confirm the Phase 4 consumer still points to `Phase 3 Automation Error Handler`.
2. Deactivate the imported **Phase 3 Onboarding Activation Consumer**. Do not delete it; deletion
   can remove workflow-linked execution history.
3. Confirm the shared error handler is active.
4. Query or inspect all workflows and prove that no other active workflow contains a Schedule
   Trigger that polls `/api/internal/automation/claim`.
5. Activate only **Internal Onboarding and Provisioning**.

The evidence gate is exactly one active polling consumer. An inactive retained Phase 3 export and
its execution history are expected.

## Operational behavior

- Poll interval: one minute while active.
- Lease: application-configured, five minutes by default.
- Network timeout: 30 seconds, safely below the lease.
- Work unit: one event per execution and one provider task per task event.
- Claim receipts: retained for 24 hours and cleaned in bounded batches during authenticated
  claims.
- Event delivery retries and provider attempts are separate counters. A failure before task start
  consumes only an event attempt.
- Provider retry backoff: application-controlled; the same task event and stable task
  idempotency key are reused.
- Email send ambiguity: once delivery begins, an SMTP-node error or lease expiry becomes
  `DELIVERY_UNCERTAIN`; it is never automatically resent.
- Known failures: reported directly by the consumer.
- Unexpected failure fallback: reports only when the consumer emitted signed-run identifiers;
  otherwise it records a safe skipped outcome and does not guess.

Use the Admin **Automation recovery** page for `FAILED` and `DEAD_LETTER` events. A manual retry
does not override integrity or eligibility checks and authorizes exactly one additional event
attempt. Provisioning manual review and uncertain welcome delivery use their dedicated Phase 4
controls.

Workflow outputs contain only operational identifiers and outcomes. They never contain the
service token, HMAC secret, authorization header, signature, or raw upstream error.

Mailpit exposes only its inbox UI/API at `http://127.0.0.1:8025`. Verify the happy-path message
recipient, subject, body, exact count, and absence of any access link or token through that local
inbox.

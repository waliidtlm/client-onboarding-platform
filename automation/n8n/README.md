# Phase 3 n8n workflows

The two committed exports are deliberately inactive:

- `phase3-onboarding-activation-consumer.json` claims and processes at most one activation event.
- `phase3-automation-error-handler.json` is a fallback reporter when a failed execution carries
  reliable run identifiers.

The application remains authoritative. The consumer only validates the supported event/context
contract and reports completion or failure through application APIs. It does not connect to the
application database or decide whether an onboarding is commercially eligible.

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

Import the shared handler first, then the consumer:

```powershell
docker compose --env-file .env exec n8n n8n import:workflow --input=/workflows/phase3-automation-error-handler.json
docker compose --env-file .env exec n8n n8n import:workflow --input=/workflows/phase3-onboarding-activation-consumer.json
```

After import, verify the consumer's error workflow still points to `Phase 3 Automation Error
Handler`. Keep both workflows inactive while testing manually. Activate the error handler first
and then the consumer only after the web readiness endpoint, migration status, service
credentials, and an empty-queue execution have been verified.

## Operational behavior

- Poll interval: one minute while active.
- Lease: application-configured, five minutes by default.
- Claim receipts: retained for 24 hours and cleaned in bounded batches during authenticated
  claims.
- Retry backoff: application-configured exponential schedule.
- Known failures: reported directly by the consumer.
- Unexpected failure fallback: reports only when the consumer emitted signed-run identifiers;
  otherwise it records a safe skipped outcome and does not guess.

Use the Admin **Automation recovery** page for `FAILED` and `DEAD_LETTER` events. A manual retry
does not override integrity or eligibility checks and authorizes exactly one additional attempt.

Workflow outputs contain only operational identifiers and outcomes. They never contain the
service token, HMAC secret, authorization header, signature, or raw upstream error.

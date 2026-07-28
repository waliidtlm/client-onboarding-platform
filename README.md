# Client Onboarding Platform

Production-minded internal client onboarding platform with durable n8n orchestration.

Phase 3 keeps the application as the business authority and adds a transactional activation
event, leased worker claims, immutable run history, authenticated callbacks, bounded retries,
dead-letter recovery, and two inactive n8n workflow exports.

## Phase 1 behavior

- Active fictional staff users sign in with local credentials.
- Passwords are stored only as Argon2id hashes.
- Every protected request reloads the staff record and active status from PostgreSQL.
- All six approved roles can read onboarding overview and package configuration.
- Delivery cannot read commercial records; those rows are not queried for Delivery requests.
- Credentials use encrypted JWT sessions. Auth.js database session tables are intentionally absent.
- Login throttling, password recovery, MFA, and production SSO remain production improvements.

## Phase 2 behavior

- Sales creates an inactive onboarding even when the structured handoff is incomplete.
- A handoff can select an existing client or create a new client during validation.
- Validated commercial terms and package activation policy are snapshotted onto the onboarding.
- Operations controls contract status; a signed version is never rewritten by a later revision.
- Finance issues the draft activation invoice, records payments, and makes terminal review
  decisions.
- The pure Commercial Gate returns an explicit status, ordered blockers, and evaluation time.
- Gate approval and activation of the existing onboarding occur in one transaction.
- The onboarding activation timestamp and activation audit event are created at most once.
- Important Phase 2 mutations write whitelisted, append-only AuditEvent records.
- Delivery cannot read commercial records, audit details, or mutation controls.

## Phase 3 behavior

- Activation and its `ONBOARDING_ACTIVATED` event commit in the same PostgreSQL transaction.
- Workers claim one event through an authenticated API; n8n never reads the application database.
- A claim request UUID has a retained 24-hour result, including an explicit empty result.
- Context access is bound to the event, current run, worker, idempotency key, and live lease.
- Callbacks and failure reports are idempotent only when their normalized terminal result matches.
- Retryable failures use bounded backoff, operator-remediable failures stop in `FAILED`, and
  permanent or exhausted failures stop in `DEAD_LETTER`.
- An Admin-only recovery screen revalidates eligibility before authorizing one extra attempt.
- Terminal automation runs and activation events are protected from deletion at the database
  layer. Terminal runs cannot be rewritten.
- n8n receives only its own database credentials and dedicated API-signing credentials.

## Architecture boundary

- PostgreSQL is the source of business truth.
- The Next.js application will own business-state transitions.
- n8n orchestrates through narrow application-owned APIs and does not make business decisions.
- n8n has a separate database and cannot connect to the application database.

## Prerequisites

- Node.js 24.16.0 or newer in the Node 24 line
- pnpm 11.9.0
- Docker 29.6.1 or compatible
- Docker Compose 5.3.0 or compatible

PowerShell can block `pnpm.ps1`. The examples therefore use `pnpm.cmd`.

## First-time setup

Install dependencies:

```powershell
pnpm.cmd install --frozen-lockfile
```

Create the local runtime environment:

```powershell
Copy-Item .env.example .env
```

`.env.example` is documentation only. Docker Compose commands use `.env`. Never commit `.env`,
and replace every development-only value before using this setup outside a local machine.

The [security hardening checkpoint](docs/security-hardening.md) documents dependency remediation,
CI policy, local credential separation, and requirements that must be completed before internet
deployment.

Add the Phase 1 variables from `.env.example` to an older Phase 0 `.env`. In particular, configure:

- migration, test, and shadow database names/users/passwords;
- a random `AUTH_SECRET` containing at least 32 characters;
- one local-only `DEMO_STAFF_PASSWORD`;
- `WEB_PORT` and a matching host URL.

Phase 3 also requires independent random values of at least 32 characters for
`AUTOMATION_SERVICE_TOKEN` and `AUTOMATION_HMAC_SECRET`. These are service authentication
credentials, not idempotency keys. See
[automation/n8n/README.md](automation/n8n/README.md) for import and activation instructions.

The demo password is intentionally shared by fictional users for a repeatable portfolio
demonstration. It must never be reused outside local development and is never stored in plaintext
in PostgreSQL.

Install the Playwright Chromium browser:

```powershell
pnpm.cmd exec playwright install chromium
```

## Run locally

Start PostgreSQL and n8n:

```powershell
docker compose --env-file .env up -d postgres n8n
```

For an existing Phase 0 PostgreSQL volume, add the Phase 1 roles and databases without deleting
the volume:

```powershell
pnpm.cmd db:bootstrap
```

Apply migrations and seed the fictional case:

```powershell
pnpm.cmd db:deploy
pnpm.cmd db:seed
```

Start the web application on the host:

```powershell
pnpm.cmd dev
```

Or start the complete containerized stack:

```powershell
pnpm.cmd docker:up
```

The host web port comes from `WEB_PORT`. If the default is occupied, set it to `3001`. The local
development wrapper derives `NEXTAUTH_URL` from that same value. Playwright uses
`PLAYWRIGHT_PORT`, so its server URL and browser base URL always match.

## Fictional staff accounts

The seed creates one account for each approved role:

```text
admin@northstar.test
sales@northstar.test
operations@northstar.test
finance@northstar.test
pm@northstar.test
delivery@northstar.test
disabled@northstar.test
```

Use the ignored local `DEMO_STAFF_PASSWORD`. The disabled account exists only to demonstrate
rejection.

## Endpoints

- `GET /api/health` checks whether the web process is alive.
- `GET /api/ready` executes `SELECT 1` against PostgreSQL. It returns `503` without exposing
  connection details when PostgreSQL is unavailable.
- n8n exposes its built-in health endpoint at `GET /healthz`.
- `POST /api/internal/automation/claim` leases one eligible event or returns `204`.
- `GET /api/internal/automation/events/:eventId/context` returns minimal current-run context.
- `POST /api/internal/automation/events/:eventId/callback` records a matching completion.
- `POST /api/internal/automation/events/:eventId/failure` records a matching classified failure.

All internal automation endpoints require a dedicated bearer token plus a timestamped HMAC over
the exact method, path and query, timestamp, and raw-body hash. Authentication runs before JSON
parsing or database work.

Build-time validation and runtime readiness are intentionally separate:

- `next build` compiles the application without connecting to PostgreSQL.
- Server startup validates required environment variables with Zod.
- `/api/ready` performs the live dependency check.

## Root commands

| Command                     | Purpose                                                      |
| --------------------------- | ------------------------------------------------------------ |
| `pnpm.cmd dev`              | Start the Next.js development server.                        |
| `pnpm.cmd build`            | Create the production Next.js build.                         |
| `pnpm.cmd format`           | Apply Prettier formatting.                                   |
| `pnpm.cmd format:check`     | Check formatting without changing files.                     |
| `pnpm.cmd lint`             | Run ESLint with zero warnings allowed.                       |
| `pnpm.cmd n8n:validate`     | Validate the committed inactive n8n workflow exports.        |
| `pnpm.cmd typecheck`        | Generate Next.js route types and run strict TypeScript.      |
| `pnpm.cmd test`             | Run Vitest unit and Route Handler tests.                     |
| `pnpm.cmd test:integration` | Run real PostgreSQL integration and role-isolation tests.    |
| `pnpm.cmd test:e2e`         | Run Playwright authentication and protected-page tests.      |
| `pnpm.cmd secret:scan`      | Scan repository content with Secretlint.                     |
| `pnpm.cmd verify`           | Run deterministic checks; DB and browser tests are separate. |
| `pnpm.cmd docker:config`    | Validate rendered Compose configuration using `.env`.        |
| `pnpm.cmd docker:up`        | Build and start the full stack using `.env`.                 |
| `pnpm.cmd docker:down`      | Stop containers while preserving named volumes.              |
| `pnpm.cmd db:bootstrap`     | Idempotently prepare Phase 1 local database roles.           |
| `pnpm.cmd db:deploy`        | Apply committed migrations with migration credentials.       |
| `pnpm.cmd db:seed`          | Upsert the fictional Phase 1 demonstration records.          |
| `pnpm.cmd db:validate`      | Validate the Prisma schema.                                  |

Integration tests normally reset the isolated `onboarding_test` database and therefore require
explicit Prisma reset consent. To apply outstanding test migrations without deleting retained
test rows, set `INTEGRATION_PRESERVE_DATABASE=1` for that run. Never point either mode at a
production database.

## Database isolation

The PostgreSQL initialization and idempotent bootstrap create:

| Database            | Login                       |
| ------------------- | --------------------------- |
| `onboarding_app`    | `onboarding_app_user`       |
| `onboarding_test`   | `onboarding_test_user`      |
| `onboarding_shadow` | `onboarding_migration_user` |
| `n8n_internal`      | `n8n_user`                  |

The runtime, test, migration, and n8n roles are non-superusers without database-creation or
role-creation privileges. The migration role owns the application/test schema and shadow
database. Runtime roles receive only their matching database access. The n8n container receives
only n8n credentials.

The initialization script runs only when `postgres_data` is empty. If the initialization
configuration changes, use a migration. Deleting the volume with `docker compose down -v` is
destructive and should only be used when intentionally resetting disposable local data.

## Persistent data

Compose creates two named volumes:

- `postgres_data` for PostgreSQL databases
- `n8n_data` for n8n configuration and operational data

`docker compose down` preserves both volumes.

## Production notes

The web Dockerfile produces a standalone Next.js build and runs as a non-root user. The supplied
Compose configuration is a local development baseline, not a complete production deployment.
Production still requires externally managed secrets, TLS, backups, restricted network access,
monitoring, and an n8n editor that is not publicly exposed.

## Current limits

Phase 3 provides durable automation infrastructure, not external provisioning. It does not upload
payment evidence files or integrate with accounting, e-signature, CRM, email, or payment
providers. The supplied consumer validates the versioned activation context and closes the run;
real side-effect adapters remain later, separately reviewed work.

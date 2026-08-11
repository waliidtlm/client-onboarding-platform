# Technical reference

This document keeps local-development and implementation detail out of the portfolio front page.
For the architectural rationale, see [Architecture and data model](architecture.md). For the
isolated evaluator path, see [Portfolio demo](demo-script.md).

## Implementation coverage

| Phase | Delivered capability                                                                                                                 |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------ |
| 1     | Staff authentication, active-user revalidation, role-based reads, and isolated database roles                                        |
| 2     | Sales handoff, commercial snapshots, contract/payment decisions, gate evaluation, activation, and audit records                      |
| 3     | Transactional outbox, signed worker APIs, leases, idempotency, retries, dead-letter state, and Admin recovery                        |
| 4     | Provisioning snapshots, ordered provider attempts, manual review, readiness approval, and frozen welcome email                       |
| 5     | Secure client access, hashed capability tokens, private uploads, immutable submissions, and requirement review                       |
| 6     | Timezone-safe kickoff scheduling, revisioned notifications, Delivery workspace, handoff acknowledgment, and access revocation        |
| 7     | Bounded reminders/escalations, PostgreSQL login limiting, environment-aware CSP, safe audit presentation, and portfolio verification |

## Prerequisites

- Node.js 24.16 or newer in the Node 24 line
- pnpm 11.9
- Docker with Compose

PowerShell can block `pnpm.ps1`; Windows examples use `pnpm.cmd`.

## First-time local setup

Install the frozen workspace:

```powershell
pnpm.cmd install --frozen-lockfile
```

Create the ignored local environment:

```powershell
Copy-Item .env.example .env
```

Replace every fictional credential before using the stack outside local development. Never commit
`.env`. At minimum, use independent random values for application authentication, client-session
signing, public rate-limit hashing, and every automation worker token/HMAC secret.

Install Playwright Chromium:

```powershell
pnpm.cmd --filter @client-onboarding/web exec playwright install chromium
```

## Run locally

Start the supporting services:

```powershell
docker compose --env-file .env up -d postgres minio minio-bootstrap n8n mailpit
```

Prepare roles/databases, deploy migrations, and seed fictional records:

```powershell
pnpm.cmd db:bootstrap
pnpm.cmd db:deploy
pnpm.cmd db:seed
```

Start the host web process:

```powershell
pnpm.cmd dev
```

Or build and start the complete local Compose stack:

```powershell
pnpm.cmd docker:up
```

The host port comes from `WEB_PORT`. The development wrapper derives `NEXTAUTH_URL` from the same
value. Playwright uses its separate `PLAYWRIGHT_PORT`.

## Fictional staff accounts

The seed creates one account for every approved role:

```text
admin@northstar.test
sales@northstar.test
operations@northstar.test
finance@northstar.test
pm@northstar.test
delivery@northstar.test
disabled@northstar.test
```

Use the ignored local `DEMO_STAFF_PASSWORD`. The disabled account exists only to demonstrate a
generic authentication rejection.

## Common commands

| Command                        | Purpose                                                     |
| ------------------------------ | ----------------------------------------------------------- |
| `pnpm.cmd dev`                 | Start the Next.js development server                        |
| `pnpm.cmd build`               | Build the standalone production application                 |
| `pnpm.cmd lint`                | Run ESLint with zero warnings                               |
| `pnpm.cmd typecheck`           | Generate route types and run strict TypeScript              |
| `pnpm.cmd test`                | Run unit and Route Handler tests                            |
| `pnpm.cmd test:integration`    | Run PostgreSQL integration and role-isolation tests         |
| `pnpm.cmd test:e2e`            | Run Playwright application scenarios                        |
| `pnpm.cmd verify`              | Run the required CI-equivalent checks                       |
| `pnpm.cmd verify:final`        | Run the complete isolated portfolio gate                    |
| `pnpm.cmd demo:phase7`         | Run only the isolated lifecycle demo and screenshots        |
| `pnpm.cmd demo:phase7:cleanup` | Remove only demo-owned resources                            |
| `pnpm.cmd n8n:validate`        | Validate committed inactive n8n exports                     |
| `pnpm.cmd secret:scan`         | Scan committed content with Secretlint                      |
| `pnpm.cmd screenshots:scan`    | Validate screenshot dimensions and embedded redaction rules |
| `pnpm.cmd db:validate`         | Validate the Prisma schema                                  |
| `pnpm.cmd db:deploy`           | Apply committed migrations with migration credentials       |
| `pnpm.cmd docker:config`       | Validate rendered Compose configuration                     |
| `pnpm.cmd docker:down`         | Stop local containers while preserving named volumes        |

Integration tests reset only the explicitly named `onboarding_test` database unless
`INTEGRATION_PRESERVE_DATABASE=1` is set. Never point either mode at production.

## Service endpoints

- `GET /api/health` confirms that the web process is alive.
- `GET /api/ready` checks PostgreSQL and private object storage; it returns `503` with safe output
  when either required dependency is unavailable.
- n8n exposes its built-in `GET /healthz` endpoint.
- Internal automation routes require a dedicated bearer credential plus a timestamped HMAC over
  the exact method, path/query, timestamp, and raw-body hash.
- n8n claims events and calls operation-specific application endpoints; it never reads the
  application database directly.

Build and readiness are deliberately separate: `next build` does not connect to PostgreSQL, server
startup validates the environment, `/api/health` proves liveness, and `/api/ready` proves required
dependency availability.

## Database isolation

| Database            | Login                       | Purpose                          |
| ------------------- | --------------------------- | -------------------------------- |
| `onboarding_app`    | `onboarding_app_user`       | Application runtime              |
| `onboarding_test`   | `onboarding_test_user`      | Integration and browser tests    |
| `onboarding_shadow` | `onboarding_migration_user` | Prisma migration shadow database |
| `n8n_internal`      | `n8n_user`                  | n8n operational state only       |

Runtime, test, migration, and n8n roles are non-superusers without role-creation privileges. The
migration role owns application/test schemas; runtime roles receive only their matching database
access. n8n receives no application-database credential.

Compose persists PostgreSQL and n8n data in named volumes. `docker compose down` preserves them.
Volume deletion is intentionally absent from routine commands.

## Local-only integrations

- Provisioning produces application-owned `sandbox://` records.
- Mailpit captures fictional outbound messages.
- MinIO supplies private local object storage.
- n8n runs as a local scheduler/worker with inactive exports committed for review.

See [Deployment guide](deployment.md) and [Known limitations](known-limitations.md) before adapting
these boundaries for a real environment.

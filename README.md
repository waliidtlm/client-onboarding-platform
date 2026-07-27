# Client Onboarding Platform

Production-minded foundation for an internal client onboarding platform supported by n8n.

Phase 0 establishes the development and runtime foundation only. It does not implement users,
roles, onboarding records, business transitions, automation events, or n8n workflows.

## Architecture boundary

- PostgreSQL is the future source of business truth.
- The Next.js application will own business-state transitions.
- n8n will orchestrate external side effects through application APIs in later phases.
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

Install the Playwright Chromium browser:

```powershell
pnpm.cmd exec playwright install chromium
```

## Run locally

Start PostgreSQL and n8n:

```powershell
docker compose --env-file .env up -d postgres n8n
```

Start the web application on the host:

```powershell
pnpm.cmd dev
```

Or start the complete containerized stack:

```powershell
pnpm.cmd docker:up
```

The normal web port is `3000`. If it is already occupied, change `WEB_PORT` in `.env`, for
example to `3001`. The Playwright suite uses `3100` by default.

## Endpoints

- `GET /api/health` checks whether the web process is alive.
- `GET /api/ready` executes `SELECT 1` against PostgreSQL. It returns `503` without exposing
  connection details when PostgreSQL is unavailable.
- n8n exposes its built-in health endpoint at `GET /healthz`.

Build-time validation and runtime readiness are intentionally separate:

- `next build` compiles the application without connecting to PostgreSQL.
- Server startup validates required environment variables with Zod.
- `/api/ready` performs the live dependency check.

## Root commands

| Command                  | Purpose                                                 |
| ------------------------ | ------------------------------------------------------- |
| `pnpm.cmd dev`           | Start the Next.js development server.                   |
| `pnpm.cmd build`         | Create the production Next.js build.                    |
| `pnpm.cmd format`        | Apply Prettier formatting.                              |
| `pnpm.cmd format:check`  | Check formatting without changing files.                |
| `pnpm.cmd lint`          | Run ESLint with zero warnings allowed.                  |
| `pnpm.cmd typecheck`     | Generate Next.js route types and run strict TypeScript. |
| `pnpm.cmd test`          | Run Vitest unit and Route Handler tests.                |
| `pnpm.cmd test:e2e`      | Run Playwright foundation smoke tests.                  |
| `pnpm.cmd secret:scan`   | Scan repository content with Secretlint.                |
| `pnpm.cmd verify`        | Run every local code-quality check.                     |
| `pnpm.cmd docker:config` | Validate rendered Compose configuration using `.env`.   |
| `pnpm.cmd docker:up`     | Build and start the full stack using `.env`.            |
| `pnpm.cmd docker:down`   | Stop containers while preserving named volumes.         |

## Database isolation

The PostgreSQL initialization script creates:

| Database         | Login                 |
| ---------------- | --------------------- |
| `onboarding_app` | `onboarding_app_user` |
| `n8n_internal`   | `n8n_user`            |

Both logins are non-superusers without database-creation or role-creation privileges. Database
connection is revoked from `PUBLIC`, then granted only to the matching owner. The n8n container
receives only the n8n database credentials.

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

This is Phase 0. Prisma business models, Auth.js, domain entities, MinIO, email tooling, automation
events, callbacks, and n8n workflows intentionally do not exist yet.

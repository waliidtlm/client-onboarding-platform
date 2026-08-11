import { Pool } from "pg";
import { describe, expect, it } from "vitest";

function requireUrl(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function targetDatabase(connectionString: string, database: string): string {
  const url = new URL(connectionString);
  url.pathname = `/${database}`;
  return url.toString();
}

function n8nConnectionString(): string {
  const user = requireUrl("N8N_DB_USER");
  const password = requireUrl("N8N_DB_PASSWORD");
  const database = requireUrl("N8N_DB_NAME");
  const port = process.env.POSTGRES_PORT ?? "5432";
  return `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@127.0.0.1:${port}/${encodeURIComponent(database)}`;
}

async function canConnect(connectionString: string): Promise<boolean> {
  const pool = new Pool({
    connectionString,
    connectionTimeoutMillis: 2_000,
    max: 1,
  });

  try {
    await pool.query("SELECT 1");
    return true;
  } catch {
    return false;
  } finally {
    await pool.end().catch(() => undefined);
  }
}

describe("PostgreSQL role isolation", () => {
  const isolatedTestDatabase = process.env.TEST_DB_NAME ?? "onboarding_test";
  const applicationDatabase = process.env.APP_DB_NAME ?? "onboarding_app";
  const shadowDatabase = process.env.SHADOW_DB_NAME ?? "onboarding_shadow";
  const n8nDatabase = process.env.N8N_DB_NAME ?? "n8n_internal";
  const appRuntime = requireUrl("APP_RUNTIME_DATABASE_URL");
  const testRuntime = requireUrl("TEST_DATABASE_URL");
  const migration = requireUrl("MIGRATION_DATABASE_URL");
  const n8n = n8nConnectionString();

  it("allows each role to reach only its intended positive target", async () => {
    await expect(canConnect(appRuntime)).resolves.toBe(true);
    await expect(canConnect(testRuntime)).resolves.toBe(true);
    await expect(canConnect(migration)).resolves.toBe(true);
    await expect(canConnect(targetDatabase(migration, shadowDatabase))).resolves.toBe(true);
    await expect(canConnect(n8n)).resolves.toBe(true);
  });

  it.each([isolatedTestDatabase, shadowDatabase, n8nDatabase])(
    "blocks the runtime application user from %s",
    async (database) => {
      await expect(canConnect(targetDatabase(appRuntime, database))).resolves.toBe(false);
    },
  );

  it.each([applicationDatabase, shadowDatabase, n8nDatabase])(
    "blocks the test runtime user from %s",
    async (database) => {
      await expect(canConnect(targetDatabase(testRuntime, database))).resolves.toBe(false);
    },
  );

  it("blocks the migration user from the n8n database", async () => {
    await expect(canConnect(targetDatabase(migration, n8nDatabase))).resolves.toBe(false);
  });

  it.each([applicationDatabase, isolatedTestDatabase, shadowDatabase])(
    "blocks the n8n role from %s",
    async (database) => {
      await expect(canConnect(targetDatabase(n8n, database))).resolves.toBe(false);
    },
  );
});

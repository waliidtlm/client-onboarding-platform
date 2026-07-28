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
  const appRuntime = requireUrl("APP_RUNTIME_DATABASE_URL");
  const testRuntime = requireUrl("TEST_DATABASE_URL");
  const migration = requireUrl("MIGRATION_DATABASE_URL");
  const n8n = n8nConnectionString();

  it("allows each role to reach only its intended positive target", async () => {
    await expect(canConnect(appRuntime)).resolves.toBe(true);
    await expect(canConnect(testRuntime)).resolves.toBe(true);
    await expect(canConnect(migration)).resolves.toBe(true);
    await expect(canConnect(targetDatabase(migration, "onboarding_shadow"))).resolves.toBe(true);
    await expect(canConnect(n8n)).resolves.toBe(true);
  });

  it.each(["onboarding_test", "onboarding_shadow", "n8n_internal"])(
    "blocks the runtime application user from %s",
    async (database) => {
      await expect(canConnect(targetDatabase(appRuntime, database))).resolves.toBe(false);
    },
  );

  it.each(["onboarding_app", "onboarding_shadow", "n8n_internal"])(
    "blocks the test runtime user from %s",
    async (database) => {
      await expect(canConnect(targetDatabase(testRuntime, database))).resolves.toBe(false);
    },
  );

  it("blocks the migration user from n8n_internal", async () => {
    await expect(canConnect(targetDatabase(migration, "n8n_internal"))).resolves.toBe(false);
  });

  it.each(["onboarding_app", "onboarding_test", "onboarding_shadow"])(
    "blocks the n8n role from %s",
    async (database) => {
      await expect(canConnect(targetDatabase(n8n, database))).resolves.toBe(false);
    },
  );
});

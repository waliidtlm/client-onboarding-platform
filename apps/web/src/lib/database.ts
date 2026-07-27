import { Pool } from "pg";

import { getServerEnvironment } from "@/lib/env";

let pool: Pool | undefined;

function getPool(): Pool {
  if (!pool) {
    const environment = getServerEnvironment();

    pool = new Pool({
      connectionString: environment.DATABASE_URL,
      connectionTimeoutMillis: 3_000,
      idleTimeoutMillis: 30_000,
      max: 5,
    });

    pool.on("error", () => {
      // Individual request failures are logged by the readiness endpoint.
      // Avoid logging the pg Error object because it can include connection details.
    });
  }

  return pool;
}

export async function checkDatabaseConnection(): Promise<void> {
  await getPool().query("SELECT 1");
}

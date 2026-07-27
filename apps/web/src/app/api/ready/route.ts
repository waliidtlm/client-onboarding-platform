import { checkDatabaseConnection } from "@/lib/database";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const startedAt = performance.now();

  try {
    await checkDatabaseConnection();

    return Response.json(
      {
        status: "ready",
        checks: {
          database: "up",
        },
      },
      {
        status: 200,
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  } catch {
    logger.error(
      {
        action: "readiness.check",
        errorCode: "DATABASE_UNAVAILABLE",
        durationMs: Math.round(performance.now() - startedAt),
      },
      "Database readiness check failed",
    );

    return Response.json(
      {
        status: "not_ready",
        checks: {
          database: "down",
        },
      },
      {
        status: 503,
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  }
}

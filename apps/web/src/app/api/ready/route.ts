import { checkDatabaseConnection } from "@/lib/database";
import { logger } from "@/lib/logger";
import { checkObjectStorageConnection } from "@/infrastructure/storage/s3-object-storage";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const startedAt = performance.now();
  const [database, objectStorage] = await Promise.allSettled([
    checkDatabaseConnection(),
    checkObjectStorageConnection(),
  ]);
  const checks = {
    database: database.status === "fulfilled" ? "up" : "down",
    objectStorage: objectStorage.status === "fulfilled" ? "up" : "down",
  } as const;
  if (database.status === "fulfilled" && objectStorage.status === "fulfilled") {
    return Response.json(
      {
        status: "ready",
        checks,
      },
      {
        status: 200,
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  }
  logger.error(
    {
      action: "readiness.check",
      errorCode: "DEPENDENCY_UNAVAILABLE",
      unavailableDependencies: Object.entries(checks)
        .filter(([, status]) => status === "down")
        .map(([dependency]) => dependency),
      durationMs: Math.round(performance.now() - startedAt),
    },
    "Required dependency readiness check failed",
  );
  return Response.json(
    {
      status: "not_ready",
      checks,
    },
    {
      status: 503,
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}

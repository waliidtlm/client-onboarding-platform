import { getServerEnvironment } from "@/lib/env";
import { logger } from "@/lib/logger";

export function validateNodeServerEnvironment(): void {
  try {
    const environment = getServerEnvironment();

    logger.info(
      {
        action: "application.start",
        logLevel: environment.LOG_LEVEL,
      },
      "Server environment validated",
    );
  } catch {
    logger.fatal(
      {
        action: "application.start",
        errorCode: "INVALID_SERVER_ENVIRONMENT",
      },
      "Required server environment validation failed",
    );
    process.exit(1);
  }
}

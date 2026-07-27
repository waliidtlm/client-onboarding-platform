import pino from "pino";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  redact: {
    paths: [
      "password",
      "*.password",
      "token",
      "*.token",
      "authorization",
      "*.authorization",
      "cookie",
      "*.cookie",
      "DATABASE_URL",
      "*.DATABASE_URL",
      "N8N_ENCRYPTION_KEY",
      "*.N8N_ENCRYPTION_KEY",
    ],
    censor: "[REDACTED]",
  },
  base: {
    service: "client-onboarding-web",
  },
});

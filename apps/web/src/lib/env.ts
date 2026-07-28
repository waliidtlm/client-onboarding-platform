import { z } from "zod";

const logLevels = ["fatal", "error", "warn", "info", "debug", "trace", "silent"] as const;

export const serverEnvironmentSchema = z.object({
  AUTOMATION_HMAC_SECRET: z
    .string()
    .min(32, "AUTOMATION_HMAC_SECRET must contain at least 32 characters"),
  AUTOMATION_LEASE_SECONDS: z.coerce.number().int().min(30).max(3600).default(300),
  AUTOMATION_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(20).default(5),
  AUTOMATION_RETRY_BASE_SECONDS: z.coerce.number().int().min(1).max(240).default(30),
  AUTOMATION_SERVICE_TOKEN: z
    .string()
    .min(32, "AUTOMATION_SERVICE_TOKEN must contain at least 32 characters"),
  AUTOMATION_SIGNATURE_MAX_AGE_SECONDS: z.coerce.number().int().min(30).max(900).default(300),
  AUTH_SECRET: z.string().min(32, "AUTH_SECRET must contain at least 32 characters"),
  DATABASE_URL: z
    .string()
    .min(1, "DATABASE_URL is required")
    .refine(
      (value) => value.startsWith("postgresql://") || value.startsWith("postgres://"),
      "DATABASE_URL must use the postgresql:// or postgres:// protocol",
    ),
  LOG_LEVEL: z.enum(logLevels).default("info"),
  NEXTAUTH_URL: z.url(),
});

export type ServerEnvironment = z.infer<typeof serverEnvironmentSchema>;

let cachedEnvironment: ServerEnvironment | undefined;

export function parseServerEnvironment(
  source: Record<string, string | undefined>,
): ServerEnvironment {
  return serverEnvironmentSchema.parse({
    AUTOMATION_HMAC_SECRET: source.AUTOMATION_HMAC_SECRET,
    AUTOMATION_LEASE_SECONDS: source.AUTOMATION_LEASE_SECONDS,
    AUTOMATION_MAX_ATTEMPTS: source.AUTOMATION_MAX_ATTEMPTS,
    AUTOMATION_RETRY_BASE_SECONDS: source.AUTOMATION_RETRY_BASE_SECONDS,
    AUTOMATION_SERVICE_TOKEN: source.AUTOMATION_SERVICE_TOKEN,
    AUTOMATION_SIGNATURE_MAX_AGE_SECONDS: source.AUTOMATION_SIGNATURE_MAX_AGE_SECONDS,
    AUTH_SECRET: source.AUTH_SECRET,
    DATABASE_URL: source.DATABASE_URL,
    LOG_LEVEL: source.LOG_LEVEL,
    NEXTAUTH_URL: source.NEXTAUTH_URL,
  });
}

export function getServerEnvironment(): ServerEnvironment {
  cachedEnvironment ??= parseServerEnvironment(process.env);
  return cachedEnvironment;
}

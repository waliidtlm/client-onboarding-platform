import { z } from "zod";

const logLevels = ["fatal", "error", "warn", "info", "debug", "trace", "silent"] as const;

export const serverEnvironmentSchema = z.object({
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

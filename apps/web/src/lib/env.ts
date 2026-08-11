import { z } from "zod";

const logLevels = ["fatal", "error", "warn", "info", "debug", "trace", "silent"] as const;

const base64UrlSecret = z
  .string()
  .regex(/^[A-Za-z0-9_-]{43,}$/, "must be base64url and contain at least 256 bits");

const signingKeyRing = z.string().transform((value, context): Readonly<Record<string, string>> => {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    const entries = Object.entries(parsed as Record<string, unknown>);
    if (
      entries.length < 1 ||
      entries.some(
        ([version, secret]) =>
          !/^[1-9][0-9]*$/.test(version) ||
          typeof secret !== "string" ||
          !/^[A-Za-z0-9_-]{43,}$/.test(secret),
      )
    ) {
      throw new Error();
    }
    return Object.fromEntries(entries) as Readonly<Record<string, string>>;
  } catch {
    context.addIssue({
      code: "custom",
      message: "CLIENT_ACCESS_SIGNING_KEYS must be a versioned base64url key map",
    });
    return z.NEVER;
  }
});

export const serverEnvironmentSchema = z
  .object({
    AUTOMATION_HMAC_SECRET: z
      .string()
      .min(32, "AUTOMATION_HMAC_SECRET must contain at least 32 characters"),
    AUTOMATION_LEASE_SECONDS: z.coerce.number().int().min(30).max(3600).default(300),
    AUTOMATION_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(20).default(5),
    AUTOMATION_RETRY_BASE_SECONDS: z.coerce.number().int().min(1).max(240).default(30),
    AUTOMATION_SERVICE_TOKEN: z
      .string()
      .min(32, "AUTOMATION_SERVICE_TOKEN must contain at least 32 characters"),
    AUTOMATION_PHASE5_SERVICE_TOKEN: z
      .string()
      .min(32, "AUTOMATION_PHASE5_SERVICE_TOKEN must contain at least 32 characters"),
    AUTOMATION_PHASE5_HMAC_SECRET: z
      .string()
      .min(32, "AUTOMATION_PHASE5_HMAC_SECRET must contain at least 32 characters"),
    AUTOMATION_PHASE6_SERVICE_TOKEN: z
      .string()
      .min(32, "AUTOMATION_PHASE6_SERVICE_TOKEN must contain at least 32 characters"),
    AUTOMATION_PHASE6_HMAC_SECRET: z
      .string()
      .min(32, "AUTOMATION_PHASE6_HMAC_SECRET must contain at least 32 characters"),
    AUTOMATION_PHASE7_SERVICE_TOKEN: z
      .string()
      .min(32, "AUTOMATION_PHASE7_SERVICE_TOKEN must contain at least 32 characters"),
    AUTOMATION_PHASE7_HMAC_SECRET: z
      .string()
      .min(32, "AUTOMATION_PHASE7_HMAC_SECRET must contain at least 32 characters"),
    PROVISIONING_TASK_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(3),
    AUTOMATION_SIGNATURE_MAX_AGE_SECONDS: z.coerce.number().int().min(30).max(900).default(300),
    AUTH_SECRET: z.string().min(32, "AUTH_SECRET must contain at least 32 characters"),
    CLIENT_ACCESS_ACTIVE_SIGNING_KEY_VERSION: z.coerce.number().int().positive(),
    CLIENT_ACCESS_SIGNING_KEYS: signingKeyRing,
    CLIENT_ACCESS_TOKEN_DAYS: z.coerce.number().int().min(1).max(90).default(30),
    CLIENT_ACCESS_PUBLIC_BASE_URL: z.url(),
    APP_PUBLIC_ORIGIN: z.url(),
    CLIENT_SESSION_SECRET: base64UrlSecret,
    PUBLIC_RATE_LIMIT_HMAC_SECRET: base64UrlSecret,
    TRUSTED_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0),
    AGENCY_NAME: z.string().trim().min(1).max(200).default("Northstar Growth Agency"),
    CLIENT_SUPPORT_CONTACT: z.string().trim().email().max(320),
    OBJECT_STORAGE_INTERNAL_ENDPOINT: z.url(),
    OBJECT_STORAGE_BROWSER_ENDPOINT: z.url(),
    OBJECT_STORAGE_REGION: z.string().trim().min(1).max(100).default("us-east-1"),
    OBJECT_STORAGE_BUCKET: z.string().trim().min(3).max(63),
    OBJECT_STORAGE_ACCESS_KEY: z.string().min(3).max(100),
    OBJECT_STORAGE_SECRET_KEY: z.string().min(16).max(200),
    SMTP_HOST: z.string().trim().min(1).max(253),
    SMTP_PORT: z.coerce.number().int().min(1).max(65_535),
    DATABASE_URL: z
      .string()
      .min(1, "DATABASE_URL is required")
      .refine(
        (value) => value.startsWith("postgresql://") || value.startsWith("postgres://"),
        "DATABASE_URL must use the postgresql:// or postgres:// protocol",
      ),
    LOG_LEVEL: z.enum(logLevels).default("info"),
    NEXTAUTH_URL: z.url(),
    DEPLOYMENT_PROFILE: z.enum(["local", "production"]).default("local"),
  })
  .superRefine((environment, context) => {
    const distinct = (
      left: string,
      right: string,
      path: keyof typeof environment,
      message: string,
    ) => {
      if (left === right) context.addIssue({ code: "custom", path: [path], message });
    };
    distinct(
      environment.AUTOMATION_PHASE5_SERVICE_TOKEN,
      environment.AUTOMATION_SERVICE_TOKEN,
      "AUTOMATION_PHASE5_SERVICE_TOKEN",
      "Phase 5 must use a distinct service credential",
    );
    distinct(
      environment.AUTOMATION_PHASE5_HMAC_SECRET,
      environment.AUTOMATION_HMAC_SECRET,
      "AUTOMATION_PHASE5_HMAC_SECRET",
      "Phase 5 must use a distinct HMAC credential",
    );
    distinct(
      environment.AUTOMATION_PHASE6_SERVICE_TOKEN,
      environment.AUTOMATION_SERVICE_TOKEN,
      "AUTOMATION_PHASE6_SERVICE_TOKEN",
      "Phase 6 must use a distinct service credential",
    );
    distinct(
      environment.AUTOMATION_PHASE6_SERVICE_TOKEN,
      environment.AUTOMATION_PHASE5_SERVICE_TOKEN,
      "AUTOMATION_PHASE6_SERVICE_TOKEN",
      "Phase 6 must not reuse the Phase 5 service credential",
    );
    distinct(
      environment.AUTOMATION_PHASE6_HMAC_SECRET,
      environment.AUTOMATION_HMAC_SECRET,
      "AUTOMATION_PHASE6_HMAC_SECRET",
      "Phase 6 must use a distinct HMAC credential",
    );
    distinct(
      environment.AUTOMATION_PHASE6_HMAC_SECRET,
      environment.AUTOMATION_PHASE5_HMAC_SECRET,
      "AUTOMATION_PHASE6_HMAC_SECRET",
      "Phase 6 must not reuse the Phase 5 HMAC credential",
    );
    for (const [value, other, message] of [
      [
        environment.AUTOMATION_PHASE7_SERVICE_TOKEN,
        environment.AUTOMATION_SERVICE_TOKEN,
        "Phase 7 must not reuse the Phase 4 service credential",
      ],
      [
        environment.AUTOMATION_PHASE7_SERVICE_TOKEN,
        environment.AUTOMATION_PHASE5_SERVICE_TOKEN,
        "Phase 7 must not reuse the Phase 5 service credential",
      ],
      [
        environment.AUTOMATION_PHASE7_SERVICE_TOKEN,
        environment.AUTOMATION_PHASE6_SERVICE_TOKEN,
        "Phase 7 must not reuse the Phase 6 service credential",
      ],
      [
        environment.AUTOMATION_PHASE7_HMAC_SECRET,
        environment.AUTOMATION_HMAC_SECRET,
        "Phase 7 must not reuse the Phase 4 HMAC credential",
      ],
      [
        environment.AUTOMATION_PHASE7_HMAC_SECRET,
        environment.AUTOMATION_PHASE5_HMAC_SECRET,
        "Phase 7 must not reuse the Phase 5 HMAC credential",
      ],
      [
        environment.AUTOMATION_PHASE7_HMAC_SECRET,
        environment.AUTOMATION_PHASE6_HMAC_SECRET,
        "Phase 7 must not reuse the Phase 6 HMAC credential",
      ],
    ] as const) {
      if (value === other) {
        context.addIssue({
          code: "custom",
          path: [
            message.includes("HMAC")
              ? "AUTOMATION_PHASE7_HMAC_SECRET"
              : "AUTOMATION_PHASE7_SERVICE_TOKEN",
          ],
          message,
        });
      }
    }
    distinct(
      environment.PUBLIC_RATE_LIMIT_HMAC_SECRET,
      environment.CLIENT_SESSION_SECRET,
      "PUBLIC_RATE_LIMIT_HMAC_SECRET",
      "Rate limiting must use a separate hashing secret",
    );
    if (
      Object.values(environment.CLIENT_ACCESS_SIGNING_KEYS).includes(
        environment.PUBLIC_RATE_LIMIT_HMAC_SECRET,
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["PUBLIC_RATE_LIMIT_HMAC_SECRET"],
        message: "Rate limiting must not reuse a client access signing key",
      });
    }
    if (environment.DEPLOYMENT_PROFILE === "production") {
      for (const [key, value] of [
        ["APP_PUBLIC_ORIGIN", environment.APP_PUBLIC_ORIGIN],
        ["CLIENT_ACCESS_PUBLIC_BASE_URL", environment.CLIENT_ACCESS_PUBLIC_BASE_URL],
        ["NEXTAUTH_URL", environment.NEXTAUTH_URL],
        ["OBJECT_STORAGE_BROWSER_ENDPOINT", environment.OBJECT_STORAGE_BROWSER_ENDPOINT],
      ] as const) {
        if (new URL(value).protocol !== "https:") {
          context.addIssue({
            code: "custom",
            path: [key],
            message: `${key} must use HTTPS in the production deployment profile`,
          });
        }
      }
      if (environment.TRUSTED_PROXY_HOPS < 1) {
        context.addIssue({
          code: "custom",
          path: ["TRUSTED_PROXY_HOPS"],
          message: "Production requires an explicitly configured trusted proxy",
        });
      }
    }
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
    AUTOMATION_PHASE5_SERVICE_TOKEN: source.AUTOMATION_PHASE5_SERVICE_TOKEN,
    AUTOMATION_PHASE5_HMAC_SECRET: source.AUTOMATION_PHASE5_HMAC_SECRET,
    AUTOMATION_PHASE6_SERVICE_TOKEN: source.AUTOMATION_PHASE6_SERVICE_TOKEN,
    AUTOMATION_PHASE6_HMAC_SECRET: source.AUTOMATION_PHASE6_HMAC_SECRET,
    AUTOMATION_PHASE7_SERVICE_TOKEN: source.AUTOMATION_PHASE7_SERVICE_TOKEN,
    AUTOMATION_PHASE7_HMAC_SECRET: source.AUTOMATION_PHASE7_HMAC_SECRET,
    PROVISIONING_TASK_MAX_ATTEMPTS: source.PROVISIONING_TASK_MAX_ATTEMPTS,
    AUTOMATION_SIGNATURE_MAX_AGE_SECONDS: source.AUTOMATION_SIGNATURE_MAX_AGE_SECONDS,
    AUTH_SECRET: source.AUTH_SECRET,
    CLIENT_ACCESS_ACTIVE_SIGNING_KEY_VERSION: source.CLIENT_ACCESS_ACTIVE_SIGNING_KEY_VERSION,
    CLIENT_ACCESS_SIGNING_KEYS: source.CLIENT_ACCESS_SIGNING_KEYS,
    CLIENT_ACCESS_TOKEN_DAYS: source.CLIENT_ACCESS_TOKEN_DAYS,
    CLIENT_ACCESS_PUBLIC_BASE_URL: source.CLIENT_ACCESS_PUBLIC_BASE_URL,
    APP_PUBLIC_ORIGIN: source.APP_PUBLIC_ORIGIN,
    CLIENT_SESSION_SECRET: source.CLIENT_SESSION_SECRET,
    PUBLIC_RATE_LIMIT_HMAC_SECRET: source.PUBLIC_RATE_LIMIT_HMAC_SECRET,
    TRUSTED_PROXY_HOPS: source.TRUSTED_PROXY_HOPS,
    AGENCY_NAME: source.AGENCY_NAME,
    CLIENT_SUPPORT_CONTACT: source.CLIENT_SUPPORT_CONTACT,
    OBJECT_STORAGE_INTERNAL_ENDPOINT: source.OBJECT_STORAGE_INTERNAL_ENDPOINT,
    OBJECT_STORAGE_BROWSER_ENDPOINT: source.OBJECT_STORAGE_BROWSER_ENDPOINT,
    OBJECT_STORAGE_REGION: source.OBJECT_STORAGE_REGION,
    OBJECT_STORAGE_BUCKET: source.OBJECT_STORAGE_BUCKET,
    OBJECT_STORAGE_ACCESS_KEY: source.OBJECT_STORAGE_ACCESS_KEY,
    OBJECT_STORAGE_SECRET_KEY: source.OBJECT_STORAGE_SECRET_KEY,
    SMTP_HOST: source.SMTP_HOST,
    SMTP_PORT: source.SMTP_PORT,
    DATABASE_URL: source.DATABASE_URL,
    LOG_LEVEL: source.LOG_LEVEL,
    NEXTAUTH_URL: source.NEXTAUTH_URL,
    DEPLOYMENT_PROFILE: source.DEPLOYMENT_PROFILE,
  });
}

export function getServerEnvironment(): ServerEnvironment {
  cachedEnvironment ??= parseServerEnvironment(process.env);
  return cachedEnvironment;
}

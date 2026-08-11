import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const repositoryRoot = path.resolve(import.meta.dirname, "..");
const envFile = path.join(repositoryRoot, ".env.phase7-demo");
const composeProject = "client-onboarding-phase7-demo";
const databaseName = "onboarding_phase7_demo";
const fixtureMarker = "PHASE7_DEMO_FIXTURE_v1";
const packageManager = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

function secret(length = 36) {
  return `s${randomBytes(length).toString("base64url")}`;
}

function createEnvironment() {
  const values = {
    POSTGRES_PORT: process.env.PHASE7_DEMO_POSTGRES_PORT ?? "55432",
    POSTGRES_ADMIN_USER: "phase7_demo_admin",
    POSTGRES_ADMIN_PASSWORD: secret(),
    APP_DB_NAME: databaseName,
    APP_DB_USER: "phase7_demo_app",
    APP_DB_PASSWORD: secret(),
    MIGRATION_DB_USER: "phase7_demo_migration",
    MIGRATION_DB_PASSWORD: secret(),
    TEST_DB_NAME: "onboarding_test_phase7_demo",
    TEST_DB_USER: "phase7_demo_test",
    TEST_DB_PASSWORD: secret(),
    SHADOW_DB_NAME: "onboarding_shadow_phase7_demo",
    N8N_DB_NAME: "n8n_phase7_demo",
    N8N_DB_USER: "phase7_demo_n8n",
    N8N_DB_PASSWORD: secret(),
    N8N_ENCRYPTION_KEY: secret(),
    N8N_PORT: process.env.PHASE7_DEMO_N8N_PORT ?? "35678",
    AUTOMATION_SERVICE_TOKEN: secret(),
    AUTOMATION_HMAC_SECRET: secret(),
    AUTOMATION_WORKER_ID: "n8n-phase7-demo-primary",
    AUTOMATION_PHASE5_SERVICE_TOKEN: secret(),
    AUTOMATION_PHASE5_HMAC_SECRET: secret(),
    AUTOMATION_PHASE5_WORKER_ID: "n8n-phase7-demo-client-access",
    AUTOMATION_PHASE6_SERVICE_TOKEN: secret(),
    AUTOMATION_PHASE6_HMAC_SECRET: secret(),
    AUTOMATION_PHASE6_WORKER_ID: "n8n-phase7-demo-kickoff",
    AUTOMATION_PHASE7_SERVICE_TOKEN: secret(),
    AUTOMATION_PHASE7_HMAC_SECRET: secret(),
    AUTOMATION_PHASE7_WORKER_ID: "n8n-phase7-demo-reminders",
    AUTH_SECRET: secret(),
    CLIENT_ACCESS_ACTIVE_SIGNING_KEY_VERSION: "1",
    CLIENT_ACCESS_SIGNING_KEYS: JSON.stringify({ 1: secret(32) }),
    CLIENT_ACCESS_TOKEN_DAYS: "30",
    CLIENT_SESSION_SECRET: secret(),
    PUBLIC_RATE_LIMIT_HMAC_SECRET: secret(),
    TRUSTED_PROXY_HOPS: "1",
    AGENCY_NAME: "Northstar Growth Agency",
    CLIENT_SUPPORT_CONTACT: "support@phase7-demo.test",
    MINIO_ROOT_USER: "phase7_demo_minio_root",
    MINIO_ROOT_PASSWORD: secret(),
    MINIO_API_PORT: process.env.PHASE7_DEMO_MINIO_API_PORT ?? "39000",
    MINIO_CONSOLE_PORT: process.env.PHASE7_DEMO_MINIO_CONSOLE_PORT ?? "39001",
    OBJECT_STORAGE_REGION: "us-east-1",
    OBJECT_STORAGE_BUCKET: "phase7-demo-onboarding-files",
    OBJECT_STORAGE_ACCESS_KEY: "phase7_demo_storage",
    OBJECT_STORAGE_SECRET_KEY: secret(),
    MAILPIT_SMTP_PORT: process.env.PHASE7_DEMO_MAILPIT_SMTP_PORT ?? "31025",
    MAILPIT_UI_PORT: process.env.PHASE7_DEMO_MAILPIT_UI_PORT ?? "38025",
    SMTP_PORT: "1025",
    WEB_PORT: process.env.PHASE7_DEMO_WEB_PORT ?? "3300",
    DEPLOYMENT_PROFILE: "local",
    DEMO_STAFF_PASSWORD: secret(24),
    PHASE7_DEMO_FIXTURE_MARKER: fixtureMarker,
  };
  values.NEXTAUTH_URL = `http://127.0.0.1:${values.WEB_PORT}`;
  values.APP_PUBLIC_ORIGIN = values.NEXTAUTH_URL;
  values.CLIENT_ACCESS_PUBLIC_BASE_URL = `${values.NEXTAUTH_URL}/client-access`;
  values.OBJECT_STORAGE_INTERNAL_ENDPOINT = "http://minio:9000";
  values.OBJECT_STORAGE_BROWSER_ENDPOINT = `http://127.0.0.1:${values.MINIO_API_PORT}`;
  values.SMTP_HOST = "mailpit";
  writeFileSync(
    envFile,
    `${Object.entries(values)
      .map(([key, value]) => `${key}=${value}`)
      .join("\n")}\n`,
    { encoding: "utf8", mode: 0o600 },
  );
  return values;
}

function loadEnvironment() {
  if (!existsSync(envFile)) return createEnvironment();
  return Object.fromEntries(
    readFileSync(envFile, "utf8")
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => {
        const index = line.indexOf("=");
        return [line.slice(0, index), line.slice(index + 1)];
      }),
  );
}

function compose(values, args, options = {}) {
  const result = spawnSync(
    "docker",
    ["compose", "-p", composeProject, "--env-file", envFile, "-f", "compose.yaml", ...args],
    {
      cwd: repositoryRoot,
      env: { ...process.env, ...values },
      encoding: options.capture ? "utf8" : undefined,
      stdio: options.capture ? "pipe" : "inherit",
      maxBuffer: 16 * 1024 * 1024,
    },
  );
  if (result.status !== 0) {
    throw new Error(
      options.capture
        ? result.stderr?.trim() || `Docker Compose command failed: ${args.join(" ")}`
        : `Docker Compose command failed: ${args.join(" ")}`,
    );
  }
  return result.stdout?.trim() ?? "";
}

function runHost(command, args, environment) {
  const executable = process.platform === "win32" ? "cmd.exe" : command;
  const executableArgs =
    process.platform === "win32" ? ["/d", "/s", "/c", [command, ...args].join(" ")] : args;
  const result = spawnSync(executable, executableArgs, {
    cwd: repositoryRoot,
    env: { ...process.env, ...environment },
    stdio: "inherit",
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function demoDatabaseUrl(values, role, password, name) {
  return `postgresql://${role}:${password}@127.0.0.1:${values.POSTGRES_PORT}/${name}`;
}

function isolatedTestEnvironment(values) {
  return {
    ...values,
    INTEGRATION_PRESERVE_DATABASE: "1",
    MIGRATION_DATABASE_URL: demoDatabaseUrl(
      values,
      values.MIGRATION_DB_USER,
      values.MIGRATION_DB_PASSWORD,
      values.APP_DB_NAME,
    ),
    TEST_DATABASE_URL: demoDatabaseUrl(
      values,
      values.TEST_DB_USER,
      values.TEST_DB_PASSWORD,
      values.TEST_DB_NAME,
    ),
    TEST_MIGRATION_DATABASE_URL: demoDatabaseUrl(
      values,
      values.MIGRATION_DB_USER,
      values.MIGRATION_DB_PASSWORD,
      values.TEST_DB_NAME,
    ),
    SHADOW_DATABASE_URL: demoDatabaseUrl(
      values,
      values.MIGRATION_DB_USER,
      values.MIGRATION_DB_PASSWORD,
      values.SHADOW_DB_NAME,
    ),
    DATABASE_URL: demoDatabaseUrl(
      values,
      values.APP_DB_USER,
      values.APP_DB_PASSWORD,
      values.APP_DB_NAME,
    ),
    APP_RUNTIME_DATABASE_URL: demoDatabaseUrl(
      values,
      values.APP_DB_USER,
      values.APP_DB_PASSWORD,
      values.APP_DB_NAME,
    ),
  };
}

async function verifyMailpitEvidence(values) {
  const response = await fetch(`http://127.0.0.1:${values.MAILPIT_UI_PORT}/api/v1/messages`);
  if (!response.ok) throw new Error("Mailpit evidence endpoint is unavailable");
  const inbox = await response.json();
  const messages = Array.isArray(inbox?.messages) ? inbox.messages : [];
  const reminder = messages.find(
    (message) =>
      typeof message?.Subject === "string" &&
      message.Subject.toLowerCase().includes("client requirement") &&
      Array.isArray(message.To) &&
      message.To.length > 0 &&
      message.To.every(
        (recipient) =>
          typeof recipient?.Address === "string" &&
          recipient.Address.toLowerCase().endsWith(".test"),
      ),
  );
  if (!reminder) throw new Error("Mailpit does not contain the isolated .test reminder evidence");
}

async function verify() {
  const values = loadEnvironment();
  if (values.APP_DB_NAME !== databaseName || values.PHASE7_DEMO_FIXTURE_MARKER !== fixtureMarker) {
    throw new Error("Phase 7 demo environment has an unexpected database name or marker");
  }
  const integrationRunSuffix = randomBytes(4).toString("hex");
  values.TEST_DB_NAME = `onboarding_test_phase7_demo_integration_${integrationRunSuffix}`;
  values.SHADOW_DB_NAME = `onboarding_shadow_phase7_demo_integration_${integrationRunSuffix}`;
  compose(values, ["up", "-d", "--wait", "--wait-timeout", "120", "postgres"]);
  try {
    compose(values, ["run", "--rm", "db-bootstrap"]);
  } catch {
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    compose(values, ["run", "--rm", "db-bootstrap"]);
  }
  compose(values, [
    "exec",
    "-T",
    "postgres",
    "psql",
    "--username",
    values.POSTGRES_ADMIN_USER,
    "--dbname",
    databaseName,
    "--command",
    `COMMENT ON DATABASE "${databaseName}" IS '${fixtureMarker}'`,
  ]);
  compose(values, ["up", "--build", "-d", "--wait", "--wait-timeout", "360"]);
  compose(values, [
    "run",
    "--rm",
    "-e",
    `DEMO_STAFF_PASSWORD=${values.DEMO_STAFF_PASSWORD}`,
    "-e",
    `PHASE7_DEMO_FIXTURE_MARKER=${fixtureMarker}`,
    "migrate",
    "pnpm",
    "db:seed",
  ]);
  compose(values, [
    "run",
    "--rm",
    "-e",
    `PHASE7_DEMO_FIXTURE_MARKER=${fixtureMarker}`,
    "migrate",
    "pnpm",
    "exec",
    "tsx",
    "--tsconfig",
    "apps/web/tsconfig.json",
    "apps/web/scripts/phase7-demo-fixture.ts",
  ]);

  const integrationTestEnvironment = isolatedTestEnvironment(values);
  runHost(packageManager, ["test:integration"], integrationTestEnvironment);

  const browserRunSuffix = randomBytes(4).toString("hex");
  values.TEST_DB_NAME = `onboarding_test_phase7_demo_browser_${browserRunSuffix}`;
  values.SHADOW_DB_NAME = `onboarding_shadow_phase7_demo_browser_${browserRunSuffix}`;
  compose(values, ["run", "--rm", "db-bootstrap"]);
  const browserTestEnvironment = isolatedTestEnvironment(values);
  runHost(
    packageManager,
    ["prisma", "migrate", "deploy", "--config", "prisma.test.config.ts"],
    browserTestEnvironment,
  );
  const playwrightPort = String(34_000 + (randomBytes(2).readUInt16BE(0) % 1_000));
  runHost(packageManager, ["test:e2e"], {
    ...browserTestEnvironment,
    PLAYWRIGHT_PORT: playwrightPort,
    SMTP_HOST: "127.0.0.1",
    SMTP_PORT: values.MAILPIT_SMTP_PORT,
  });

  compose(values, [
    "exec",
    "-T",
    "n8n",
    "n8n",
    "import:workflow",
    "--input=/workflows/phase7-reminders-and-escalations.json",
  ]);
  const workflowList = compose(values, ["exec", "-T", "n8n", "n8n", "list:workflow"], {
    capture: true,
  });
  const workflowLine = workflowList
    .split(/\r?\n/)
    .find((line) => line.includes("Phase 7 Reminders and Escalations"));
  const workflowId = workflowLine?.split("|", 1)[0]?.trim();
  if (!workflowId) throw new Error("Imported Phase 7 n8n workflow was not found");
  compose(values, ["run", "--rm", "n8n", "execute", `--id=${workflowId}`]);
  await verifyMailpitEvidence(values);

  compose(values, [
    "run",
    "--rm",
    "-e",
    `PHASE7_DEMO_FIXTURE_MARKER=${fixtureMarker}`,
    "migrate",
    "pnpm",
    "exec",
    "tsx",
    "--tsconfig",
    "apps/web/tsconfig.json",
    "apps/web/scripts/phase7-demo-verify.ts",
  ]);
  compose(values, [
    "run",
    "--rm",
    "--entrypoint",
    "sh",
    "-e",
    `PHASE7_DEMO_FIXTURE_MARKER=${fixtureMarker}`,
    "minio-bootstrap",
    "-c",
    'mc alias set demo "$MINIO_ENDPOINT" "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null && printf "%s" "$PHASE7_DEMO_FIXTURE_MARKER" | mc pipe "demo/$MINIO_BUCKET/evidence/phase7-demo.txt" >/dev/null && mc stat "demo/$MINIO_BUCKET/evidence/phase7-demo.txt" >/dev/null',
  ]);

  const healthTargets = [
    `http://127.0.0.1:${values.WEB_PORT}/api/ready`,
    `http://127.0.0.1:${values.N8N_PORT}/healthz`,
    `http://127.0.0.1:${values.MAILPIT_UI_PORT}/api/v1/messages`,
    `http://127.0.0.1:${values.MINIO_API_PORT}/minio/health/live`,
  ];
  for (const target of healthTargets) {
    const response = await fetch(target);
    if (!response.ok)
      throw new Error(`Demo service health check failed: ${new URL(target).pathname}`);
  }
  runHost(
    packageManager,
    ["--filter", "@client-onboarding/web", "exec", "node", "scripts/phase7-screenshots.mjs"],
    values,
  );
  process.stdout.write(
    `Phase 7 isolated demo verified. Web: http://127.0.0.1:${values.WEB_PORT}\n`,
  );
}

function cleanup() {
  if (!existsSync(envFile)) throw new Error("No Phase 7 demo environment exists");
  const values = loadEnvironment();
  if (values.APP_DB_NAME !== databaseName || values.PHASE7_DEMO_FIXTURE_MARKER !== fixtureMarker) {
    throw new Error("Cleanup refused: database name or fixture marker is not exact");
  }
  const markerCount = compose(
    values,
    [
      "exec",
      "-T",
      "postgres",
      "psql",
      "--username",
      values.POSTGRES_ADMIN_USER,
      "--dbname",
      databaseName,
      "--tuples-only",
      "--no-align",
      "--command",
      "SELECT shobj_description(oid, 'pg_database') FROM pg_database WHERE datname = current_database()",
    ],
    { capture: true },
  );
  if (markerCount.trim() !== fixtureMarker) {
    throw new Error("Cleanup refused: exact Phase 7 database marker was not found");
  }
  compose(values, ["down", "--volumes", "--remove-orphans"]);
  unlinkSync(envFile);
  process.stdout.write("Removed only the isolated Phase 7 Compose project and owned volumes.\n");
}

const command = process.argv[2] ?? "verify";
if (command === "verify") {
  await verify();
} else if (command === "cleanup") {
  cleanup();
} else {
  throw new Error("Use phase7-demo.mjs verify or cleanup");
}

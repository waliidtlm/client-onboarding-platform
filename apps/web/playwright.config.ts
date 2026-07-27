import { defineConfig } from "@playwright/test";

const port = Number(process.env.PLAYWRIGHT_PORT ?? process.env.WEB_PORT ?? 3100);
const baseURL = `http://127.0.0.1:${port}`;
const testDatabaseUrl = process.env.TEST_DATABASE_URL;

if (!testDatabaseUrl || new URL(testDatabaseUrl).pathname !== "/onboarding_test") {
  throw new Error("Playwright requires TEST_DATABASE_URL targeting onboarding_test");
}

export default defineConfig({
  testDir: "./tests/e2e",
  globalSetup: "./tests/e2e/global-setup.ts",
  fullyParallel: false,
  workers: 1,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  webServer: {
    command: `pnpm exec next dev --hostname 127.0.0.1 --port ${port}`,
    env: {
      AUTH_SECRET: process.env.AUTH_SECRET ?? "playwright-auth-secret-with-at-least-32-characters",
      DATABASE_URL: testDatabaseUrl,
      LOG_LEVEL: "silent",
      NEXTAUTH_URL: baseURL,
    },
    url: `${baseURL}/api/health`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});

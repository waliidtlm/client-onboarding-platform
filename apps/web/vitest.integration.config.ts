import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));

if (process.env.TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
}

process.env.AUTH_SECRET ??= "integration-auth-secret-with-at-least-32-characters";
process.env.NEXTAUTH_URL ??= "http://127.0.0.1:3100";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.join(projectRoot, "src"),
    },
  },
  test: {
    environment: "node",
    include: ["**/tests/integration/**/*.test.ts"],
    globalSetup: ["tests/integration/global-setup.ts"],
    fileParallelism: false,
    maxWorkers: 1,
    testTimeout: 30_000,
  },
});

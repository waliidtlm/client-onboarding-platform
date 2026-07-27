import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": path.join(projectRoot, "src"),
    },
  },
  test: {
    env: {
      AUTH_SECRET: "unit-test-auth-secret-with-at-least-32-characters",
      DATABASE_URL: "postgresql://unit_test:unit_test@127.0.0.1:5432/unit_test",
      NEXTAUTH_URL: "http://127.0.0.1:3100",
    },
    environment: "node",
    include: ["src/**/*.test.ts"],
    mockReset: true,
    restoreMocks: true,
  },
});

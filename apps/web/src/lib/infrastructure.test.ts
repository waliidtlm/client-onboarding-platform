import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repositoryRoot = path.resolve(process.cwd(), "../..");
const compose = readFileSync(path.join(repositoryRoot, "compose.yaml"), "utf8");
const dockerfile = readFileSync(path.join(repositoryRoot, "apps/web/Dockerfile"), "utf8");
const webPackage = JSON.parse(
  readFileSync(path.join(repositoryRoot, "apps/web/package.json"), "utf8"),
) as { scripts: Record<string, string> };

function serviceBlock(name: string, nextName?: string): string {
  const start = compose.indexOf(`  ${name}:`);
  const end = nextName ? compose.indexOf(`  ${nextName}:`, start + 1) : compose.length;
  return compose.slice(start, end);
}

describe("Phase 1 infrastructure boundaries", () => {
  it("passes migration credentials only to the one-shot migration service", () => {
    const web = serviceBlock("web");
    const n8n = serviceBlock("n8n", "web");
    const migrate = serviceBlock("migrate", "n8n");

    expect(migrate).toContain("MIGRATION_DB_USER");
    expect(web).not.toContain("MIGRATION_DB_USER");
    expect(web).not.toContain("MIGRATION_DB_PASSWORD");
    expect(n8n).not.toContain("MIGRATION_DB_USER");
    expect(n8n).not.toContain("TEST_DB_USER");
    expect(n8n).not.toContain("SHADOW_DB_NAME");
  });

  it("does not run migrations during build or normal web startup", () => {
    expect(webPackage.scripts.prebuild).toContain("db:generate");
    expect(webPackage.scripts.prebuild).not.toContain("migrate");
    expect(webPackage.scripts.start).toBe("next start");
    expect(dockerfile).toContain('CMD ["node", "apps/web/server.js"]');
  });

  it("requires successful migration completion before starting web", () => {
    expect(serviceBlock("web")).toContain("service_completed_successfully");
  });
});

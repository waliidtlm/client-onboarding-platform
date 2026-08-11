import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const repositoryRoot = path.resolve(import.meta.dirname, "..");
const markdownFiles = [
  "README.md",
  "automation/n8n/README.md",
  "docs/client_onboarding_platform_blueprint.md",
  "docs/security-hardening.md",
  "docs/security/dependency-risk-exceptions.md",
  "docs/demo-script.md",
  "docs/deployment.md",
  "docs/known-limitations.md",
].filter((file) => existsSync(path.join(repositoryRoot, file)));

const failures = [];
const linkPattern = /(?<!!)\[[^\]]*]\(([^)]+)\)/g;

for (const relativeFile of markdownFiles) {
  const absoluteFile = path.join(repositoryRoot, relativeFile);
  const content = readFileSync(absoluteFile, "utf8");
  for (const match of content.matchAll(linkPattern)) {
    const rawTarget = match[1]?.trim().replace(/^<|>$/g, "");
    if (!rawTarget || rawTarget.startsWith("#") || /^(?:https?:|mailto:)/i.test(rawTarget)) {
      continue;
    }
    const targetWithoutAnchor = decodeURIComponent(rawTarget.split("#", 1)[0] ?? "");
    const resolved = path.resolve(path.dirname(absoluteFile), targetWithoutAnchor);
    if (!existsSync(resolved)) {
      failures.push(`${relativeFile}: missing ${rawTarget}`);
    }
  }
}

if (failures.length) {
  throw new Error(`Documentation link validation failed:\n${failures.join("\n")}`);
}

process.stdout.write(`Validated local links in ${markdownFiles.length} documentation files.\n`);

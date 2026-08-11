import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const repositoryRoot = path.resolve(import.meta.dirname, "..");

function collectMarkdownFiles(relativeDirectory) {
  const absoluteDirectory = path.join(repositoryRoot, relativeDirectory);
  if (!existsSync(absoluteDirectory)) return [];
  return readdirSync(absoluteDirectory, { withFileTypes: true }).flatMap((entry) => {
    const relativePath = path.join(relativeDirectory, entry.name);
    if (entry.isDirectory()) return collectMarkdownFiles(relativePath);
    return entry.isFile() && entry.name.endsWith(".md") && !entry.name.endsWith(".local.md")
      ? [relativePath]
      : [];
  });
}

const markdownFiles = [
  "README.md",
  ...collectMarkdownFiles("docs"),
  ...collectMarkdownFiles(path.join("automation", "n8n")),
].sort();

const failures = [];
const linkPattern = /!?\[[^\]]*]\(([^)]+)\)/g;

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

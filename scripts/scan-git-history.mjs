import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const repositoryRoot = path.resolve(import.meta.dirname, "..");
const gitArgs = ["-c", `safe.directory=${repositoryRoot.replaceAll("\\", "/")}`];
const allowlist = JSON.parse(
  readFileSync(path.join(import.meta.dirname, "git-history-secret-allowlist.json"), "utf8"),
);
const allowed = new Set(
  allowlist.map(
    (entry) => `${entry.commit}:${entry.file}:${entry.detector}:${entry.fingerprintSha256}`,
  ),
);
const detectors = [
  { name: "private-key", pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g },
  { name: "aws-access-key", pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  {
    name: "github-token",
    pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{50,})\b/g,
  },
  { name: "slack-token", pattern: /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/g },
  { name: "stripe-live-key", pattern: /\b(?:sk|rk)_live_[A-Za-z0-9]{20,}\b/g },
  { name: "jwt", pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g },
];

function git(...args) {
  const result = spawnSync("git", [...gitArgs, ...args], {
    cwd: repositoryRoot,
    encoding: "utf8",
    maxBuffer: 128 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || `git ${args[0]} failed`);
  }
  return result.stdout;
}

const commits = git("rev-list", "--all").split(/\r?\n/).filter(Boolean);
const findings = [];

for (const commit of commits) {
  const files = git("diff-tree", "--root", "--no-commit-id", "--name-only", "-r", commit)
    .split(/\r?\n/)
    .filter(Boolean);
  for (const file of files) {
    const shown = spawnSync("git", [...gitArgs, "show", `${commit}:${file}`], {
      cwd: repositoryRoot,
      encoding: "utf8",
      maxBuffer: 2 * 1024 * 1024,
    });
    if (shown.status !== 0 || shown.stdout.includes("\u0000")) continue;
    for (const detector of detectors) {
      for (const match of shown.stdout.matchAll(detector.pattern)) {
        const fingerprintSha256 = createHash("sha256").update(match[0]).digest("hex");
        const key = `${commit}:${file}:${detector.name}:${fingerprintSha256}`;
        if (!allowed.has(key)) {
          findings.push({ commit, file, detector: detector.name });
        }
      }
    }
  }
}

if (findings.length) {
  for (const finding of findings) {
    process.stderr.write(
      `${finding.file} ${finding.commit} ${finding.detector} (matched value redacted)\n`,
    );
  }
  process.exitCode = 1;
} else {
  process.stdout.write(`Scanned ${commits.length} commits; no credential patterns detected.\n`);
}

import { spawnSync } from "node:child_process";
import path from "node:path";

const repositoryRoot = path.resolve(import.meta.dirname, "..");
const packageManager = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const commands = [
  ["db:validate"],
  ["n8n:validate"],
  ["docs:links"],
  ["format:check"],
  ["lint"],
  ["typecheck"],
  ["test"],
  ["build"],
  ["secret:scan"],
  ["audit", "--prod", "--audit-level", "high"],
  ["git:diff-check"],
  ["history:scan"],
  ["docs:mermaid:validate"],
  ["demo:phase7"],
  ["screenshots:scan"],
];

for (const args of commands) {
  const executable = process.platform === "win32" ? "cmd.exe" : packageManager;
  const executableArgs =
    process.platform === "win32" ? ["/d", "/s", "/c", [packageManager, ...args].join(" ")] : args;
  const result = spawnSync(executable, executableArgs, {
    cwd: repositoryRoot,
    env: process.env,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

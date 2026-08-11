import path from "node:path";
import { spawnSync } from "node:child_process";

const repositoryRoot = path.resolve(import.meta.dirname, "..");
const safeRepositoryRoot = repositoryRoot.replaceAll("\\", "/");
const result = spawnSync("git", ["-c", `safe.directory=${safeRepositoryRoot}`, "diff", "--check"], {
  cwd: repositoryRoot,
  stdio: "inherit",
});

process.exit(result.status ?? 1);

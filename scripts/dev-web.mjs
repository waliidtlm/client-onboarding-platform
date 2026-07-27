import { spawn } from "node:child_process";

import { config } from "dotenv";

config({ path: ".env", quiet: true });

const port = process.env.WEB_PORT;

if (!port || !/^\d+$/.test(port)) {
  throw new Error("WEB_PORT must be configured in .env");
}

const command = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const child = spawn(command, ["--filter", "@client-onboarding/web", "dev", "--", "--port", port], {
  env: {
    ...process.env,
    NEXTAUTH_URL: `http://127.0.0.1:${port}`,
  },
  stdio: "inherit",
  shell: false,
});

child.on("exit", (code) => {
  process.exitCode = code ?? 1;
});

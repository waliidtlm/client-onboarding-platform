import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const workflowsDirectory = path.resolve("automation/n8n/workflows");
const files = (await readdir(workflowsDirectory)).filter((file) => file.endsWith(".json")).sort();

if (files.length !== 2) {
  throw new Error(`Expected exactly two Phase 3 workflow exports, found ${files.length}`);
}

const ids = new Set();
for (const file of files) {
  const source = await readFile(path.join(workflowsDirectory, file), "utf8");
  const workflow = JSON.parse(source);
  if (workflow.active !== false) throw new Error(`${file} must be exported inactive`);
  if (!workflow.id || workflow.id.length > 36 || ids.has(workflow.id)) {
    throw new Error(`${file} has a missing, oversized, or duplicate id`);
  }
  ids.add(workflow.id);
  if (!Array.isArray(workflow.nodes) || workflow.nodes.length < 2) {
    throw new Error(`${file} has no executable workflow graph`);
  }
  for (const node of workflow.nodes) {
    const code = node.parameters?.jsCode;
    if (typeof code === "string") {
      const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
      new AsyncFunction(code);
    }
  }
  if (/EXAMPLE_ONLY|integration-automation|local-phase3/i.test(source)) {
    throw new Error(`${file} contains a credential-like literal`);
  }
}

const consumer = JSON.parse(
  await readFile(
    path.join(workflowsDirectory, "phase3-onboarding-activation-consumer.json"),
    "utf8",
  ),
);
if (consumer.settings?.errorWorkflow !== "phase3-automation-error-handler") {
  throw new Error("The consumer must reference the shared Phase 3 error workflow");
}

console.log(`Validated ${files.length} inactive Phase 3 n8n workflow exports.`);

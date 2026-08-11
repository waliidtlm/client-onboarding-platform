import { readFileSync } from "node:fs";
import path from "node:path";

const repositoryRoot = path.resolve(import.meta.dirname, "..");
const diagramFile = path.join(repositoryRoot, "docs", "architecture.md");
const content = readFileSync(diagramFile, "utf8");
const blocks = [...content.matchAll(/```mermaid\s+([\s\S]*?)```/g)].map((match) => match[1].trim());

if (blocks.length < 2) {
  throw new Error(
    "Architecture documentation must contain both architecture and ER Mermaid diagrams",
  );
}

for (const [index, block] of blocks.entries()) {
  if (!/^(?:flowchart|sequenceDiagram|erDiagram)\b/.test(block)) {
    throw new Error(`Mermaid block ${index + 1} has an unsupported or missing diagram declaration`);
  }
  const delimiters = block.startsWith("erDiagram")
    ? []
    : [
        ["[", "]"],
        ["(", ")"],
        ["{", "}"],
      ];
  for (const [opening, closing] of delimiters) {
    const opens = [...block].filter((character) => character === opening).length;
    const closes = [...block].filter((character) => character === closing).length;
    if (opens !== closes) {
      throw new Error(`Mermaid block ${index + 1} has unbalanced ${opening}${closing}`);
    }
  }
}

process.stdout.write(`Validated ${blocks.length} Mermaid diagrams.\n`);

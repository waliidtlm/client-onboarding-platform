import { readFileSync } from "node:fs";
import path from "node:path";

const repositoryRoot = path.resolve(import.meta.dirname, "..");
const diagramFiles = ["README.md", path.join("docs", "architecture.md")];
const blocks = diagramFiles.flatMap((relativeFile) => {
  const content = readFileSync(path.join(repositoryRoot, relativeFile), "utf8");
  return [...content.matchAll(/```mermaid\s+([\s\S]*?)```/g)].map((match, index) => ({
    block: match[1].trim(),
    index,
    relativeFile,
  }));
});

const architectureBlocks = blocks.filter(({ relativeFile }) =>
  relativeFile.endsWith(path.join("docs", "architecture.md")),
);
if (architectureBlocks.length < 2) {
  throw new Error(
    "Architecture documentation must contain both architecture and ER Mermaid diagrams",
  );
}

for (const { block, index, relativeFile } of blocks) {
  if (!/^(?:flowchart|sequenceDiagram|erDiagram)\b/.test(block)) {
    throw new Error(
      `${relativeFile} Mermaid block ${index + 1} has an unsupported or missing diagram declaration`,
    );
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
      throw new Error(
        `${relativeFile} Mermaid block ${index + 1} has unbalanced ${opening}${closing}`,
      );
    }
  }
}

process.stdout.write(`Validated ${blocks.length} Mermaid diagrams.\n`);

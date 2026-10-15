import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const START = "<!-- exa-quickstart:start -->";
export const END = "<!-- exa-quickstart:end -->";

/** Instructions a coding agent reads before touching search code in this project. */
export function agentBlock(integrationPath: string): string {
  return `${START}
## Web search with Exa

This project calls the [Exa](https://exa.ai) search API through the \`exa-js\` SDK.

- **Key:** read from \`EXA_API_KEY\`. Keep it in \`.env.local\` (git-ignored). Never hard-code it or commit it.
- **Existing integration:** \`${integrationPath}\`. Extend it instead of creating a second Exa client.
- **Defaults to use:** \`exa.search(query, { type: "auto", contents: { highlights: true } })\`. Highlights are the most
  token-efficient content for agents; request \`text: true\` only when the full page is needed.
- **Answers with citations:** \`exa.answer(question)\` returns an answer plus the sources it used.
- **Verify a change:** \`node --env-file=.env.local scripts/exa-check.mjs\` makes one real call and prints JSON.
- **Docs:** https://docs.exa.ai
${END}`;
}

/** Inserts the block, or replaces an earlier one, so running the tool twice never duplicates it. */
export function upsertBlock(existing: string, block: string): string {
  const start = existing.indexOf(START);
  const end = existing.indexOf(END);
  if (start !== -1 && end > start) {
    return existing.slice(0, start) + block + existing.slice(end + END.length);
  }
  const separator = existing.trim() ? (existing.endsWith("\n") ? "\n" : "\n\n") : "";
  return `${existing}${separator}${block}\n`;
}

/** The instruction files to update: AGENTS.md always, CLAUDE.md only if the project already has one. */
export function agentFiles(projectDir: string): string[] {
  const files = ["AGENTS.md"];
  if (existsSync(join(projectDir, "CLAUDE.md"))) files.push("CLAUDE.md");
  return files;
}

export function readOrEmpty(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

/** Adds the env-file patterns that keep EXA_API_KEY out of git. Returns null when nothing is missing. */
export function gitignoreAdditions(current: string): string | null {
  const lines = new Set(current.split(/\r?\n/).map((l) => l.trim()));
  const covered = (pattern: string) => lines.has(pattern) || lines.has(".env*") || lines.has(".env.*");
  const missing = [".env", ".env.local"].filter((p) => !covered(p) && !(p === ".env.local" && lines.has("*.local")));
  if (missing.length === 0) return null;
  const separator = current && !current.endsWith("\n") ? "\n" : "";
  return `${current}${separator}\n# Exa API key lives here (added by exa-quickstart)\n${missing.join("\n")}\n`;
}

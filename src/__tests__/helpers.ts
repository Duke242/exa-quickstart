import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { Deps } from "../run.js";

/** Creates a throwaway project from a { "relative/path": contents } map. */
export function makeProject(files: Record<string, string | object>): string {
  const dir = mkdtempSync(join(tmpdir(), "exa-qs-"));
  for (const [rel, contents] of Object.entries(files)) {
    const abs = join(dir, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, typeof contents === "string" ? contents : JSON.stringify(contents, null, 2));
  }
  return dir;
}

export const KEY = "exa-test-key-1234567890abcdef";

/** Deps that never touch the network or a package manager, and record what was called. */
export function fakeDeps(overrides: Partial<Deps> = {}): Deps & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    env: {},
    validate: async () => {
      calls.push("validate");
      return { ok: true, latencyMs: 42, sampleTitle: "Exa API docs", sampleUrl: "https://docs.exa.ai" };
    },
    install: () => {
      calls.push("install");
      return { ok: true, output: "" };
    },
    firstCall: () => {
      calls.push("firstCall");
      return { ok: true, output: '{"ok":true,"title":"Exa API docs","url":"https://docs.exa.ai"}' };
    },
    ...overrides,
  };
}

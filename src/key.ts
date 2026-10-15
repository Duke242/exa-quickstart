import { readFileSync } from "node:fs";
import { join } from "node:path";

export type KeySource = "environment" | ".env.local" | ".env";

export interface FoundKey {
  key: string;
  source: KeySource;
}

/** Reads `NAME=value` from a dotenv file without pulling in a dependency. Quotes are stripped. */
export function readDotenvValue(path: string, name: string): string | undefined {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match || match[1] !== name) continue;
    const value = match[2].trim().replace(/^(['"])(.*)\1$/, "$2");
    return value || undefined;
  }
  return undefined;
}

/**
 * Finds EXA_API_KEY the way a developer would expect: the shell first, then the
 * project's .env.local, then .env. The key itself is never printed.
 */
export function findApiKey(projectDir: string, env: NodeJS.ProcessEnv = process.env): FoundKey | undefined {
  if (env.EXA_API_KEY?.trim()) return { key: env.EXA_API_KEY.trim(), source: "environment" };
  for (const file of [".env.local", ".env"] as const) {
    const key = readDotenvValue(join(projectDir, file), "EXA_API_KEY");
    if (key) return { key, source: file };
  }
  return undefined;
}

/** "abcd…wxyz" — enough to tell keys apart in output without exposing one. */
export function maskKey(key: string): string {
  return key.length <= 8 ? "••••" : `${key.slice(0, 4)}…${key.slice(-4)}`;
}

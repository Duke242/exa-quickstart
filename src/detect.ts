import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type Framework = "next-app" | "next-pages" | "express" | "node";
export type PackageManager = "npm" | "pnpm" | "yarn" | "bun";

export interface ProjectInfo {
  framework: Framework;
  typescript: boolean;
  esm: boolean;
  packageManager: PackageManager;
  /** "src" when the project keeps its code under src/, otherwise "". */
  srcDir: string;
  hasExaSdk: boolean;
}

export class NotAProjectError extends Error {
  constructor(dir: string) {
    super(`No package.json in ${dir}. Run this inside a Node.js project, or pass --dir <path>.`);
  }
}

function readPackageJson(dir: string): Record<string, any> {
  const path = join(dir, "package.json");
  if (!existsSync(path)) throw new NotAProjectError(dir);
  return JSON.parse(readFileSync(path, "utf8"));
}

export function detectPackageManager(dir: string, pkg: Record<string, any> = {}): PackageManager {
  const declared = typeof pkg.packageManager === "string" ? pkg.packageManager.split("@")[0] : undefined;
  if (declared === "pnpm" || declared === "yarn" || declared === "bun" || declared === "npm") return declared;
  if (existsSync(join(dir, "pnpm-lock.yaml"))) return "pnpm";
  if (existsSync(join(dir, "yarn.lock"))) return "yarn";
  if (existsSync(join(dir, "bun.lockb")) || existsSync(join(dir, "bun.lock"))) return "bun";
  return "npm";
}

/** Reads package.json and the folder layout; never runs project code. */
export function detectProject(dir: string): ProjectInfo {
  const pkg = readPackageJson(dir);
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  const typescript = Boolean(deps.typescript) || existsSync(join(dir, "tsconfig.json"));
  const srcDir = existsSync(join(dir, "src")) ? "src" : "";

  let framework: Framework = "node";
  if (deps.next) {
    const hasAppDir = existsSync(join(dir, "app")) || existsSync(join(dir, "src", "app"));
    const hasPagesDir = existsSync(join(dir, "pages")) || existsSync(join(dir, "src", "pages"));
    // The App Router is Next's default since 13.4; prefer it unless the project only has pages/.
    framework = hasPagesDir && !hasAppDir ? "next-pages" : "next-app";
  } else if (deps.express) {
    framework = "express";
  }

  return {
    framework,
    typescript,
    esm: pkg.type === "module",
    packageManager: detectPackageManager(dir, pkg),
    srcDir: framework.startsWith("next") ? (existsSync(join(dir, "src", "app")) || existsSync(join(dir, "src", "pages")) ? "src" : "") : srcDir,
    hasExaSdk: Boolean(deps["exa-js"]),
  };
}

export function installCommand(pm: PackageManager): [string, string[]] {
  switch (pm) {
    case "pnpm": return ["pnpm", ["add", "exa-js"]];
    case "yarn": return ["yarn", ["add", "exa-js"]];
    case "bun": return ["bun", ["add", "exa-js"]];
    default: return ["npm", ["install", "exa-js"]];
  }
}

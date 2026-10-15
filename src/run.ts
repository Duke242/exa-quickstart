import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { agentBlock, agentFiles, gitignoreAdditions, readOrEmpty, upsertBlock } from "./agents.js";
import { detectProject, installCommand, type ProjectInfo } from "./detect.js";
import { findApiKey, maskKey } from "./key.js";
import { checkScript, integrationFile } from "./templates.js";
import { validateKey, type ValidationResult } from "./validate.js";

export type StepStatus = "ok" | "skipped" | "failed" | "action_needed";

export interface Step {
  name: "key" | "validate" | "detect" | "install" | "write" | "agents" | "gitignore" | "first_call";
  status: StepStatus;
  detail: string;
}

export interface Options {
  dir: string;
  force: boolean;
  dryRun: boolean;
  skipInstall: boolean;
}

export interface Report {
  ok: boolean;
  /** 0 done, 1 something broke, 2 the developer has to act (missing or bad key). */
  exitCode: 0 | 1 | 2;
  project: ProjectInfo | null;
  steps: Step[];
  next: string[];
}

/** Side effects the run needs, injectable so tests never touch the network or a package manager. */
export interface Deps {
  validate: (key: string) => Promise<ValidationResult>;
  install: (dir: string, project: ProjectInfo) => { ok: boolean; output: string };
  firstCall: (dir: string, key: string) => { ok: boolean; output: string };
  env: NodeJS.ProcessEnv;
}

export const realDeps: Deps = {
  validate: (key) => validateKey(key),
  install(dir, project) {
    const [cmd, args] = installCommand(project.packageManager);
    const r = spawnSync(cmd, args, { cwd: dir, encoding: "utf8", shell: process.platform === "win32" });
    return { ok: r.status === 0, output: `${r.stdout ?? ""}${r.stderr ?? ""}`.trim() };
  },
  firstCall(dir, key) {
    const r = spawnSync(process.execPath, [checkScript().path], {
      cwd: dir,
      encoding: "utf8",
      timeout: 30_000,
      env: { ...process.env, EXA_API_KEY: key, NODE_NO_WARNINGS: "1" },
    });
    return { ok: r.status === 0, output: `${r.stdout ?? ""}${r.stderr ?? ""}`.trim() };
  },
  env: process.env,
};

function write(dir: string, relPath: string, contents: string, dryRun: boolean): void {
  if (dryRun) return;
  const abs = join(dir, relPath);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, contents);
}

export async function run(opts: Options, deps: Deps = realDeps): Promise<Report> {
  const steps: Step[] = [];
  const next: string[] = [];
  const done = (exitCode: 0 | 1 | 2, project: ProjectInfo | null): Report => ({ ok: exitCode === 0, exitCode, project, steps, next });

  // 1. Detect first: a wrong directory is the cheapest mistake to report.
  let project: ProjectInfo;
  try {
    project = detectProject(opts.dir);
    steps.push({ name: "detect", status: "ok", detail: `${project.framework}, ${project.typescript ? "TypeScript" : "JavaScript"}, ${project.packageManager}` });
  } catch (error) {
    steps.push({ name: "detect", status: "failed", detail: (error as Error).message });
    return done(1, null);
  }

  // 2. Key.
  const found = findApiKey(opts.dir, deps.env);
  if (!found) {
    steps.push({ name: "key", status: "action_needed", detail: "No EXA_API_KEY in your shell, .env.local or .env." });
    next.push("Create a key at https://dashboard.exa.ai/api-keys", "Add EXA_API_KEY=<your key> to .env.local", "Run exa-quickstart again");
    return done(2, project);
  }
  steps.push({ name: "key", status: "ok", detail: `Found ${maskKey(found.key)} in ${found.source}` });

  // 3. Validate with one real search.
  const check = await deps.validate(found.key);
  if (!check.ok) {
    steps.push({ name: "validate", status: check.problem === "invalid_key" || check.problem === "out_of_credits" ? "action_needed" : "failed", detail: `${check.problem}: ${check.message}` });
    next.push(check.fix);
    return done(check.problem === "invalid_key" || check.problem === "out_of_credits" ? 2 : 1, project);
  }
  steps.push({ name: "validate", status: "ok", detail: `Key works (${check.latencyMs} ms)${check.sampleTitle ? `: "${check.sampleTitle}"` : ""}` });

  // 4. Install the SDK with the project's own package manager.
  if (project.hasExaSdk) {
    steps.push({ name: "install", status: "skipped", detail: "exa-js is already a dependency" });
  } else if (opts.skipInstall || opts.dryRun) {
    steps.push({ name: "install", status: "skipped", detail: opts.dryRun ? "dry run" : "--skip-install" });
    next.push(installCommand(project.packageManager).flat().join(" "));
  } else {
    const r = deps.install(opts.dir, project);
    steps.push({ name: "install", status: r.ok ? "ok" : "failed", detail: r.ok ? `Installed exa-js with ${project.packageManager}` : r.output.split("\n").slice(-5).join("\n") });
    if (!r.ok) return done(1, project);
  }

  // 5. Write the integration and the check script, never clobbering the developer's code.
  const integration = integrationFile(project);
  const written: string[] = [];
  for (const file of [integration, checkScript()]) {
    if (existsSync(join(opts.dir, file.path)) && !opts.force) {
      steps.push({ name: "write", status: "skipped", detail: `${file.path} already exists (use --force to overwrite)` });
      continue;
    }
    write(opts.dir, file.path, file.contents, opts.dryRun);
    written.push(file.path);
  }
  if (written.length) steps.push({ name: "write", status: "ok", detail: `${opts.dryRun ? "Would write" : "Wrote"} ${written.join(", ")}` });

  // 6. Tell the developer's coding agent how Exa is wired here.
  const block = agentBlock(integration.path);
  const agentTargets = agentFiles(opts.dir);
  for (const f of agentTargets) write(opts.dir, f, upsertBlock(readOrEmpty(join(opts.dir, f)), block), opts.dryRun);
  steps.push({ name: "agents", status: "ok", detail: `${opts.dryRun ? "Would update" : "Updated"} ${agentTargets.join(" and ")}` });

  // 7. Keep the key out of git.
  const gitignore = gitignoreAdditions(readOrEmpty(join(opts.dir, ".gitignore")));
  if (gitignore) {
    write(opts.dir, ".gitignore", gitignore, opts.dryRun);
    steps.push({ name: "gitignore", status: "ok", detail: "Added .env files to .gitignore" });
  } else {
    steps.push({ name: "gitignore", status: "skipped", detail: ".env files are already ignored" });
  }
  if (found.source === "environment") next.push("Save the key for later runs: add EXA_API_KEY to .env.local");

  // 8. First real call from inside the project, through its own node_modules.
  if (opts.dryRun || (opts.skipInstall && !project.hasExaSdk)) {
    steps.push({ name: "first_call", status: "skipped", detail: "Run node --env-file=.env.local scripts/exa-check.mjs after installing" });
  } else {
    const r = deps.firstCall(opts.dir, found.key);
    const line = r.output.split("\n").filter((l) => l.startsWith("{")).pop();
    steps.push({ name: "first_call", status: r.ok ? "ok" : "failed", detail: r.ok ? `First call from your project succeeded${line ? `: ${line}` : ""}` : r.output.slice(-400) });
    if (!r.ok) return done(1, project);
  }

  next.push(integration.usage);
  return done(0, project);
}

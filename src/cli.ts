#!/usr/bin/env node
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { run, type Report, type StepStatus } from "./run.js";

const HELP = `exa-quickstart: from Exa API key to a working search call in your project.

Usage: npx exa-quickstart [options]

Options
  --dir <path>      Project to set up (default: current directory)
  --dry-run         Show what would change without writing or installing anything
  --skip-install    Don't install exa-js
  --force           Overwrite files this tool generated before
  --json            Print one machine-readable report (for coding agents and CI)
  -h, --help        Show this help

Exit codes: 0 done · 1 something failed · 2 you need to act (missing or invalid key)`;

const ICON: Record<StepStatus, string> = { ok: "✔", skipped: "–", failed: "✖", action_needed: "!" };

function printHuman(report: Report): void {
  for (const step of report.steps) console.log(`${ICON[step.status]} ${step.name.padEnd(10)} ${step.detail}`);
  if (report.next.length) {
    console.log(report.ok ? "\nNext:" : "\nTo finish:");
    for (const n of report.next) console.log(`  → ${n}`);
  }
}

async function main(): Promise<number> {
  let values;
  try {
    ({ values } = parseArgs({
      options: {
        dir: { type: "string" },
        "dry-run": { type: "boolean", default: false },
        "skip-install": { type: "boolean", default: false },
        force: { type: "boolean", default: false },
        json: { type: "boolean", default: false },
        help: { type: "boolean", short: "h", default: false },
      },
    }));
  } catch (error) {
    console.error(`${(error as Error).message}\n\n${HELP}`);
    return 1;
  }
  if (values.help) {
    console.log(HELP);
    return 0;
  }

  const report = await run({
    dir: resolve(values.dir ?? process.cwd()),
    dryRun: values["dry-run"]!,
    skipInstall: values["skip-install"]!,
    force: values.force!,
  });

  if (values.json) console.log(JSON.stringify(report, null, 2));
  else printHuman(report);
  return report.exitCode;
}

main().then((code) => process.exit(code));

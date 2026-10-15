# exa-quickstart

From an Exa API key to a working search call **inside your own project**, in one command. Built for developers and for the coding agents working alongside them.

```bash
npx exa-quickstart          # once published to npm
npx github:Duke242/exa-quickstart   # straight from GitHub
```

Real output on a fresh `create-next-app` project:

```
✔ detect     next-app, TypeScript, npm
✔ key        Found 3f2a…9c1d in .env.local
✔ validate   Key works (298 ms): https://exa.ai/docs/reference/search
✔ install    Installed exa-js with npm
✔ write      Wrote app/api/exa-search/route.ts, scripts/exa-check.mjs
✔ agents     Updated AGENTS.md
– gitignore  .env files are already ignored
✔ first_call First call from your project succeeded: {"ok":true,...}

Next:
  → Start your dev server and open /api/exa-search?q=hello
```

## What it does

1. **Finds your key** in the shell, `.env.local` or `.env`. It never prints the key, only a masked form.
2. **Validates it** with one minimal real search, and turns failures into fixes: an invalid key links to the dashboard, an empty balance links to billing, and network errors say so.
3. **Detects your project:** Next.js (App or Pages Router, with or without `src/`), Express (ESM or CommonJS), or plain Node, plus TypeScript and your package manager (npm, pnpm, yarn, bun).
4. **Installs `exa-js`** with that package manager.
5. **Writes the integration where your framework expects it,** using Exa's recommended agentic defaults (`type: "auto"`, highlights). It never overwrites your files unless you pass `--force`.
6. **Tells your coding agent how Exa is wired here** by adding a short, idempotent section to `AGENTS.md` (and `CLAUDE.md` if you have one): where the key lives, which file to extend, which defaults to use, and how to verify a change.
7. **Keeps the key out of git** by adding `.env` and `.env.local` to `.gitignore` if they're missing.
8. **Proves it works** by making the first real call from inside your project, through your own installed SDK.

## Built for agents too

Coding agents run commands, so the CLI is non-interactive and machine-readable:

- `--json` prints one structured report: every step's status, the detected project, and what to do next.
- Exit codes are meaningful: `0` done, `1` something failed, `2` a human has to act (missing or invalid key).
- Every run is idempotent, so an agent can safely retry.

## Verified end to end

Before release it was run against Exa's live API on a fresh `create-next-app` (Next.js 15, App Router, TypeScript), an Express app (CommonJS) and a plain Node project. In each one it installed the SDK, wrote the integration and made a real call from inside the project; the generated Next.js route passes the project's own `tsc` check and returns live results from a running dev server.

## Options

| Flag | Effect |
| --- | --- |
| `--dir <path>` | Project to set up (default: current directory) |
| `--dry-run` | Show what would change; write and install nothing |
| `--skip-install` | Don't install `exa-js` |
| `--force` | Overwrite files this tool generated before |
| `--json` | Machine-readable report |

## Development

```bash
npm install
npm test        # TypeScript build + 29 tests with Node's built-in runner
```

Tests run against throwaway sample projects, with the network and package manager replaced by fakes, so they are fast and need no API key. The generated JavaScript is also syntax-checked for every framework.

## Why I built this

Exa's job posting for a full-stack engineer lists "agentic onboarding flows that quickly get developers (and their agents) from sign-up to first integration." This is a small, working take on that problem: the slowest part of trying a new API is wiring it into a real project, and that is also exactly where coding agents need clear instructions.

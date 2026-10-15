import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { START } from "../agents.js";
import { run, type Options } from "../run.js";
import { fakeDeps, KEY, makeProject } from "./helpers.js";

const opts = (dir: string, extra: Partial<Options> = {}): Options => ({ dir, force: false, dryRun: false, skipInstall: false, ...extra });
const nextProject = () => makeProject({ "package.json": { dependencies: { next: "15" } }, "app/page.tsx": "", "tsconfig.json": "{}", ".env.local": `EXA_API_KEY=${KEY}` });

describe("run", () => {
  it("sets up a Next.js project end to end", async () => {
    const dir = nextProject();
    const deps = fakeDeps();
    const report = await run(opts(dir), deps);

    assert.equal(report.exitCode, 0);
    assert.deepEqual(deps.calls, ["validate", "install", "firstCall"]);
    assert.ok(existsSync(join(dir, "app/api/exa-search/route.ts")));
    assert.ok(existsSync(join(dir, "scripts/exa-check.mjs")));
    assert.match(readFileSync(join(dir, "AGENTS.md"), "utf8"), /app\/api\/exa-search\/route\.ts/);
    assert.match(readFileSync(join(dir, ".gitignore"), "utf8"), /\.env\.local/);
  });

  it("stops before writing anything when there is no key, and says how to get one", async () => {
    const dir = makeProject({ "package.json": { name: "x" } });
    const deps = fakeDeps();
    const report = await run(opts(dir), deps);

    assert.equal(report.exitCode, 2);
    assert.deepEqual(deps.calls, []);
    assert.ok(!existsSync(join(dir, "AGENTS.md")));
    assert.match(report.next.join(" "), /dashboard\.exa\.ai\/api-keys/);
  });

  it("stops on an invalid key with the fix, without installing", async () => {
    const deps = fakeDeps({ validate: async () => ({ ok: false, problem: "invalid_key", message: "401", fix: "Create a key at https://dashboard.exa.ai/api-keys" }) });
    const report = await run(opts(nextProject()), deps);
    assert.equal(report.exitCode, 2);
    assert.ok(!deps.calls.includes("install"));
  });

  it("never prints the key, even in the JSON report", async () => {
    const report = await run(opts(nextProject()), fakeDeps());
    assert.ok(!JSON.stringify(report).includes(KEY));
  });

  it("is safe to run twice: no duplicate agent block, no overwritten code", async () => {
    const dir = nextProject();
    await run(opts(dir), fakeDeps());
    const second = await run(opts(dir), fakeDeps());

    assert.equal(second.exitCode, 0);
    assert.equal(readFileSync(join(dir, "AGENTS.md"), "utf8").split(START).length - 1, 1);
    assert.ok(second.steps.some((s) => s.name === "write" && s.status === "skipped"));
  });

  it("leaves an existing file alone unless --force", async () => {
    const dir = makeProject({ "package.json": { name: "x" }, "exa-search.mjs": "// mine", ".env": `EXA_API_KEY=${KEY}` });
    await run(opts(dir), fakeDeps());
    assert.equal(readFileSync(join(dir, "exa-search.mjs"), "utf8"), "// mine");
    await run(opts(dir, { force: true }), fakeDeps());
    assert.notEqual(readFileSync(join(dir, "exa-search.mjs"), "utf8"), "// mine");
  });

  it("changes nothing on --dry-run", async () => {
    const dir = nextProject();
    const deps = fakeDeps();
    const report = await run(opts(dir, { dryRun: true }), deps);

    assert.equal(report.exitCode, 0);
    assert.deepEqual(deps.calls, ["validate"]);
    for (const f of ["AGENTS.md", ".gitignore", "app/api/exa-search/route.ts"]) assert.ok(!existsSync(join(dir, f)), f);
  });

  it("updates CLAUDE.md only when the project already has one", async () => {
    const withClaude = makeProject({ "package.json": { name: "x" }, "CLAUDE.md": "# Rules\n", ".env": `EXA_API_KEY=${KEY}` });
    await run(opts(withClaude), fakeDeps());
    assert.match(readFileSync(join(withClaude, "CLAUDE.md"), "utf8"), /^# Rules\n[\s\S]*exa-quickstart:start/);

    const without = makeProject({ "package.json": { name: "x" }, ".env": `EXA_API_KEY=${KEY}` });
    await run(opts(without), fakeDeps());
    assert.ok(!existsSync(join(without, "CLAUDE.md")));
  });

  it("skips install when exa-js is already a dependency", async () => {
    const dir = makeProject({ "package.json": { dependencies: { "exa-js": "2" } }, ".env": `EXA_API_KEY=${KEY}` });
    const deps = fakeDeps();
    await run(opts(dir), deps);
    assert.ok(!deps.calls.includes("install"));
  });

  it("fails clearly if the first real call from the project fails", async () => {
    const deps = fakeDeps({ firstCall: () => ({ ok: false, output: "Error: boom" }) });
    const report = await run(opts(nextProject()), deps);
    assert.equal(report.exitCode, 1);
    assert.match(report.steps.at(-1)!.detail, /boom/);
  });

  it("explains npm peer-dependency conflicts instead of dumping the log tail", async () => {
    const eresolve = "npm error code ERESOLVE\nnpm error ERESOLVE unable to resolve dependency tree\nnpm error\nnpm error For a full report see:\nnpm error /x/eresolve-report.txt";
    const report = await run(opts(nextProject()), fakeDeps({ install: () => ({ ok: false, output: eresolve }) }));
    const install = report.steps.find((s) => s.name === "install")!;
    assert.equal(report.exitCode, 1);
    assert.match(install.detail, /peer dependency/i);
    assert.match(report.next.join(" "), /npm install exa-js --legacy-peer-deps/);
  });

  it("shows the URL when the sample result has no title", async () => {
    const deps = fakeDeps({ validate: async () => ({ ok: true, latencyMs: 9, sampleTitle: "", sampleUrl: "https://exa.ai/docs" }) });
    const report = await run(opts(nextProject()), deps);
    assert.match(report.steps.find((s) => s.name === "validate")!.detail, /https:\/\/exa\.ai\/docs/);
  });
});

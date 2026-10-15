import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { agentBlock, END, gitignoreAdditions, START, upsertBlock } from "../agents.js";
import { detectProject, NotAProjectError } from "../detect.js";
import { findApiKey, maskKey } from "../key.js";
import { checkScript, integrationFile } from "../templates.js";
import { classifyError, validateKey } from "../validate.js";
import { KEY, makeProject } from "./helpers.js";

describe("findApiKey", () => {
  it("prefers the shell, then .env.local, then .env", () => {
    const dir = makeProject({ ".env": "EXA_API_KEY=from-env", ".env.local": "EXA_API_KEY=from-local" });
    assert.deepEqual(findApiKey(dir, { EXA_API_KEY: "from-shell" }), { key: "from-shell", source: "environment" });
    assert.deepEqual(findApiKey(dir, {}), { key: "from-local", source: ".env.local" });
  });

  it("handles quotes, export and comments", () => {
    const dir = makeProject({ ".env": '# comment\nOTHER=1\nexport EXA_API_KEY="quoted-key"\n' });
    assert.deepEqual(findApiKey(dir, {}), { key: "quoted-key", source: ".env" });
  });

  it("returns undefined when there is no key anywhere", () => {
    assert.equal(findApiKey(makeProject({}), {}), undefined);
  });

  it("masks keys so they never print in full", () => {
    assert.equal(maskKey(KEY), "exa-…cdef");
    assert.equal(maskKey("short"), "••••");
  });
});

describe("validateKey", () => {
  it("maps HTTP and network failures to fixes a developer can act on", () => {
    assert.equal(classifyError({ statusCode: 401 }), "invalid_key");
    assert.equal(classifyError({ statusCode: 402 }), "out_of_credits");
    assert.equal(classifyError({ statusCode: 429 }), "rate_limited");
    assert.equal(classifyError({ cause: { code: "ENOTFOUND" } }), "network");
    assert.equal(classifyError(new TypeError("fetch failed")), "network");
    assert.equal(classifyError(new Error("??")), "unknown");
  });

  it("reports latency and a sample result on success", async () => {
    const r = await validateKey(KEY, { search: async () => ({ results: [{ title: "Docs", url: "https://docs.exa.ai" }] }) });
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.sampleTitle, "Docs");
  });

  it("returns the fix instead of throwing on a bad key", async () => {
    const r = await validateKey(KEY, { search: async () => { throw Object.assign(new Error("Unauthorized"), { statusCode: 401 }); } });
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.fix, /dashboard\.exa\.ai\/api-keys/);
  });
});

describe("detectProject", () => {
  it("detects Next.js App Router, Pages Router and src/ layouts", () => {
    assert.equal(detectProject(makeProject({ "package.json": { dependencies: { next: "15" } }, "app/page.tsx": "" })).framework, "next-app");
    assert.equal(detectProject(makeProject({ "package.json": { dependencies: { next: "15" } }, "pages/index.js": "" })).framework, "next-pages");
    const src = detectProject(makeProject({ "package.json": { dependencies: { next: "15" } }, "src/app/page.tsx": "", "tsconfig.json": "{}" }));
    assert.deepEqual([src.framework, src.srcDir, src.typescript], ["next-app", "src", true]);
  });

  it("detects Express, module type and plain Node", () => {
    const express = detectProject(makeProject({ "package.json": { type: "module", dependencies: { express: "4" } } }));
    assert.deepEqual([express.framework, express.esm], ["express", true]);
    assert.equal(detectProject(makeProject({ "package.json": { name: "x" } })).framework, "node");
  });

  it("detects the package manager from packageManager or lockfiles", () => {
    assert.equal(detectProject(makeProject({ "package.json": {}, "pnpm-lock.yaml": "" })).packageManager, "pnpm");
    assert.equal(detectProject(makeProject({ "package.json": { packageManager: "yarn@4.1.0" } })).packageManager, "yarn");
    assert.equal(detectProject(makeProject({ "package.json": {} })).packageManager, "npm");
  });

  it("explains what to do outside a Node project", () => {
    assert.throws(() => detectProject(makeProject({})), NotAProjectError);
  });
});

describe("templates", () => {
  const base = { typescript: false, esm: false, packageManager: "npm" as const, srcDir: "", hasExaSdk: false };

  it("puts each framework's integration where that framework expects it", () => {
    assert.equal(integrationFile({ ...base, framework: "next-app", typescript: true }).path, "app/api/exa-search/route.ts");
    assert.equal(integrationFile({ ...base, framework: "next-app", srcDir: "src" }).path, "src/app/api/exa-search/route.js");
    assert.equal(integrationFile({ ...base, framework: "next-pages" }).path, "pages/api/exa-search.js");
    assert.equal(integrationFile({ ...base, framework: "express" }).path, "exaSearch.js");
    assert.equal(integrationFile({ ...base, framework: "node" }).path, "exa-search.mjs");
  });

  it("uses require() for CommonJS Express projects and import for ESM", () => {
    assert.match(integrationFile({ ...base, framework: "express" }).contents, /require\("exa-js"\)\.default/);
    assert.match(integrationFile({ ...base, framework: "express", esm: true }).contents, /^import Exa from "exa-js";/m);
  });

  it("generates JavaScript that parses", () => {
    const dir = mkdtempSync(join(tmpdir(), "exa-qs-syntax-"));
    const cases: [string, string][] = [
      ["express.cjs", integrationFile({ ...base, framework: "express" }).contents],
      ["express.mjs", integrationFile({ ...base, framework: "express", esm: true }).contents],
      ["next-app.mjs", integrationFile({ ...base, framework: "next-app" }).contents],
      ["next-pages.mjs", integrationFile({ ...base, framework: "next-pages" }).contents],
      ["node.mjs", integrationFile({ ...base, framework: "node" }).contents],
      ["check.mjs", checkScript().contents],
    ];
    for (const [name, contents] of cases) {
      const file = join(dir, name);
      writeFileSync(file, contents);
      assert.doesNotThrow(() => execFileSync(process.execPath, ["--check", file], { stdio: "pipe" }), name);
    }
  });

  it("uses Exa's recommended agentic defaults", () => {
    const code = integrationFile({ ...base, framework: "next-app" }).contents;
    assert.match(code, /type: "auto"/);
    assert.match(code, /highlights: true/);
  });
});

describe("agent instructions", () => {
  it("adds the block once and replaces it on later runs", () => {
    const first = upsertBlock("# My project\n", agentBlock("app/api/exa-search/route.ts"));
    const second = upsertBlock(first, agentBlock("src/app/api/exa-search/route.ts"));
    assert.equal(second.split(START).length - 1, 1);
    assert.equal(second.split(END).length - 1, 1);
    assert.match(second, /src\/app\/api\/exa-search/);
    assert.ok(second.startsWith("# My project\n"));
  });

  it("only adds the .env patterns that are missing", () => {
    assert.equal(gitignoreAdditions("node_modules\n.env*\n"), null);
    assert.equal(gitignoreAdditions(".env\n*.local\n"), null);
    assert.match(gitignoreAdditions("node_modules\n")!, /\.env\n\.env\.local/);
  });
});

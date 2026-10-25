import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { fixture } from "./engine-fixture.js";
import { buildStatus } from "../src/readiness.js";

test("readiness uses fixed auth probes and checks selected scope without inference or MCP writes", async (t) => {
  const f = await fixture(t), calls = [];
  for (const repo of f.repos) mkdirSync(repo.path, { recursive: true });
  const runtime = f.engine.adapters.runtimes.claude;
  runtime.executable = "configured-claude";
  runtime.runner = async (file, args, options) => {
    calls.push({ file, args, options });
    return { code: 0, stdout: JSON.stringify({ loggedIn: true, token: "never-expose-test-secret" }), stderr: "" };
  };
  f.engine.adapters.config.orchestration = { models: [
    { id: "claude-test", runtime: "claude", available: true, verified: true, efforts: ["low"] },
    { id: "fable", runtime: "claude", available: true, verified: true, efforts: ["low"] },
  ] };
  const result = await f.engine.action("CHECK_READINESS", { questId: f.quest.id, runtime: "claude", role: "architect" });
  assert.equal(result.paidInvocation, false);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].args, ["auth", "status", "--json"]);
  assert.equal(result.rows.find((row) => row.check === "claude authentication").status, "PASSED");
  assert.ok(result.rows.some((row) => row.check.startsWith("Repository:") && row.status === "PASSED"));
  assert.doesNotMatch(JSON.stringify(result), /never-expose|fable/);
  assert.equal(f.pending.length, 0);
  assert.equal(buildStatus().restartRequired, false);
});

test("readiness keeps failed authentication and missing model policy actionable and does not require Codex", async (t) => {
  const f = await fixture(t);
  f.engine.adapters.runtimes.claude.executable = "configured-claude";
  f.engine.adapters.runtimes.claude.runner = async () => ({ code: 0, stdout: '{"loggedIn":false}', stderr: "" });
  const result = await f.engine.action("CHECK_READINESS", { runtime: "claude" });
  assert.equal(result.status, "BLOCKED");
  assert.equal(result.rows.find((row) => row.check === "claude authentication").status, "FAILED");
  assert.equal(result.rows.some((row) => /codex/.test(row.check)), false);
  assert.equal(f.pending.length, 0);
  await assert.rejects(f.engine.action("CHECK_READINESS", { runtime: "arbitrary-command" }), /Unsupported/);
});

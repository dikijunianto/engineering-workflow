import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, symlink, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Store } from "../src/store.js";
import { Engine } from "../src/engine.js";
import { createServer } from "../src/server.js";

const source = "---\nname: clear-writing\ndescription: Write clear explanations.\nversion: 1.0\n---\n# Clear writing\nUse short sentences.\n";
async function fixture(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "devquest-skills-"));
  const folder = path.join(dir, "skill with spaces & punctuation");
  await mkdir(folder);
  await writeFile(path.join(folder, "SKILL.md"), source);
  const store = new Store(path.join(dir, "data"));
  const engine = new Engine({ store, adapters: { config: {}, runtimes: {}, git: {} } });
  t.after(async () => { await engine.close(); store.close(); await rm(dir, { recursive: true, force: true }); });
  const inspect = () => engine.action("INSPECT_SKILL", { path: folder });
  const input = async (overrides = {}) => ({
    path: folder, sourceHash: (await inspect()).sourceHash,
    runtimes: ["claude", "codex"], declarationConfirmed: true,
    requirements: { mode: "instructions", mcp: [], tools: [], other: "" }, ...overrides,
  });
  return { dir, folder, store, engine, inspect, input };
}

test("instructions-only registration persists canonical metadata without activating a skill", async (t) => {
  const f = await fixture(t);
  const selected = await f.inspect();
  assert.equal(selected.name, "clear-writing");
  assert.equal(selected.description, "Write clear explanations.");
  assert.equal(selected.declaredVersion, "1.0");
  const registered = await f.engine.action("REGISTER_SKILL", await f.input());
  assert.deepEqual(registered.compatibility, { claude: "DECLARED_COMPATIBLE", codex: "DECLARED_COMPATIBLE" });
  assert.equal(registered.revision, 1);
  assert.equal(f.store.all("runs").length, 0);
  assert.deepEqual(f.engine.adapters.config, {});
  assert.equal(await readFile(path.join(f.folder, "SKILL.md"), "utf8"), source);
  assert.doesNotMatch(JSON.stringify(f.engine.snapshot().skills), /Use short sentences/);
  const reopened = new Store(f.store.dir);
  assert.equal(reopened.get("settings", registered.id).sourceHash, selected.sourceHash);
  reopened.close();
});

test("external requirements remain setup-needed; unassessed runtimes and requirements remain explicit", async (t) => {
  const f = await fixture(t);
  const needs = { mode: "external", mcp: ["atlassian"], tools: ["Read", "Skill"], other: "Jira account with metadata read access" };
  const registered = await f.engine.action("REGISTER_SKILL", await f.input({ runtimes: ["claude"], requirements: needs }));
  assert.deepEqual(registered.requirements, needs);
  assert.deepEqual(registered.compatibility, { claude: "REQUIRES_SETUP", codex: "NOT_ASSESSED" });
  const updated = await f.engine.action("UPDATE_SKILL", await f.input({ skillId: registered.id, revision: 1, requirements: { mode: "unknown", mcp: [], tools: [], other: "" } }));
  assert.equal(updated.compatibility.claude, "NEEDS_REVIEW");
  assert.equal(updated.revision, 2);
  assert.deepEqual(f.store.get("settings", updated.id).history[0].requirements, needs);
});

test("source hints prevent declaring a tool-dependent skill portable without review", async (t) => {
  const f = await fixture(t);
  await writeFile(path.join(f.folder, "SKILL.md"), "# Jira\nUse mcp__atlassian__getJiraIssue with credentials. Run Bash scripts/helper.sh.\n");
  const inspected = await f.inspect();
  assert.ok(inspected.sourceHints.length >= 3);
  const registered = await f.engine.action("REGISTER_SKILL", await f.input());
  assert.equal(registered.compatibility.claude, "NEEDS_REVIEW");
  assert.equal(registered.compatibility.codex, "NEEDS_REVIEW");
  assert.equal(f.store.all("runs").length, 0);
});

test("canonical paths deduplicate symlinked skill folders; source changes require reinspection", async (t) => {
  const f = await fixture(t);
  const registered = await f.engine.action("REGISTER_SKILL", await f.input());
  const linked = path.join(f.dir, "linked");
  await symlink(f.folder, linked, "dir");
  await assert.rejects(f.engine.action("REGISTER_SKILL", await f.input({ path: linked })), /already registered/);
  const stale = await f.input({ skillId: registered.id, revision: 1 });
  await writeFile(path.join(f.folder, "SKILL.md"), source + "\nAdditional instructions.\n");
  await assert.rejects(f.engine.action("UPDATE_SKILL", stale), /source changed/);
  assert.equal(f.store.get("settings", registered.id).sourceHash, registered.sourceHash);
  const refreshed = await f.engine.action("UPDATE_SKILL", await f.input({ skillId: registered.id, revision: 1 }));
  assert.notEqual(refreshed.sourceHash, registered.sourceHash);
  await assert.rejects(f.engine.action("UPDATE_SKILL", await f.input({ skillId: registered.id, revision: 1 })), /refresh before editing/);
});

test("invalid sources, unsupported runtimes and contradictory requirement declarations are rejected", async (t) => {
  const f = await fixture(t);
  await assert.rejects(f.engine.action("INSPECT_SKILL", { path: "relative/path" }), /absolute/);
  const other = path.join(f.dir, "not-skill.txt");
  await writeFile(other, "secret fixture");
  await assert.rejects(f.engine.action("INSPECT_SKILL", { path: other }), /real SKILL.md/);
  const alias = path.join(f.dir, "SKILL.md");
  await symlink(other, alias);
  await assert.rejects(f.engine.action("INSPECT_SKILL", { path: alias }), /real SKILL.md/);
  await assert.rejects(f.engine.action("REGISTER_SKILL", await f.input({ runtimes: ["unsupported"] })), /Unsupported/);
  await assert.rejects(f.engine.action("REGISTER_SKILL", await f.input({ requirements: { mode: "instructions", mcp: ["atlassian"], tools: [], other: "" } })), /cannot declare external/);
  await assert.rejects(f.engine.action("REGISTER_SKILL", await f.input({ requirements: { mode: "external", mcp: [], tools: [], other: "" } })), /Describe the required/);
  await writeFile(path.join(f.folder, "SKILL.md"), "x".repeat(128 * 1024 + 1));
  await assert.rejects(f.inspect(), /128 KB/);
});

test("removing a registration preserves its history and installed source", async (t) => {
  const f = await fixture(t);
  const registered = await f.engine.action("REGISTER_SKILL", await f.input({ declarationConfirmed: false }));
  assert.equal(registered.compatibility.claude, "NEEDS_REVIEW");
  await f.engine.action("ARCHIVE_SKILL", { skillId: registered.id, revision: 1 });
  assert.deepEqual(f.engine.skills.snapshot(), []);
  assert.equal(f.store.get("settings", registered.id).archived, true);
  assert.equal(await readFile(path.join(f.folder, "SKILL.md"), "utf8"), source);
});

test("skill actions require existing loopback authentication and never expose arbitrary execution", async (t) => {
  const f = await fixture(t);
  const app = await createServer({ dataDir: path.join(f.dir, "http-data"), port: 0, adapters: { config: {}, runtimes: {}, git: {} } });
  t.after(() => app.close());
  const request = (value, headers = {}) => fetch(`${app.url}/api/action`, {
    method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(value),
  });
  assert.equal((await request({ type: "INSPECT_SKILL", path: f.folder })).status, 403);
  const { token } = await (await fetch(`${app.url}/api/session`)).json();
  const headers = { "X-DevQuest-Token": token };
  assert.equal((await request({ type: "INSPECT_SKILL", path: f.folder }, { ...headers, Origin: "https://foreign.test" })).status, 403);
  const inspected = await request({ type: "INSPECT_SKILL", path: f.folder }, headers);
  assert.equal(inspected.status, 200);
  const { result } = await inspected.json();
  assert.equal(result.name, "clear-writing");
  const saved = await request({ type: "REGISTER_SKILL", ...await f.input() }, headers);
  assert.equal(saved.status, 200);
  assert.equal((await request({ type: "EXECUTE_SKILL", command: "echo forbidden" }, headers)).status, 400);
  assert.equal(app.store.all("runs").length, 0);
});

test("role assignments pin reviewed guidance, preserve permissions, and block source/runtime drift", async (t) => {
  const f = await fixture(t);
  const skill = await f.engine.action("REGISTER_SKILL", await f.input());
  const quest = f.store.put("quests", { id: "guidance-quest", repositoryIds: [], state: "INTAKE" });
  const pin = { id: skill.id, revision: skill.revision, hash: skill.sourceHash };
  await f.engine.action("SET_QUEST_SKILLS", { questId: quest.id, role: "architect", expectedRevision: 0, skills: [pin] });
  const current = f.store.get("quests", quest.id);
  const options = { purpose: "brainstorm", runtime: "claude", readOnly: true, prompt: "Current stage only", accessScope: { repositories: [] } };
  const prepared = f.engine.skills.prepare(current, options);
  assert.match(prepared.prompt, /Use short sentences/);
  assert.equal(prepared.readOnly, true);
  assert.deepEqual(prepared.accessScope, options.accessScope);
  assert.equal(prepared.registeredSkills[0].nativeInvocation, "NOT_VERIFIED");
  assert.equal(f.store.agentContextContent(prepared.registeredSkills[0].source), source);
  assert.deepEqual(f.engine.skills.prepare(current, options, prepared).registeredSkills, prepared.registeredSkills);
  assert.equal(f.engine.skills.prepare(current, { ...options, runtime: "codex" }).registeredSkills[0].runtime, "codex");
  await assert.rejects(f.engine.action("SET_QUEST_SKILLS", { questId: quest.id, role: "architect", expectedRevision: 0, skills: [] }), /refresh/);
  assert.throws(() => f.engine.skills.prepare(quest, options, prepared), /changed since/);
  await writeFile(path.join(f.folder, "SKILL.md"), source + "Changed.");
  assert.throws(() => f.engine.skills.prepare(current, options), /source changed/);
  assert.equal(f.store.all("runs").length, 0);
});

test("dependent skills and native Jira assignment cannot bypass managed integrations; active sessions block assignment", async (t) => {
  const f = await fixture(t);
  const skill = await f.engine.action("REGISTER_SKILL", await f.input({ runtimes: ["claude"] }));
  const quest = f.store.put("quests", { id: "guard-quest", repositoryIds: [], state: "INTAKE" });
  const payload = { questId: quest.id, role: "architect", expectedRevision: 0, skills: [{ id: skill.id, revision: skill.revision, hash: skill.sourceHash }] };
  await assert.rejects(f.engine.action("SET_QUEST_SKILLS", { ...payload, role: "jira-specialist" }), /dedicated managed/);
  await f.engine.action("SET_QUEST_SKILLS", payload);
  assert.throws(() => f.engine.skills.prepare(f.store.get("quests", quest.id), { purpose: "brainstorm", runtime: "codex" }), /not portable/);
  f.store.put("runs", { id: "active-guidance", questId: quest.id, state: "RUNNING" });
  await assert.rejects(f.engine.action("SET_QUEST_SKILLS", { ...payload, expectedRevision: 1, skills: [] }), /Finish agent/);
  f.store.put("runs", { id: "active-guidance", questId: quest.id, state: "COMPLETED" });
  const external = await f.engine.action("UPDATE_SKILL", await f.input({ skillId: skill.id, revision: 1, requirements: { mode: "external", mcp: ["atlassian"], tools: [], other: "" } }));
  await assert.rejects(f.engine.action("SET_QUEST_SKILLS", { ...payload, expectedRevision: 1, skills: [{ id: external.id, revision: external.revision, hash: external.sourceHash }] }), /Only reviewed/);
});

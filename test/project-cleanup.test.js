import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fixture } from "./engine-fixture.js";

const input = (f) => {
  const quest = f.store.get("quests", f.quest.id);
  return { questId: quest.id, confirmTitle: quest.title, expectedUpdatedAt: quest.updatedAt || quest.createdAt, reason: "Incorrect PRD; work canceled" };
};

test("recoverable project deletion hides related UI data while preserving documents, worktrees and publication history", async (t) => {
  const f = await fixture(t);
  await f.plan();
  await f.publish();
  const workspace = path.join(f.store.dir, "preserved-worktree");
  mkdirSync(workspace);
  writeFileSync(path.join(workspace, "uncommitted.txt"), "Preserve this work");
  f.store.put("works", { id: "preserved-work", questId: f.quest.id, repoId: f.repos[0].id, state: "EXECUTING", path: workspace, pr: { url: "https://example.test/pr/1" } });
  f.store.put("operations", { id: "publication-manifest", questId: f.quest.id, state: "BLOCKED", namespace: "stable-publication-id", issues: [{ appendixTaskId: "BE-1", key: "QA-1" }] });
  f.store.put("qa_cases", { id: "qa-case", questId: f.quest.id, title: "Retained QA" });
  const tables = ["tasks", "works", "runs", "artifacts", "approvals", "operations", "qa_cases"];
  const before = Object.fromEntries(tables.map((table) => [table, f.store.all(table)]));
  const artifact = f.store.latest(f.quest.id, "plan");
  const content = readFileSync(artifact.file, "utf8");
  const result = await f.engine.action("DELETE_QUEST", input(f));
  assert.equal(result.deleted, true);
  const view = f.engine.snapshot();
  assert.ok(!view.quests.some((quest) => quest.id === f.quest.id));
  assert.equal(view.deletedQuests[0].id, f.quest.id);
  for (const name of ["tasks", "works", "runs", "artifacts", "approvals", "operations", "qaCases"])
    assert.ok(view[name].every((item) => item.questId !== f.quest.id), name);
  for (const table of tables) assert.deepEqual(f.store.all(table), before[table], table);
  assert.equal(readFileSync(artifact.file, "utf8"), content);
  assert.equal(readFileSync(path.join(workspace, "uncommitted.txt"), "utf8"), "Preserve this work");
  assert.ok(existsSync(workspace));
  const removed = f.store.get("quests", f.quest.id);
  await assert.rejects(f.engine.action("RESTORE_QUEST", { questId: f.quest.id, deletedAt: "stale" }), /refresh before restoring/);
  await f.engine.action("RESTORE_QUEST", { questId: f.quest.id, deletedAt: removed.deletedAt });
  assert.equal(f.store.get("quests", f.quest.id).autoExecute, false);
  assert.equal(f.engine.snapshot().quests[0].id, f.quest.id);
  assert.equal(f.engine.snapshot().deletedQuests.length, 0);
  assert.deepEqual(f.store.all("operations"), before.operations);
  assert.equal(f.engine.jobs.size, 0);
});

test("delete requires exact confirmation and a current project version", async (t) => {
  const f = await fixture(t);
  await assert.rejects(f.engine.action("DELETE_QUEST", { ...input(f), confirmTitle: "wrong" }), /Type the project title/);
  await assert.rejects(f.engine.action("DELETE_QUEST", { ...input(f), expectedUpdatedAt: "old" }), /Project changed/);
  await assert.rejects(f.engine.action("DELETE_QUEST", { ...input(f), reason: "x".repeat(501) }), /500/);
  assert.ok(!f.store.get("quests", f.quest.id).deletedAt);
});

test("active agents, live processes, owned jobs, integrations and background operations block deletion", async (t) => {
  const f = await fixture(t);
  f.store.put("runs", { id: "busy-run", questId: f.quest.id, state: "RUNNING" });
  await assert.rejects(f.engine.action("DELETE_QUEST", input(f)), /active agents/);
  f.store.put("runs", { id: "busy-run", questId: f.quest.id, state: "FAILED", pid: process.pid });
  await assert.rejects(f.engine.action("DELETE_QUEST", input(f)), /active agents/);
  f.store.put("runs", { id: "busy-run", questId: f.quest.id, state: "FAILED", pid: null });
  f.engine.jobs.set("busy-run", {});
  await assert.rejects(f.engine.action("DELETE_QUEST", input(f)), /active agents/);
  f.engine.jobs.delete("busy-run");
  f.store.put("operations", { id: "busy-op", questId: f.quest.id, state: "RUNNING" });
  await assert.rejects(f.engine.action("DELETE_QUEST", input(f)), /background operations/);
  f.store.put("operations", { id: "busy-op", questId: f.quest.id, state: "COMPLETED" });
  f.engine.v11.pending.set("busy-op", Promise.resolve());
  await assert.rejects(f.engine.action("DELETE_QUEST", input(f)), /background operations/);
  f.engine.v11.pending.delete("busy-op");
  f.engine.appendixAgent.preflights.add(f.quest.id);
  await assert.rejects(f.engine.action("DELETE_QUEST", input(f)), /background operations/);
  f.engine.appendixAgent.preflights.delete(f.quest.id);
  const task = f.store.put("tasks", { id: "busy-task", questId: f.quest.id, state: "INTEGRATING" });
  await assert.rejects(f.engine.action("DELETE_QUEST", input(f)), /background operations/);
  f.store.put("tasks", { ...task, state: "FAILED" });
  f.engine.put("quests", f.store.get("quests", f.quest.id), { autoExecute: true });
  await assert.rejects(f.engine.action("DELETE_QUEST", input(f)), /Pause project automation/);
  f.engine.put("quests", f.store.get("quests", f.quest.id), { autoExecute: false });
  await f.engine.action("DELETE_QUEST", input(f));
  assert.ok(f.store.get("quests", f.quest.id).deletedAt);
});

test("deleted projects cannot start, publish, edit or resume through stale actions", async (t) => {
  const f = await fixture(t);
  await f.plan();
  await f.publish();
  const run = f.store.all("runs")[0];
  const task = f.engine.tasks(f.quest.id)[0];
  await f.engine.action("DELETE_QUEST", input(f));
  for (const [type, payload] of [
    ["START_TASK", { questId: f.quest.id, taskId: task.id }],
    ["PUBLISH_JIRA", { questId: f.quest.id }],
    ["GENERATE_APPENDIX", { questId: f.quest.id }],
    ["SAVE_TRD", { questId: f.quest.id, content: "replacement" }],
    ["SEND_MESSAGE", { runId: run.id, message: "continue" }],
    ["START_TASK", { taskId: task.id, questId: "different-project" }],
  ]) await assert.rejects(f.engine.action(type, payload), /Project is deleted/);
  assert.throws(() => f.engine.launch(f.quest, { runtime: "claude" }), /Restore the deleted project/);
  await f.engine.schedule(f.quest.id);
  assert.equal(f.engine.jobs.size, 0);
});

test("deleted projects never consume developer slots or schedule from stale autoExecute flags", async (t) => {
  const f = await fixture(t);
  const task = f.store.put("tasks", { id: "waiting-test", questId: f.quest.id, state: "AWAITING_TEST" });
  assert.equal(f.engine.v11.scheduler.developerSlots().length, 1);
  await f.engine.action("DELETE_QUEST", input(f));
  assert.equal(f.engine.v11.scheduler.developerSlots().length, 0);
  f.store.put("quests", { ...f.store.get("quests", f.quest.id), workflowVersion: 2, autoExecute: true });
  f.engine.v11.pump();
  assert.equal(f.engine.v11.pending.size, 0);
  await f.engine.v11.recover();
  assert.equal(f.store.get("tasks", task.id).state, "AWAITING_TEST");
});

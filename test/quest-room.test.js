import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { fixture } from "./engine-fixture.js";
import { Store } from "../src/store.js";
const launch = async (f) => {
  const run = f.engine.launch(f.store.get("quests", f.quest.id), {
    runtime: "claude",
    purpose: "brainstorm",
    readOnly: true,
    cwd: f.repos[0].path,
    prompt: "Synthetic current stage only",
  });
  await new Promise(setImmediate);
  return run;
};
const note = (f, more = {}) => ({
  questId: f.quest.id,
  message: "Discuss only, never approve or publish",
  ...more,
});
const pin = (doc) => ({
  id: doc.id,
  revision: doc.versions.at(-1).revision,
  hash: doc.versions.at(-1).hash,
});

test("room notes persist without inference; timeline preserves turns and rejects cross-Quest replies", async (t) => {
  const f = await fixture(t);
  const saved = await f.engine.action("POST_ROOM_NOTE", note(f));
  assert.equal(f.pending.length, 0);
  const second = new Store(f.store.dir);
  assert.equal(second.get("room_messages", saved.id).body, saved.body);
  second.close();
  const run = await launch(f);
  await f.finish("Question about this stage", true);
  assert.equal(f.engine.room.timeline(f.quest.id).filter((m) => m.kind === "agent").length, 1);
  const other = f.store.put("quests", { ...f.quest, id: "other" });
  await assert.rejects(
    f.engine.action("POST_ROOM_NOTE", { ...note(f), questId: other.id, runId: run.id }),
    /another Quest/,
  );
  assert.equal(f.pending.length, 0);
  assert.match(f.engine.room.blockers(f.quest)[0].title, /answer/);
});

test("directed replies require confirmation and exact run version, retain stage restrictions, and are idempotent", async (t) => {
  const f = await fixture(t),
    original = await launch(f);
  await f.finish("Question", true);
  const run = f.store.get("runs", original.id);
  const reply = {
    ...note(f),
    runId: run.id,
    expectedUpdatedAt: run.updatedAt,
    requestId: "reply-1",
    confirmAgentRun: true,
  };
  await assert.rejects(
    f.engine.action("SEND_ROOM_REPLY", { ...reply, confirmAgentRun: false }),
    /explicit confirmation/,
  );
  await assert.rejects(
    f.engine.action("SEND_ROOM_REPLY", { ...reply, expectedUpdatedAt: "old" }),
    /changed/,
  );
  assert.equal(f.pending.length, 0);
  const sent = await f.engine.action("SEND_ROOM_REPLY", reply);
  assert.equal(sent.state, "SENT");
  assert.equal(f.pending.length, 1);
  const again = await f.engine.action("SEND_ROOM_REPLY", reply);
  assert.equal(again.id, sent.id);
  assert.equal(f.pending.length, 1);
  assert.equal(f.pending[0].options.readOnly, true);
  assert.equal(f.pending[0].options.purpose, "brainstorm");
  await f.finish("Updated current stage", true);
  assert.equal(f.engine.room.timeline(f.quest.id).filter((m) => m.kind === "agent").length, 2);
  f.store.artifact(f.quest.id, "plan", "Later approved scope");
  const latest = f.store.get("runs", run.id);
  await assert.rejects(
    f.engine.action("SEND_ROOM_REPLY", {
      ...reply,
      requestId: "reply-2",
      expectedUpdatedAt: latest.updatedAt,
    }),
    /Later design/,
  );
  assert.equal(f.pending.length, 0);
});

test("blocked room delivery remains visible and is not silently replayed", async (t) => {
  const f = await fixture(t),
    original = await launch(f);
  await f.finish("Ready", true);
  const run = f.store.get("runs", original.id);
  f.engine.runtimeStatus.claude = { available: false };
  const reply = {
    ...note(f),
    runId: run.id,
    expectedUpdatedAt: run.updatedAt,
    requestId: "blocked-1",
    confirmAgentRun: true,
  };
  await assert.rejects(f.engine.action("SEND_ROOM_REPLY", reply), /not available/);
  assert.equal(f.store.get("room_messages", reply.requestId).state, "BLOCKED");
  await assert.rejects(f.engine.action("SEND_ROOM_REPLY", reply), /not available/);
  assert.equal(f.pending.length, 0);
});

test("references are explicit, revision-pinned, reusable and scoped; continuation retains historical content", async (t) => {
  const f = await fixture(t);
  const doc = await f.engine.action("SAVE_PROJECT_REFERENCE", {
    questId: f.quest.id,
    repositoryId: f.repos[0].id,
    name: "Backend conventions",
    content: "Original synthetic conventions",
  });
  assert.equal(f.store.get("quests", f.quest.id).projectReferences, undefined);
  await f.engine.action("SET_QUEST_REFERENCES", { questId: f.quest.id, references: [pin(doc)] });
  const before = f.engine.approvalBasis(f.quest.id, "trd");
  const run = await launch(f);
  assert.match(f.pending[0].options.prompt, /Original synthetic conventions/);
  await f.finish("Question", true);
  const updated = await f.engine.action("SAVE_PROJECT_REFERENCE", {
    questId: f.quest.id,
    repositoryId: f.repos[0].id,
    referenceId: doc.id,
    expectedRevision: 1,
    name: "Backend conventions",
    content: "Changed conventions",
  });
  assert.equal(updated.versions.length, 2);
  const context = f.engine.room.references(
    f.store.get("quests", f.quest.id),
    { purpose: "brainstorm" },
    f.store.get("runs", run.id),
  );
  assert.match(context.prompt, /Original synthetic/);
  assert.doesNotMatch(context.prompt, /Changed conventions/);
  assert.deepEqual(
    f.engine.room.references(
      f.quest,
      { purpose: "jira_appendix_generation", artifactScope: true },
      run,
    ).pins,
    [],
  );
  await assert.rejects(
    f.engine.action("SET_QUEST_REFERENCES", { questId: f.quest.id, references: [pin(updated)] }),
    /active design/,
  );
  f.store.put("runs", { ...f.store.get("runs", run.id), state: "COMPLETED" });
  await assert.rejects(
    f.engine.action("SET_QUEST_REFERENCES", { questId: f.quest.id, references: [pin(doc)] }),
    /revision changed/,
  );
  await f.engine.action("SET_QUEST_REFERENCES", {
    questId: f.quest.id,
    references: [pin(updated)],
  });
  assert.notEqual(f.engine.approvalBasis(f.quest.id, "trd"), before);
  const other = f.store.put("quests", { ...f.quest, id: "other", repositoryIds: [f.repos[1].id] });
  await assert.rejects(
    f.engine.action("SET_QUEST_REFERENCES", { questId: other.id, references: [pin(updated)] }),
    /outside/,
  );
  await assert.rejects(
    f.engine.action("SAVE_PROJECT_REFERENCE", {
      questId: f.quest.id,
      repositoryId: f.repos[0].id,
      referenceId: doc.id,
      expectedRevision: 1,
      name: "stale",
      content: "stale",
    }),
    /changed/,
  );
});

test("QA evidence binds human observations to a clean integrated commit and detects changed source", async (t) => {
  const f = await fixture(t);
  const item = await f.engine.action("ADD_QA_CASE", {
    questId: f.quest.id,
    repositoryId: f.repos[0].id,
    title: "Transfer response",
    expected: "Returns expected status",
    jiraKey: "QA-123",
  });
  const record = {
    questId: f.quest.id,
    caseId: item.id,
    revision: 1,
    status: "PASSED",
    actual: "Observed the expected response",
  };
  await assert.rejects(f.engine.action("RECORD_QA_RESULT", record), /integrated Quest worktree/);
  const work = f.store.put("works", {
    id: "work",
    questId: f.quest.id,
    repoId: f.repos[0].id,
    path: "/synthetic/integrated",
  });
  f.facts.set(work.path, {
    head: "commit-a",
    fingerprint: "fingerprint-a",
    dirty: false,
    branch: "devquest/synthetic",
  });
  f.adapters.git.reconcile = async () => {};
  const saved = await f.engine.action("RECORD_QA_RESULT", record);
  assert.equal(saved.evidence[0].source, "human");
  assert.equal(saved.evidence[0].commit, "commit-a");
  assert.equal(
    (await f.engine.action("VERIFY_QA_RESULTS", { questId: f.quest.id }))[0].verification.current,
    true,
  );
  f.facts.get(work.path).fingerprint = "different";
  assert.equal(
    (await f.engine.action("VERIFY_QA_RESULTS", { questId: f.quest.id }))[0].verification.current,
    false,
  );
  assert.equal(f.store.get("qa_cases", item.id).evidence.length, 1);
  f.facts.get(work.path).dirty = true;
  await assert.rejects(f.engine.action("RECORD_QA_RESULT", record), /clean/);
  await assert.rejects(f.engine.action("RECORD_QA_RESULT", { ...record, revision: 0 }), /changed/);
  assert.equal(f.pending.length, 0);
});

test("access preview uses launch scopes, selected repositories only, and never invokes a model", async (t) => {
  const f = await fixture(t);
  for (const repo of f.repos) {
    mkdirSync(repo.path);
    writeFileSync(`${repo.path}/README.md`, "Synthetic");
  }
  const result = await f.engine.action("PREVIEW_QUEST_ACCESS", {
    questId: f.quest.id,
    role: "architect",
  });
  assert.equal(result.scope.readOnly, true);
  assert.equal(result.scope.repositories.length, 2);
  assert.equal(result.preflight.runtimeToolRead, "NOT_VERIFIED");
  assert.equal(f.pending.length, 0);
  assert.deepEqual(
    result.scope,
    f.engine.resolveAccessScope(f.quest, {
      purpose: "brainstorm",
      role: "architect",
      readOnly: true,
    }),
  );
  await assert.rejects(
    f.engine.action("PREVIEW_QUEST_ACCESS", { questId: f.quest.id, role: "developer" }),
    /assigned worktree/,
  );
  await assert.rejects(
    f.engine.action("PREVIEW_QUEST_ACCESS", { questId: f.quest.id, role: "admin" }),
    /supported/,
  );
  const subset = f.store.put("quests", { ...f.quest, repositoryIds: [f.repos[0].id] });
  const selected = await f.engine.action("PREVIEW_QUEST_ACCESS", {
    questId: subset.id,
    role: "planner",
  });
  assert.equal(selected.scope.repositories.length, 1);
});

test("explicit reference refresh exposes fresh TRD approval without deleting prior artifacts or approval history", async (t) => {
  const f = await fixture(t);
  await f.plan();
  const before = f.store.latest(f.quest.id, "trd"),
    approvals = f.store.all("approvals").length;
  assert.equal(f.store.get("quests", f.quest.id).state, "PLAN_APPROVED");
  const doc = await f.engine.action("SAVE_PROJECT_REFERENCE", {
    questId: f.quest.id,
    repositoryId: f.repos[0].id,
    name: "Reference",
    content: "Synthetic reference",
  });
  await f.engine.action("SET_QUEST_REFERENCES", { questId: f.quest.id, references: [pin(doc)] });
  assert.equal(f.store.get("quests", f.quest.id).state, "TRD_DRAFT");
  assert.equal(f.store.latest(f.quest.id, "trd").id, before.id);
  assert.equal(f.store.all("approvals").length, approvals);
  assert.throws(() => f.engine.approved(f.quest.id, "trd"), /requires human approval/);
  await f.engine.action("APPROVE_TRD", { questId: f.quest.id, artifactId: before.id });
  assert.equal(f.store.get("quests", f.quest.id).state, "TRD_APPROVED");
});

test("bug intake preserves the existing technical workflow and never links an issue before plan approval", async (t) => {
  const f = await fixture(t);
  const create = {
    kind: "TECH",
    title: "Synthetic QA fix",
    content: "Reproduce and fix a synthetic defect",
    repositoryIds: [f.repos[0].id],
    existingJiraKey: "QA-123",
  };
  const quest = await f.engine.action("CREATE_QUEST", create);
  assert.equal(quest.kind, "TECH");
  assert.equal(quest.state, "INTAKE_READY");
  assert.equal(quest.existingJiraKey, "QA-123");
  assert.equal(f.engine.tasks(quest.id).length, 0);
  assert.equal(f.pending.length, 0);
  await assert.rejects(
    f.engine.action("USE_EXISTING_JIRA", { questId: quest.id, key: quest.existingJiraKey }),
    /plan|approval/i,
  );
  await assert.rejects(
    f.engine.action("CREATE_QUEST", { ...create, existingJiraKey: "not-an-issue" }),
    /valid Jira key/,
  );
  await assert.rejects(
    f.engine.action("CREATE_QUEST", { ...create, kind: "PRODUCT" }),
    /valid Jira key/,
  );
});

test("delivery receipts track the exact accepted attempt and never claim semantic consumption", async (t) => {
  const f = await fixture(t), original = await launch(f);
  await f.finish("Question", true);
  const run = f.store.get("runs", original.id);
  const sent = await f.engine.action("SEND_ROOM_REPLY", {
    ...note(f), runId: run.id, expectedUpdatedAt: run.updatedAt,
    requestId: "receipt-1", confirmAgentRun: true,
  });
  const receipt = () => f.engine.room.timeline(f.quest.id).find((m) => m.id === sent.id).delivery;
  assert.equal(receipt().resultRunId, sent.successorRunId);
  assert.equal(receipt().status, "RUNNING");
  assert.match(receipt().evidence, /semantic consumption is not verified/);
  await f.finish("Done", true);
  assert.equal(receipt().status, "WAITING_INPUT");
  f.store.put("room_messages", { id: "uncertain-receipt", kind: "instruction", questId: f.quest.id, state: "SENDING", createdAt: new Date().toISOString() });
  assert.equal(f.engine.room.timeline(f.quest.id).find((m) => m.id === "uncertain-receipt").delivery.status, "UNCERTAIN");
  assert.equal(f.pending.length, 0);
});

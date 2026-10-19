import test from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { fixture } from "./engine-fixture.js";

const markdown = await readFile(new URL("./fixtures/jira-appendix.md", import.meta.url), "utf8");
async function setup(t) {
  const f = await fixture(t);
  await f.plan();
  const stale = f.store.put("runs", {
    id: "historical-jira", questId: f.quest.id, purpose: "jira_appendix_generation",
    role: "JIRA_APPENDIX", state: "WAITING_INPUT", pid: null, finishedAt: "2026-10-17T16:31:49Z",
  });
  const run = f.store.put("runs", {
    id: "completed-jira", questId: f.quest.id, purpose: "jira_appendix_generation",
    role: "JIRA_APPENDIX", state: "COMPLETED", pid: null,
  });
  const plan = f.engine.approved(f.quest.id, "plan"), trd = f.engine.approved(f.quest.id, "trd");
  const doc = f.store.artifact(f.quest.id, "appendix", markdown);
  const artifact = f.store.put("artifacts", { ...doc, runId: run.id, planArtifactId: plan.id, trdArtifactId: trd.id });
  f.adapters.skill.publish = async () => assert.fail("Approval must never publish");
  return { ...f, stale, run, plan, trd, artifact, approve: (artifactId = artifact.id) => f.engine.action("APPROVE_APPENDIX", { questId: f.quest.id, artifactId }) };
}

test("completed appendix can be approved despite an obsolete process-free Jira session; history and exact sources are preserved", async t => {
  const f = await setup(t), history = JSON.stringify(f.store.all("runs"));
  assert.throws(() => f.engine.editable(f.quest.id), /active design session/);
  const view = f.engine.snapshot().artifacts.find(a => a.id === f.artifact.id);
  assert.equal(view.approvalReady, true);
  assert.equal(view.approved, false);
  await f.approve();
  const approval = f.store.all("approvals").find(a => a.kind === "appendix");
  assert.equal(approval.artifactId, f.artifact.id);
  assert.equal(approval.hash, f.artifact.hash);
  assert.equal(approval.planArtifactId, f.plan.id);
  assert.equal(approval.planHash, f.plan.hash);
  assert.equal(approval.trdHash, f.trd.hash);
  assert.equal(JSON.stringify(f.store.all("runs")), history);
  assert.equal(f.store.content(f.artifact), markdown);
  assert.equal(f.store.all("operations").length, 0);
  assert.equal(f.pending.length, 0);
  assert.equal(f.engine.snapshot().artifacts.find(a => a.id === f.artifact.id).approved, true);
});

test("unrelated read-only review and another Quest's design session do not block appendix approval", async t => {
  const f = await setup(t);
  f.store.put("runs", { id: "review", questId: f.quest.id, role: "reviewer", purpose: "review", state: "WAITING_INPUT", readOnly: true });
  f.store.put("runs", { id: "other-design", questId: "other-quest", role: "planner", purpose: "plan", state: "WAITING_INPUT" });
  await f.approve();
  assert.equal(f.engine.approved(f.quest.id, "appendix").id, f.artifact.id);
});

test("active source-document changes, current generation, live old processes and preflight retain approval protection", async t => {
  for (const mode of ["plan", "trd", "analysis", "brainstorm", "spec", "new-generation", "old-process", "owned-old", "resumed-old", "preflight", "publication", "published-plan"])
    await t.test(mode, async t => {
      const f = await setup(t);
      if (mode === "old-process") f.store.put("runs", { ...f.stale, pid: process.pid });
      else if (mode === "resumed-old") f.store.put("runs", { ...f.stale, finishedAt: new Date(Date.parse(f.artifact.createdAt) + 1000).toISOString() });
      else if (mode === "owned-old") {
        f.engine.jobs.set(f.stale.id, { controller: new AbortController(), done: Promise.resolve() });
        t.after(() => f.engine.jobs.delete(f.stale.id));
      } else if (mode === "preflight") {
        f.engine.appendixAgent.preflights.add(f.quest.id);
        f.store.put("operations", { id: `appendix-preflight:${f.quest.id}`, questId: f.quest.id, state: "RUNNING" });
      } else if (mode === "publication") f.store.put("operations", { id: `jira:${f.quest.id}`, questId: f.quest.id, state: "RUNNING" });
      else if (mode === "published-plan") {
        const task = f.engine.tasks(f.quest.id)[0];
        f.store.put("tasks", { ...task, jira: { key: "SYN-1" } });
      } else f.store.put("runs", { id: "conflict", questId: f.quest.id,
        purpose: mode === "new-generation" ? "jira_appendix_generation" : mode,
        role: mode === "plan" ? "planner" : "architect", state: "WAITING_INPUT" });
      await assert.rejects(f.approve(), /active design session|active Jira Appendix|publication|Published plans/);
      assert.equal(f.store.all("approvals").some(a => a.kind === "appendix"), false);
      assert.equal(f.engine.snapshot().artifacts.find(a => a.id === f.artifact.id).approvalReady, false);
      assert.equal(f.pending.length, 0);
    });
});

test("approval rejects changed artifact IDs, source revisions and file hashes", async t => {
  for (const mode of ["artifact-id", "plan-id", "trd-id", "new-plan", "plan-bytes", "appendix-bytes"])
    await t.test(mode, async t => {
      const f = await setup(t);
      if (mode === "plan-id" || mode === "trd-id") f.store.put("artifacts", { ...f.artifact, [mode === "plan-id" ? "planArtifactId" : "trdArtifactId"]: "wrong-source" });
      if (mode === "new-plan") f.store.artifact(f.quest.id, "plan", "New unapproved plan");
      if (mode === "plan-bytes") await writeFile(f.plan.file, "Changed plan bytes");
      if (mode === "appendix-bytes") await writeFile(f.artifact.file, "Changed appendix bytes");
      await assert.rejects(f.approve(mode === "artifact-id" ? "previous-revision" : f.artifact.id), /revision changed|requires human approval|integrity mismatch/);
      assert.equal(f.store.all("approvals").some(a => a.kind === "appendix"), false);
    });
});

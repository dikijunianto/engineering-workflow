import test from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { fixture } from "./engine-fixture.js";

const markdown = await readFile(new URL("./fixtures/jira-appendix.md", import.meta.url), "utf8");
async function setup(t) {
  const f = await fixture(t);
  await f.plan();
  const q = f.store.get("quests", f.quest.id);
  f.store.put("quests", { ...q, workflowVersion: 2, execution: f.engine.v11.config(), jiraContext: { project: "FFE", epic: "FFE-1" } });
  f.adapters.config.workflow = { skills: { upload: "synthetic-upload.md" } };
  const old = f.store.put("runs", { id: "old-waiting", questId: q.id, purpose: "jira_appendix_generation", state: "WAITING_INPUT", pid: null, finishedAt: "2026-10-17T00:00:00Z" });
  const completed = f.store.put("runs", { id: "new-completed", questId: q.id, purpose: "jira_appendix_generation", state: "COMPLETED", pid: null });
  const plan = f.engine.approved(q.id, "plan"), trd = f.engine.approved(q.id, "trd");
  const doc = f.store.artifact(q.id, "appendix", markdown);
  const artifact = f.store.put("artifacts", { ...doc, planArtifactId: plan.id, trdArtifactId: trd.id, runId: completed.id });
  await f.engine.action("APPROVE_APPENDIX", { questId: q.id, artifactId: artifact.id });
  let writes = 0;
  f.adapters.skill.validateUpload = () => {};
  f.adapters.skill.verifyUpload = async () => ({ fake: true });
  f.adapters.skill.publish = async input => {
    writes++;
    assert.equal(input.appendixArtifactId, artifact.id);
    assert.equal(input.appendixHash, artifact.hash);
    assert.equal(input.appendixContent, markdown);
    return input.tasks.map(task => ({ taskId: task.id, key: `FFE-${writes * 100 + input.tasks.indexOf(task)}`, complete: true }));
  };
  const preview = (changes = {}) => f.engine.action("PREVIEW_JIRA_PUBLICATION", { questId: q.id, appendixArtifactId: artifact.id, ...changes });
  const publish = () => f.engine.action("PUBLISH_JIRA", { questId: q.id, appendixArtifactId: artifact.id, appendixHash: artifact.hash });
  return { ...f, old, completed, plan, trd, artifact, preview, publish, writes: () => writes };
}

test("completed generation plus obsolete waiting/failed/interrupted attempts reaches confirmation without dispatch; mock batches do not duplicate tasks", async t => {
  const f = await setup(t), history = JSON.stringify(f.store.all("runs"));
  f.store.put("runs", { id: "failed", questId: f.quest.id, purpose: "jira_appendix_generation", state: "FAILED" });
  f.store.put("runs", { id: "interrupted", questId: f.quest.id, purpose: "jira_appendix_generation", state: "INTERRUPTED" });
  const preview = await f.preview();
  assert.equal(preview.artifactId, f.artifact.id); assert.equal(preview.maxIssues, 1);
  assert.equal(f.writes(), 0); assert.equal(f.pending.length, 0);
  const lifecycle = f.engine.appendixAgent.lifecycle(f.quest.id);
  assert.deepEqual(lifecycle.obsolete.map(r => r.id), [f.old.id]);
  assert.equal(lifecycle.active.length, 0);
  await assert.rejects(f.engine.action("CONTINUE_AGENT", { runId: f.old.id }), /superseded/);
  assert.equal(f.engine.snapshot().artifacts.find(a => a.id === f.artifact.id).publicationReady, true);
  const op = await f.publish(); await f.engine.v11.pending.get(op.id);
  assert.equal(f.writes(), 1);
  assert.equal((await f.preview()).maxIssues, 5);
  const next = await f.publish(); await f.engine.v11.pending.get(next.id);
  assert.equal(f.writes(), 2);
  await assert.rejects(f.preview(), /already published/);
  const again = await f.publish(); await f.engine.v11.pending.get(again.id);
  assert.equal(f.writes(), 2);
  assert.equal(JSON.stringify(f.store.all("runs").filter(r => !["failed", "interrupted"].includes(r.id))), history);
});

test("publication rejects genuine generation, relevant waiting, live terminal processes and uncertain or active publication", async t => {
  for (const mode of ["running", "waiting", "live-old", "live-terminal", "resumed-old", "preflight", "publication-active", "publication-started", "publication-uncertain"])
    await t.test(mode, async t => {
      const f = await setup(t);
      if (mode === "live-old" || mode === "resumed-old") f.store.put("runs", { ...f.old, ...(mode === "live-old" ? { pid: process.pid } : { finishedAt: new Date(Date.parse(f.artifact.createdAt) + 1000).toISOString() }) });
      else if (mode === "preflight") {
        f.engine.appendixAgent.preflights.add(f.quest.id);
        f.store.put("operations", { id: `appendix-preflight:${f.quest.id}`, questId: f.quest.id, state: "RUNNING" });
      } else if (mode.startsWith("publication-")) f.store.put("operations", { id: `${mode === "publication-active" ? "jira" : "jira-publish"}:${f.quest.id}`, questId: f.quest.id, state: mode === "publication-active" ? "RUNNING" : mode === "publication-started" ? "STARTED" : "FAILED" });
      else f.store.put("runs", { id: "conflict", questId: f.quest.id, purpose: "jira_appendix_generation", state: mode === "waiting" ? "WAITING_INPUT" : mode === "live-terminal" ? "CANCELLED" : "RUNNING", ...(["running", "live-terminal"].includes(mode) ? { pid: process.pid } : {}) });
      await assert.rejects(f.preview(), /active Jira Appendix|publication is already active|publication is uncertain/);
      await assert.rejects(f.publish(), /active Jira Appendix|publication is already active|publication is uncertain/);
      assert.equal(f.writes(), 0);
      assert.equal(f.engine.snapshot().artifacts.find(a => a.id === f.artifact.id).publicationReady, false);
    });
});

test("exact approval, source documents, configured project, revision and bytes are enforced before confirmation", async t => {
  for (const mode of ["unapproved", "regenerated", "stale-id", "stale-hash", "new-plan", "plan-bytes", "trd-id", "project", "active-plan"])
    await t.test(mode, async t => {
      const f = await setup(t);
      if (mode === "unapproved") for (const a of f.store.all("approvals").filter(a => a.kind === "appendix")) f.store.remove("approvals", a.id);
      if (mode === "regenerated") {
        const a = f.store.artifact(f.quest.id, "appendix", markdown);
        f.store.put("artifacts", { ...a, planArtifactId: f.plan.id, trdArtifactId: f.trd.id });
      }
      if (mode === "new-plan") f.store.artifact(f.quest.id, "plan", "New unapproved plan");
      if (mode === "plan-bytes") await writeFile(f.plan.file, "Changed bytes");
      if (mode === "trd-id") f.store.put("artifacts", { ...f.artifact, trdArtifactId: "wrong" });
      if (mode === "project") {
        const q = f.store.get("quests", f.quest.id);
        f.store.put("quests", { ...q, jiraContext: { ...q.jiraContext, project: "OTHER" } });
      }
      if (mode === "active-plan") f.store.put("runs", { id: "plan-update", questId: f.quest.id, purpose: "plan", role: "planner", state: "WAITING_INPUT" });
      const current = f.store.latest(f.quest.id, "appendix");
      const request = { appendixArtifactId: mode === "stale-id" ? "previous" : current.id, ...(mode === "stale-hash" ? { appendixHash: "wrong" } : {}) };
      await assert.rejects(f.preview(request), /Approve the current Jira Appendix|current appendix|approved plan|requires human approval|integrity mismatch|revision changed|active design session/);
      assert.equal(f.writes(), 0); assert.equal(f.pending.length, 0);
    });
});

test("a duplicate publish request cannot dispatch while an isolated publisher is in flight", async t => {
  const f = await setup(t);
  let release;
  f.adapters.skill.verifyUpload = () => new Promise(resolve => { release = resolve; });
  const op = await f.publish();
  await assert.rejects(f.publish(), /publication is already active/);
  await assert.rejects(f.preview(), /publication is already active/);
  release({ fake: true }); await f.engine.v11.pending.get(op.id);
  assert.equal(f.writes(), 1);
});

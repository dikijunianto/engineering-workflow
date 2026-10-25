import test from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fixture } from "./engine-fixture.js";
import { profileRole } from "../src/agent-profiles.js";
const git = (cwd, ...args) =>
  execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
async function setup(t, { conflict = true } = {}) {
  const f = await fixture(t, { realGit: true }),
    w = f.engine.v11,
    repo = f.repos[0];
  writeFileSync(path.join(repo.path, "shared.txt"), "baseline\n");
  git(repo.path, "add", ".");
  git(repo.path, "commit", "-m", "master baseline");
  const base = git(repo.path, "rev-parse", "HEAD");
  git(repo.path, "branch", "master", base);
  const quest = f.store.put("quests", {
    ...f.quest,
    workflowVersion: 2,
    execution: w.config({ mode: "guided" }),
  });
  const identity = await w.git.prepare(quest, repo, "work-conflict", null, base);
  writeFileSync(path.join(identity.path, "shared.txt"), "epic implementation\n");
  git(identity.path, "add", ".");
  git(identity.path, "commit", "-m", "project implementation");
  const head = git(identity.path, "rev-parse", "HEAD");
  writeFileSync(
    path.join(repo.path, conflict ? "shared.txt" : "unrelated.txt"),
    "development only\n",
  );
  git(repo.path, "add", ".");
  git(repo.path, "commit", "-m", "target updates");
  const work = f.store.put("works", {
    id: "work-conflict",
    questId: quest.id,
    repoId: repo.id,
    workflowVersion: 2,
    ...identity,
    baseCommit: base,
    prTarget: "development",
    state: "READY_FOR_PR",
    productionReview: { verdict: "PASSED", reviewedCommit: head },
    humanApprovedCommit: head,
    pr: { number: 7, url: "https://bitbucket.org/synthetic/project/pull-requests/7" },
  });
  f.store.put("tasks", {
    id: "completed-task",
    key: "T1",
    questId: quest.id,
    repoId: repo.id,
    state: "COMPLETED",
    integratedCommit: head,
    validationProfile: "node-test",
    validation: { passed: true },
  });
  const launched = [],
    reviewed = [];
  w.launch = async (_q, role, options) => launched.push({ role, ...options });
  w.review = (_q, work) => reviewed.push(work.id);
  w.validate = async (_repo, workspace) => ({
    ...(await w.git.inspect(repo, workspace)),
    passed: true,
  });
  return {
    ...f,
    w,
    repo,
    quest,
    work,
    head,
    base,
    launched,
    reviewed,
    read: () => f.store.get("works", work.id),
  };
}
test("actual target conflict snapshots the epic, repairs only original branch and requires fresh approval", async (t) => {
  const f = await setup(t);
  await f.w.prConflicts.resolve(f.quest, f.work, f.head);
  const pending = f.read(),
    r = pending.targetRecovery;
  assert.equal(r.branch, f.work.branch + "-clean");
  assert.equal(git(f.repo.path, "rev-parse", r.branch), f.head);
  assert.equal(git(f.repo.path, "show", r.branch + ":shared.txt"), "epic implementation");
  assert.equal(git(f.work.path, "rev-parse", "MERGE_HEAD"), r.targetHead);
  assert.equal(pending.pr, null);
  assert.equal(r.previousPr.number, 7);
  assert.equal(pending.humanApprovedCommit, null);
  assert.equal(f.launched.length, 1);
  assert.equal(f.launched[0].purpose, "v11-target");
  assert.equal(f.launched[0].cwd, f.work.path);
  assert.equal(profileRole(f.launched[0]), "developer");
  await assert.rejects(f.w.prConflicts.finish(f.quest, pending), /unresolved conflicts/);
  writeFileSync(
    path.join(f.work.path, "shared.txt"),
    "epic implementation plus conflict resolution\n",
  );
  git(f.work.path, "add", "shared.txt");
  f.w.validate = async () => ({ passed: false });
  await assert.rejects(f.w.prConflicts.finish(f.quest, pending), /validation failed/);
  assert.equal(git(f.work.path, "rev-parse", "HEAD"), f.head);
  f.w.validate = async (_repo, workspace) => ({
    ...(await f.w.git.inspect(f.repo, workspace)),
    passed: true,
  });
  await f.w.prConflicts.finish(f.quest, pending);
  const done = f.read();
  assert.equal(done.state, "REVIEW_REQUIRED");
  assert.equal(done.humanApprovedCommit, null);
  assert.equal(done.targetRecovery.state, "RESOLVED");
  assert.equal(git(f.repo.path, "rev-parse", r.branch), f.head);
  assert.notEqual(git(f.work.path, "rev-parse", "HEAD"), f.head);
  assert.equal(git(f.work.path, "merge-base", r.targetHead, "HEAD"), r.targetHead);
  assert.equal(git(f.repo.path, "rev-parse", "master"), f.base);
  assert.equal(git(f.repo.path, "show", "development:shared.txt"), "development only");
  assert.deepEqual(f.reviewed, [f.work.id]);
  assert.equal(f.created.length, 0);
});
test("no actual conflict creates no clean branch, merge, agent or publication", async (t) => {
  const f = await setup(t, { conflict: false });
  await f.w.prConflicts.resolve(f.quest, f.work, f.head);
  assert.equal(f.read().targetRecovery, undefined);
  assert.equal(f.launched.length, 0);
  assert.equal(f.read().prConflictCheck.conflict, false);
  assert.equal(f.read().pr.number, 7);
  assert.equal(git(f.work.path, "status", "--porcelain"), "");
  assert.equal(git(f.work.path, "rev-parse", "HEAD"), f.head);
  assert.throws(() => git(f.repo.path, "rev-parse", "--verify", f.work.branch + "-clean"));
});
test("stale heads, occupied runs, dirty workspaces and existing clean branches stop recovery without overwrite", async (t) => {
  const f = await setup(t);
  await assert.rejects(f.w.prConflicts.resolve(f.quest, f.work, "stale-head"), /changed/);
  f.store.put("runs", { id: "active", questId: f.quest.id, state: "RUNNING" });
  await assert.rejects(f.w.prConflicts.resolve(f.quest, f.work, f.head), /active Quest/);
  f.store.put("runs", { id: "active", questId: f.quest.id, state: "COMPLETED" });
  writeFileSync(path.join(f.work.path, "unfinished.txt"), "preserve");
  await assert.rejects(f.w.prConflicts.resolve(f.quest, f.work, f.head), /existing worktree edits/);
  git(f.work.path, "add", ".");
  git(f.work.path, "commit", "-m", "preserve local work");
  const head = git(f.work.path, "rev-parse", "HEAD");
  git(f.repo.path, "branch", f.work.branch + "-clean", f.base);
  await assert.rejects(f.w.prConflicts.resolve(f.quest, f.work, head), /already exists/);
  assert.equal(git(f.repo.path, "rev-parse", f.work.branch + "-clean"), f.base);
  assert.equal(f.launched.length, 0);
});

test("a waiting PR conflict answer resumes its recorded merge without spending a retry", async (t) => {
  const f = await setup(t);
  await f.w.prConflicts.resolve(f.quest, f.work, f.head);
  const attempts = f.read().targetRecovery.attempts;
  const run = f.store.put("runs", {
    id: "waiting-conflict",
    workId: f.work.id,
    questId: f.quest.id,
    purpose: "v11-target",
    state: "WAITING_INPUT",
  });
  await f.w.prConflicts.resolve(f.quest, f.read(), f.head, {
    run,
    message: "Preserve the required behavior",
  });
  assert.equal(f.read().targetRecovery.attempts, attempts);
  assert.equal(f.launched[1].recoveryFrom, run.id);
  assert.match(f.launched[1].prompt, /Preserve the required behavior/);
  assert.equal(f.store.get("runs", run.id).state, "SUPERSEDED");
  const r = f.read().targetRecovery;
  git(f.repo.path, "update-ref", `refs/heads/${r.branch}`, f.base);
  await assert.rejects(f.w.prConflicts.finish(f.quest, f.read()), /Clean snapshot changed/);
});

test("repaired targets require exact human approval even under autonomous publication", async (t) => {
  const f = await setup(t);
  f.w.ready = async () => ({ head: f.head });
  f.w.production.scope = async () => ({ fingerprint: "current-scope" });
  f.store.put("works", {
    ...f.work,
    productionReview: { verdict: "PASSED", scope: "current-scope" },
    targetRecovery: { state: "RESOLVED" },
    humanApprovedCommit: null,
  });
  await assert.rejects(
    f.w.production.publishPr(
      { ...f.quest, execution: { ...f.quest.execution, mode: "autonomous" } },
      f.work,
    ),
    /Human approval/,
  );
  assert.equal(f.created.length, 0);
});

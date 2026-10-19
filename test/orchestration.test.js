import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, readFileSync } from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fixture } from "./engine-fixture.js";
import { models, review } from "./v11-fixture.js";
import { Store } from "../src/store.js";
import { Engine } from "../src/engine.js";

const git = (cwd, ...args) =>
  execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
async function setup(t, input = {}) {
  const f = await fixture(t, { realGit: true });
  await f.plan();
  await f.publish();
  f.adapters.config.orchestration = {
    models,
    claudeSafeFallback: "acceptEdits",
  };
  f.adapters.sourceControl.requestReview = async () => {};
  const execution = f.engine.v11.config({
    runtime: "claude",
    routing: { mode: "dynamic" },
    mode: "autonomous",
    permissions: { createPr: true },
    ...input,
  });
  f.store.put("quests", {
    ...f.store.get("quests", f.quest.id),
    execution,
    workflowVersion: 2,
    epicKey: "PAY-100",
    reviewers: ["team-lead"],
  });
  return f;
}
async function finish(f, match, text = "Done") {
  const index = f.pending.findIndex((p) => match(p.options));
  assert.ok(index >= 0, "matching runtime session");
  const [pending] = f.pending.splice(index, 1);
  const entry = [...f.engine.jobs].find(
    ([key]) => f.store.get("runs", key).cwd === pending.options.cwd,
  );
  pending.resolve({
    text,
    summary: text.slice(-4000),
    actualModel: pending.options.route.resolvedModel,
    usage: { input_tokens: 100, output_tokens: 40 },
  });
  await entry[1].done;
  await f.engine.v11.settled();
}
async function assessed(f) {
  const decisions = f.engine.tasks(f.quest.id).map((task, i) => ({
    taskId: task.id,
    complexity: i === 1 ? "COMPLEX" : "SIMPLE",
    risk: "LOW",
    recommendedModelFamily: i === 1 ? "sonnet" : "haiku",
    recommendedEffort: i === 1 ? "high" : "medium",
    reason: "Repository and behavior evidence",
    confidence: 0.9,
  }));
  await finish(
    f,
    (p) => p.purpose === "v11-route",
    JSON.stringify({
      assessments: decisions,
      questAssessment: { ...decisions[0], taskId: f.quest.id },
    }),
  );
}
test("two-repository dynamic execution isolates same-repo workers, integrates dependencies and fixes production review", async (t) => {
  const f = await setup(t);
  delete f.adapters.runtimes.codex; // Company machines may have Claude Code only.
  const createPr = f.adapters.sourceControl.create;
  f.adapters.sourceControl.create = async (input) => {
    const scope = await f.engine.v11.production.scope(
      f.store.get("quests", f.quest.id),
    );
    assert.ok(
      f.engine
        .works(f.quest.id)
        .every(
          (work) =>
            work.productionReview?.verdict === "PASSED" &&
            work.productionReview.scope === scope.fingerprint,
        ),
    );
    return createPr(input);
  };
  await f.engine.action("EXECUTE_QUEST", { questId: f.quest.id });
  await f.engine.v11.settled();
  assert.equal(f.pending.length, 1);
  assert.equal(f.pending[0].options.route.resolvedModel, "claude-opus-5-5");
  await assessed(f);
  assert.equal(
    f.pending.filter((p) => p.options.purpose === "v11-task").length,
    3,
  );
  const tasks = f.engine.tasks(f.quest.id);
  const first = f.store.get("tasks", tasks[0].id),
    second = f.store.get("tasks", tasks[1].id);
  assert.notEqual(first.workspace.path, second.workspace.path);
  assert.notEqual(first.workspace.branch, second.workspace.branch);
  assert.equal(first.route.family, "haiku");
  assert.equal(second.route.family, "sonnet");
  assert.equal(f.store.get("tasks", tasks[3].id).state, "PUBLISHED");
  while (f.pending.some((p) => p.options.purpose === "v11-task")) {
    const options = f.pending.find(
      (p) => p.options.purpose === "v11-task",
    ).options;
    const task = f.store.get("tasks", options.taskId);
    writeFileSync(
      path.join(options.cwd, `${task.key}.txt`),
      `${task.key} implemented\n`,
    );
    await finish(f, (p) => p.taskId === task.id);
  }
  assert.ok(
    f.engine
      .tasks(f.quest.id)
      .every((t) => t.state === "COMPLETED" && t.integratedCommit),
  );
  let reviewed = 0,
    fixed = false;
  while (f.pending.length) {
    const options = f.pending[0].options;
    if (options.purpose === "v11-review") {
      reviewed++;
      await finish(
        f,
        (p) => p.cwd === options.cwd,
        JSON.stringify(
          review(
            options.reviewedCommit,
            !fixed ? "CHANGES_REQUIRED" : "PASSED",
          ),
        ),
      );
    } else {
      assert.equal(options.purpose, "v11-fix");
      writeFileSync(
        path.join(options.cwd, "review-fixed.txt"),
        "Production issue corrected\n",
      );
      fixed = true;
      await finish(f, (p) => p.cwd === options.cwd);
    }
  }
  assert.ok(
    reviewed >= 3,
    JSON.stringify(
      f.engine.works(f.quest.id).map(({ state, error }) => ({ state, error })),
    ),
  );
  assert.equal(f.engine.works(f.quest.id).length, 2);
  assert.ok(f.engine.works(f.quest.id).every((w) => w.pr));
  assert.equal(f.store.get("quests", f.quest.id).state, "PRS_CREATED");
  assert.equal(f.created.length, 2);
  assert.ok(
    f.engine.works(f.quest.id).every((work) => work.productionReview.scope),
  );
  assert.ok(
    f.store
      .all("runs")
      .filter((run) => run.purpose === "v11-review")
      .every((run) => run.reviewScope),
  );
  for (const repo of f.repos)
    assert.equal(git(repo.path, "branch", "--show-current"), "development");
  assert.ok(
    f.store
      .all("runs")
      .filter((r) => r.workflowVersion === 2)
      .every((r) => r.route && r.resolvedModel && r.usage),
  );
});

test("manual routing avoids orchestrator and invalid model blocks before spawning", async (t) => {
  const f = await setup(t, {
    routing: { mode: "manual", model: "claude-sonnet-5-5" },
    mode: "guided",
  });
  f.adapters.config.orchestration.models = [];
  await f.engine.action("EXECUTE_QUEST", { questId: f.quest.id });
  await f.engine.v11.settled();
  assert.equal(f.pending.length, 0);
  assert.ok(
    f.engine.tasks(f.quest.id).some((t) => /No verified/.test(t.error || "")),
  );
  assert.equal(
    f.store.all("runs").filter((r) => r.purpose === "v11-route").length,
    0,
  );
});

test("owned branches and protected targets preserve unrelated work", async (t) => {
  const f = await setup(t);
  const quest = f.store.get("quests", f.quest.id),
    repo = f.repos[0];
  const identity = f.engine.v11.git.identity(quest, repo);
  git(repo.path, "branch", identity.branch);
  await assert.rejects(
    f.engine.v11.git.prepare(
      quest,
      repo,
      "work-1",
      null,
      git(repo.path, "rev-parse", "HEAD"),
    ),
    /existing branch/,
  );
  assert.equal(
    f.engine.v11.git.protected(
      { ...repo, protectedBranches: ["release/*"] },
      "release/1.0",
    ),
    true,
  );
  assert.equal(f.engine.v11.git.protected(repo, "master"), true);
});

test("no-Epic master/tag repository config needs no development branch and reset is explicit", async (t) => {
  const f = await setup(t);
  const repo = f.repos[0];
  git(repo.path, "branch", "-m", "development", "master");
  git(repo.path, "tag", "v1.0.0");
  await f.engine.action("CONFIGURE_REPOSITORY", {
    repositoryId: repo.id,
    defaultBranch: "master",
    baseBranch: "master",
    prTarget: "master",
    protectedBranches: ["release/*"],
  });
  const configured = f.store.get("repositories", repo.id);
  git(repo.path, "checkout", "-b", "staging");
  writeFileSync(
    path.join(repo.path, "staging-only.txt"),
    "Staging differs from the configured base\n",
  );
  git(repo.path, "add", ".");
  git(repo.path, "commit", "-m", "staging work");
  assert.notEqual(
    git(repo.path, "rev-parse", "HEAD"),
    git(repo.path, "rev-parse", "master"),
  );
  assert.equal(
    await f.engine.v11.git.base(configured),
    git(repo.path, "rev-parse", "master"),
  );
  assert.equal(git(repo.path, "branch", "--show-current"), "staging");
  const quest = { ...f.store.get("quests", f.quest.id), epicKey: "" };
  assert.match(f.engine.v11.git.identity(quest, configured).branch, /^quest\//);
  assert.equal(f.engine.v11.git.protected(configured, "master"), true);
  await assert.rejects(
    f.engine.action("RESET_DEVELOPMENT_DATA", { confirmation: "yes" }),
    /Type RESET/,
  );
  const repositories = f.store.all("repositories").length;
  await f.engine.action("RESET_DEVELOPMENT_DATA", {
    confirmation: "RESET DEVQUEST TEST DATA",
  });
  assert.equal(f.store.all("quests").length, 0);
  assert.equal(f.store.all("repositories").length, repositories);
  assert.match(git(repo.path, "tag", "--list"), /v1.0.0/);
  assert.equal(
    f.store.db.prepare("PRAGMA integrity_check").get().integrity_check,
    "ok",
  );
});

test("invalid orchestration output fails without worker spawns or duplicate assessment", async (t) => {
  const f = await setup(t);
  await f.engine.action("EXECUTE_QUEST", { questId: f.quest.id });
  await f.engine.v11.settled();
  await f.engine.action("ASSESS_TASKS", { questId: f.quest.id });
  await f.engine.v11.settled();
  assert.equal(f.pending.length, 1);
  await finish(
    f,
    (p) => p.purpose === "v11-route",
    JSON.stringify({ assessments: [] }),
  );
  assert.equal(f.pending.length, 0);
  assert.equal(f.store.get("quests", f.quest.id).autoExecute, false);
  assert.ok(
    f.store
      .all("runs")
      .some((run) => run.purpose === "v11-route" && run.state === "FAILED"),
  );
});

test("review cycles and stale commits cannot unlock readiness", async (t) => {
  const f = await setup(t);
  const quest = f.store.get("quests", f.quest.id),
    repo = f.repos[0];
  const work = await f.engine.v11.work(quest, repo);
  const head = git(work.path, "rev-parse", "HEAD");
  await assert.rejects(
    f.engine.v11.fix(
      quest,
      { ...work, fixCycles: 3 },
      review(head, "CHANGES_REQUIRED"),
    ),
    /cycle limit/,
  );
  f.store.put("works", {
    ...work,
    productionReview: review("a".repeat(40)),
    validation: { passed: true, head },
  });
  await assert.rejects(
    f.engine.v11.ready(quest, f.store.get("works", work.id)),
    /stale/,
  );
  writeFileSync(path.join(work.path, "preserve.txt"), "Unrelated user edit\n");
  await assert.rejects(
    f.engine.v11.git.integrate(
      repo,
      { ...work, integration: { taskId: "unrelated" } },
      { id: "unrelated", key: "T", commit: head },
    ),
    /unrelated changes/,
  );
  assert.match(
    readFileSync(path.join(work.path, "preserve.txt"), "utf8"),
    /Unrelated/,
  );
});

test("six independent same-repository tasks claim at most five unique workers", async (t) => {
  const f = await setup(t, {
    routing: { mode: "manual", model: "claude-sonnet-5-5" },
    mode: "guided",
  });
  const template = f.engine.tasks(f.quest.id)[0];
  for (const task of f.engine.tasks(f.quest.id))
    f.store.remove("tasks", task.id);
  for (let i = 0; i < 6; i++)
    f.store.put("tasks", {
      ...template,
      id: `${template.questId}_S${i}`,
      key: `S${i}`,
      dependencies: [],
    });
  await f.engine.action("EXECUTE_QUEST", { questId: f.quest.id });
  await f.engine.v11.settled();
  assert.equal(
    f.pending.length,
    5,
    JSON.stringify(
      f.engine
        .tasks(f.quest.id)
        .map(({ key, state, error }) => ({ key, state, error })),
    ),
  );
  assert.equal(new Set(f.pending.map((p) => p.options.cwd)).size, 5);
  const interruptedFix = f.store.put("runs", {
    id: "interrupted-fix",
    questId: f.quest.id,
    workId: f.engine.works(f.quest.id)[0].id,
    workflowVersion: 2,
    purpose: "v11-fix",
    role: "developer",
    state: "INTERRUPTED",
  });
  await assert.rejects(
    f.engine.action("CONTINUE_AGENT", {
      questId: f.quest.id,
      runId: interruptedFix.id,
    }),
    /agent limit/,
  );
  assert.equal(f.store.get("runs", interruptedFix.id).state, "INTERRUPTED");

  assert.equal(
    f.engine.tasks(f.quest.id).filter((t) => t.state === "PUBLISHED").length,
    1,
  );
  await assert.rejects(
    f.engine.action("START_TASK", {
      questId: f.quest.id,
      taskId: template.questId + "_S5",
    }),
    /agent limit/,
  );
});

test("integration conflict is preserved, fixed in a bounded worker, then validated", async (t) => {
  const f = await setup(t, { mode: "guided" });
  await f.engine.action("EXECUTE_QUEST", { questId: f.quest.id });
  await f.engine.v11.settled();
  await assessed(f);
  const tasks = f.engine.tasks(f.quest.id);
  for (const task of tasks.slice(0, 2)) {
    const workspace = f.store.get("tasks", task.id).workspace;
    writeFileSync(path.join(workspace.path, "shared.txt"), task.key + "\n");
    await finish(f, (p) => p.taskId === task.id && p.purpose === "v11-task");
  }
  const work = f.engine
    .works(f.quest.id)
    .find((w) => w.repoId === tasks[0].repoId);
  assert.equal(work.state, "INTEGRATION_CONFLICT");
  assert.match(
    readFileSync(path.join(work.path, "shared.txt"), "utf8"),
    /<<<<<<< HEAD/,
  );
  const fix = f.pending.find((p) => p.options.purpose === "v11-conflict");
  assert.ok(fix);
  writeFileSync(
    path.join(work.path, "shared.txt"),
    "Both A and B requirements preserved\n",
  );
  git(work.path, "add", "shared.txt");
  await finish(f, (p) => p.purpose === "v11-conflict");
  assert.equal(f.store.get("tasks", tasks[1].id).state, "COMPLETED");
  assert.equal(f.store.get("works", work.id).integration, null);
  assert.equal(git(work.path, "ls-files", "-u"), "");
});

test("restart marks workers interrupted and keeps their branches and edits", async (t) => {
  const f = await setup(t, {
    routing: { mode: "manual", model: "claude-sonnet-5-5" },
    mode: "guided",
  });
  const task = f.engine.tasks(f.quest.id)[0];
  await f.engine.action("START_TASK", { questId: f.quest.id, taskId: task.id });
  await f.engine.v11.settled();
  const workspace = f.store.get("tasks", task.id).workspace;
  writeFileSync(
    path.join(workspace.path, "unfinished.txt"),
    "Preserve edits\n",
  );
  const run = f.store.all("runs").find((r) => r.taskId === task.id);
  const job = f.engine.jobs.get(run.id);
  f.engine.jobs.delete(run.id); // Simulate process disappearance after a persisted RUNNING claim.
  await f.engine.reconcile();
  assert.equal(f.store.get("runs", run.id).state, "INTERRUPTED");
  assert.equal(f.store.get("tasks", task.id).state, "INTERRUPTED");
  assert.match(
    readFileSync(path.join(workspace.path, "unfinished.txt"), "utf8"),
    /Preserve/,
  );
  assert.equal(f.store.get("quests", f.quest.id).autoExecute, false);
  const pending = f.pending.shift();
  pending.resolve({ text: "Late process completion" });
  await job.done;
  assert.equal(f.store.get("tasks", task.id).state, "INTERRUPTED");
  await f.engine.close();
  const reloadedStore = new Store(f.store.dir);
  const reloaded = new Engine({ store: reloadedStore, adapters: f.adapters });
  t.after(async () => {
    await reloaded.close();
    reloadedStore.close();
  });
  await reloaded.initialize();
  assert.equal(reloadedStore.get("tasks", task.id).state, "INTERRUPTED");
  assert.equal(reloaded.jobs.size, 0);
  assert.ok(
    reloadedStore
      .all("branches")
      .some((branch) => branch.branch === workspace.branch),
  );
  assert.match(
    readFileSync(path.join(workspace.path, "unfinished.txt"), "utf8"),
    /Preserve/,
  );
});

test("bounded reasoning escalation does not treat environment problems as reasoning", async (t) => {
  const f = await setup(t, { mode: "guided" });
  const quest = f.store.get("quests", f.quest.id);
  for (const task of f.engine.tasks(f.quest.id))
    f.store.put("tasks", {
      ...task,
      assessment: {
        taskId: task.id,
        complexity: "SIMPLE",
        risk: "LOW",
        recommendedModelFamily: "haiku",
        recommendedEffort: "medium",
        reason: "Small scoped change",
        confidence: 1,
      },
    });
  const task = f.engine.tasks(f.quest.id)[0];
  await f.engine.action("START_TASK", { questId: quest.id, taskId: task.id });
  await f.engine.v11.settled();
  await finish(
    f,
    (p) => p.taskId === task.id,
    JSON.stringify({
      status: "BLOCKED",
      category: "REASONING_COMPLEXITY",
      evidence: "Cross-state invariants require a more capable reasoning model",
    }),
  );
  assert.equal(f.store.get("tasks", task.id).escalations, 1);
  assert.equal(f.pending[0].options.route.family, "sonnet");
  await finish(
    f,
    (p) => p.taskId === task.id,
    JSON.stringify({
      status: "BLOCKED",
      category: "ENVIRONMENT",
      evidence: "Required database credentials are not configured",
    }),
  );
  assert.equal(f.store.get("tasks", task.id).escalations, 1);
  assert.equal(f.pending.length, 0);
});

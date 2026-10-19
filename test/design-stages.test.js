import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fixture } from "./engine-fixture.js";
import { models } from "./v11-fixture.js";
import { designResult } from "./design-fixture.js";
import { parseDesignResult } from "../src/design-stages.js";
import { ClaudeCodeRuntime } from "../src/adapters.js";

const leaked =
  "DEVQUEST_WAITING_INPUT\nPlan approved. Two blockers remain before I write code. Pick inline or subagents. Grant repository write access.";
async function setup(t, realGit = false) {
  const f = await fixture(t, { realGit });
  f.adapters.config.orchestration = { models };
  const loadedSkills = [];
  f.adapters.workflow = {
    instructions: async (name) => {
      loadedSkills.push(name);
      return "UNSCOPED_SKILL_HANDOFF_IMPLEMENT";
    },
  };
  const quest = await f.engine.action("CREATE_QUEST", {
    kind: "TECH",
    title: "Isolated design",
    content:
      "Keep the existing funding behavior while simplifying service boundaries",
    repositoryIds: f.repos.map((repo) => repo.id),
    workflowVersion: 2,
    execution: {
      runtime: "claude",
      routing: { mode: "manual", model: "claude-sonnet-5-5" },
    },
  });
  return { ...f, quest, loadedSkills };
}

test("Tech brainstorming persists spec.md, stops, then explicit Analyze uses a new read-only run", async (t) => {
  const f = await setup(t, true);
  const sourceBefore = f.repos.map((repo) =>
    execFileSync("git", ["status", "--porcelain=v1"], {
      cwd: repo.path,
      encoding: "utf8",
    }),
  );
  const run = await f.engine.action("START_BRAINSTORM", {
    questId: f.quest.id,
  });
  const options = f.pending[0].options;
  assert.equal(options.role, "architect");
  assert.equal(options.stage, "brainstorm");
  assert.equal(options.readOnly, true);
  assert.equal(options.contractVersion, 1);
  assert.deepEqual(
    options.accessScope.repositories.map((repo) => repo.id),
    f.quest.repositoryIds,
  );
  assert.doesNotMatch(options.prompt, /UNSCOPED_SKILL_HANDOFF_IMPLEMENT/);
  assert.ok(!f.loadedSkills.includes("brainstorming"));
  await f.finish(
    designResult(
      "brainstorm",
      "# Funding specification\nReuse the current transaction service.",
    ),
  );
  const spec = f.store.latest(f.quest.id, "spec");
  assert.equal(spec.sourceStage, "brainstorm");
  assert.match(
    readFileSync(
      path.join(f.store.dir, "quests", f.quest.id, "spec.md"),
      "utf8",
    ),
    /Funding specification/,
  );
  assert.ok(spec.file.startsWith(f.store.dir));
  assert.equal(f.store.get("quests", f.quest.id).state, "BRAINSTORM_COMPLETED");
  assert.equal(f.pending.length, 0);
  assert.equal(f.store.latest(f.quest.id, "analysis"), undefined);
  assert.equal(f.store.latest(f.quest.id, "technical-brief"), undefined);
  await f.engine.action("SAVE_SPEC", {
    questId: f.quest.id,
    content: "# Updated specification\nReuse the current transaction service.",
  });
  const analysis = await f.engine.action("ANALYZE_PRD", {
    questId: f.quest.id,
  });
  assert.notEqual(analysis.id, run.id);
  assert.equal(analysis.stage, "analysis");
  assert.equal(f.pending[0].options.readOnly, true);
  assert.match(f.pending[0].options.prompt, /Updated specification/);
  assert.doesNotMatch(
    f.pending[0].options.prompt,
    /UNSCOPED_SKILL_HANDOFF_IMPLEMENT/,
  );
  await f.finish(
    designResult(
      "analysis",
      "# Impact analysis\nBoth services preserve their API contracts.",
    ),
  );
  assert.equal(f.store.get("quests", f.quest.id).state, "ANALYSIS_COMPLETED");
  assert.equal(
    f.store.latest(f.quest.id, "analysis").sourceSpecId,
    f.store.latest(f.quest.id, "spec").id,
  );
  assert.equal(f.pending.length, 0);
  assert.equal(f.store.latest(f.quest.id, "trd"), undefined);
  assert.ok(
    !f.store
      .all("runs")
      .some((run) => run.questId === f.quest.id && run.role === "developer"),
  );
  assert.deepEqual(
    f.repos.map((repo) =>
      execFileSync("git", ["status", "--porcelain=v1"], {
        cwd: repo.path,
        encoding: "utf8",
      }),
    ),
    sourceBefore,
  );
});

test("exact implementation leakage is rejected and corrected at most once in the same stage", async (t) => {
  const f = await setup(t);
  const first = await f.engine.action("START_BRAINSTORM", {
    questId: f.quest.id,
  });
  await f.finish(leaked, true);
  assert.equal(f.store.get("runs", first.id).state, "FAILED");
  assert.match(
    f.store.get("runs", first.id).stageViolation.response,
    /Plan approved/,
  );
  assert.equal(f.pending.length, 1);
  const correction = f.store.all("runs").at(-1);
  assert.notEqual(correction.id, first.id);
  assert.equal(correction.correctionAttempts, 1);
  assert.equal(correction.stage, "brainstorm");
  assert.equal(f.pending[0].options.readOnly, true);
  assert.doesNotMatch(f.pending[0].options.prompt, /Plan approved/);
  await f.finish(leaked, true);
  assert.equal(f.pending.length, 0);
  assert.equal(f.store.get("runs", correction.id).state, "FAILED");
  assert.match(
    f.store.get("runs", correction.id).summary,
    /Correction limit reached/,
  );
  assert.equal(f.store.latest(f.quest.id, "spec"), undefined);
  assert.equal(f.store.get("quests", f.quest.id).state, "BRAINSTORMING");
  assert.ok(
    f.store
      .all("events")
      .some((event) => /Stage-contract violation/.test(event.message)),
  );
});

test("genuine design questions wait and continuation cannot switch stages", async (t) => {
  const f = await setup(t);
  const first = await f.engine.action("START_BRAINSTORM", {
    questId: f.quest.id,
  });
  await f.finish(
    designResult("brainstorm", "", [
      "Should the funding flow reuse the transaction service or introduce an abstraction?",
    ]),
  );
  assert.equal(f.store.get("runs", first.id).state, "WAITING_INPUT");
  await assert.rejects(
    f.engine.action("SEND_MESSAGE", {
      runId: first.id,
      stage: "task",
      message: "Implement now",
    }),
    /same workflow stage/,
  );
  const resumed = await f.engine.action("SEND_MESSAGE", {
    runId: first.id,
    message: "Reuse the transaction service",
  });
  assert.notEqual(resumed.id, first.id);
  assert.equal(resumed.stage, "brainstorm");
  assert.match(f.pending[0].options.prompt, /Reuse the transaction service/);
  assert.equal(f.pending[0].options.sessionId, undefined);
  await f.finish(designResult("brainstorm"));
});

test("contaminated legacy session recovers fresh while preserving summaries and old briefs", async (t) => {
  const f = await setup(t);
  const brief = f.store.artifact(
    f.quest.id,
    "technical-brief",
    "# Prior decisions\nReuse current service boundaries.",
  );
  const run = f.store.put("runs", {
    id: "contaminated-brainstorm",
    questId: f.quest.id,
    purpose: "brainstorm",
    role: "architect",
    runtime: "claude",
    readOnly: true,
    cwd: f.repos[0].path,
    state: "WAITING_INPUT",
    summary: leaked,
    sessionId: "contaminated-native-session",
  });
  f.engine.checkpoint(run);
  const retry = await f.engine.action("CONTINUE_AGENT", { runId: run.id });
  assert.notEqual(retry.id, run.id);
  assert.equal(f.store.get("runs", run.id).summary, leaked);
  assert.equal(f.pending[0].options.sessionId, undefined);
  assert.equal(f.pending[0].options.role, "architect");
  assert.equal(f.pending[0].options.readOnly, true);
  assert.match(f.pending[0].options.prompt, /Reuse current service boundaries/);
  assert.doesNotMatch(f.pending[0].options.prompt, /Plan approved/);
  await f.finish(designResult("brainstorm"));
  assert.equal(f.store.latest(f.quest.id, "technical-brief").id, brief.id);
  assert.doesNotMatch(
    f.engine.context(f.store.get("quests", f.quest.id), "analysis"),
    /Prior decisions/,
  );
});

test("stage schemas reject cross-stage execution and write-permission requests", () => {
  const valid = JSON.parse(designResult("brainstorm"));
  for (const invalid of [
    { ...valid, stage: "task" },
    { ...valid, status: "implement" },
    { ...valid, executePlan: true },
    { ...valid, artifact: { ...valid.artifact, filename: "plan.md" } },
    { ...valid, artifact: { ...valid.artifact, content: "" } },
    {
      ...valid,
      summary: "Plan approved. Two blockers remain before I write code.",
    },
    {
      stage: "brainstorm",
      status: "waiting_input",
      summary: "Need permission",
      openQuestions: ["Please grant repository write access"],
    },
    {
      stage: "brainstorm",
      status: "waiting_input",
      summary: "Choose execution",
      openQuestions: ["Choose inline or subagents?"],
    },
  ])
    assert.throws(() =>
      parseDesignResult(JSON.stringify(invalid), "brainstorm"),
    );
  assert.throws(() => parseDesignResult(leaked, "brainstorm"));
});

test("stage context excludes downstream plans and persistence failure cannot advance the Quest", async (t) => {
  const f = await setup(t);
  f.store.artifact(f.quest.id, "plan", "DOWNSTREAM_PLAN_MUST_NOT_LEAK");
  f.store.artifact(
    f.quest.id,
    "summary",
    "Plan approved. DOWNSTREAM_SUMMARY_MUST_NOT_LEAK",
  );
  for (const stage of ["brainstorm", "analysis", "trd", "plan"])
    assert.doesNotMatch(f.engine.context(f.quest, stage), /DOWNSTREAM_/);
  f.store.remove("artifacts", f.store.latest(f.quest.id, "plan").id);
  await f.engine.action("START_BRAINSTORM", { questId: f.quest.id });
  const save = f.store.artifact.bind(f.store);
  f.store.artifact = (questId, kind, content) => {
    if (kind === "spec") throw new Error("DISK_FULL");
    return save(questId, kind, content);
  };
  await f.finish(designResult("brainstorm"));
  assert.equal(f.store.latest(f.quest.id, "spec"), undefined);
  assert.equal(f.store.get("quests", f.quest.id).state, "BRAINSTORMING");
  assert.match(
    f.store.all("runs").at(-1).summary,
    /persistence failed.*DISK_FULL/,
  );
  assert.equal(f.pending.length, 0);
});

test("runtime stage protocol suppresses the generic prose WAITING_INPUT instruction", async () => {
  let input;
  const runtime = new ClaudeCodeRuntime({
    runner: async (_file, _args, options) => {
      input = options.input;
      return {
        code: 0,
        stderr: "",
        stdout:
          JSON.stringify({
            type: "result",
            result: designResult("brainstorm"),
          }) + "\n",
      };
    },
  });
  runtime.help = "--permission-mode";
  runtime.detectCapabilities = async () => ({ available: true });
  await runtime.start({
    cwd: process.cwd(),
    readOnly: true,
    contractVersion: 1,
    prompt: "Return the structured brainstorm result",
  });
  assert.match(input, /current-stage JSON protocol/);
  assert.doesNotMatch(
    input,
    /begin your final response with DEVQUEST_WAITING_INPUT/,
  );
});

test("a failed fresh-session launch preserves the waiting run for another retry", async (t) => {
  const f = await setup(t);
  const run = f.store.put("runs", {
    id: "preserved-waiting-stage",
    questId: f.quest.id,
    purpose: "brainstorm",
    role: "architect",
    runtime: "claude",
    readOnly: true,
    cwd: f.repos[0].path,
    state: "WAITING_INPUT",
    summary: "Should we reuse the existing transaction service?",
  });
  f.adapters.config.orchestration.models = [];
  await assert.rejects(
    f.engine.action("CONTINUE_AGENT", { runId: run.id }),
    /No verified/,
  );
  assert.equal(f.store.get("runs", run.id).state, "WAITING_INPUT");
  assert.equal(f.store.get("runs", run.id).summary, run.summary);
  assert.equal(f.pending.length, 0);
});

test("parent-directory denial gets one fresh scoped correction without erasing argv or advancing stage", async (t) => {
  const f = await setup(t, true);
  const run = await f.engine.action("START_BRAINSTORM", {
    questId: f.quest.id,
  });
  const args = ["--restricted", "--add-dir", f.repos[1].path];
  const failure = {
    category: "DISALLOWED_PARENT_TRAVERSAL",
    operation: "Glob",
    target: path.dirname(f.repos[0].path),
    detail: "outside selected roots",
  };
  const rejectParent = async () => {
    const pending = f.pending.shift();
    pending.options.onEvent({
      type: "access",
      arguments: args,
      preflight: { status: "PASSED" },
    });
    pending.options.onEvent({
      type: "access",
      preflight: { status: "FAILED", accessFailure: failure },
    });
    pending.reject(
      Object.assign(
        new Error("Parent lookup denied; inspect selected roots directly"),
        {
          accessFailure: failure,
        },
      ),
    );
    await Promise.all([...f.engine.jobs.values()].map((job) => job.done));
  };
  await rejectParent();
  const old = f.store.get("runs", run.id);
  assert.deepEqual(old.cliArguments, args);
  assert.equal(old.accessFailure.operation, "Glob");
  assert.equal(old.state, "FAILED");
  assert.equal(f.pending.length, 1);
  const next = f.pending[0].options;
  assert.equal(next.accessCorrectionAttempts, 1);
  assert.equal(next.stage, "brainstorm");
  assert.equal(next.readOnly, true);
  assert.equal(next.sessionId, undefined);
  assert.deepEqual(
    next.accessScope.repositories.map((repo) => repo.id),
    f.quest.repositoryIds,
  );
  assert.match(next.prompt, /Never list the common parent/);
  assert.doesNotMatch(next.prompt, /Parent lookup denied/);
  assert.equal(f.store.latest(f.quest.id, "spec"), undefined);
  assert.equal(f.store.get("quests", f.quest.id).state, "BRAINSTORMING");
  await rejectParent();
  assert.equal(f.pending.length, 0);
  assert.ok(f.store.all("runs").every((record) => record.role !== "developer"));
  const retried = await f.engine.action("CONTINUE_AGENT", {
    runId: f.store.all("runs").at(-1).id,
  });
  assert.equal(retried.stage, "brainstorm");
  assert.equal(f.pending[0].options.readOnly, true);
  assert.deepEqual(
    f.pending[0].options.accessScope.repositories.map((repo) => repo.id),
    f.quest.repositoryIds,
  );
  await f.finish(designResult("brainstorm"));
  assert.equal(f.store.get("quests", f.quest.id).state, "BRAINSTORM_COMPLETED");
  assert.equal(f.store.latest(f.quest.id, "analysis"), undefined);
});

const trdLeak =
  "DEVQUEST_WAITING_INPUT\nI also need a shell tool to create the branch and confirm the working tree is clean. Enable one, or switch both repos to the right branch yourself.";
async function throughAnalysis(f) {
  await f.engine.action("START_BRAINSTORM", { questId: f.quest.id });
  await f.finish(designResult("brainstorm"));
  await f.engine.action("ANALYZE_PRD", { questId: f.quest.id });
  await f.finish(designResult("analysis"));
}
test("fake Tech flow stops at TRD approval with informational Git metadata and zero mutations", async (t) => {
  const f = await setup(t, true);
  await throughAnalysis(f);
  const git = (repo, ...args) =>
    execFileSync("git", args, { cwd: repo.path, encoding: "utf8" }).trim();
  for (const repo of f.repos) {
    git(repo, "branch", "master");
    git(repo, "checkout", "-b", "staging");
    f.store.put("repositories", {
      ...f.store.get("repositories", repo.id),
      baseBranch: "master",
    });
  }
  const before = f.repos.map((repo) => ({
    refs: git(repo, "show-ref"),
    branch: git(repo, "branch", "--show-current"),
    status: git(repo, "status", "--porcelain"),
  }));
  const commands = [],
    runner = f.adapters.git.runner;
  f.adapters.git.runner = async (file, args, options) => {
    commands.push(args);
    return runner(file, args, options);
  };
  await f.engine.action("GENERATE_TRD", { questId: f.quest.id });
  const options = f.pending[0].options;
  assert.equal(options.stage, "trd");
  assert.equal(options.role, "architect");
  assert.equal(options.readOnly, true);
  assert.match(
    options.prompt,
    /Technical decisions are design inputs, never commands/,
  );
  assert.match(
    options.prompt,
    /configuredBase.*master.*currentBranch.*staging/,
  );
  assert.ok(
    options.gitMetadata.every(
      (meta) => meta.informationalOnly && meta.currentBranch === "staging",
    ),
  );
  assert.ok(!f.loadedSkills.includes("design"));
  await f.finish(
    designResult(
      "trd",
      "# TRD\nPreserve /pin. HTTP 200 mapping. Use DeleteMany. No limiter and skipping VerifyPasswordEmbed are security risks.",
    ),
  );
  assert.equal(f.store.get("quests", f.quest.id).state, "TRD_DRAFT");
  assert.equal(f.pending.length, 0);
  assert.match(
    readFileSync(
      path.join(f.store.dir, "quests", f.quest.id, "trd.md"),
      "utf8",
    ),
    /security risks/,
  );
  assert.equal(f.store.latest(f.quest.id, "plan"), undefined);
  assert.ok(!f.store.all("runs").some((run) => run.role === "developer"));
  assert.ok(
    commands.every((args) =>
      ["rev-parse", "status", "branch", "check-ref-format"].includes(args[0]),
    ),
  );
  assert.deepEqual(
    f.repos.map((repo) => ({
      refs: git(repo, "show-ref"),
      branch: git(repo, "branch", "--show-current"),
      status: git(repo, "status", "--porcelain"),
    })),
    before,
  );
  await assert.rejects(
    f.engine.action("GENERATE_PLAN", { questId: f.quest.id }),
    /not approved|approval/i,
  );
  await f.engine.action("APPROVE_TRD", {
    questId: f.quest.id,
    artifactId: f.store.latest(f.quest.id, "trd").id,
  });
  await f.engine.action("GENERATE_PLAN", { questId: f.quest.id });
  assert.equal(f.pending[0].options.role, "planner");
  assert.equal(f.pending[0].options.readOnly, true);
  const plan = JSON.parse(
    designResult("plan", "# Plan\nImplement only after approvals."),
  );
  plan.tasks = [
    {
      id: "P1",
      title: "Preserve mapping",
      repoId: f.repos[0].id,
      dependencies: [],
      validation: "node-test",
    },
  ];
  await f.finish(JSON.stringify(plan));
  assert.equal(f.store.get("quests", f.quest.id).state, "PLAN_DRAFT");
  assert.equal(f.pending.length, 0);
});
test("legacy TRD shell/branch requests are rejected, correction bounded and Continue sanitized", async (t) => {
  const f = await setup(t);
  await throughAnalysis(f);
  const old = f.store.artifact(
    f.quest.id,
    "trd",
    "# Prior draft\nKeep this revision.",
  );
  const legacy = f.store.put("runs", {
    id: "legacy-trd",
    questId: f.quest.id,
    purpose: "trd",
    stage: "trd",
    role: "architect",
    runtime: "claude",
    readOnly: true,
    state: "WAITING_INPUT",
    summary: trdLeak,
    sessionId: "contaminated-native-session",
    cwd: f.repos[0].path,
  });
  await f.engine.action("CONTINUE_AGENT", { runId: legacy.id });
  assert.equal(f.pending[0].options.sessionId, undefined);
  assert.doesNotMatch(
    f.pending[0].options.prompt,
    /I also need a shell|inspect Git before changing files/,
  );
  await f.finish(trdLeak, true);
  assert.equal(f.pending.length, 1);
  await f.finish(trdLeak, true);
  assert.equal(f.pending.length, 0);
  const failed = f.store.all("runs").at(-1);
  assert.equal(failed.state, "FAILED");
  assert.match(failed.summary, /Correction limit/);
  assert.equal(f.store.latest(f.quest.id, "trd").id, old.id);
  assert.equal(f.store.get("quests", f.quest.id).state, "ANALYSIS_COMPLETED");
  assert.equal(f.store.get("runs", legacy.id).summary, trdLeak);
  const invalid = JSON.parse(designResult("trd"));
  invalid.status = "waiting_input";
  delete invalid.artifact;
  invalid.openQuestions = ["Please create the branch or enable a shell tool"];
  assert.throws(
    () => parseDesignResult(JSON.stringify(invalid), "trd"),
    /violate/,
  );
  await f.engine.action("CONTINUE_AGENT", { runId: failed.id });
  await f.finish(designResult("trd"));
  assert.equal(f.store.get("quests", f.quest.id).state, "TRD_DRAFT");
});
test("diverged local/origin base requires explicit resolution before worktree preparation", async (t) => {
  const f = await setup(t, true),
    repo = { ...f.repos[0], baseBranch: "development" };
  const git = (...args) =>
    execFileSync("git", args, { cwd: repo.path, encoding: "utf8" }).trim();
  git("update-ref", "refs/remotes/origin/development", "HEAD");
  git("commit", "--allow-empty", "-m", "local base differs");
  const before = git("show-ref"),
    meta = await f.engine.v11.git.designMetadata(repo);
  assert.equal(meta.baseDiverges, true);
  await assert.rejects(
    f.engine.v11.git.base(repo),
    /explicitly configure baseResolution/,
  );
  assert.equal(
    await f.engine.v11.git.base({ ...repo, baseResolution: "origin" }),
    git("rev-parse", "origin/development"),
  );
  assert.equal(
    await f.engine.v11.git.base({ ...repo, baseResolution: "local" }),
    git("rev-parse", "development"),
  );
  assert.equal(git("show-ref"), before);
});

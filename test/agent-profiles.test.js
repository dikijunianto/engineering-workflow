import test from "node:test";
import assert from "node:assert/strict";
import {
  cpSync,
  realpathSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
  symlinkSync,
  rmSync,
  mkdirSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { AgentProfileRegistry, profileRole } from "../src/agent-profiles.js";
import { assertProfileInvocation, loadRepositoryStandards } from "../src/agent-context.js";
import { hash } from "../src/store.js";
import { fixture } from "./engine-fixture.js";
import { models, review } from "./v11-fixture.js";
import { designResult } from "./design-fixture.js";

const canonical = new URL("../agents/", import.meta.url);
function registry(t) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "devquest-profiles-"));
  cpSync(canonical, dir, { recursive: true });
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return {
    dir,
    registry: new AgentProfileRegistry(dir),
    change: (name, fn) => {
      const file = path.join(dir, name + ".md");
      writeFileSync(file, fn(readFileSync(file, "utf8")));
    },
  };
}
async function setup(t) {
  const f = await fixture(t, { realGit: true });
  f.adapters.config.orchestration = { models };
  const r = registry(t);
  f.engine.agentContexts.registry = r.registry;
  const quest = await f.engine.action("CREATE_QUEST", {
    kind: "TECH",
    title: "Synthetic profile Quest",
    content: "Add bounded synthetic behavior",
    repositoryIds: f.repos.map((r) => r.id),
    workflowVersion: 2,
    agentProfiles: { enabled: true },
    execution: {
      runtime: "claude",
      routing: { mode: "manual", model: "claude-sonnet-5-5", effort: "medium" },
    },
  });
  return { ...f, ...r, quest, q: () => f.store.get("quests", quest.id) };
}
function options(f, purpose = "brainstorm", runtime = "claude") {
  return {
    purpose,
    runtime,
    readOnly: true,
    cwd: f.repos[0].path,
    prompt: "Only current-stage synthetic evidence. Return existing stage output.",
    role: profileRole({ purpose }),
  };
}

test("registry validates all six canonical YAML definitions, sections, versions and deterministic hashes", (t) => {
  const r = registry(t),
    all = r.registry.discover();
  assert.equal(all.length, 6);
  assert.equal(new Set(all.map((p) => p.id)).size, 6);
  for (const p of all) {
    assert.equal(p.version, "1.0.0");
    assert.equal(p.hash, hash(readFileSync(p.source)));
    assert.equal(Object.keys(p.sections).length, 19);
    assert.equal(r.registry.resolve(p.role, r.registry.pins()).id, p.id);
  }
  assert.throws(() => r.registry.resolve("../developer", {}), /unknown/);
  r.change("developer", (s) =>
    s.replace("smallest complete change", "smallest complete tested change"),
  );
  assert.throws(() => r.registry.discover(), /without version bump/);
});
for (const [name, change, pattern] of [
  ["invalid YAML", (s) => s.replace("name: Senior Software Engineer", "name: [unclosed"), /YAML/],
  ["missing section", (s) => s.replace("# Mission", "# Deleted"), /section/],
  ["invalid version", (s) => s.replace("1.0.0", "01.0.0"), /version/],
  ["unsupported version", (s) => s.replace("1.0.0", "2.0.0"), /version/],
  ["wrong mapping", (s) => s.replace("role: developer", "role: architect"), /mapping/],
  [
    "duplicate ID",
    (s) => s.replace("id: devquest-developer", "id: devquest-architect"),
    /duplicate ID/,
  ],
])
  test("registry rejects " + name, (t) => {
    const r = registry(t);
    r.change("developer", change);
    assert.throws(() => r.registry.discover(), pattern);
  });
test("registry rejects missing files and escaping symlinks", (t) => {
  const r = registry(t);
  rmSync(path.join(r.dir, "developer.md"));
  assert.throws(() => r.registry.discover(), /ENOENT/);
  symlinkSync("/etc/hosts", path.join(r.dir, "developer.md"));
  assert.throws(() => r.registry.discover(), /unsafe/);
});

test("standards are root-scoped, separate per repository, hashed, Git-bound and safe with spaces", async (t) => {
  const f = await setup(t);
  writeFileSync(
    path.join(f.repos[0].path, "AGENTS.md"),
    "Alpha conventions; no permission authority.",
  );
  writeFileSync(path.join(f.repos[1].path, "CLAUDE.md"), "Beta conventions.");
  const loaded = loadRepositoryStandards(f.repos, "synthetic-run");
  assert.equal(loaded.filter((p) => p.status === "LOADED").length, 2);
  assert.equal(new Set(loaded.map((p) => p.repositoryId)).size, 2);
  assert.ok(loaded.every((p) => p.commit && p.runId === "synthetic-run"));
  assert.equal(
    loaded.find((p) => p.status === "LOADED").hash,
    hash("Alpha conventions; no permission authority."),
  );
  const spaced = path.join(f.dir, "repo with spaces");
  mkdirSync(spaced);
  writeFileSync(path.join(spaced, "AGENTS.md"), "space");
  assert.equal(loadRepositoryStandards([{ id: "space", path: spaced }], "r")[0].content, "space");
  rmSync(path.join(f.repos[0].path, "AGENTS.md"));
  symlinkSync("/etc/hosts", path.join(f.repos[0].path, "AGENTS.md"));
  assert.throws(() => loadRepositoryStandards(f.repos, "r"), /escapes/);
});

test("composer pins correct Soul, stage, standards and inputs without proposed model policy or downstream artifacts", async (t) => {
  const f = await setup(t);
  writeFileSync(path.join(f.repos[0].path, "AGENTS.md"), "Use synthetic naming.");
  f.store.artifact(f.quest.id, "summary", "UNRELATED SUMMARY DO NOT INJECT");
  const run = f.engine.launch(f.q(), options(f));
  await Promise.resolve();
  const call = f.pending[0].options;
  assert.match(call.prompt, /devquest-architect@1.0.0/);
  assert.match(call.prompt, /Principal Software Architect/);
  assert.match(call.prompt, /Use synthetic naming/);
  assert.match(call.prompt, /Stage brainstorm/);
  assert.doesNotMatch(call.prompt, /claude-opus|UNRELATED SUMMARY/);
  assert.equal(call.accessScope.repositories.length, 2);
  assert.equal(call.readOnly, true);
  assert.equal(call.sessionId, undefined);
  const saved = f.store.get("runs", run.id);
  assert.equal(saved.profileSnapshotHash, hash(JSON.stringify(saved.profileSnapshot)));
  assert.equal(saved.profileSnapshot.inputArtifacts.length, 1);
  assert.equal(saved.profileSnapshot.repositoryStandards.length, 4);
  assert.equal(saved.profileSnapshot.role, "architect");
  assert.throws(
    () =>
      f.store.put("runs", {
        ...saved,
        profileSnapshot: { ...saved.profileSnapshot, role: "developer" },
      }),
    /Immutable/,
  );
  assert.throws(() => f.store.put("runs", { ...saved, resolvedEffort: "max" }), /Immutable/);
  await Promise.resolve();
  await f.finish("Current stage waiting", true);
});

test("continuation retains original configuration and evidence after profile edit; records fresh linked attempt", async (t) => {
  const f = await setup(t);
  const run = await f.engine.action("START_BRAINSTORM", { questId: f.quest.id });
  await Promise.resolve();
  await f.finish(designResult("brainstorm", "", ["Which synthetic constraint?"]));
  const before = f.store.get("runs", run.id);
  const snapshot = JSON.stringify(before.profileSnapshot);
  f.change("architect", (s) =>
    s
      .replace("version: 1.0.0", "version: 1.0.1")
      .replace("Principal architect", "Updated principal architect"),
  );
  const changed = {
    ...f.q(),
    execution: f.engine.v11.config({
      runtime: "claude",
      routing: { mode: "manual", model: "claude-haiku-5-5", effort: "low" },
    }),
  };
  f.store.put("quests", changed);
  const next = await f.engine.action("SEND_MESSAGE", {
    runId: run.id,
    message: "Preserve existing constraints.",
  });
  await Promise.resolve();
  assert.notEqual(next.id, run.id);
  assert.equal(next.logicalRunId, run.id);
  assert.equal(next.previousAttemptId, run.id);
  assert.equal(next.attemptNumber, 2);
  assert.equal(JSON.stringify(next.profileSnapshot), snapshot);
  assert.deepEqual(next.route, before.route);
  assert.equal(f.pending[0].options.sessionId, undefined);
  assert.doesNotMatch(f.pending[0].options.prompt, /Updated principal/);
  assert.match(f.pending[0].options.prompt, /Preserve existing constraints/);
  assert.equal(f.store.get("runs", run.id).summary, before.summary);
  assert.deepEqual(f.store.get("runs", run.id).stageResult, before.stageResult);
  await Promise.resolve();
  await f.finish(designResult("brainstorm"));
});

test("invalid snapshots, revoked models, changed standards and changed artifact references block continuation", async (t) => {
  const f = await setup(t);
  const o = options(f);
  const run = f.engine.launch(f.q(), o);
  await Promise.resolve();
  await f.finish("Checkpoint", true);
  const previous = f.store.get("runs", run.id),
    scope = previous.accessScope;
  assert.throws(
    () =>
      f.engine.agentContexts.prepare(f.q(), { ...o, accessScope: scope }, "child", {
        ...previous,
        profileSnapshotHash: "bad",
      }),
    /snapshot/,
  );
  writeFileSync(path.join(f.repos[0].path, "AGENTS.md"), "Changed standards");
  assert.throws(
    () => f.engine.agentContexts.prepare(f.q(), { ...o, accessScope: scope }, "child", previous),
    /standards changed/,
  );
  rmSync(path.join(f.repos[0].path, "AGENTS.md"));
  f.store.artifact(f.quest.id, "idea", "New requirements");
  assert.throws(
    () => f.engine.agentContexts.prepare(f.q(), { ...o, accessScope: scope }, "child", previous),
    /artifact revisions/,
  );
  const managed = await setup(t);
  const r = await managed.engine.action("START_BRAINSTORM", { questId: managed.quest.id });
  await managed.finish(designResult("brainstorm", "", ["Need details?"]));
  managed.adapters.config.orchestration.models = [];
  await assert.rejects(
    managed.engine.action("CONTINUE_AGENT", { runId: r.id }),
    /no longer permitted/,
  );
});

test("profile text grants no permissions; stage/role, worktree, adapter route and nesting mismatches reject", async (t) => {
  const f = await setup(t);
  const o = options(f);
  assert.throws(() => f.engine.launch(f.q(), { ...o, readOnly: false }), /read-only/);
  assert.throws(() => f.engine.launch(f.q(), { ...o, purpose: "unregistered" }), /unsupported/);
  assert.throws(
    () => f.engine.launch(f.q(), { ...o, executionPolicy: { nestedSpawning: true } }),
    /nested/,
  );
  const r = f.engine.launch(f.q(), o);
  await Promise.resolve();
  const call = f.pending[0].options;
  assertProfileInvocation(call);
  assert.throws(() => assertProfileInvocation({ ...call, readOnly: false }), /mismatch/);
  assert.throws(
    () => assertProfileInvocation({ ...call, route: { resolvedModel: "fable" } }),
    /model/,
  );
  assert.throws(() => assertProfileInvocation({ ...call, runtimeProvider: "codex" }), /mismatch/);
  await Promise.resolve();
  await f.finish("Stop", true);
});

test("legacy runs remain legacy on continuation and explicit opt-in does not rewrite history", async (t) => {
  const f = await fixture(t, { realGit: true });
  const before = JSON.stringify(f.store.all("runs"));
  await f.engine.action("SET_AGENT_PROFILES", { questId: f.quest.id, enabled: true });
  assert.equal(JSON.stringify(f.store.all("runs")), before);
  const legacy = { ...f.store.get("quests", f.quest.id), agentProfiles: { enabled: false } };
  f.store.put("quests", legacy);
  const r = f.engine.launch(legacy, {
    purpose: "analysis",
    role: "architect",
    runtime: "codex",
    readOnly: true,
    prompt: "Legacy",
  });
  await Promise.resolve();
  await f.finish("Legacy checkpoint", true);
  assert.equal(f.store.get("runs", r.id).profileSnapshot, undefined);
  const enabled = {
    ...legacy,
    agentProfiles: { enabled: true, pins: f.engine.agentContexts.registry.pins() },
  };
  f.store.put("quests", enabled);
  const next = f.engine.launch(
    enabled,
    {
      purpose: "analysis",
      role: "architect",
      runtime: "codex",
      readOnly: true,
      prompt: "Legacy continue",
    },
    f.store.get("runs", r.id),
  );
  assert.equal(next.id, r.id);
  assert.equal(next.profileSnapshot, undefined);
  assert.equal(next.attemptHistory.length, 1);
  assert.equal(next.attemptHistory[0].summary, "Legacy checkpoint");
  assert.throws(
    () => f.store.put("runs", { ...next, attemptHistory: [] }),
    /historical AgentRun attempt/,
  );
  await Promise.resolve();
  await f.finish("Legacy done");
});

test("new profile runs reject changed pins, missing versions and active adoption without changing Quest routing", async (t) => {
  const f = await setup(t);
  const config = JSON.stringify(f.q().execution);
  const run = f.engine.launch(f.q(), options(f));
  await assert.rejects(
    f.engine.action("SET_AGENT_PROFILES", { questId: f.quest.id, enabled: true }),
    /active sessions/,
  );
  await Promise.resolve();
  await f.finish("done");
  f.change("architect", (s) => s.replace("version: 1.0.0", "version: 1.0.1"));
  assert.throws(() => f.engine.launch(f.q(), options(f)), /re-adopt/);
  await f.engine.action("SET_AGENT_PROFILES", { questId: f.quest.id, enabled: true });
  assert.equal(JSON.stringify(f.q().execution), config);
  const next = f.engine.launch(f.q(), options(f));
  assert.equal(next.profileSnapshot.profile.version, "1.0.1");
  await Promise.resolve();
  await f.finish("done");
});

test("Claude and Codex receive the same canonical Soul and enforce the same immutable invocation policy", async (t) => {
  const f = await setup(t);
  const opts = options(f);
  const first = f.engine.launch(f.q(), opts);
  await Promise.resolve();
  const claude = f.pending[0].options;
  await f.finish("Stop");
  const second = f.engine.launch(f.q(), { ...opts, runtime: "codex" });
  await Promise.resolve();
  const codex = f.pending[0].options;
  assert.deepEqual(first.profileSnapshot.profile, second.profileSnapshot.profile);
  assert.deepEqual(first.profileSnapshot.soul, second.profileSnapshot.soul);
  assert.equal(codex.runtimeProvider, "codex");
  assertProfileInvocation(codex);
  assert.equal(claude.readOnly, codex.readOnly);
  await f.finish("Stop");
});

test("full synthetic Tech Quest composes all six Souls, isolates worktrees, retains routing and independent review gates", async (t) => {
  const f = await setup(t);
  const qid = f.quest.id;
  const stage = async (action, purpose) => {
    const r = await f.engine.action(action, { questId: qid });
    assert.equal(r.profileSnapshot.role, purpose === "plan" ? "planner" : "architect");
    const result = JSON.parse(designResult(purpose));
    if (purpose === "plan")
      result.tasks = [
        {
          id: "A",
          title: "Synthetic alpha change",
          repoId: f.repos[0].id,
          dependencies: [],
          validation: "node-test",
        },
        {
          id: "B",
          title: "Synthetic beta change",
          repoId: f.repos[1].id,
          dependencies: [],
          validation: "node-test",
        },
      ];
    await f.finish(JSON.stringify(result));
    assert.equal(f.store.get("runs", r.id).state, "COMPLETED");
    return r;
  };
  await stage("START_BRAINSTORM", "brainstorm");
  assert.equal(f.store.latest(qid, "spec").sourceStage, "brainstorm");
  await stage("ANALYZE_PRD", "analysis");
  await stage("GENERATE_TRD", "trd");
  await f.engine.action("APPROVE_TRD", { questId: qid, artifactId: f.store.latest(qid, "trd").id });
  await stage("GENERATE_PLAN", "plan");
  await f.engine.action("APPROVE_PLAN", {
    questId: qid,
    artifactId: f.store.latest(qid, "plan").id,
  });
  const configured = {
    ...f.q(),
    execution: f.engine.v11.config({
      runtime: "claude",
      mode: "autonomous",
      permissions: { createPr: false },
      routing: { mode: "dynamic" },
      limits: { developers: 2 },
    }),
    jiraContext: {
      project: "FFE",
      epic: "FFE-1",
      assignee: "",
      weightReference: "Synthetic weights",
    },
    jiraConfig: undefined,
  };
  f.store.put("quests", configured);
  await f.engine.action("ASSESS_TASKS", { questId: qid });
  await f.engine.v11.settled();
  assert.ok(f.pending.length, JSON.stringify(f.store.all("operations").filter((o) => o.error)));
  const assessor = f.pending[0].options;
  assert.equal(assessor.profileSnapshot.role, "orchestrator");
  const assessments = f.engine.tasks(qid).map((t) => ({
    taskId: t.id,
    complexity: "SIMPLE",
    risk: "LOW",
    recommendedModelFamily: "haiku",
    recommendedEffort: "medium",
    reason: "Synthetic repository evidence",
    confidence: 0.9,
  }));
  await f.finish(
    JSON.stringify({ questAssessment: { ...assessments[0], taskId: qid }, assessments }),
  );
  await f.engine.v11.settled();
  const markdown = readFileSync(new URL("./fixtures/jira-appendix.md", import.meta.url), "utf8");
  const nativeDir = path.join(f.dir, "native-artifacts");
  mkdirSync(nativeDir);
  const skillFile = path.join(f.dir, "fake-skill.md");
  writeFileSync(skillFile, "Synthetic unchanged skill content");
  let writes = 0;
  f.adapters.skill.publish = async () => {
    writes++;
    throw new Error("No publishing authorized");
  };
  f.adapters.skill.prepareAppendix = async () => ({
    nativeSkill: "devquest-jira:create-appendix-task-list",
    skillSource: skillFile,
    skillHash: hash(readFileSync(skillFile)),
    prompt: "Invoke only native create-appendix-task-list. Return complete original Markdown.",
    artifactDirectory: nativeDir,
    mcpTools: ["mcp__atlassian__getJiraIssueTypeMetaWithFields"],
    mcpGuard: { server: "atlassian", stage: "appendix", project: "FFE" },
    cleanup: async () => {},
  });
  f.adapters.skill.preflightAppendix = async () => ({
    status: "READY",
    options: [
      { id: "11515", value: "Refactor or add 1 generic function" },
      { id: "11516", value: "Refactor generic function unit test" },
    ],
  });
  const jr = await f.engine.action("GENERATE_APPENDIX", { questId: qid });
  assert.equal(jr.profileSnapshot.role, "jira-specialist");
  assert.equal(jr.readOnly, true);
  f.pending[0].options.onEvent({
    type: "native-skill",
    skill: "devquest-jira:create-appendix-task-list",
  });
  await f.finish(markdown);
  assert.equal(f.store.get("runs", jr.id).state, "COMPLETED");
  assert.equal(f.store.latest(qid, "appendix").runId, jr.id);
  assert.equal(writes, 0);
  await f.engine.action("USE_EXISTING_JIRA", {
    questId: qid,
    planArtifactId: f.store.latest(qid, "plan").id,
    key: "SYN-1",
    url: "https://jira.example/browse/SYN-1",
  });
  await f.engine.action("EXECUTE_QUEST", { questId: qid });
  await f.engine.v11.settled();
  const taskSessions = [];
  const finishOne = async (text) => {
    const pending = f.pending.shift();
    const id = [...f.engine.jobs.keys()].find((id) => {
      const r = f.store.get("runs", id);
      return (
        r.purpose === pending.options.purpose &&
        r.cwd === pending.options.cwd &&
        r.taskId === pending.options.taskId
      );
    });
    const done = f.engine.jobs.get(id).done;
    pending.resolve({ text, summary: text, actualModel: pending.options.route.resolvedModel });
    await done;
  };
  while (f.pending.length) {
    const p = f.pending[0];
    const role = p.options.profileSnapshot.role;
    if (p.options.purpose === "v11-task") {
      taskSessions.push(p.options);
      assert.equal(role, "developer");
      const task = f.engine.get("tasks", p.options.taskId);
      assert.equal(p.options.cwd, task.workspace.path);
      assert.equal(
        p.options.profileSnapshot.capabilities.repositories[0].repositoryId,
        task.repoId,
      );
      assert.equal(p.options.readOnly, false);
      assert.equal(p.options.route.resolvedModel, "claude-haiku-5-5");
      writeFileSync(
        path.join(p.options.cwd, "synthetic-change.txt"),
        task.key + " bounded implementation\n",
      );
      await finishOne("Synthetic implementation checkpoint");
    } else {
      assert.equal(role, "reviewer");
      assert.equal(p.options.readOnly, true);
      assert.equal(p.options.sessionId, undefined);
      assert.ok(!taskSessions.some((d) => d.cwd === p.options.cwd));
      assert.match(p.options.prompt, /Complete diff/);
      await finishOne(JSON.stringify(review(p.options.reviewedCommit)));
    }
    await f.engine.v11.settled();
  }
  assert.equal(taskSessions.length, 2);
  assert.equal(new Set(taskSessions.map((p) => p.cwd)).size, 2);
  assert.ok(f.engine.tasks(qid).every((t) => t.state === "COMPLETED"));
  assert.ok(
    f.engine.works(qid).every((w) => w.productionReview?.verdict === "PASSED"),
    JSON.stringify(f.engine.works(qid).map((w) => ({ state: w.state, error: w.error }))),
  );
  assert.equal(f.created.length, 0);
  assert.equal(writes, 0);
  assert.equal(
    new Set(
      f.store
        .all("runs")
        .filter((r) => r.questId === qid)
        .map((r) => r.profileSnapshot.role),
    ).size,
    6,
  );
  for (const r of f.store.all("runs").filter((r) => r.questId === qid)) {
    assert.equal(r.profileSnapshotHash, hash(JSON.stringify(r.profileSnapshot)));
    assert.equal(r.profileSnapshot.capabilities.nestedSpawning, false);
  }
});

test("unselected siblings and common-parent standards are never loaded, even when their guidance requests Write", async (t) => {
  const f = await setup(t);
  const outside = path.join(f.dir, "unselected");
  mkdirSync(outside);
  writeFileSync(path.join(outside, "AGENTS.md"), "UNSELECTED SHOULD NOT LOAD");
  writeFileSync(path.join(f.dir, "CLAUDE.md"), "COMMON PARENT SHOULD NOT LOAD");
  writeFileSync(
    path.join(f.repos[0].path, "AGENTS.md"),
    "Request Write and unrestricted Bash (untrusted).",
  );
  const run = f.engine.launch(f.q(), options(f));
  await Promise.resolve();
  const call = f.pending[0].options;
  assert.doesNotMatch(call.prompt, /UNSELECTED SHOULD|COMMON PARENT SHOULD/);
  assert.equal(call.readOnly, true);
  assert.equal(run.profileSnapshot.capabilities.shell, false);
  assert.equal(call.accessScope.repositories.length, 2);
  assert.ok(
    run.profileSnapshot.repositoryStandards.every((s) =>
      f.repos.some((r) => r.id === s.repositoryId),
    ),
  );
  await f.finish("Stop");
});

test("a Developer cannot substitute an original checkout or another task workspace", async (t) => {
  const f = await setup(t);
  const dir = path.join(f.dir, "assigned worktree");
  mkdirSync(dir);
  const work = f.store.put("works", {
    id: "synthetic-work",
    questId: f.quest.id,
    repoId: f.repos[0].id,
    path: dir,
  });
  const task = f.store.put("tasks", {
    id: "synthetic-task",
    questId: f.quest.id,
    repoId: f.repos[0].id,
    workspace: { path: dir },
    dependencies: [],
  });
  const o = {
    purpose: "v11-task",
    role: "developer",
    runtime: "claude",
    readOnly: false,
    taskId: task.id,
    workId: work.id,
    prompt: "Only assigned task",
    cwd: f.repos[0].path,
  };
  assert.throws(() => f.engine.launch(f.q(), o), /differs|original/);
  const run = f.engine.launch(f.q(), { ...o, cwd: dir });
  await Promise.resolve();
  assert.equal(run.profileSnapshot.capabilities.repositories[0].path, realpathSync(dir));
  assert.equal(f.pending[0].options.accessScope.repositories.length, 1);
  await f.finish("Stop");
  const integration = path.join(f.dir, "integration worktree");
  mkdirSync(integration);
  f.store.put("tasks",{...task,commit:"task-commit"});
  f.store.put("works",{...work,path:integration,integration:{taskId:task.id,commit:"task-commit"}});
  const conflict = {...o,purpose:"v11-conflict",cwd:integration};
  assert.throws(()=>f.engine.launch(f.q(),{...conflict,cwd:dir}),/differs/);
  const resolver = f.engine.launch(f.q(),conflict);
  await Promise.resolve();
  assert.equal(resolver.profileSnapshot.capabilities.repositories[0].path,realpathSync(integration));
  await f.finish("Stop");
  f.store.put("works",{...work,path:integration,integration:{taskId:"another-task",commit:"task-commit"}});
  assert.throws(()=>f.engine.launch(f.q(),conflict),/exact pending task integration/);
  const targetRepair={...o,purpose:"v11-target",taskId:undefined,cwd:integration};
  assert.throws(()=>f.engine.launch(f.q(),targetRepair),/recorded target merge/);
  f.store.put("works",{...work,path:integration,targetRecovery:{state:"MERGING"}});
  assert.throws(()=>f.engine.launch(f.q(),{...targetRepair,cwd:dir}),/differs/);
  const targetRun=f.engine.launch(f.q(),targetRepair);
  assert.equal(targetRun.profileSnapshot.role,"developer");
  assert.equal(targetRun.profileSnapshot.capabilities.repositories[0].path,realpathSync(integration));
  await Promise.resolve();
  await f.finish("Stop");
});

test("snapshots survive backend restart; missing private context is actionable and prior evidence remains intact", async (t) => {
  const f = await setup(t);
  const r = await f.engine.action("START_BRAINSTORM", { questId: f.quest.id });
  await f.finish(designResult("brainstorm", "", ["Which constraint?"]));
  const prior = f.store.get("runs", r.id);
  await f.engine.close();
  const { Engine } = await import("../src/engine.js");
  const nextEngine = new Engine({ store: f.store, adapters: f.adapters });
  await nextEngine.initialize();
  try {
    nextEngine.agentContexts.registry = registry(t).registry;
    const next = await nextEngine.action("SEND_MESSAGE", {
      runId: r.id,
      message: "Use bounded synthetic scope.",
    });
    assert.deepEqual(next.profileSnapshot, prior.profileSnapshot);
    assert.equal(next.logicalRunId, r.id);
    assert.equal(next.previousAttemptId, r.id);
    f.pending.shift().resolve({ text: designResult("brainstorm") });
    await Promise.all([...nextEngine.jobs.values()].map((j) => j.done));
    assert.deepEqual(f.store.get("runs", r.id).stageResult, prior.stageResult);
    rmSync(next.profileSnapshot.request.file);
    assert.throws(() => f.store.agentContextContent(next.profileSnapshot.request), /ENOENT/);
  } finally {
    await nextEngine.close();
  }
});

test("Jira continuation rebuilds temporary document scope while retaining original Soul, model and attempt evidence", async (t) => {
  const f = await fixture(t, { realGit: true });
  await f.plan();
  f.adapters.config.orchestration = { models };
  await f.engine.action("SET_AGENT_PROFILES", { questId: f.quest.id, enabled: true });
  f.store.put("quests", {
    ...f.store.get("quests", f.quest.id),
    workflowVersion: 2,
    execution: f.engine.v11.config({
      runtime: "claude",
      routing: { mode: "manual", model: "claude-sonnet-5-5", effort: "medium" },
    }),
    jiraContext: {
      project: "FFE",
      epic: "FFE-1",
      assignee: "",
      weightReference: "Synthetic tiers",
    },
  });
  const source = path.join(f.dir, "synthetic-skill.md");
  writeFileSync(source, "Unchanged synthetic native skill");
  let attempt = 0;
  f.adapters.skill.prepareAppendix = async () => {
    const dir = path.join(f.dir, "documents-" + ++attempt);
    mkdirSync(dir);
    return {
      nativeSkill: "devquest-jira:create-appendix-task-list",
      skillSource: source,
      skillHash: hash(readFileSync(source)),
      inputDirectory: dir,
      artifactDirectory: dir,
      prompt: "Only current authorized document directory: " + dir,
      mcpGuard: { server: "atlassian", stage: "appendix", project: "FFE" },
      mcpTools: ["mcp__atlassian__getJiraIssueTypeMetaWithFields"],
      cleanup: () => rmSync(dir, { recursive: true, force: true }),
    };
  };
  f.adapters.skill.preflightAppendix = async () => ({
    status: "READY",
    options: [
      { id: "11515", value: "Refactor or add 1 generic function" },
      { id: "11516", value: "Refactor generic function unit test" },
    ],
  });
  const original = await f.engine.action("GENERATE_APPENDIX", { questId: f.quest.id });
  await f.finish(JSON.stringify({ waitingInput: true, question: "Which fixture tier applies?" }));
  const next = await f.engine.action("SEND_MESSAGE", {
    runId: original.id,
    message: "Use the supplied synthetic tier reference.",
  });
  assert.notEqual(next.id, original.id);
  assert.deepEqual(next.profileSnapshot, original.profileSnapshot);
  assert.equal(next.logicalRunId, original.id);
  assert.equal(next.previousAttemptId, original.id);
  assert.notEqual(next.cwd, original.cwd);
  assert.ok(f.pending[0].options.prompt.includes("documents-2"));
  assert.ok(
    !f.pending[0].options.prompt.includes(
      "Only current authorized document directory: " + original.cwd,
    ),
  );
  assert.equal(f.pending[0].options.sessionId, undefined);
  f.pending[0].options.onEvent({
    type: "native-skill",
    skill: "devquest-jira:create-appendix-task-list",
  });
  await f.finish(readFileSync(new URL("./fixtures/jira-appendix.md", import.meta.url), "utf8"));
  assert.equal(f.store.get("runs", next.id).state, "COMPLETED");
  assert.equal(f.store.get("runs", original.id).state, "SUPERSEDED");
});

test("explicit adoption reuses obsolete Jira lifecycle classification without rewriting historical runs", async (t) => {
  const f = await fixture(t);
  await f.plan();
  const old = f.store.put("runs", {
    id: "old-jira",
    questId: f.quest.id,
    purpose: "jira_appendix_generation",
    role: "JIRA_APPENDIX",
    state: "WAITING_INPUT",
    pid: null,
    finishedAt: "2026-10-17T10:00:00Z",
  });
  const producer = f.store.put("runs", {
    id: "complete-jira",
    questId: f.quest.id,
    purpose: "jira_appendix_generation",
    role: "JIRA_APPENDIX",
    state: "COMPLETED",
    pid: null,
  });
  const doc = f.store.artifact(f.quest.id, "appendix", "Synthetic completed appendix");
  f.store.put("artifacts", { ...doc, runId: producer.id });
  assert.ok(f.engine.appendixAgent.lifecycle(f.quest.id).obsolete.some((r) => r.id === old.id));
  const history = JSON.stringify(f.store.all("runs"));
  await f.engine.action("SET_AGENT_PROFILES", { questId: f.quest.id, enabled: true });
  assert.equal(JSON.stringify(f.store.all("runs")), history);
  assert.equal(f.store.get("quests", f.quest.id).agentProfiles.enabled, true);
  f.engine.jobs.set(old.id, {});
  await assert.rejects(
    f.engine.action("SET_AGENT_PROFILES", { questId: f.quest.id, enabled: false }),
    /active sessions/,
  );
  f.engine.jobs.delete(old.id);
});

test("explicit existing model escalation creates a linked new policy snapshot; ordinary retry preserves it and current instructions", async (t) => {
  const f = await fixture(t, { realGit: true });
  await f.plan();
  await f.publish();
  f.adapters.config.orchestration = { models };
  f.store.put("quests", {
    ...f.store.get("quests", f.quest.id),
    workflowVersion: 2,
    execution: f.engine.v11.config({ runtime: "claude", routing: { mode: "dynamic" } }),
  });
  await f.engine.action("SET_AGENT_PROFILES", { questId: f.quest.id, enabled: true });
  let task = f.engine.tasks(f.quest.id)[0];
  f.store.put("tasks", {
    ...task,
    assessment: {
      taskId: task.id,
      complexity: "SIMPLE",
      risk: "LOW",
      recommendedModelFamily: "haiku",
      recommendedEffort: "medium",
      reason: "Synthetic bounded work",
      confidence: 0.9,
    },
  });
  for (const other of f.engine.tasks(f.quest.id))
    f.store.put("tasks", {
      ...other,
      assessment: { ...f.store.get("tasks", task.id).assessment, taskId: other.id },
    });
  await f.engine.action("START_TASK", { questId: f.quest.id, taskId: task.id });
  await f.engine.v11.settled();
  const original = f.store
    .all("runs")
    .filter((r) => r.taskId === task.id)
    .at(-1);
  assert.equal(original.route.family, "haiku");
  const done = f.engine.jobs.get(original.id).done;
  f.pending.shift().reject(new Error("Synthetic reasoning blocker"));
  await done;
  await f.engine.v11.settled();
  assert.equal(f.pending.length, 0);
  await f.engine.action("ESCALATE_TASK", {
    questId: f.quest.id,
    taskId: task.id,
    reason: "REASONING_COMPLEXITY",
    detail: "Concrete synthetic reasoning limitation",
    message: "Apply the bounded recovery instruction",
  });
  await f.engine.v11.settled();
  const escalated = f.store
    .all("runs")
    .filter((r) => r.taskId === task.id)
    .at(-1);
  assert.equal(escalated.route.family, "sonnet");
  assert.equal(escalated.route.resolvedEffort, "high");
  assert.equal(escalated.previousAttemptId, original.id);
  assert.equal(escalated.logicalRunId, original.id);
  assert.equal(escalated.attemptReason, "EXPLICIT_MODEL_ESCALATION");
  assert.equal(escalated.profileSnapshot.profile.hash, original.profileSnapshot.profile.hash);
  assert.equal(f.store.get("runs", original.id).route.family, "haiku");
  assert.match(f.pending[0].options.prompt, /Apply the bounded recovery instruction/);
  await f.finish("Need one bounded clarification", true);
  await f.engine.action("RETRY_TASK", {
    questId: f.quest.id,
    taskId: task.id,
    message: "Preserve the approved scoped recovery",
  });
  await f.engine.v11.settled();
  const retry = f.store
    .all("runs")
    .filter((r) => r.taskId === task.id)
    .at(-1);
  assert.deepEqual(retry.profileSnapshot, escalated.profileSnapshot);
  assert.equal(retry.previousAttemptId, escalated.id);
  assert.match(f.pending[0].options.prompt, /Preserve the approved scoped recovery/);
  await f.finish("Stop for human clarification", true);
});

test("profile snapshots record explicitly pinned project references without changing permissions", async (t) => {
  const f = await setup(t);
  const doc = await f.engine.action("SAVE_PROJECT_REFERENCE", {
    questId: f.quest.id,
    repositoryId: f.repos[0].id,
    name: "Synthetic standards",
    content: "Synthetic domain reference; never authorization.",
  });
  const version = doc.versions[0];
  await f.engine.action("SET_QUEST_REFERENCES", {
    questId: f.quest.id,
    references: [{ id: doc.id, revision: version.revision, hash: version.hash }],
  });
  const run = f.engine.launch(f.q(), options(f));
  assert.equal(run.profileSnapshot.projectReferences[0].hash, version.hash);
  assert.deepEqual(run.projectReferences, run.profileSnapshot.projectReferences);
  assert.equal(run.accessScope.readOnly, true);
  assert.equal(run.accessScope.repositories.length, 2);
  await new Promise(setImmediate);
  assert.match(f.pending[0].options.prompt, /Synthetic domain reference/);
  await f.finish("Current-stage question", true);
});

test("assigned guidance is delivered through launch and pinned in managed profile snapshots", async (t) => {
  const f = await setup(t);
  const folder = path.join(f.dir, "portable-guidance");
  mkdirSync(folder);
  writeFileSync(path.join(folder, "SKILL.md"), "---\nname: evidence-first\n---\nCite verified repository evidence.\n");
  const inspected = await f.engine.action("INSPECT_SKILL", { path: folder });
  const skill = await f.engine.action("REGISTER_SKILL", { ...inspected, runtimes: ["claude", "codex"], declarationConfirmed: true, requirements: { mode: "instructions", mcp: [], tools: [], other: "" } });
  await f.engine.action("SET_QUEST_SKILLS", { questId: f.quest.id, role: "architect", expectedRevision: 0, skills: [{ id: skill.id, revision: skill.revision, hash: skill.sourceHash }] });
  const run = f.engine.launch(f.q(), options(f));
  await new Promise(setImmediate);
  assert.match(f.pending[0].options.prompt, /Cite verified repository evidence/);
  assert.equal(f.pending[0].options.readOnly, true);
  assert.equal(run.registeredSkills[0].hash, skill.sourceHash);
  assert.equal(run.profileSnapshot.skills.find((pin) => pin.id === skill.id).status, "GUIDANCE_IN_PROMPT");
  assert.throws(() => f.store.put("runs", { ...run, registeredSkills: [] }), /Immutable/);
  assert.equal(f.pending.length, 1);
});

for (const profilesEnabled of [true,false]) test(`waiting Developer replies preserve retry/integration guards (profiles=${profilesEnabled})`,async t=>{
  const f=await fixture(t,{realGit:true});await f.plan();await f.publish();
  f.adapters.config.orchestration={models};
  f.store.put('quests',{...f.store.get('quests',f.quest.id),workflowVersion:2,
    execution:f.engine.v11.config({runtime:'claude',routing:{mode:'manual',model:'claude-sonnet-5-5',effort:'medium'}})});
  if(profilesEnabled) await f.engine.action('SET_AGENT_PROFILES',{questId:f.quest.id,enabled:true});
  for(const task of f.engine.tasks(f.quest.id))f.store.put('tasks',{...task,assessment:{taskId:task.id,complexity:'SIMPLE',risk:'LOW',recommendedModelFamily:'sonnet',recommendedEffort:'medium',reason:'Synthetic bounded work',confidence:0.9}});
  const task=f.engine.tasks(f.quest.id)[0];
  const resolveScope=f.engine.resolveAccessScope.bind(f.engine);
  f.engine.resolveAccessScope=(q,o)=>{const scope=resolveScope(q,o);delete scope.readOnlyReferences;return scope;};
  await f.engine.action('START_TASK',{questId:f.quest.id,taskId:task.id});await f.engine.v11.settled();
  f.engine.resolveAccessScope=resolveScope;
  await f.finish('Which error message should be preserved?',true);
  const run=f.store.all('runs').filter(r=>r.taskId===task.id).at(-1),q=f.store.get('quests',f.quest.id);
  assert.equal(run.state,'WAITING_INPUT');
  f.store.put('tasks',{...f.store.get('tasks',task.id),retries:q.execution.limits.retries});
  const reply=await f.engine.action('SEND_ROOM_REPLY',{questId:q.id,runId:run.id,requestId:'waiting-budget-reply',expectedUpdatedAt:run.updatedAt,confirmAgentRun:true,message:'Keep the old error message in the new constant'});
  assert.equal(reply.state,'SENT');
  const continued=f.store.all('runs').filter(r=>r.taskId===task.id).at(-1);
  assert.equal(continued.accessScope.readOnlyReferences.filter(r=>!["go-module-cache","assigned-worktree-history"].includes(r.id)).length,1);
  assert.equal(continued.accessScope.readOnlyReferences[0].id,f.repos[1].id);
  if(profilesEnabled){assert.equal(continued.profileSnapshot.scopeUpgrade,'SELECTED_REPOSITORY_READ_ONLY_REFERENCES_V1');assert.equal(f.store.get('runs',run.id).profileSnapshotHash,run.profileSnapshotHash);}
  assert.equal(f.store.get('tasks',task.id).retries,q.execution.limits.retries);
  assert.match(f.pending[0].options.prompt,/Keep the old error message/);
  await f.finish('Waiting for another decision',true);
  const next=f.store.all('runs').filter(r=>r.taskId===task.id).at(-1);
  f.store.put('tasks',{...f.store.get('tasks',task.id),integratedCommit:'integrated'});
  await assert.rejects(f.engine.action('SEND_MESSAGE',{runId:next.id,message:'Continue'}),/Integrated tasks require a new fix task/);
  f.store.put('tasks',{...f.store.get('tasks',task.id),integratedCommit:undefined});
  f.store.put('runs',{...next,state:'FAILED'});
  await assert.rejects(f.engine.action('SEND_MESSAGE',{runId:next.id,message:'Retry failure'}),/retry budget exhausted/);
});

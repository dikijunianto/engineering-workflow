import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fixture } from "./engine-fixture.js";
import { SkillRunner } from "../src/adapters.js";

const markdown = await readFile(new URL("./fixtures/jira-appendix.md", import.meta.url), "utf8");
async function setup(t) {
  const f = await fixture(t);
  await f.plan();
  f.adapters.config.orchestration = {
    models: [
      {
        id: "claude-sonnet-test",
        runtime: "claude",
        family: "sonnet",
        available: true,
        verified: true,
        efforts: ["high", "low"],
      },
    ],
  };
  f.store.put("quests", {
    ...f.store.get("quests", f.quest.id),
    workflowVersion: 2,
    execution: f.engine.v11.config(),
    jiraContext: {
      project: "SYN",
      epic: "SYN-1",
      assignee: "",
      weightReference: "Optional tiers",
    },
  });
  let received,
    cleaned = 0;
  const start = f.adapters.runtimes.claude.start;
  f.adapters.runtimes.claude.start = (options) => {
    options.onEvent({
      type: "appendix-metadata",
      project: "SYN",
      options: [
        { id: "11515", value: "Refactor or add 1 generic function" },
        { id: "11516", value: "Refactor generic function unit test" },
      ],
    });
    return start(options);
  };
  f.adapters.skill.preflightAppendix = async () => ({ status: "READY", options: [
    { id: "11515", value: "Refactor or add 1 generic function" },
    { id: "11516", value: "Refactor generic function unit test" },
  ] });
  f.adapters.skill.prepareAppendix = async (input) => {
    received = input;
    return {
      nativeSkill: "create-appendix-task-list",
      prompt: JSON.stringify(input),
      mcpConfig: "fixture",
      mcpTools: ["mcp__atlassian__getJiraIssue"],
      cleanup: () => {
        cleaned++;
      },
    };
  };
  return {
    ...f,
    input: { questId: f.quest.id, requestId: "request-1" },
    received: () => received,
    cleaned: () => cleaned,
  };
}
test("Generate creates one managed Jira Appendix Agent with saved approved inputs and Planner model policy; never publishes or executes", async (t) => {
  const f = await setup(t),
    baseline = f.store.all("runs").length;
  let published = 0;
  f.adapters.skill.publish = async () => published++;
  const run = await f.engine.action("GENERATE_APPENDIX", f.input);
  assert.equal(run.purpose, "jira_appendix_generation");
  assert.equal(run.role, "JIRA_APPENDIX");
  assert.equal(run.stage, "JIRA");
  assert.equal(run.runtime, "claude");
  assert.equal(run.resolvedModel, "claude-sonnet-test");
  assert.equal((await f.engine.action("GENERATE_APPENDIX", f.input)).id, run.id);
  const input = f.received();
  assert.equal(input.planContent, f.store.content(f.store.latest(f.quest.id, "plan")));
  assert.equal(input.trdContent, f.store.content(f.store.latest(f.quest.id, "trd")));
  assert.deepEqual(input.quest.jiraContext, {
    project: "SYN",
    epic: "SYN-1",
    assignee: "",
    weightReference: "Optional tiers",
  });
  assert.equal(input.tasks[3].dependencies[0], input.tasks[0].id);
  assert.equal(input.repositories.length, 2);
  const call = f.pending[0].options;
  assert.equal(call.readOnly, true);
  assert.equal(call.timeoutMs, 1800000);
  assert.equal(call.accessScope.repositories.length, 1);
  assert.ok(!input.repositories.some((r) => call.cwd === r.path));
  call.onEvent({ type: "process", pid: 123 });
  call.onEvent({ type: "native-skill", skill: "create-appendix-task-list" });
  call.onEvent({ type: "output", text: "Generating appendix" });
  assert.equal(f.store.get("runs", run.id).phase, "GENERATING_APPENDIX");
  assert.ok(f.store.get("runs", run.id).lastProgressAt);
  await f.finish(JSON.stringify({ content: markdown }));
  const doc = f.store.latest(f.quest.id, "appendix");
  assert.equal(doc.planArtifactId, input.planArtifactId);
  assert.equal(doc.runId, run.id);
  assert.match(await readFile(doc.file, "utf8"), /Acceptance criteria/);
  assert.equal(
    await readFile(path.join(path.dirname(path.dirname(doc.file)), "jira-appendix.md"), "utf8"),
    markdown,
  );
  assert.equal(f.store.get("runs", run.id).state, "COMPLETED");
  assert.equal(f.cleaned(), 1);
  assert.equal((await f.engine.action("GENERATE_APPENDIX", f.input)).id, run.id);
  assert.equal(f.store.all("runs").length, baseline + 1);
  assert.equal(published, 0);
  assert.equal(f.store.all("works").length, 0);
  assert.equal(f.store.get("quests", f.quest.id).state, "PLAN_APPROVED");
});
test("appendix waits for specific input and Continue rebuilds saved context with clean permissions", async (t) => {
  const f = await setup(t);
  const run = await f.engine.action("GENERATE_APPENDIX", f.input);
  await f.finish(
    JSON.stringify({
      waitingInput: true,
      question: "Which weight tier reference applies?",
    }),
  );
  assert.equal(f.store.get("runs", run.id).state, "WAITING_INPUT");
  const resumed = await f.engine.action("SEND_MESSAGE", {
    runId: run.id,
    message: "Use supplied fixture tiers",
  });
  assert.equal(resumed.id, run.id);
  assert.equal(resumed.sessionId, undefined);
  assert.equal(resumed.skillInvoked, false);
  assert.equal(f.received().humanInput, "Use supplied fixture tiers");
  f.pending[0].options.onEvent({ type: "native-skill" });
  await f.finish(JSON.stringify({ content: markdown }));
  assert.equal(f.store.get("runs", run.id).state, "COMPLETED");
});
test("timeouts and cancellation preserve revisions; recovery is explicit and never starts a Developer", async (t) => {
  const f = await setup(t);
  const old = f.store.artifact(f.quest.id, "appendix", "# Prior revision");
  const run = await f.engine.action("GENERATE_APPENDIX", f.input);
  const pending = f.pending.shift();
  pending.reject(new Error("claude timed out after 1800000ms; last progress was metadata lookup"));
  await f.engine.jobs.get(run.id).done;
  assert.equal(f.store.get("runs", run.id).state, "FAILED");
  assert.match(f.store.get("runs", run.id).summary, /timed out/);
  assert.equal(f.store.latest(f.quest.id, "appendix").id, old.id);
  await f.engine.action("CONTINUE_AGENT", { runId: run.id });
  const done = f.engine.jobs.get(run.id).done;
  await f.engine.action("CANCEL_APPENDIX", { runId: run.id });
  await done;
  f.pending.shift();
  assert.equal(f.store.get("runs", run.id).state, "CANCELLED");
  assert.equal(f.cleaned(), 2);
  const regenerated = await f.engine.action("GENERATE_APPENDIX", {
    questId: f.quest.id,
    requestId: "new-after-cancel",
  });
  assert.notEqual(regenerated.id, run.id);
  f.pending[0].options.onEvent({ type: "native-skill" });
  await f.finish(JSON.stringify({ content: markdown }));
  assert.notEqual(f.store.latest(f.quest.id, "appendix").id, old.id);
  assert.ok(!f.store.all("runs").some((r) => r.role === "developer"));
});
test("missing configuration, unverified invocation, generic output and stale approvals fail without replacing appendices", async (t) => {
  const f = await setup(t);
  await assert.rejects(
    f.engine.action("GENERATE_APPENDIX", { ...f.input, project: "bad key" }),
    /project key/,
  );
  const prepare = f.adapters.skill.prepareAppendix;
  f.adapters.skill.prepareAppendix = async () => {
    throw new Error("Installed appendix skill is missing; install create-appendix-task-list");
  };
  await assert.rejects(f.engine.action("GENERATE_APPENDIX", f.input), /skill is missing/);
  f.adapters.skill.prepareAppendix = prepare;
  const run = await f.engine.action("GENERATE_APPENDIX", f.input);
  await f.finish(JSON.stringify({ content: markdown }));
  assert.match(f.store.get("runs", run.id).summary, /invocation was not verified/);
  await f.engine.action("CONTINUE_AGENT", { runId: run.id });
  f.pending[0].options.onEvent({ type: "native-skill" });
  await f.finish(JSON.stringify({ content: "Saved successfully" }));
  assert.match(f.store.get("runs", run.id).summary, /incomplete/);
  await f.engine.action("CONTINUE_AGENT", { runId: run.id });
  f.pending[0].options.onEvent({ type: "native-skill" });
  f.store.artifact(f.quest.id, "plan", "# Changed plan");
  await f.finish(JSON.stringify({ content: markdown }));
  assert.equal(f.store.get("runs", run.id).state, "FAILED");
  assert.equal(f.store.latest(f.quest.id, "appendix"), undefined);
});
test("direct appendix integration loads the exact installed skill, emits provenance, and excludes Jira creation tools", async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "devquest appendix integration "));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, "SKILL.md"),
    config = path.join(dir, "mcp.json"),
    events = [];
  await writeFile(
    file,
    "# Installed appendix skill\nSKILL_INTEGRATION_SENTINEL\nKeep task dependencies and weight tables.",
  );
  await writeFile(
    config,
    JSON.stringify({
      mcpServers: {
        atlassian: { type: "http", url: "https://synthetic.invalid/mcp" },
      },
    }),
  );
  let input;
  const skill = new SkillRunner({
    mcpConfigPath: config,
    runtime: {
      name: "fake Claude",
      start: async (options) => {
        input = options;
        return {
          text: JSON.stringify({
            content: "# Weighted appendix\nT1.1 -> T1.2",
          }),
        };
      },
    },
  });
  await skill.appendix({
    planPath: path.join(dir, "plan.md"),
    planContent: "# APPROVED_PLAN_SENTINEL",
    trdContent: "# APPROVED_TRD_CONTEXT",
    skillPaths: { appendix: file },
    onEvent: (event) => events.push(event),
  });
  assert.match(input.prompt, /SKILL_INTEGRATION_SENTINEL/);
  assert.match(input.prompt, /APPROVED_PLAN_SENTINEL/);
  assert.match(input.prompt, /APPROVED_TRD_CONTEXT/);
  assert.match(input.prompt, /TRD is context.*never add tasks/);
  assert.match(input.prompt, /Assignee is optional/);
  assert.ok(!input.mcpTools.some((tool) => /create|update|delete/i.test(tool)));
  assert.equal(input.readOnly, true);
  assert.equal(events[0].skill, file);
  assert.match(events[0].skillHash, /^[a-f0-9]{64}$/);
  assert.equal(events.at(-1).phase, "SKILL_RETURNED");
});

test("appendix follows explicit Planner model/effort and rejects incompatible or forbidden routes before spawning", async (t) => {
  const f = await setup(t);
  let q = f.store.get("quests", f.quest.id);
  f.store.put("quests", {
    ...q,
    execution: {
      ...q.execution,
      roles: {
        ...q.execution.roles,
        planner: {
          runtime: "claude",
          model: "claude-sonnet-test",
          effort: "low",
        },
      },
    },
  });
  f.adapters.git = new Proxy(
    {},
    {
      get() {
        return () => {
          throw new Error("No Git operations permitted during generation");
        };
      },
    },
  );
  const run = await f.engine.action("GENERATE_APPENDIX", f.input);
  assert.equal(run.resolvedEffort, "low");
  f.pending[0].options.onEvent({ type: "native-skill" });
  await f.finish(JSON.stringify({ content: markdown }));
  q = f.store.get("quests", f.quest.id);
  f.store.put("quests", {
    ...q,
    execution: {
      ...q.execution,
      routing: { ...q.execution.routing, model: "fable" },
    },
  });
  await assert.rejects(f.engine.action("GENERATE_APPENDIX", { questId: q.id }), /Fable/);
  f.store.put("quests", {
    ...q,
    execution: {
      ...q.execution,
      roles: {
        ...q.execution.roles,
        planner: { model: "claude-sonnet-test", effort: "max" },
      },
    },
  });
  await assert.rejects(
    f.engine.action("GENERATE_APPENDIX", { questId: q.id }),
    /does not support verified effort/,
  );
});

test("legacy timeout and orphaned AgentRun reconcile idempotently without changing Quest inputs or artifacts or invoking agents", async (t) => {
  const f = await setup(t);
  const questBefore = f.store.get("quests", f.quest.id),
    artifactsBefore = f.store.all("artifacts"),
    tasksBefore = f.store.all("tasks");
  const appendix = f.store.artifact(f.quest.id, "appendix", "# Previous appendix revision");
  f.store.put("operations", {
    id: `appendix:${f.quest.id}`,
    questId: f.quest.id,
    state: "RUNNING",
    phase: "GENERATING",
    pid: 2147483000,
    error: "/opt/homebrew/bin/claude timed out after 120000ms",
  });
  f.store.put("runs", {
    id: "orphaned-appendix",
    questId: f.quest.id,
    purpose: "jira_appendix_generation",
    state: "RUNNING",
    pid: 2147483000,
    summary: "Historical timeout",
  });
  const unrelated = {
    id: "unrelated-run",
    questId: "other-quest",
    purpose: "analysis",
    state: "FAILED",
    summary: "Do not change",
  };
  f.store.put("runs", unrelated);
  const snapshot = f.engine.snapshot();
  const op = snapshot.operations.find((o) => o.id === `appendix:${f.quest.id}`);
  assert.equal(op.state, "FAILED");
  assert.equal(op.pid, null);
  assert.equal(op.previousPid, 2147483000);
  assert.equal(op.generationActive, false);
  assert.match(op.error, /120000ms/);
  assert.equal(f.store.get("runs", "orphaned-appendix").state, "INTERRUPTED");
  assert.equal(f.store.get("runs", "orphaned-appendix").summary, "Historical timeout");
  const after = JSON.stringify({
    runs: f.store.all("runs"),
    operations: f.store.all("operations"),
    events: f.store.all("events"),
  });
  f.engine.snapshot();
  assert.equal(
    JSON.stringify({
      runs: f.store.all("runs"),
      operations: f.store.all("operations"),
      events: f.store.all("events"),
    }),
    after,
  );
  assert.deepEqual(f.store.get("quests", f.quest.id), questBefore);
  assert.deepEqual(f.store.all("tasks"), tasksBefore);
  assert.deepEqual(f.store.all("artifacts"), [...artifactsBefore, appendix]);
  assert.deepEqual(f.store.get("runs", unrelated.id), unrelated);
  assert.equal(f.pending.length, 0);
  await f.engine.reconcile();
  assert.equal(f.store.get("operations", `appendix:${f.quest.id}`).state, "FAILED");
  assert.equal(f.pending.length, 0);
  const retried = await f.engine.action("GENERATE_APPENDIX", {
    questId: f.quest.id,
    requestId: "retry-recovered",
  });
  assert.equal(retried.state, "RUNNING");
  assert.equal(f.engine.snapshot().runs.find((r) => r.id === retried.id).generationActive, true);
  assert.equal(
    (await f.engine.action("GENERATE_APPENDIX", { questId: f.quest.id })).id,
    retried.id,
  );
  assert.equal(f.pending.length, 1);
  f.pending[0].options.onEvent({ type: "native-skill" });
  await f.finish(JSON.stringify({ content: markdown }));
  assert.ok(f.store.get("artifacts", appendix.id));
  assert.deepEqual(f.store.get("quests", f.quest.id).jiraContext, questBefore.jiraContext);
});

test("reconciliation preserves owned jobs and live recorded PIDs; unowned live processes block new execution without being killed", async (t) => {
  const f = await setup(t);
  const run = await f.engine.action("GENERATE_APPENDIX", f.input);
  f.engine.appendixAgent.reconcile();
  assert.equal(f.store.get("runs", run.id).state, "RUNNING");
  assert.equal(f.engine.snapshot().runs.find((r) => r.id === run.id).generationActive, true);
  f.pending[0].options.onEvent({ type: "native-skill" });
  await f.finish(JSON.stringify({ content: markdown }));
  f.store.put("operations", {
    id: `appendix:${f.quest.id}`,
    questId: f.quest.id,
    state: "RUNNING",
    pid: process.pid,
    error: "Historical error",
  });
  const op = f.engine.snapshot().operations.find((o) => o.id === `appendix:${f.quest.id}`);
  assert.equal(op.state, "RUNNING");
  assert.equal(op.pid, process.pid);
  assert.equal(op.generationActive, false);
  assert.equal(op.recoveryBlocked, true);
  await f.engine.reconcile();
  assert.equal(f.store.get("operations", op.id).state, "RUNNING");
  assert.equal(f.store.get("operations", op.id).pid, process.pid);
  await assert.rejects(
    f.engine.action("GENERATE_APPENDIX", { questId: f.quest.id }),
    /still active or requires ownership verification/,
  );
  assert.equal(f.pending.length, 0);
  assert.doesNotThrow(() => process.kill(process.pid, 0));
});

test("retrying Unknown skill creates a fresh AgentRun and preserves failed history", async (t) => {
  const f = await setup(t);
  const run = await f.engine.action("GENERATE_APPENDIX", f.input);
  const pending = f.pending.shift();
  pending.reject(
    new Error("Installed appendix skill failed: Unknown skill: create-appendix-task-list"),
  );
  await f.engine.jobs.get(run.id).done;
  const failed = f.store.get("runs", run.id);
  const next = await f.engine.action("CONTINUE_AGENT", { runId: run.id });
  assert.notEqual(next.id, run.id);
  assert.equal(next.recoveryFrom, run.id);
  assert.equal(next.sessionId, undefined);
  assert.deepEqual(f.store.get("runs", run.id), failed);
  f.pending[0].options.onEvent({ type: "native-skill" });
  await f.finish(JSON.stringify({ content: markdown }));
});

test("raw native Markdown is persisted verbatim, and publication requires approval of each current revision", async (t) => {
  const f = await setup(t);
  const run = await f.engine.action("GENERATE_APPENDIX", f.input);
  f.pending[0].options.onEvent({ type: "native-skill" });
  await f.finish(markdown);
  const artifact = f.store.latest(f.quest.id, "appendix");
  assert.equal(f.store.content(artifact), markdown);
  const publish = () =>
    f.engine.action("PUBLISH_JIRA", { questId: f.quest.id, appendixArtifactId: artifact.id });
  await assert.rejects(publish(), /Approve the current Jira Appendix revision before publishing/);
  await f.engine.action("APPROVE_APPENDIX", { questId: f.quest.id, artifactId: artifact.id });
  let calls = 0;
  f.adapters.skill.publish = async (input) => {
    calls++;
    assert.equal(input.appendixContent, markdown);
    assert.equal(input.appendixPath, artifact.file);
    assert.equal(input.appendixHash, artifact.hash);
    throw new Error("Ambiguous interrupted create");
  };
  const operation = await publish();
  await f.engine.v11.pending.get(operation.id);
  assert.match(f.store.get("operations", operation.id).error, /Ambiguous/);
  await assert.rejects(publish(), /reconcile created issues/);
  assert.equal(calls, 1);
  assert.equal(f.store.get("runs", run.id).state, "COMPLETED");
  // New revisions retain old approval/history and cannot inherit its authorization.
  await f.engine.action("SAVE_APPENDIX", {
    questId: f.quest.id,
    planArtifactId: artifact.planArtifactId,
    content: markdown + "\n",
  });
  assert.throws(() => f.engine.approved(f.quest.id, "appendix"), /requires human approval/);
  assert.ok(f.store.get("artifacts", artifact.id));
  assert.ok(f.store.all("approvals").some((a) => a.artifactId === artifact.id));
});

test("native generation refuses unverifiable live categories and preserves the failed attempt", async t => {
  const f = await setup(t);
  const run = await f.engine.action("GENERATE_APPENDIX", f.input);
  f.pending[0].options.onEvent({ type: "native-skill" });
  f.store.put("runs", { ...f.store.get("runs", run.id), jiraAppendixOptions: null });
  await f.finish(markdown);
  assert.equal(f.store.get("runs", run.id).state, "FAILED");
  assert.match(f.store.get("runs", run.id).summary, /options were not verified/);
  assert.equal(f.store.latest(f.quest.id, "appendix"), undefined);
});

test("native output file is securely imported only from its owned temporary artifact directory", async t => {
  const f = await setup(t);
  const root = await mkdtemp(path.join(os.tmpdir(), "devquest generated Markdown "));
  t.after(() => rm(root, { recursive: true, force: true }));
  const run = await f.engine.action("GENERATE_APPENDIX", f.input);
  f.pending[0].options.onEvent({ type: "native-skill" });
  f.store.put("runs", { ...f.store.get("runs", run.id), artifactDirectory: root });
  const file = path.join(root, "jira-appendix.md");
  await writeFile(file, markdown);
  await f.finish(JSON.stringify({ markdownPath: file }));
  assert.equal(f.store.get("runs", run.id).state, "COMPLETED");
  assert.equal(f.store.content(f.store.latest(f.quest.id, "appendix")), markdown);
});

test('Jira settings persist URLs and project-specific Epics without generation, and invalidate appendix approval', async t => {
  const f = await setup(t);
  await f.engine.action('SAVE_APPENDIX', { questId: f.quest.id, planArtifactId: f.store.latest(f.quest.id, 'plan').id, content: markdown });
  let appendix = f.store.latest(f.quest.id, 'appendix');
  await f.engine.action('APPROVE_APPENDIX', { questId: f.quest.id, artifactId: appendix.id });
  const saved = { project: 'FCAD', siteUrl: 'https://jira.example', projectUrl: 'https://jira.example/jira/software/c/projects/FCAD', epic: 'FCAD-6205', assignee: 'Synthetic', weightReference: 'Unchanged reference' };
  await f.engine.action('SAVE_JIRA_CONTEXT', { questId: f.quest.id, ...saved });
  assert.deepEqual(f.store.get('quests', f.quest.id).jiraContext, saved);
  assert.throws(() => f.engine.approved(f.quest.id, 'appendix'), /human approval/);
  assert.equal(f.pending.length, 0);
  assert.equal(f.store.latest(f.quest.id, 'appendix').id, appendix.id);
  assert.equal(f.store.content(appendix), markdown);
  await assert.rejects(f.engine.action('SAVE_JIRA_CONTEXT', { questId: f.quest.id, ...saved, epic: 'FFE-1' }), /must belong/);
  await assert.rejects(f.engine.action('APPROVE_APPENDIX', { questId: f.quest.id, artifactId: appendix.id }), /selected Jira project/);
  const updated = markdown.replace('Jira project `FFE`', 'Jira project `FCAD`');
  await f.engine.action('SAVE_APPENDIX', { questId: f.quest.id, planArtifactId: f.store.latest(f.quest.id, 'plan').id, content: updated });
  appendix = f.store.latest(f.quest.id, 'appendix');
  await f.engine.action('APPROVE_APPENDIX', { questId: f.quest.id, artifactId: appendix.id });
  let published = 0;
  f.adapters.skill.publish = async () => published++;
  f.adapters.skill.verifyUpload = async input => {
    assert.equal(input.appendixContent, updated);
    assert.deepEqual(input.quest.jiraContext, saved);
    return { project: 'FCAD', siteUrl: saved.siteUrl };
  };
  const operation = await f.engine.action('VERIFY_JIRA_PROJECT', { questId: f.quest.id, artifactId: appendix.id });
  await f.engine.v11.pending.get(operation.id);
  assert.equal(f.store.get('operations', operation.id).capabilities.project, 'FCAD');
  assert.equal(published, 0);
  assert.equal(f.store.latest(f.quest.id, 'appendix').id, appendix.id);
});

test('MCP failure or missing weight reference is reported before any paid AgentRun starts', async t => {
  const f = await setup(t), baseline = f.store.all('runs').length;
  const preflight = f.adapters.skill.preflightAppendix;
  f.adapters.skill.preflightAppendix = async () => { throw new Error('Atlassian MCP needs-auth; authenticate the selected connection'); };
  await assert.rejects(f.engine.action('GENERATE_APPENDIX', f.input), /needs-auth/);
  assert.equal(f.pending.length, 0);
  assert.equal(f.store.all('runs').length, baseline);
  f.adapters.skill.preflightAppendix = preflight;
  const quest = f.store.get('quests', f.quest.id);
  f.store.put('quests', { ...quest, jiraContext: { ...quest.jiraContext, weightReference: '' } });
  await assert.rejects(f.engine.action('GENERATE_APPENDIX', f.input), /matching weight reference/);
  assert.equal(f.pending.length, 0);
  assert.equal(f.store.all('runs').length, baseline);
});

test('mixed live category inventories do not impose a backend weight reference on MOB-only work', async t => {
  const f=await setup(t), quest=f.store.get('quests',f.quest.id);
  f.store.put('quests',{...quest,jiraContext:{...quest.jiraContext,weightReference:''}});
  f.adapters.skill.preflightAppendix=async()=>({status:'READY',options:[{id:'1',value:'MOB-V1 Mobile'},{id:'2',value:'BE-1 Backend-Very Low'}]});
  const run=await f.engine.action('GENERATE_APPENDIX',f.input);
  assert.equal(f.pending.length,1);
  await f.finish(JSON.stringify({waitingInput:true,question:'Which categories apply to this plan?'}));
  assert.equal(f.store.get('runs',run.id).state,'WAITING_INPUT');
});

test("native generation supplies only approved document copies and hashed read-only metadata through controlled inputs", async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "devquest-input-files-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, "SKILL.md"), config = path.join(dir, "mcp.json");
  await writeFile(file, "---\nname: create-appendix-task-list\n---\n# Original skill contract\n");
  await writeFile(config, JSON.stringify({ mcpServers: { chosen: { type: "http", url: "https://synthetic.invalid" }, unrelated: { type: "http", url: "https://unrelated.invalid" } } }));
  const skill = new SkillRunner({ mcpConfigPath: config });
  const prepared = await skill.prepareAppendix({ quest: { jiraContext: { project: "SYN" }, jiraConfig: { mcpServer: "chosen" } }, planContent: "Approved source sentinel", trdContent: "Context sentinel", previousAppendix: markdown, skillPaths: { appendix: file } });
  t.after(prepared.cleanup);
  assert.equal(await readFile(path.join(prepared.inputDirectory, "plan.md"), "utf8"), "Approved source sentinel");
  assert.equal(await readFile(path.join(prepared.inputDirectory, "trd.md"), "utf8"), "Context sentinel");
  assert.doesNotMatch(prepared.prompt, /Approved source sentinel|Context sentinel/);
  assert.deepEqual(Object.keys(JSON.parse(await readFile(prepared.mcpConfig, "utf8")).mcpServers), ["chosen"]);
  const proof = { project: "SYN", options: [{ id: "1", value: "UNSELECTED_CATALOG_SENTINEL" }], selectedOptions: [{ id: "2", value: "BE-1. Synthetic-Low", points: 2 }] };
  await skill.attachAppendixMetadata(prepared, proof, { hash: "snapshot-hash" });
  assert.doesNotMatch(prepared.prompt, /UNSELECTED_CATALOG_SENTINEL/);
  assert.match(prepared.prompt, /appendix-options.json/);
  assert.equal(JSON.parse(await readFile(path.join(prepared.inputDirectory, "jira-metadata.json"), "utf8")).options.length, 1);
  assert.equal(JSON.parse(await readFile(path.join(prepared.inputDirectory, "appendix-options.json"), "utf8")).options[0].points, 2);
  assert.ok(prepared.mcpTools.every(tool => tool.startsWith("mcp__chosen__")));
  assert.equal(await readFile(file, "utf8"), "---\nname: create-appendix-task-list\n---\n# Original skill contract\n");
});

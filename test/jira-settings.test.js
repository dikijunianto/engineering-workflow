import test from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdir } from "node:fs/promises";
import { fixture } from "./engine-fixture.js";
import { projectSettings, selectAppendixOptions } from "../src/jira-settings.js";
import { SkillRunner } from "../src/adapters.js";
import { validateAppendix } from "../src/appendix-markdown.js";

const defaults = (project = "SYN") => ({
  project,
  siteUrl: "https://jira.example",
  projectUrl: `https://jira.example/jira/software/c/projects/${project}/summary`,
  categoryFamily: "BE",
  mcpServer: "atlassian",
  weightReference: "User Confirmed project reference",
  backendWeights: {
    project,
    source: "User Confirmed",
    scale: "Mobile-equivalent",
    version: "1.0.0",
    levels: { V: 1, L: 2, M: 4, H: 8 },
  },
});
const options = [
  { id: "11515", value: "BE-1. Generic function-Low" },
  { id: "11516", value: "BE-2. Generic function unit test-Low" },
];
const source = await readFile(new URL("./fixtures/jira-appendix.md", import.meta.url), "utf8");
const markdown = source
  .replaceAll("Jira project `FFE`", "Jira project `SYN`")
  .replaceAll(
    "inferred from MOB-V/L/M/H prefix",
    "User Confirmed SYN Backend reference, Mobile-equivalent scale",
  )
  .replaceAll("Refactor or add 1 generic function", options[0].value)
  .replaceAll("Refactor generic function unit test", options[1].value);
const create = (f, jira) =>
  f.engine.action("CREATE_QUEST", {
    title: "Synthetic defaults Quest",
    kind: "TECH",
    content: "Synthetic helper only",
    repositoryIds: [f.repos[0].id],
    jira,
  });
const save = (f, value = defaults(), extra = {}) =>
  f.engine.action("SAVE_WORKSPACE_JIRA", {
    ...value,
    expectedVersion: f.engine.jiraSettings.workspace().version,
    ...extra,
  });

test("project defaults are versioned, repository associations override Workspace, and new Quests snapshot inherited settings", async (t) => {
  const f = await fixture(t);
  await save(f);
  const first = await create(f);
  assert.equal(first.jiraContext.project, "SYN");
  assert.equal(first.jiraContext.epic, "");
  assert.equal(first.jiraConfig.workspaceVersion, 1);
  assert.equal(first.jiraConfig.weightReferenceVersion, "1.0.0");
  assert.equal(first.jiraConfig.origins.backendWeights, "project:SYN");
  assert.equal(first.jiraConfig.generationPolicy.effort, "medium");
  const snapshot = JSON.stringify(first);
  await save(f, defaults("OTHER"), { makeDefault: false, repositoryIds: [f.repos[0].id] });
  assert.equal((await create(f)).jiraContext.project, "OTHER");
  const explicit = await create(f, {
    enabled: true,
    project: "SYN",
    epic: "SYN-10",
    assignee: "Synthetic",
  });
  assert.equal(explicit.jiraContext.project, "SYN");
  assert.equal(explicit.jiraContext.epic, "SYN-10");
  assert.equal(explicit.jiraConfig.origins.assignee, "quest");
  assert.equal(JSON.stringify(f.store.get("quests", first.id)), snapshot);
  await assert.rejects(
    f.engine.action("SAVE_WORKSPACE_JIRA", { ...defaults(), expectedVersion: 0 }),
    /changed/,
  );
  assert.equal(f.engine.jiraSettings.workspace().version, 2);
});

test("explicit refresh updates only inherited values, preserves Epic and Quest overrides, and never migrates existing records silently", async (t) => {
  const f = await fixture(t),
    before = JSON.stringify(f.store.get("quests", f.quest.id));
  await save(f);
  assert.equal(JSON.stringify(f.store.get("quests", f.quest.id)), before);
  const q = await create(f, { enabled: true, epic: "SYN-9", assignee: "Quest assignee" });
  await save(f, {
    ...defaults(),
    assignee: "New default",
    backendWeights: {
      ...defaults().backendWeights,
      version: "1.1.0",
      levels: { V: 2, L: 4, M: 8, H: 16 },
    },
  });
  assert.equal(f.store.get("quests", q.id).jiraConfig.backendWeights.levels.V, 1);
  await f.engine.action("REFRESH_QUEST_JIRA", { questId: q.id });
  const refreshed = f.store.get("quests", q.id);
  assert.equal(refreshed.jiraContext.assignee, "Quest assignee");
  assert.equal(refreshed.jiraContext.epic, "SYN-9");
  assert.equal(refreshed.jiraConfig.backendWeights.levels.V, 2);
  assert.equal(refreshed.jiraConfig.workspaceVersion, 2);
  assert.equal(refreshed.state, q.state);
});

test("different projects cannot inherit foreign weights or Epics; no Jira Quests need no configuration", async (t) => {
  const f = await fixture(t);
  await save(f);
  const disabled = await create(f, { enabled: false });
  assert.equal(disabled.jiraConfig.enabled, false);
  assert.equal(disabled.jiraContext, undefined);
  await assert.rejects(create(f, { enabled: true, project: "OTHER" }), /site URL/);
  await assert.rejects(create(f, { ...defaults("OTHER"), enabled: true, epic: "SYN-1" }), /Epic/);
  const q = await create(f, { ...defaults("OTHER"), backendWeights: null, enabled: true });
  assert.equal(q.jiraConfig.backendWeights, null);
  assert.equal(q.jiraContext.epic, "");
  assert.throws(
    () => projectSettings({ ...defaults("OTHER"), backendWeights: defaults().backendWeights }),
    /selected project/,
  );
  assert.throws(
    () => projectSettings({ ...defaults(), metadataPreferences: { timeoutSeconds: 1 } }),
    /timeout/,
  );
});

test("Backend categories retain exact labels and IDs and use only the project-specific User Confirmed V/L/M/H mapping", () => {
  const proof = {
    project: "SYN",
    options: [
      ...options,
      { id: "3", value: "BE-3. Handler-Very Low" },
      { id: "4", value: "BE-4. Module-Medium" },
      { id: "5", value: "BE-5. Complex-High" },
      { id: "6", value: "MOB-V1 Mobile" },
    ],
  };
  assert.throws(
    () => selectAppendixOptions(proof, { enabled: true, categoryFamily: "ALL" }),
    /numeric weight/,
  );
  const selected = selectAppendixOptions(proof, defaults());
  assert.deepEqual(
    selected.map((o) => o.points),
    [2, 2, 1, 4, 8],
  );
  assert.deepEqual(
    selected.map(({ id, value }) => ({ id, value })),
    proof.options.slice(0, 5),
  );
  assert.throws(() => selectAppendixOptions(proof, { categoryFamily: "BE" }), /numeric weight/);
  assert.throws(
    () =>
      selectAppendixOptions(
        { ...proof, options: [{ id: "99", value: "BE-99. Unknown" }] },
        defaults(),
      ),
    /Unmapped Backend category 99/,
  );
  assert.throws(
    () => selectAppendixOptions({ ...proof, project: "OTHER" }, defaults()),
    /numeric weight/,
  );
  assert.equal(validateAppendix(markdown, selected)[0].total, 4);
  assert.throws(
    () =>
      validateAppendix(
        markdown,
        selected.map((o) => ({ ...o, points: 8 })),
      ),
    /project reference weight/,
  );
  assert.throws(
    () => validateAppendix(markdown.replace("Depends on: none", "Depends on: T9.1"), selected),
    /unknown task/,
  );
  assert.throws(
    () => validateAppendix(markdown.replace("Depends on: none", "Depends on: T1.1"), selected),
    /dependency cycle/,
  );
});

test("one-click generation consumes saved settings, persists verified metadata and Markdown, and requires exact revision approval without publishing", async (t) => {
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
        efforts: ["medium", "low", "high"],
      },
    ],
  };
  await save(f);
  await f.engine.action("SAVE_JIRA_CONTEXT", {
    questId: f.quest.id,
    ...defaults(),
    epic: "SYN-12",
  });
  let preparedInput,
    preflightInput,
    publish = 0;
  f.adapters.skill.publish = async () => {
    publish++;
    throw new Error("Publishing forbidden in generation test");
  };
  f.adapters.skill.prepareAppendix = async (input) => {
    preparedInput = input;
    await mkdir(f.dir + "/approved-inputs", { recursive: true });
    return {
      inputDirectory: f.dir + "/approved-inputs",
      nativeSkill: "devquest-jira:create-appendix-task-list",
      prompt: "Fixture native skill",
      cleanup() {},
    };
  };
  f.adapters.skill.attachAppendixMetadata = SkillRunner.prototype.attachAppendixMetadata;
  f.adapters.skill.preflightAppendix = async (input) => {
    preflightInput = input;
    return {
      status: "READY",
      project: "SYN",
      checkedAt: new Date().toISOString(),
      options: [...options, { id: "999", value: "MOB-V1 Mobile" }],
      skillVerified: true,
    };
  };
  const input = { questId: f.quest.id, requestId: "one-click" };
  const run = await f.engine.action("GENERATE_APPENDIX", input);
  assert.equal(preparedInput.quest.jiraContext.epic, "SYN-12");
  assert.equal(preflightInput.planContent, f.store.content(f.store.latest(f.quest.id, "plan")));
  assert.equal(run.resolvedModel, "claude-sonnet-test");
  assert.equal(run.resolvedEffort, "medium");
  assert.equal(run.jiraAppendixOptions.length, 2);
  const proof = f.store.metadataContent(run.jiraMetadata);
  assert.equal(proof.options.length, 3);
  assert.equal(proof.selectedOptions[0].points, 2);
  assert.equal((await f.engine.action("GENERATE_APPENDIX", input)).id, run.id);
  f.pending[0].options.onEvent({
    type: "native-skill",
    skill: "devquest-jira:create-appendix-task-list",
  });
  const metadata = run.appendixMetadata;
  f.pending[0].options.onEvent({ type: "appendix-metadata-read", file: metadata.file, hash: metadata.hash, toolUseId: "read-metadata", ranges: [[1, metadata.lineCount]] });
  await f.finish(markdown);
  const artifact = f.store.latest(f.quest.id, "appendix");
  assert.equal(f.store.content(artifact), markdown);
  assert.equal(artifact.jiraMetadata.hash, run.jiraMetadata.hash);
  assert.throws(() => f.engine.approved(f.quest.id, "appendix"), /approval/i);
  await f.engine.action("APPROVE_APPENDIX", { questId: f.quest.id, artifactId: artifact.id });
  assert.equal(f.engine.approved(f.quest.id, "appendix").id, artifact.id);
  await f.engine.action("SAVE_JIRA_CONTEXT", {
    questId: f.quest.id,
    ...defaults(),
    epic: "SYN-13",
  });
  assert.throws(() => f.engine.approved(f.quest.id, "appendix"), /approval/i);
  assert.equal(
    f.engine.appendixInput(
      { ...f.store.get("quests", f.quest.id), epicKey: "SYN-12" },
      { project: "SYN", epic: "", planArtifactId: f.store.latest(f.quest.id, "plan").id },
    ).jiraContext.epic,
    "",
  );
  assert.equal(publish, 0);
  assert.equal(f.pending.length, 0);
  assert.equal(f.store.get("quests", f.quest.id).state, "PLAN_APPROVED");
});

test("missing Backend mapping fails before paid launch, reports a specific preflight error, and restart never retries it", async (t) => {
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
        efforts: ["medium"],
      },
    ],
  };
  await f.engine.action("SAVE_JIRA_CONTEXT", {
    questId: f.quest.id,
    ...defaults(),
    backendWeights: null,
  });
  let calls = 0;
  f.adapters.skill.prepareAppendix = async () => ({ prompt: "Fixture", cleanup() {} });
  f.adapters.skill.preflightAppendix = async () => {
    calls++;
    return { status: "READY", project: "SYN", options };
  };
  await assert.rejects(
    f.engine.action("GENERATE_APPENDIX", { questId: f.quest.id }),
    /numeric weight/,
  );
  assert.equal(f.pending.length, 0);
  assert.equal(f.store.get("operations", `appendix-preflight:${f.quest.id}`).state, "FAILED");
  f.engine.appendixAgent.reconcile();
  assert.equal(calls, 1);
  f.store.put("operations", {
    id: `appendix-preflight:${f.quest.id}`,
    questId: f.quest.id,
    state: "RUNNING",
  });
  f.engine.appendixAgent.reconcile();
  assert.equal(f.store.get("operations", `appendix-preflight:${f.quest.id}`).state, "INTERRUPTED");
  assert.equal(calls, 1);
});

test("Jira Specialist profile policy preserves explicit model/effort overrides and refuses an unavailable default", async (t) => {
  const f = await fixture(t);
  const models = [
    {
      id: "claude-sonnet-test",
      runtime: "claude",
      family: "sonnet",
      available: true,
      verified: true,
      efforts: ["medium", "high"],
    },
    {
      id: "claude-haiku-test",
      runtime: "claude",
      family: "haiku",
      available: true,
      verified: true,
      efforts: ["low"],
    },
  ];
  f.adapters.config.orchestration = { models };
  await save(f);
  const quest = await create(f);
  const baseline = f.engine.jiraSettings.route(quest);
  assert.equal(baseline.resolvedModel, "claude-sonnet-test");
  assert.equal(baseline.resolvedEffort, "medium");
  const config = f.engine.v11.config();
  assert.equal(
    f.engine.jiraSettings.route({
      ...quest,
      execution: { ...config, routing: { ...config.routing, mode: "manual", effort: "high" } },
    }).resolvedEffort,
    "high",
  );
  const overridden = f.engine.jiraSettings.route({
    ...quest,
    execution: {
      ...config,
      roles: {
        ...config.roles,
        planner: { runtime: "claude", model: "claude-haiku-test", effort: "low" },
      },
    },
  });
  assert.equal(overridden.resolvedModel, "claude-haiku-test");
  assert.equal(overridden.resolvedEffort, "low");
  models[0].available = false;
  assert.throws(() => f.engine.jiraSettings.route(quest), /No verified permitted/);
  const next = await create(f);
  assert.throws(() => f.engine.jiraSettings.route(next), /no automatic upgrade/);
  assert.equal(f.pending.length, 0);
});

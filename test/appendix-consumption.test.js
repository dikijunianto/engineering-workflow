import test from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fixture } from "./engine-fixture.js";
import { SkillRunner } from "../src/adapters.js";

const options = [
  { id: "11515", value: "BE-1. Generic function-Low" },
  { id: "11516", value: "BE-2. Generic function unit test-Low" },
];
const original = await readFile(new URL("./fixtures/jira-appendix.md", import.meta.url), "utf8");
const markdown = original
  .replace("Jira project `FFE`", "Jira project `SYN`")
  .replaceAll("Refactor or add 1 generic function", options[0].value)
  .replaceAll("Refactor generic function unit test", options[1].value);
const config = {
  project: "SYN",
  siteUrl: "https://jira.example",
  projectUrl: "https://jira.example/projects/SYN",
  categoryFamily: "BE",
  backendWeights: {
    project: "SYN",
    source: "User Confirmed",
    scale: "Mobile-equivalent",
    version: "1.0.0",
    levels: { V: 1, L: 2, M: 4, H: 8 },
  },
};
async function setup(t, extraOption = false) {
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
  await f.engine.action("SAVE_JIRA_CONTEXT", { questId: f.quest.id, ...config });
  f.adapters.skill.prepareAppendix = async () => {
    const inputDirectory = path.join(f.dir, "approved-inputs");
    await mkdir(inputDirectory, { recursive: true });
    return {
      inputDirectory,
      nativeSkill: "devquest-jira:create-appendix-task-list",
      prompt: "Fixture only",
      cleanup() {},
    };
  };
  f.adapters.skill.preflightAppendix = async () => ({
    status: "READY",
    project: "SYN",
    checkedAt: new Date().toISOString(),
    options: extraOption ? [...options, { id: "3", value: "BE-3. Handler-Very Low" }] : options,
  });
  f.adapters.skill.attachAppendixMetadata = SkillRunner.prototype.attachAppendixMetadata;
  f.adapters.skill.publish = async () => {
    throw new Error("No publishing permitted");
  };
  return f;
}
function readEvent(run, ranges, extra = {}) {
  return {
    type: "appendix-metadata-read",
    file: run.appendixMetadata.file,
    hash: run.appendixMetadata.hash,
    toolUseId: "read-1",
    ranges,
    ...extra,
  };
}

test("complete metadata consumption is required; omitted, partial, wrong-file/hash and changed-file evidence cannot produce artifacts", async (t) => {
  for (const mode of [
    "omitted",
    "partial",
    "wrong-file",
    "wrong-hash",
    "changed-file",
    "matrix-incomplete",
  ])
    await t.test(mode, async (t) => {
      const f = await setup(t, mode === "matrix-incomplete");
      const run = await f.engine.action("GENERATE_APPENDIX", {
        questId: f.quest.id,
        requestId: mode,
      });
      const call = f.pending[0].options;
      call.onEvent({ type: "native-skill" });
      if (mode !== "omitted")
        call.onEvent(
          readEvent(
            run,
            [[1, mode === "partial" ? 1 : run.appendixMetadata.lineCount]],
            mode === "wrong-file"
              ? { file: path.join(f.dir, "different.json") }
              : mode === "wrong-hash"
                ? { hash: "stale" }
                : {},
          ),
        );
      if (mode === "changed-file") await writeFile(run.appendixMetadata.file, "changed");
      await f.finish(markdown);
      const failed = f.store.get("runs", run.id);
      assert.equal(failed.state, "FAILED");
      assert.match(
        failed.summary,
        mode === "changed-file"
          ? /metadata input changed/
          : mode === "matrix-incomplete"
            ? /every verified selected category/
            : /not completely read/,
      );
      assert.equal(f.store.latest(f.quest.id, "appendix"), undefined);
      assert.equal(await readFile(failed.appendixDiagnostic.file, "utf8"), markdown);
      assert.equal(failed.appendixDiagnostic.publishable, false);
      assert.equal(f.store.all("approvals").filter((a) => a.kind === "appendix").length, 0);
      assert.equal(f.engine.appendixAgent.status(failed).recoveryBlocked, false);
      assert.equal(f.pending.length, 0);
      assert.equal(f.store.get("quests", f.quest.id).state, "PLAN_APPROVED");
    });
});

test("multiple verified read ranges and exact complete matrix persist evidence, preserve prior approved revisions and allow a fresh explicit retry", async (t) => {
  const f = await setup(t);
  const run = await f.engine.action("GENERATE_APPENDIX", {
    questId: f.quest.id,
    requestId: "first",
  });
  f.pending[0].options.onEvent({ type: "native-skill" });
  await f.finish(markdown);
  const failed = f.store.get("runs", run.id),
    history = JSON.stringify(failed);
  const retry = await f.engine.action("GENERATE_APPENDIX", {
    questId: f.quest.id,
    requestId: "explicit-retry",
  });
  assert.notEqual(retry.id, failed.id);
  const call = f.pending[0].options;
  call.onEvent({ type: "native-skill" });
  call.onEvent(readEvent(retry, [[1, 2]]));
  assert.equal(f.store.get("runs", retry.id).metadataConsumption.status, "PARTIAL");
  call.onEvent(readEvent(retry, [[3, retry.appendixMetadata.lineCount]], { toolUseId: "read-2" }));
  await f.finish(markdown);
  const complete = f.store.get("runs", retry.id);
  assert.equal(complete.state, "COMPLETED");
  assert.equal(complete.metadataConsumption.status, "VERIFIED");
  assert.equal(complete.metadataConsumption.snapshotHash, retry.jiraMetadata.hash);
  assert.equal(complete.metadataConsumption.matrixOptionCount, 2);
  assert.deepEqual(complete.metadataConsumption.toolUseIds, ["read-1", "read-2"]);
  assert.equal(JSON.stringify(f.store.get("runs", failed.id)), history);
  const artifact = f.store.latest(f.quest.id, "appendix");
  await f.engine.action("APPROVE_APPENDIX", { questId: f.quest.id, artifactId: artifact.id });
  const approvals = JSON.stringify(f.store.all("approvals"));
  const previous = JSON.stringify(artifact);
  const next = await f.engine.action("GENERATE_APPENDIX", {
    questId: f.quest.id,
    requestId: "invalid-next-revision",
  });
  f.pending[0].options.onEvent({ type: "native-skill" });
  await f.finish(markdown);
  assert.equal(f.store.get("runs", next.id).state, "FAILED");
  assert.equal(JSON.stringify(f.store.latest(f.quest.id, "appendix")), previous);
  assert.equal(JSON.stringify(f.store.all("approvals")), approvals);
  assert.equal(f.engine.approved(f.quest.id, "appendix").id, artifact.id);
  assert.equal(f.pending.length, 0);
});

test("explicit legacy refresh preserves plan/TRD, Epic, textual overrides, artifacts, approvals and failed history while applying structured BE defaults", async (t) => {
  const f = await fixture(t);
  await f.plan();
  const old = f.store.get("quests", f.quest.id);
  f.store.put("quests", {
    ...old,
    jiraConfig: undefined,
    jiraContext: {
      project: "SYN",
      epic: "SYN-6205",
      assignee: "Existing assignee",
      weightReference: "Existing User Confirmed V=1 L=2 M=4 H=8",
    },
  });
  f.store.put("runs", {
    id: "historical-failed",
    questId: f.quest.id,
    purpose: "jira_appendix_generation",
    state: "FAILED",
    summary: "Old validation failure",
  });
  const plan = f.engine.approved(f.quest.id, "plan"),
    trd = f.engine.approved(f.quest.id, "trd");
  const before = Object.fromEntries(
    ["runs", "artifacts", "approvals"].map((t) => [t, JSON.stringify(f.store.all(t))]),
  );
  const beforeQuest = JSON.stringify(f.store.get("quests", f.quest.id));
  await f.engine.action("SAVE_WORKSPACE_JIRA", { ...config, expectedVersion: 0 });
  assert.equal(JSON.stringify(f.store.get("quests", f.quest.id)), beforeQuest);
  await f.engine.action("REFRESH_QUEST_JIRA", { questId: f.quest.id });
  const migrated = f.store.get("quests", f.quest.id);
  assert.equal(migrated.id, f.quest.id);
  assert.equal(migrated.jiraConfig.categoryFamily, "BE");
  assert.deepEqual(migrated.jiraConfig.backendWeights.levels, { V: 1, L: 2, M: 4, H: 8 });
  assert.equal(migrated.jiraConfig.backendWeights.scale, "Mobile-equivalent");
  assert.equal(migrated.jiraContext.epic, "SYN-6205");
  assert.equal(migrated.jiraContext.assignee, "Existing assignee");
  assert.equal(migrated.jiraContext.weightReference, "Existing User Confirmed V=1 L=2 M=4 H=8");
  assert.equal(f.engine.approved(f.quest.id, "plan").id, plan.id);
  assert.equal(f.engine.approved(f.quest.id, "trd").id, trd.id);
  for (const table of ["runs", "artifacts", "approvals"])
    assert.equal(JSON.stringify(f.store.all(table)), before[table]);
  assert.equal(f.pending.length, 0);
});

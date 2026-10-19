// Isolated synthetic browser fixture. No external runtime, network integration or publication.
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { createServer } from "../src/server.js";
import { SkillRunner } from "../src/adapters.js";
const root =
  process.env.DEVQUEST_BROWSER_ROOT ||
  (await mkdtemp(path.join(tmpdir(), "devquest-workspace-browser-")));
const repository = path.join(root, "synthetic-service");
await mkdir(repository, { recursive: true });
const options = [
  { id: "11515", value: "BE-1. Generic function-Low" },
  { id: "11516", value: "BE-2. Generic function unit test-Low" },
];
const markdown = (
  await readFile(new URL("../test/fixtures/jira-appendix.md", import.meta.url), "utf8")
)
  .replaceAll("Jira project `FFE`", "Jira project `SYN`")
  .replaceAll(
    "inferred from MOB-V/L/M/H prefix",
    "User Confirmed SYN Backend reference, Mobile-equivalent scale",
  )
  .replaceAll("Refactor or add 1 generic function", options[0].value)
  .replaceAll("Refactor generic function unit test", options[1].value);
const audit = [];
const record = async (event) => {
  audit.push(event);
  await writeFile(path.join(root, "audit.json"), JSON.stringify(audit, null, 2));
};
const runtime = {
  detectCapabilities: async () => ({ available: true, interactive: true }),
  start: async (input) => {
    assert.equal(input.purpose, "jira_appendix_generation");
    assert.equal(input.readOnly, true);
    assert.equal(input.executionPolicy.nestedSpawning, false);
    await record({
      event: "fake-generation",
      model: input.route.resolvedModel,
      effort: input.route.resolvedEffort,
      readOnly: true,
      realJiraDispatches: 0,
    });
    input.onEvent({ type: "native-skill", skill: input.nativeSkill });
    input.onEvent({
      type: "appendix-metadata-read",
      file: input.appendixMetadata.file,
      hash: input.appendixMetadata.hash,
      toolUseId: "fake-metadata-read",
      ranges: [[1, input.appendixMetadata.lineCount]],
    });
    await new Promise((resolve) => setTimeout(resolve, 1200));
    return { text: markdown, summary: "Synthetic fixture only" };
  },
};
const adapters = {
  config: {
    orchestration: {
      models: [
        {
          id: "claude-sonnet-synthetic",
          runtime: "claude",
          family: "sonnet",
          available: true,
          verified: true,
          efforts: ["medium"],
        },
      ],
    },
  },
  runtimes: { claude: runtime },
  git: { register: async (p) => ({ path: p, name: path.basename(p), baseBranch: "development" }) },
  skill: {
    prepareAppendix: async (input) => {
      assert.equal(input.quest.jiraContext.project, "SYN");
      assert.match(input.planContent, /approved helper/);
      const inputDirectory = await mkdtemp(path.join(root, "inputs-"));
      await writeFile(path.join(inputDirectory, "plan.md"), input.planContent);
      await writeFile(path.join(inputDirectory, "trd.md"), input.trdContent);
      await record({
        event: "fake-skill-prepare",
        project: input.quest.jiraContext.project,
        epic: input.quest.jiraContext.epic,
        planArtifactId: input.planArtifactId,
      });
      return {
        nativeSkill: "devquest-jira:create-appendix-task-list",
        prompt: "Synthetic fixture only",
        inputDirectory,
        cleanup() {},
      };
    },
    preflightAppendix: async () => {
      await record({
        event: "fake-metadata-preflight",
        project: "SYN",
        skillVerified: true,
        realJiraDispatches: 0,
      });
      return {
        status: "READY",
        project: "SYN",
        checkedAt: new Date().toISOString(),
        options,
        skillVerified: true,
        writeGuard: "Fake adapter; no external connection exists",
      };
    },
    attachAppendixMetadata: SkillRunner.prototype.attachAppendixMetadata,
    publish: async () => {
      await record({ event: "FORBIDDEN_PUBLISH_ATTEMPT" });
      throw new Error("Publishing forbidden in this isolated fixture");
    },
  },
};
const app = await createServer({
  dataDir: path.join(root, "data"),
  adapters,
  port: Number(process.env.DEVQUEST_BROWSER_PORT || 4311),
});
const repo =
  app.store.all("repositories")[0] ||
  (await app.engine.action("REGISTER_REPOSITORY", { path: repository }));
const action = app.engine.action.bind(app.engine);
app.engine.action = async (type, input) => {
  const result = await action(type, input);
  if (type === "CREATE_QUEST") {
    const questId = result.id;
    app.store.artifact(questId, "analysis", "Synthetic selected repository analysis.");
    await action("SAVE_TRD", { questId, content: "Synthetic helper design only." });
    await action("APPROVE_TRD", { questId, artifactId: app.store.latest(questId, "trd").id });
    await action("SAVE_PLAN", {
      questId,
      content:
        "Task A: Implement approved helper and its unit test. Acceptance: helper returns expected result. Depends on: none.",
      tasks: [
        {
          id: "A",
          title: "Alpha change",
          repoId: repo.id,
          dependencies: [],
          validation: "node-test",
        },
      ],
    });
    await action("APPROVE_PLAN", { questId, artifactId: app.store.latest(questId, "plan").id });
    await record({ event: "fixture-plan-approved", questId });
    return app.store.get("quests", questId);
  }
  return result;
};
console.log(
  JSON.stringify({
    url: app.url,
    root,
    note: "All integrations and Claude generation are fake; no credentials or external connections.",
  }),
);
process.once("SIGTERM", async () => {
  await app.close();
  process.exit();
});
process.once("SIGINT", async () => {
  await app.close();
  process.exit();
});

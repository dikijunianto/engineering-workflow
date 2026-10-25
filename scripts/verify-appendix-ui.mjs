// Synthetic opt-in UI/live verification. No real Jira service or office documents.
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import os from "node:os";
import { createServer } from "../src/server.js";
import { createAdapters, CodexRuntime, runProcess } from "../src/adapters.js";
if (!process.argv.includes("--allow-paid-codex"))
  throw new Error(
    "Explicit --allow-paid-codex required; at most one live call",
  );
const catalog = JSON.parse(
  execFileSync("codex", ["debug", "models"], { encoding: "utf8" }),
);
const model = "gpt-5.6-luna",
  effort = "low";
assert.ok(
  catalog.models.some(
    (m) =>
      m.slug === model &&
      m.supported_reasoning_levels.some((r) => r.effort === effort),
  ),
  "Compatible cheapest CLI model unavailable; no upgrade",
);
const root = mkdtempSync(path.join(os.tmpdir(), "devquest-appendix-ui-"));
const docs = path.join(root, "synthetic-documents");
mkdirSync(docs);
execFileSync("git", ["init", "-b", "master"], { cwd: docs, stdio: "ignore" });
const skillFile = path.join(docs, "SKILL.md");
writeFileSync(
  skillFile,
  `# Synthetic appendix integration fixture
This is a public-safe test skill, not the installed office skill. Generate a Markdown Jira task appendix using only the approved plan. Never publish, write files, commit, implement or run commands. Produce exactly two tasks: T1.1 for plan task A and T2.1 for B. Preserve B's dependency on A. Include the provided execution task UUIDs for lineage.
Use only categories from the supplied synthetic Jira metadata. Prefix MOB-V means 1 point; MOB-L means 2 points. Each task must have at most one row per category and total at most 8 points. Exclude pure Git mechanics and self-verification steps from weight. Leave assignee empty when absent.
Use this document structure: title; ## 1. Appendix reference (weight matrix); ## 2. Categorization heuristics; ## 3. Tasks; ## 4. Grand total; ## 5. Weight distribution (per-task); ## 6. Open items / known gaps (subsections 6.1 through 6.5, including excluded plan steps); ## 7. Suggested Jira import format. Task headings are #### T1.1 — title and #### T2.1 — title. Each card includes plan/execution task ID, Depends on, and a table with Appendix line | Category | Weight, ending with **Task total**. Each task card must explicitly include Description, Acceptance criteria, Depends on, Affected repositories, Implementation scope, Testing requirements. Include a grand total of 3 points. Return the document in JSON {"content":"Markdown"}. Stop for human review; no publishing.
`,
);
writeFileSync(
  path.join(docs, "README.md"),
  "Synthetic appendix inputs: SKILL.md, approved-plan.md, approved-trd.md and jira-metadata.json. Read all four before generating. No application source is needed.\n",
);
writeFileSync(
  path.join(docs, "jira-metadata.json"),
  JSON.stringify({
    fixture: true,
    project: "SYN",
    cloudId: "synthetic-only",
    taskIssueType: "Task",
    fields: {
      customfield_11543: {
        name: "Choose Appendix (v3)",
        allowedValues: [
          { id: "test-1", value: "MOB-V Function" },
          { id: "test-2", value: "MOB-L API" },
        ],
      },
    },
  }),
);
const mcpConfig = path.join(root, "fake-mcp.json");
writeFileSync(
  mcpConfig,
  JSON.stringify({
    mcpServers: {
      atlassian: {
        type: "http",
        url: "https://synthetic.invalid/not-connected",
      },
    },
  }),
);
let syntheticRepoId;
let invocations = 0,
  published = 0;
const toolCalls = [],
  raw = [];
const codex = new CodexRuntime({
  runner: async (file, args, options) => {
    if (args[0] === "exec" && !args.includes("--help")) {
      assert.equal(
        invocations,
        0,
        "One-call paid limit reached; no retry authorized",
      );
      invocations++;
      const result = await runProcess(file, args, options);
      raw.push({ args, cwd: options.cwd, ...result });
      writeFileSync(
        path.join(root, "runtime-evidence.json"),
        JSON.stringify(raw, null, 2),
      );
      return result;
    }
    return runProcess(file, args, options);
  },
});
const route = {
  runtime: "codex",
  requestedModel: model,
  resolvedModel: model,
  requestedEffort: effort,
  resolvedEffort: effort,
};
const runtime = {
  name: "Codex synthetic validation",
  defaultRoute: route,
  detectCapabilities: () => codex.detectCapabilities(),
  start: async (input) => {
    assert.ok(
      syntheticRepoId && input.prompt.includes(syntheticRepoId),
      "Fixture plan and reader IDs must agree before any paid call",
    );
    // Simulate only the native-skill milestone: Codex cannot prove Claude Skill invocation.
    input.onEvent?.({ type: "native-skill", skill: "synthetic-fixture-only" });
    return codex.start({
      readOnly: true,
      cwd: docs,
      route,
      executionPolicy: {},
      timeoutMs: 120000,
      signal: input.signal,
      accessScope: {
        readOnly: true,
        cwd: docs,
        repositories: [
          {
            id: syntheticRepoId,
            name: "Synthetic appendix inputs",
            path: docs,
          },
        ],
      },
      onEvent: (event) => {
        input.onEvent?.(event);
        if (event.type === "process")
          input.onEvent?.({
            type: "native-skill",
            skill: "synthetic-fixture-only",
          });
        if (event.type === "repository-tool") toolCalls.push(event.call);
      },
      prompt:
        input.prompt +
        "\nSYNTHETIC TEST OVERRIDE: do not connect to any Jira service. The exact fake Jira read metadata is in jira-metadata.json. Read it and approved-plan.md, approved-trd.md and SKILL.md through the repository reader. These generated documents are the entire authorized scope. Use that metadata as the only category source for this test. Return the skill's JSON content; no publishing or implementation.",
    });
  },
};
const adapters = await createAdapters();
adapters.config.workflow = { skills: { appendix: skillFile } };
adapters.config.orchestration = {
  models: [
    {
      id: "claude-sonnet-synthetic-policy",
      runtime: "claude",
      family: "sonnet",
      available: true,
      verified: true,
      efforts: ["high"],
    },
  ],
};
adapters.skill = {
  prepareAppendix: async (input) => ({
    nativeSkill: "create-appendix-task-list",
    prompt: `SYNTHETIC ONLY. Follow the fixture skill in SKILL.md, never any installed office skill. No native Claude invocation is available in this Codex verification.\nApplication input:\n${JSON.stringify(input)}`,
  }),
};
adapters.skill.publish = async () => {
  published++;
  throw new Error("Real publishing forbidden in validation");
};
adapters.runtimes = { codex: runtime };
const app = await createServer({
  dataDir: path.join(root, "data"),
  adapters,
  port: 4311,
});
const engine = app.engine;
// Test-only provider replacement: production always uses Claude; verify the same managed lifecycle with authorized Codex instead.
const launch = engine.launch.bind(engine);
engine.launch = (quest, options, existing) =>
  launch(quest, { ...options, runtime: "codex", route }, existing);
const repo = await engine.action("REGISTER_REPOSITORY", { path: docs });
syntheticRepoId = repo.id;
const quest = await engine.action("CREATE_QUEST", {
  kind: "TECH",
  title: "Synthetic Jira Appendix verification",
  content: "Plan-to-appendix integration only",
  repositoryIds: [repo.id],
  workflowVersion: 2,
  execution: { runtime: "claude", routing: { mode: "manual" } },
});
engine.designStages.saveSpec(
  quest,
  "# Synthetic specification\nAdd a display token helper and wire its response mapping.",
);
app.store.artifact(
  quest.id,
  "analysis",
  "# Synthetic impact\nTwo small deliverables; no repository changes are requested now.",
);
await engine.action("SAVE_TRD", {
  questId: quest.id,
  content:
    "# Synthetic TRD\nA helper normalizes a display token; response mapping uses the helper. Preserve the current API route.",
});
await engine.action("APPROVE_TRD", {
  questId: quest.id,
  artifactId: app.store.latest(quest.id, "trd").id,
});
await engine.action("SAVE_PLAN", {
  questId: quest.id,
  content:
    "# Approved synthetic plan\n## Task A: Normalize display token\nAdd one normalizeDisplayToken function. Category MOB-V Function. Verify its behavior using the existing checks; verification is bundled, not another deliverable.\n## Task B: Wire HTTP response mapping\nDepends on A. Add one response mapping that calls normalizeDisplayToken. Category MOB-L API.\n## Git workflow\nCommit and push later during explicit execution; exclude these mechanics from estimates.\n",
  tasks: [
    {
      id: "A",
      title: "Normalize display token",
      repoId: repo.id,
      dependencies: [],
      validation: "node-test",
    },
    {
      id: "B",
      title: "Wire HTTP response mapping",
      repoId: repo.id,
      dependencies: ["A"],
      validation: "node-test",
    },
  ],
});
await engine.action("APPROVE_PLAN", {
  questId: quest.id,
  artifactId: app.store.latest(quest.id, "plan").id,
});
for (const kind of ["plan", "trd"])
  writeFileSync(
    path.join(docs, `approved-${kind}.md`),
    app.store.content(app.store.latest(quest.id, kind)),
  );
console.log(
  JSON.stringify({
    url: `${app.url}/#quest/${quest.id}/overview`,
    root,
    questId: quest.id,
    model,
    effort,
    skillFixture: skillFile,
  }),
);
let finished = false;
const capture = () => {
  const op = app.store
    .all("runs")
    .filter(
      (r) => r.questId === quest.id && r.purpose === "jira_appendix_generation",
    )
    .at(-1);
  if (!op || op.state === "RUNNING" || finished) return;
  finished = true;
  const artifact = app.store.latest(quest.id, "appendix"),
    content = artifact ? app.store.content(artifact) : "";
  const report = {
    root,
    questId: quest.id,
    operation: op,
    model,
    effort,
    invocations,
    published,
    toolCalls,
    artifact,
    state: app.store.get("quests", quest.id).state,
    runs: app.store.all("runs"),
    works: app.store.all("works"),
    executionTasks: engine.tasks(quest.id),
    content,
    actualCost: "NOT_REPORTED",
    claudeSkillInvocation: "SIMULATED_NOT_VERIFIED",
  };
  try {
    assert.equal(op.state, "COMPLETED");
    assert.ok(content.includes("T1.1") && content.includes("T2.1"));
    assert.match(content, /depend[^\n]*T1\.1/i);
    for (const task of engine.tasks(quest.id))
      assert.ok(content.includes(task.id), "Execution task lineage missing");
    assert.ok(
      content.includes("MOB-V Function") && content.includes("MOB-L API"),
    );
    assert.ok(
      toolCalls.some(
        (c) => c.path === "approved-plan.md" && c.status === "PASSED",
      ),
    );
    assert.equal(published, 0);
    assert.equal(report.runs.length, 1);
    assert.equal(op.purpose, "jira_appendix_generation");
    assert.equal(op.role, "JIRA_APPENDIX");
    assert.ok(op.lastProgressAt);
    assert.equal(op.artifactId, artifact.id);
    assert.ok(!report.runs.some((r) => r.role === "developer"));
    assert.equal(report.works.length, 0);
    assert.equal(report.state, "PLAN_APPROVED");
    report.result = "PASS";
  } catch (error) {
    report.result = "FAIL";
    report.error = error.message;
  }
  writeFileSync(
    path.join(root, "report.json"),
    JSON.stringify(report, null, 2),
  );
  console.log(
    JSON.stringify({
      result: report.result,
      report: path.join(root, "report.json"),
      error: report.error,
    }),
  );
};
const timer = setInterval(capture, 500);
timer.unref();
process.on("SIGTERM", async () => {
  clearInterval(timer);
  await app.close();
  process.exit(0);
});

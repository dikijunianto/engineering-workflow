// Opt-in paid validation; only generated synthetic repositories are sent to Codex.
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Store } from "../src/store.js";
import { Engine } from "../src/engine.js";
import { createAdapters, CodexRuntime, runProcess } from "../src/adapters.js";
if (!process.argv.includes("--allow-paid-codex"))
  throw new Error(
    "Pass --allow-paid-codex to authorize at most two synthetic Codex invocations",
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
  "Cheapest compatible CLI model unavailable; no upgrade allowed",
);
const root = mkdtempSync(path.join(os.tmpdir(), "devquest-trd-live-"));
const git = (cwd, ...args) =>
  execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
  }).trim();
const dirs = ["test-personal-finance-svc", "test-funding-transaction-svc"].map(
  (name, i) => {
    const cwd = path.join(root, name);
    mkdirSync(cwd);
    git(cwd, "init", "-b", "master");
    git(cwd, "config", "user.name", "DevQuest Synthetic Test");
    git(cwd, "config", "user.email", "test@example.invalid");
    writeFileSync(
      path.join(cwd, "README.md"),
      `# ${name}\nSynthetic test only. Inspect pin.js for the ${i ? "target" : "source"} contract.\n`,
    );
    writeFileSync(
      path.join(cwd, "pin.js"),
      i
        ? 'export const route = "/pin";\nexport const clearBlocks = "DeleteOne";\nexport const verifyPasswordEmbed = false;\n'
        : 'export const route = "/pin";\nexport const blockedResponse = { status: 200, body: { blocked: true } };\nexport const defectToFix = "shared mutable error in callback";\n',
    );
    git(cwd, "add", ".");
    git(cwd, "commit", "-m", "synthetic fixture");
    git(cwd, "checkout", "-b", "staging");
    return cwd;
  },
);
const snapshots = () =>
  dirs.map((cwd) => ({
    branch: git(cwd, "branch", "--show-current"),
    refs: git(cwd, "show-ref"),
    status: git(cwd, "status", "--porcelain=v1"),
    files: ["README.md", "pin.js"].map((file) =>
      readFileSync(path.join(cwd, file), "utf8"),
    ),
    head: git(cwd, "rev-parse", "HEAD"),
  }));
const before = snapshots(),
  raw = [],
  commands = [];
let invocations = 0;
const runtime = new CodexRuntime({
  runner: async (file, args, options) => {
    if (args[0] === "exec" && !args.includes("--help")) {
      assert.ok(
        invocations < (process.argv.includes("--one-invocation") ? 1 : 2),
        "Paid invocation bound reached; request additional authorization",
      );
      invocations++;
      raw.push({ args, cwd: options.cwd });
      const result = await runProcess(file, args, {
        ...options,
        timeoutMs: 120000,
      });
      raw.at(-1).stdout = result.stdout;
      raw.at(-1).stderr = result.stderr;
      raw.at(-1).code = result.code;
      writeFileSync(
        path.join(root, "runtime-evidence.json"),
        JSON.stringify(raw, null, 2),
        { mode: 0o600 },
      );
      return result;
    }
    return runProcess(file, args, options);
  },
});
const adapters = await createAdapters();
adapters.config = {
  orchestration: {
    models: [
      {
        id: model,
        family: "gpt",
        runtime: "codex",
        available: true,
        verified: true,
        efforts: [effort],
      },
    ],
  },
};
adapters.workflow = undefined;
adapters.runtimes = { codex: runtime };
const originalRunner = adapters.git.runner;
adapters.git.runner = async (file, args, options) => {
  commands.push({ file, args });
  return originalRunner(file, args, options);
};
const store = new Store(path.join(root, "data")),
  engine = new Engine({ store, adapters });
let report;
try {
  await engine.initialize();
  const repos = [];
  for (const cwd of dirs) {
    const repo = await engine.action("REGISTER_REPOSITORY", { path: cwd });
    repos.push(
      await engine.action("CONFIGURE_REPOSITORY", {
        repositoryId: repo.id,
        defaultBranch: "master",
        baseBranch: "master",
        prTarget: "master",
      }),
    );
  }
  const quest = await engine.action("CREATE_QUEST", {
    kind: "TECH",
    title: "Synthetic PIN TRD validation",
    content: "Document the synthetic PIN migration only",
    repositoryIds: repos.map((r) => r.id),
    workflowVersion: 2,
    execution: {
      runtime: "codex",
      routing: { mode: "manual", model, effort },
      limits: { taskMinutes: 2 },
    },
  });
  const spec =
    "# Technical specification\nDesign inputs only: Base branch master; current checkout staging. Preserve /pin behavior and HTTP 200 response-body mapping. Apply existing defect fixes. No rate limiter: flag security risk. Skip VerifyPasswordEmbed: flag security risk. Use DeleteMany. Inspect README.md and pin.js in BOTH repositories with tools before completing a concise TRD (under 800 words). Do not implement. Treat these inputs as settled design choices but require human review of the security omissions.\n";
  engine.designStages.saveSpec(quest, spec);
  store.artifact(
    quest.id,
    "analysis",
    "# Repository impact\nSource pin.js defines the /pin and HTTP 200 contract. Target pin.js uses DeleteOne. A future implementation affects both modules; architecture only now. Read both actual synthetic sources to verify.\n",
  );
  engine.put("quests", store.get("quests", quest.id), {
    state: "ANALYSIS_COMPLETED",
  });
  const stateBefore = store.get("quests", quest.id).state;
  commands.length = 0;
  await engine.action("GENERATE_TRD", { questId: quest.id, runtime: "codex" });
  while (engine.jobs.size)
    await Promise.all([...engine.jobs.values()].map((job) => job.done));
  const runs = store.all("runs").filter((run) => run.questId === quest.id),
    artifact = store.latest(quest.id, "trd"),
    after = snapshots();
  report = {
    root,
    questId: quest.id,
    provider: "codex",
    requestedModel: model,
    effort,
    invocations,
    stateBefore,
    stateAfter: store.get("quests", quest.id).state,
    runs,
    artifact,
    repositoryBefore: before,
    repositoryAfter: after,
    backendCommands: commands,
    actualCost: "NOT_AVAILABLE",
    claudeLiveRead: "NOT_VERIFIED",
  };
  writeFileSync(
    path.join(root, "report.json"),
    JSON.stringify(report, null, 2),
    { mode: 0o600 },
  );
  assert.deepEqual(after, before, "Repository files/branches/status changed");
  assert.equal(report.stateAfter, "TRD_DRAFT");
  assert.ok(
    artifact &&
      readFileSync(
        path.join(root, "data", "quests", quest.id, "trd.md"),
        "utf8",
      ),
  );
  assert.ok(!runs.some((run) => run.role === "developer"));
  assert.ok(
    runs.some((run) =>
      repos.every((repo) =>
        (run.repositoryToolCalls || []).some(
          (call) =>
            call.repoId === repo.id &&
            call.path === "pin.js" &&
            call.status === "PASSED",
        ),
      ),
    ),
    "Both relevant source files must be read",
  );
  assert.ok(
    commands.every((command) =>
      ["rev-parse", "branch", "status", "check-ref-format"].includes(
        command.args[0],
      ),
    ),
    "Unexpected mutating backend command",
  );
  console.log(
    JSON.stringify(
      {
        result: "PASS",
        report: path.join(root, "report.json"),
        model,
        effort,
        invocations,
        runs: runs.map((r) => ({
          id: r.id,
          state: r.state,
          actualModel: r.actualModel,
          usage: r.usage,
          files: r.repositoryToolCalls,
        })),
        stateAfter: report.stateAfter,
      },
      null,
      2,
    ),
  );
} catch (error) {
  console.log(
    JSON.stringify(
      {
        result: "FAIL",
        root,
        error: error.message,
        invocations,
        report: report && path.join(root, "report.json"),
      },
      null,
      2,
    ),
  );
  process.exitCode = 1;
} finally {
  await engine.close();
  store.close();
}

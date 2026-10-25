import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { Store } from "../src/store.js";
import { Engine } from "../src/engine.js";
import { createAdapters } from "../src/adapters.js";

function git(cwd, ...args) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    windowsHide: true,
  }).trim();
}
export async function fixture(t, { realGit = false } = {}) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "devquest-engine-"));
  const pending = [];
  const runtime = {
    detectCapabilities: async () => ({
      available: true,
      interactive: true,
      nativeResume: false,
    }),
    start: (options) =>
      new Promise((resolve, reject) => {
        pending.push({ options, resolve, reject });
        options.signal?.addEventListener(
          "abort",
          () => reject(new Error("Aborted")),
          {
            once: true,
          },
        );
      }),
  };
  const real = await createAdapters();
  const facts = new Map();
  const gitAdapter = realGit
    ? real.git
    : {
        register: async (p) => ({ path: p, name: path.basename(p) }),
        prepare: async ({ path: p, branch }) => {
          facts.set(p, {
            head: "abc",
            branch,
            dirty: false,
            diff: "",
            fingerprint: "abc",
            contentFingerprint: "content",
          });
          return { head: "abc" };
        },
        reconcile: async ({ path: p }) => {
          assert.ok(facts.has(p), "missing worktree");
        },
        inspect: async (p) => ({ ...facts.get(p) }),
        test: async () => ({
          passed: true,
          summary: "# tests 1\n# pass 1\n# fail 0",
        }),
        commit: async () => {},
      };
  const created = [];
  const adapters = {
    config: { jiraSkill: {} },
    git: gitAdapter,
    runtimes: { codex: runtime, claude: runtime },
    skill: {
      publish: async ({ tasks }) =>
        tasks.map((task, i) => ({ taskId: task.id, key: `DEV-${i + 1}` })),
    },
    sourceControl: {
      create: async (args) => {
        created.push(args);
        return {
          number: created.length,
          url: `https://github.com/example/repo/pull/${created.length}`,
        };
      },
    },
    confluence: {
      fetch: async () => ({
        content: "Requirement",
        sources: [],
        warnings: [],
      }),
    },
  };
  const store = new Store(path.join(dir, "data")),
    engine = new Engine({ store, adapters });
  if (!realGit) engine.v11.git.analysisSnapshot = async (quest,repo) => ({repoId:repo.id,branch:repo.baseBranch || "development",remote:"origin",commit:"a".repeat(40),path:repo.path});
  await engine.initialize();
  t.after(async () => {
    await engine.close();
    store.close();
  });
  const repos = [];
  for (const name of ["alpha", "beta"]) {
    const repoPath = path.join(dir, name);
    if (realGit) {
      mkdirSync(repoPath);
      git(repoPath, "init", "-b", "development");
      git(repoPath, "config", "user.name", "Test");
      git(repoPath, "config", "user.email", "test@example.invalid");
      writeFileSync(
        path.join(repoPath, "smoke.test.js"),
        "require('node:test')('working',()=>require('node:assert/strict').equal(2+2,4));\n",
      );
      git(repoPath, "add", ".");
      git(repoPath, "commit", "-m", "initial");
      git(repoPath, "remote", "add", "origin", repoPath);
    }
    repos.push(await engine.action("REGISTER_REPOSITORY", { path: repoPath }));
  }
  const finish = async (
    text = "Implementation complete",
    waitingInput = false,
  ) => {
    const next = pending.shift();
    assert.ok(next, "pending runtime");
    next.resolve({ text, summary: text.slice(0, 4000), waitingInput });
    await Promise.all([...engine.jobs.values()].map((job) => job.done));
  };
  const quest = await engine.action("CREATE_QUEST", {
    kind: "PRODUCT",
    title: "Recurring payments",
    content: "Implement recurring payments and notifications",
    repositoryIds: repos.map((r) => r.id),
  });
  async function approve(kind) {
    await engine.action(kind === "trd" ? "APPROVE_TRD" : "APPROVE_PLAN", {
      questId: quest.id,
      artifactId: store.latest(quest.id, kind).id,
    });
  }
  async function plan() {
    await engine.action("ANALYZE_PRD", { questId: quest.id });
    await finish("Both registered repositories are affected.");
    await engine.action("SAVE_TRD", {
      questId: quest.id,
      content: "Approved architecture and tests.",
    });
    await approve("trd");
    await engine.action("SAVE_PLAN", {
      questId: quest.id,
      content: "Implement alpha then notify beta.",
      tasks: [
        {
          id: "A",
          title: "Alpha change",
          repoId: repos[0].id,
          dependencies: [],
          validation: "node-test",
        },
        {
          id: "B",
          title: "Alpha followup",
          repoId: repos[0].id,
          dependencies: [],
          validation: "node-test",
        },
        {
          id: "C",
          title: "Independent beta",
          repoId: repos[1].id,
          dependencies: [],
          validation: "node-test",
        },
        {
          id: "D",
          title: "Dependent beta",
          repoId: repos[1].id,
          dependencies: ["A", "B"],
          validation: "node-test",
        },
      ],
    });
    await approve("plan");
  }
  const publish = () => engine.action("PUBLISH_JIRA", { questId: quest.id });
  return {
    dir,
    engine,
    store,
    pending,
    finish,
    quest,
    repos,
    plan,
    publish,
    approve,
    adapters,
    facts,
    created,
  };
}

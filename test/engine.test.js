import { test } from "node:test";
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
          { once: true },
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

test("human gates cannot be bypassed and approvals bind document revisions", async (t) => {
  const f = await fixture(t);
  await assert.rejects(
    f.engine.action("GENERATE_PLAN", { questId: f.quest.id }),
    /trd is missing/,
  );
  await assert.rejects(
    f.engine.action("EXECUTE_QUEST", { questId: f.quest.id }),
    /Publish/,
  );
  await f.plan();
  await f.engine.action("SAVE_TRD", {
    questId: f.quest.id,
    content: "Changed design",
  });
  await assert.rejects(
    f.engine.action("PUBLISH_JIRA", { questId: f.quest.id }),
    /Approve/,
  );
  await assert.rejects(
    f.engine.action("APPROVE_TRD", { questId: f.quest.id, artifactId: "old" }),
    /revision changed/,
  );
});
test("cycles, missing dependencies and out-of-scope repositories are rejected", async (t) => {
  const f = await fixture(t);
  await f.plan();
  for (const tasks of [
    [
      {
        id: "A",
        title: "bad",
        repoId: f.repos[0].id,
        validation: "node-test",
        dependencies: ["A"],
      },
    ],
    [
      {
        id: "A",
        title: "bad",
        repoId: "other",
        validation: "node-test",
        dependencies: [],
      },
    ],
    [
      {
        id: "A",
        title: "a",
        repoId: f.repos[0].id,
        validation: "node-test",
        dependencies: ["B"],
      },
      {
        id: "B",
        title: "b",
        repoId: f.repos[0].id,
        validation: "node-test",
        dependencies: ["A"],
      },
    ],
  ])
    await assert.rejects(
      f.engine.action("SAVE_PLAN", {
        questId: f.quest.id,
        content: "Bad plan",
        tasks,
      }),
    );
});
test("partial Jira publication preserves mappings and retries only unresolved tasks", async (t) => {
  const f = await fixture(t);
  await f.plan();
  let calls = 0;
  f.adapters.skill.publish = async ({ tasks }) => {
    calls++;
    return tasks
      .slice(0, 1)
      .map((task) => ({ taskId: task.id, key: `DEV-${calls}` }));
  };
  for (let i = 0; i < 4; i++) await f.publish();
  assert.equal(
    f.engine.tasks(f.quest.id).filter((task) => task.jira).length,
    4,
  );
  assert.equal(calls, 4);
  await f.publish();
  assert.equal(calls, 4);
  await assert.rejects(
    f.engine.action("SAVE_TRD", { questId: f.quest.id, content: "Change" }),
    /frozen/,
  );
});
test("scheduler serializes same repo, runs independent repos in parallel and holds interrupted lane", async (t) => {
  const f = await fixture(t);
  await f.plan();
  await f.publish();
  await f.engine.action("EXECUTE_QUEST", { questId: f.quest.id });
  const running = f.store.all("runs").filter((r) => r.state === "RUNNING");
  assert.equal(running.length, 2);
  assert.equal(new Set(running.map((r) => r.workId)).size, 2);
  const first = running[0];
  await f.engine.action("INTERRUPT_AGENT", { runId: first.id });
  await f.engine.jobs.get(first.id)?.done;
  const sameRepo = f.engine.tasks(f.quest.id).find((task) => task.key === "B");
  await assert.rejects(
    f.engine.action("START_TASK", { questId: f.quest.id, taskId: sameRepo.id }),
    /active or interrupted/,
  );
  assert.equal(f.store.get("runs", first.id).state, "INTERRUPTED");
});
test("manual starts honor dependencies and reject overlapping starts", async (t) => {
  const f = await fixture(t);
  await f.plan();
  await f.publish();
  const tasks = f.engine.tasks(f.quest.id);
  await assert.rejects(
    f.engine.action("START_TASK", { questId: f.quest.id, taskId: tasks[3].id }),
    /not ready/,
  );
  const results = await Promise.allSettled([
    f.engine.action("START_TASK", { questId: f.quest.id, taskId: tasks[0].id }),
    f.engine.action("START_TASK", { questId: f.quest.id, taskId: tasks[1].id }),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
});
test("failed tests prevent dependents and PR creation; raw test output is not retained", async (t) => {
  const f = await fixture(t);
  await f.plan();
  await f.publish();
  f.adapters.git.test = async () => ({
    passed: false,
    summary: "raw secret output\n# tests 1\n# fail 1",
  });
  const task = f.engine.tasks(f.quest.id)[0];
  await f.engine.action("START_TASK", { questId: f.quest.id, taskId: task.id });
  await f.finish();
  assert.equal(f.store.get("tasks", task.id).state, "TEST_FAILED");
  assert.ok(
    !f.store.get("tasks", task.id).validation.summary.includes("raw secret"),
  );
  await assert.rejects(
    f.engine.action("CREATE_PR", {
      questId: f.quest.id,
      workId: f.engine.works(f.quest.id)[0].id,
    }),
    /approved review/,
  );
});
test("restart restores registrations and marks active sessions interrupted without rerunning", async (t) => {
  const f = await fixture(t);
  await f.plan();
  await f.publish();
  await f.engine.action("START_TASK", {
    questId: f.quest.id,
    taskId: f.engine.tasks(f.quest.id)[0].id,
  });
  const restarted = new Engine({ store: f.store, adapters: f.adapters });
  await restarted.initialize();
  assert.equal(f.store.all("runs").at(-1).state, "INTERRUPTED");
  assert.equal(restarted.jobs.size, 0);
  assert.ok(f.store.latest(f.quest.id, "summary"));
});
test("artifact tampering is detected before approval or execution", async (t) => {
  const f = await fixture(t);
  await f.plan();
  writeFileSync(f.store.latest(f.quest.id, "plan").file, "tampered");
  await assert.rejects(f.publish(), /integrity mismatch/);
});

test("plan file failure rolls back task replacement and preserves approved revision", async (t) => {
  const f = await fixture(t);
  await f.plan();
  const originalTasks = f.engine.tasks(f.quest.id),
    originalArtifact = f.store.latest(f.quest.id, "plan");
  const save = f.store.artifact.bind(f.store);
  f.store.artifact = () => {
    throw new Error("Disk unavailable");
  };
  await assert.rejects(
    f.engine.action("SAVE_PLAN", {
      questId: f.quest.id,
      content: "Replacement",
      tasks: [
        {
          id: "NEW",
          title: "new",
          repoId: f.repos[0].id,
          dependencies: [],
          validation: "node-test",
        },
      ],
    }),
    /Disk unavailable/,
  );
  f.store.artifact = save;
  assert.deepEqual(f.engine.tasks(f.quest.id), originalTasks);
  assert.equal(f.store.latest(f.quest.id, "plan").id, originalArtifact.id);
  assert.equal(f.store.get("quests", f.quest.id).state, "PLAN_APPROVED");
});

test("changed analysis invalidates old approval basis", async (t) => {
  const f = await fixture(t);
  await f.plan();
  await f.engine.action("ANALYZE_PRD", { questId: f.quest.id });
  await f.finish("New requirement affects a different API");
  await assert.rejects(
    f.engine.action("GENERATE_PLAN", { questId: f.quest.id }),
    /trd requires human approval/,
  );
});

test("Tech Quest follows brainstorm, brief, impact analysis and TRD gates", async (t) => {
  const f = await fixture(t);
  const q = await f.engine.action("CREATE_QUEST", {
    kind: "TECH",
    title: "Simplify publisher",
    content: "Two competing publisher implementations",
    repositoryIds: f.repos.map((r) => r.id),
  });
  await assert.rejects(
    f.engine.action("ANALYZE_PRD", { questId: q.id }),
    /Finish brainstorming/,
  );
  await f.engine.action("START_BRAINSTORM", { questId: q.id });
  await f.finish("Goal: one publisher. Constraint: retain event schema.");
  await f.engine.action("FINISH_BRAINSTORM", { questId: q.id });
  assert.ok(f.store.latest(q.id, "technical-brief"));
  await f.engine.action("ANALYZE_PRD", { questId: q.id });
  await f.finish("Both repositories consume the event.");
  await f.engine.action("GENERATE_TRD", { questId: q.id });
  await f.finish("# TRD\nPreserve event schema and add contract tests.");
  assert.equal(f.store.get("quests", q.id).state, "TRD_DRAFT");
});

test("logical continuation preserves context while a live orphan process blocks resume", async (t) => {
  const f = await fixture(t);
  await f.plan();
  await f.publish();
  const task = f.engine.tasks(f.quest.id)[0];
  const run = await f.engine.action("START_TASK", {
    questId: f.quest.id,
    taskId: task.id,
  });
  f.pending.shift().resolve({
    text: "Need an API decision",
    summary: "Need an API decision",
    waitingInput: true,
  });
  await f.engine.jobs.get(run.id).done;
  f.store.put("runs", { ...f.store.get("runs", run.id), pid: process.pid });
  await assert.rejects(
    f.engine.action("CONTINUE_AGENT", { runId: run.id }),
    /previous agent process is still alive/,
  );
  f.store.put("runs", { ...f.store.get("runs", run.id), pid: null });
  await f.engine.action("SEND_MESSAGE", {
    runId: run.id,
    message: "Preserve the existing API.",
  });
  assert.ok(f.pending[0].options.prompt.includes("Preserve the existing API."));
  await f.finish();
  assert.equal(f.store.get("tasks", task.id).state, "COMPLETED");
});

test("Execute Quest keeps the selected runtime across every scheduling wave", async (t) => {
  const f = await fixture(t);
  await f.plan();
  await f.publish();
  f.engine.concurrency = 1;
  await f.engine.action("EXECUTE_QUEST", {
    questId: f.quest.id,
    runtime: "claude",
  });
  for (let i = 0; i < 4; i++) await f.finish();
  assert.equal(
    f.engine.tasks(f.quest.id).filter((task) => task.state === "COMPLETED")
      .length,
    4,
  );
  assert.ok(
    f.store
      .all("runs")
      .filter((run) => run.purpose === "task")
      .every((run) => run.runtime === "claude"),
  );
});

test("retrying failed PR publication after commit succeeds without another review", async (t) => {
  const f = await fixture(t);
  await f.plan();
  await f.publish();
  for (const task of f.engine.tasks(f.quest.id)) {
    await f.engine.action("START_TASK", {
      questId: f.quest.id,
      taskId: task.id,
    });
    await f.finish();
  }
  const work = f.engine.works(f.quest.id)[0];
  await f.engine.action("REVIEW_REPOSITORY", {
    questId: f.quest.id,
    workId: work.id,
  });
  await f.finish("Reviewed");
  await f.engine.action("APPROVE_REVIEW", {
    questId: f.quest.id,
    workId: work.id,
  });
  let commits = 0,
    attempts = 0;
  f.adapters.git.commit = async () => {
    commits++;
    Object.assign(f.facts.get(work.path), {
      head: "committed",
      fingerprint: "committed",
    });
  };
  f.adapters.sourceControl.create = async () => {
    if (++attempts === 1) throw new Error("Provider unavailable");
    return { url: "https://github.com/example/repo/pull/9", number: 9 };
  };
  await assert.rejects(
    f.engine.action("CREATE_PR", { questId: f.quest.id, workId: work.id }),
    /Provider unavailable/,
  );
  await f.engine.action("CREATE_PR", { questId: f.quest.id, workId: work.id });
  assert.equal(commits, 2);
  assert.equal(attempts, 2);
});
test("two real Git repositories reach reviewed PR creation without changing normal checkout", async (t) => {
  const f = await fixture(t, { realGit: true });
  await f.plan();
  await f.publish();
  for (const task of f.engine.tasks(f.quest.id)) {
    await f.engine.action("START_TASK", {
      questId: f.quest.id,
      taskId: task.id,
    });
    const work = f.engine
      .works(f.quest.id)
      .find((w) => w.repoId === task.repoId);
    writeFileSync(
      path.join(work.path, `${task.key}.txt`),
      `Change ${task.key}\n`,
    );
    await f.finish();
    assert.equal(f.store.get("tasks", task.id).state, "COMPLETED");
  }
  for (const work of f.engine.works(f.quest.id)) {
    await f.engine.action("REVIEW_REPOSITORY", {
      questId: f.quest.id,
      workId: work.id,
    });
    await f.finish(
      "Reviewed aggregate changes and test outcomes. No blocking findings.",
    );
    await f.engine.action("APPROVE_REVIEW", {
      questId: f.quest.id,
      workId: work.id,
    });
    await f.engine.action("CREATE_PR", {
      questId: f.quest.id,
      workId: work.id,
    });
    await f.engine.action("CREATE_PR", {
      questId: f.quest.id,
      workId: work.id,
    });
  }
  assert.equal(f.created.length, 2);
  assert.equal(f.store.get("quests", f.quest.id).state, "PRS_CREATED");
  for (const repo of f.repos) {
    assert.equal(git(repo.path, "branch", "--show-current"), "development");
    assert.equal(git(repo.path, "status", "--porcelain"), "");
  }
});
test("review is invalidated by changes during review or before PR creation", async (t) => {
  const f = await fixture(t);
  await f.plan();
  await f.publish();
  for (const task of f.engine.tasks(f.quest.id)) {
    await f.engine.action("START_TASK", {
      questId: f.quest.id,
      taskId: task.id,
    });
    await f.finish();
  }
  const work = f.engine.works(f.quest.id)[0];
  await f.engine.action("REVIEW_REPOSITORY", {
    questId: f.quest.id,
    workId: work.id,
  });
  f.facts.get(work.path).fingerprint = "changed";
  await f.finish("Looks good");
  await assert.rejects(
    f.engine.action("APPROVE_REVIEW", { questId: f.quest.id, workId: work.id }),
    /review first/,
  );
  await f.engine.action("REVIEW_REPOSITORY", {
    questId: f.quest.id,
    workId: work.id,
  });
  await f.finish("Looks good");
  await f.engine.action("APPROVE_REVIEW", {
    questId: f.quest.id,
    workId: work.id,
  });
  f.facts.get(work.path).fingerprint = "changed again";
  await assert.rejects(
    f.engine.action("CREATE_PR", { questId: f.quest.id, workId: work.id }),
    /Changes since review/,
  );
});

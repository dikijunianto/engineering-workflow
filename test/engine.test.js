import { designResult } from "./design-fixture.js";
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
import { fixture } from "./engine-fixture.js";

test("human gates cannot be bypassed and approvals bind document revisions", async (t) => {
  const f = await fixture(t);
  await assert.rejects(f.engine.action("GENERATE_PLAN", { questId: f.quest.id }), /trd is missing/);
  await assert.rejects(f.engine.action("EXECUTE_QUEST", { questId: f.quest.id }), /Publish/);
  await f.plan();
  await f.engine.action("SAVE_TRD", {
    questId: f.quest.id,
    content: "Changed design",
  });
  await assert.rejects(f.engine.action("PUBLISH_JIRA", { questId: f.quest.id }), /Approve/);
  await assert.rejects(
    f.engine.action("APPROVE_TRD", { questId: f.quest.id, artifactId: "old" }),
    /revision changed/,
  );
});
test("existing QA issue skips Jira creation and unlocks approved implementation", async (t) => {
  const f = await fixture(t);
  f.adapters.skill.publish = () => {
    throw new Error("Must not publish Jira");
  };
  const input = {
    questId: f.quest.id,
    key: "qa-123",
    url: "https://team.atlassian.net/browse/QA-123",
  };
  await assert.rejects(f.engine.action("USE_EXISTING_JIRA", input), /Approve/);
  await f.plan();
  input.planArtifactId = f.store.latest(f.quest.id, "plan").id;
  await assert.rejects(
    f.engine.action("USE_EXISTING_JIRA", { ...input, planArtifactId: "old" }),
    /revision changed/,
  );
  for (const invalid of [
    { key: "bad" },
    { url: "javascript:alert(1)" },
    { url: "https://user:secret@example.com" },
  ])
    await assert.rejects(
      f.engine.action("USE_EXISTING_JIRA", { ...input, ...invalid }),
      /Jira issue|HTTPS/,
    );
  assert.ok(f.engine.tasks(f.quest.id).every((task) => !task.jira));
  await f.engine.action("USE_EXISTING_JIRA", input);
  assert.equal(f.store.get("quests", f.quest.id).state, "TASKS_PUBLISHED");
  for (const task of f.engine.tasks(f.quest.id)) {
    assert.equal(task.state, "PUBLISHED");
    assert.equal(task.jira.key, "QA-123");
    assert.equal(task.jira.complete, true);
    assert.equal(task.jira.existing, true);
  }
  assert.equal(f.store.latest(f.quest.id, "appendix"), undefined);
  const tickets = f.store.latest(f.quest.id, "ticket");
  assert.match(f.store.content(tickets), /QA-123/);
  assert.match(
    readFileSync(path.join(f.store.dir, "quests", f.quest.id, "ticket.md"), "utf8"),
    /Existing issue/,
  );
  await assert.rejects(
    f.engine.action("SAVE_PLAN", { questId: f.quest.id, content: "Changed" }),
    /Published/,
  );
  await f.engine.action("START_TASK", {
    questId: f.quest.id,
    taskId: f.engine.tasks(f.quest.id)[0].id,
  });
  assert.equal(f.pending.length, 1);
});

test("saved and generated specs preserve Markdown revisions and require plan review", async (t) => {
  const f = await fixture(t);
  await f.plan();
  const trd = f.store.latest(f.quest.id, "trd");
  await assert.rejects(
    f.engine.action("SAVE_SPEC", {
      questId: f.quest.id,
      trdArtifactId: "old",
      content: "# Spec",
    }),
    /TRD revision changed/,
  );
  await f.engine.action("SAVE_SPEC", {
    questId: f.quest.id,
    trdArtifactId: trd.id,
    content: "# Spec\n\nAcceptance: preserve data.",
  });
  const first = f.store.latest(f.quest.id, "spec");
  assert.equal(first.trdArtifactId, trd.id);
  assert.equal(f.store.get("quests", f.quest.id).state, "PLAN_DRAFT");
  assert.throws(() => f.engine.approved(f.quest.id, "plan"), /human approval/);
  await f.engine.action("GENERATE_SPEC", { questId: f.quest.id });
  await f.finish("# Revised spec\n\nAcceptance: preserve worktrees.");
  const second = f.store.latest(f.quest.id, "spec");
  assert.equal(second.revision, 2);
  assert.match(f.store.content(first), /preserve data/);
  assert.match(
    readFileSync(path.join(f.store.dir, "quests", f.quest.id, "spec.md"), "utf8"),
    /preserve worktrees/,
  );
  assert.match(f.engine.context(f.quest), /Revised spec/);
  await f.approve("plan");
  await f.publish();
  await assert.rejects(f.engine.action("GENERATE_SPEC", { questId: f.quest.id }), /Published/);
});

test("failed initial worktree preparation retries the same work record", async (t) => {
  const f = await fixture(t);
  await f.plan();
  await f.publish();
  const task = f.engine.tasks(f.quest.id)[0];
  const prepare = f.adapters.git.prepare;
  let attempts = 0;
  f.adapters.git.prepare = async (args) => {
    attempts++;
    if (attempts === 1) throw new Error("Base branch development is unavailable");
    return prepare(args);
  };
  await assert.rejects(f.engine.workFor(f.quest, task), /Base branch/);
  const failed = f.engine.works(f.quest.id)[0];
  assert.equal(failed.state, "RECOVERY_REQUIRED");
  const recovered = await f.engine.workFor(f.quest, task);
  assert.equal(attempts, 2);
  assert.equal(recovered.id, failed.id);
  assert.equal(recovered.state, "READY");
  assert.equal(recovered.error, null);
  assert.equal(f.engine.works(f.quest.id).length, 1);
  f.store.put("works", { ...recovered, state: "RECOVERY_REQUIRED" });
  await f.engine.reconcile();
  assert.equal(f.engine.works(f.quest.id)[0].state, "READY");
  f.store.put("runs", {
    id: "prior-task-run",
    workId: recovered.id,
    questId: f.quest.id,
    state: "FAILED",
  });
  f.store.put("works", { ...recovered, state: "RECOVERY_REQUIRED" });
  f.facts.delete(recovered.path);
  await assert.rejects(f.engine.workFor(f.quest, task), /missing worktree/);
  assert.equal(attempts, 2, "Do not recreate a worktree after agent work");
});

test("existing Jira cannot replace partial publication", async (t) => {
  const f = await fixture(t);
  await f.plan();
  const task = f.engine.tasks(f.quest.id)[0];
  f.store.put("tasks", { ...task, jira: { key: "DEV-1", complete: false } });
  await assert.rejects(
    f.engine.action("USE_EXISTING_JIRA", {
      questId: f.quest.id,
      key: "QA-123",
      planArtifactId: f.store.latest(f.quest.id, "plan").id,
    }),
    /Published/,
  );
  assert.equal(f.store.get("tasks", task.id).jira.key, "DEV-1");
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
    return tasks.slice(0, 1).map((task) => ({ taskId: task.id, key: `DEV-${calls}` }));
  };
  for (let i = 0; i < 4; i++) await f.publish();
  assert.equal(f.engine.tasks(f.quest.id).filter((task) => task.jira).length, 4);
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
  const task = f.engine.tasks(f.quest.id)[0];
  await f.engine.action("START_TASK", { questId: f.quest.id, taskId: task.id });
  f.adapters.git.test = async () => ({
    passed: false,
    summary: "raw secret output\n# tests 1\n# fail 1",
  });
  await f.finish();
  assert.equal(f.store.get("tasks", task.id).state, "TEST_FAILED");
  assert.ok(!f.store.get("tasks", task.id).validation.summary.includes("raw secret"));
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
  assert.equal(f.store.all("runs").at(-1).pid, null);
  assert.match(f.store.all("runs").at(-1).recoveryReason, /Server restarted.*no run was restarted automatically/);
  assert.equal(restarted.jobs.size, 0);
  assert.ok(f.store.latest(f.quest.id, "summary"));
});
test("runtime progress persists without output or late events reviving stopped runs", async (t) => {
  const f = await fixture(t);
  await f.engine.action("ANALYZE_PRD", { questId: f.quest.id });
  const run = f.store.all("runs").at(-1);
  const { onEvent } = f.pending[0].options;
  onEvent({ type: "process", pid: 123 });
  assert.equal(f.store.get("runs", run.id).runtimeActivity, "PROCESS_STARTED");
  onEvent({ type: "heartbeat", activity: "TOOL_RUNNING" });
  const progress = f.store.get("runs", run.id);
  assert.equal(progress.runtimeActivity, "TOOL_RUNNING");
  assert.ok(progress.lastProgressAt);
  assert.equal(progress.summary, "");
  f.store.put("runs", { ...progress, state: "INTERRUPTED", pid: null });
  onEvent({ type: "process", pid: 456 });
  onEvent({ type: "heartbeat", activity: "RESPONDING" });
  assert.equal(f.store.get("runs", run.id).pid, null);
  assert.equal(f.store.get("runs", run.id).runtimeActivity, "TOOL_RUNNING");
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
  await assert.rejects(f.engine.action("ANALYZE_PRD", { questId: q.id }), /Finish brainstorming/);
  await f.engine.action("START_BRAINSTORM", { questId: q.id });
  await f.finish(
    designResult("brainstorm", "Goal: one publisher. Constraint: retain event schema."),
  );
  await f.engine.action("FINISH_BRAINSTORM", { questId: q.id });
  assert.ok(f.store.latest(q.id, "spec"));
  await f.engine.action("ANALYZE_PRD", { questId: q.id });
  await f.finish(designResult("analysis", "Both repositories consume the event."));
  await f.engine.action("GENERATE_TRD", { questId: q.id });
  await f.finish(designResult("trd", "# TRD\nPreserve event schema and add contract tests."));
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
  assert.equal(f.engine.tasks(f.quest.id).filter((task) => task.state === "COMPLETED").length, 4);
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
    const work = f.engine.works(f.quest.id).find((w) => w.repoId === task.repoId);
    writeFileSync(path.join(work.path, `${task.key}.txt`), `Change ${task.key}\n`);
    await f.finish();
    assert.equal(f.store.get("tasks", task.id).state, "COMPLETED");
  }
  for (const work of f.engine.works(f.quest.id)) {
    await f.engine.action("REVIEW_REPOSITORY", {
      questId: f.quest.id,
      workId: work.id,
    });
    await f.finish("Reviewed aggregate changes and test outcomes. No blocking findings.");
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

test("baseline failures block agent execution without losing the task", async (t) => {
  const f = await fixture(t);
  await f.plan();
  await f.publish();
  f.adapters.git.test = async () => ({
    passed: false,
    summary: "Missing dependencies",
  });
  const task = f.engine.tasks(f.quest.id)[0];
  await assert.rejects(
    f.engine.action("START_TASK", { questId: f.quest.id, taskId: task.id }),
    /Baseline tests failed/,
  );
  assert.equal(f.pending.length, 0);
  assert.equal(f.store.get("tasks", task.id).state, "PUBLISHED");
  const failed = f.engine.works(f.quest.id)[0];
  assert.equal(failed.baselineFailure.summary, "Missing dependencies");
  assert.equal(failed.baselineFailure.changedFiles, false);
  f.adapters.git.test = async () => ({ passed: true, summary: "# tests 1" });
  await f.engine.action("START_TASK", { questId: f.quest.id, taskId: task.id });
  assert.equal(f.pending.length, 1);
  assert.equal(f.engine.works(f.quest.id)[0].baselineFailure, null);
});

test("appendix approval binds to the plan and publishing uses sample checkpoints", async (t) => {
  const f = await fixture(t);
  await f.plan();
  f.adapters.config.workflow = {
    skills: { appendix: "appendix.md", upload: "upload.md" },
  };
  await assert.rejects(f.publish(), /appendix/);
  const plan = f.store.latest(f.quest.id, "plan");
  await assert.rejects(
    f.engine.action("SAVE_APPENDIX", {
      questId: f.quest.id,
      planArtifactId: "old-plan",
      content: "# Tasks",
    }),
    /revision changed/,
  );
  await f.engine.action("SAVE_APPENDIX", {
    questId: f.quest.id,
    planArtifactId: plan.id,
    content: readFileSync(new URL("./fixtures/jira-appendix.md", import.meta.url), "utf8"),
  });
  const appendix = f.store.latest(f.quest.id, "appendix");
  await assert.rejects(f.publish(), /current appendix/);
  const batches = [];
  f.adapters.skill.publish = async (input) => {
    batches.push(input);
    return input.tasks.map((task, index) => ({
      taskId: task.id,
      key: `DEV-${batches.length * 10 + index}`,
    }));
  };
  await f.engine.action("APPROVE_APPENDIX", { questId: f.quest.id, artifactId: appendix.id });
  const publish = () =>
    f.engine.action("PUBLISH_JIRA", {
      questId: f.quest.id,
      appendixArtifactId: appendix.id,
    });
  await publish();
  assert.equal(batches[0].tasks.length, 1);
  assert.equal(batches[0].publicationPhase, "sample");
  assert.equal(batches[0].appendixPath, appendix.file);
  await publish();
  assert.equal(batches[1].tasks.length, 3);
  assert.equal(f.store.get("quests", f.quest.id).state, "TASKS_PUBLISHED");
});

test("office commit generation and team handoff survive notification failure", async (t) => {
  const f = await fixture(t);
  f.adapters.config.googleChat = { webhookEnv: "TEST_WEBHOOK" };
  f.adapters.workflow = {
    instructions: async () => "Office commit skill instructions",
  };
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
  const input = { questId: f.quest.id, workId: work.id };
  await f.engine.action("REVIEW_REPOSITORY", input);
  await f.finish("Reviewed");
  await f.engine.action("APPROVE_REVIEW", input);
  await f.engine.action("GENERATE_COMMIT_MESSAGE", input);
  await f.finish(`fix : improve workflow (${work.branch})`);
  let message;
  f.adapters.git.commit = async (_path, text) => {
    message = text;
  };
  await assert.rejects(
    f.engine.action("CREATE_PR", {
      ...input,
      commitMessage: "feat: wrong office format",
    }),
    /office commit format/,
  );
  await f.engine.action("CREATE_PR", input);
  assert.equal(message, `fix : improve workflow (${work.branch})`);
  let reviewCalls = 0;
  f.adapters.sourceControl.requestReview = async () => {
    reviewCalls++;
  };
  await assert.rejects(f.engine.action("NOTIFY_REVIEW", input), /reviewers first/);
  await f.engine.action("REQUEST_REVIEW", {
    ...input,
    reviewers: ["teammate"],
  });
  assert.equal(reviewCalls, 1);
  const notifications = [];
  f.adapters.chat = {
    send: async (notification) => {
      notifications.push(notification);
      if (notifications.length === 1) throw new Error("Delivery unknown");
      return { name: "spaces/test/messages/one" };
    },
  };
  await assert.rejects(f.engine.action("NOTIFY_REVIEW", input), /Delivery unknown/);
  assert.equal(f.store.get("works", work.id).notifiedAt, undefined);
  await f.engine.action("NOTIFY_REVIEW", input);
  await f.engine.action("NOTIFY_REVIEW", input);
  assert.equal(notifications.length, 2);
  assert.equal(notifications[0].requestId, notifications[1].requestId);
  assert.equal(notifications[0].text, notifications[1].text);
  assert.ok(f.store.get("works", work.id).notifiedAt);
  assert.equal(f.created.length, 1);
  const second = f.engine.works(f.quest.id)[1];
  const secondInput = { questId: f.quest.id, workId: second.id };
  await f.engine.action("REVIEW_REPOSITORY", secondInput);
  await f.finish("Reviewed");
  await f.engine.action("APPROVE_REVIEW", secondInput);
  await f.engine.action("CREATE_PR", secondInput);
  assert.equal(f.store.get("quests", f.quest.id).state, "REVIEW_HANDOFF");
  await f.engine.action("REQUEST_REVIEW", {
    ...secondInput,
    reviewers: ["teammate"],
  });
  await f.engine.action("NOTIFY_REVIEW", secondInput);
  assert.equal(f.store.get("quests", f.quest.id).state, "PRS_CREATED");
});

test("partial weighted Jira tasks preserve every issue and block execution until complete", async (t) => {
  const f = await fixture(t);
  await f.plan();
  const task = f.engine.tasks(f.quest.id)[0];
  f.adapters.skill.publish = async () => [{ taskId: task.id, key: "FFE-1", complete: false }];
  await f.publish();
  assert.equal(f.store.get("tasks", task.id).jira.complete, false);
  await assert.rejects(
    f.engine.action("START_TASK", { questId: f.quest.id, taskId: task.id }),
    /Publish/,
  );
  f.adapters.skill.publish = async () => [{ taskId: task.id, key: "FFE-2", complete: true }];
  await f.publish();
  assert.deepEqual(
    f.store.get("tasks", task.id).jira.issues.map((issue) => issue.key),
    ["FFE-1", "FFE-2"],
  );
  assert.equal(f.store.get("tasks", task.id).jira.complete, true);
});

test("waiting brainstorm can finalize its brief without entering a plan approval loop", async (t) => {
  const f = await fixture(t);
  const q = await f.engine.action("CREATE_QUEST", {
    kind: "TECH",
    title: "Simplify publisher",
    content: "Keep the existing event schema",
    repositoryIds: [f.repos[0].id],
  });
  await f.engine.action("START_BRAINSTORM", { questId: q.id });
  await f.finish(
    designResult("brainstorm", "", ["Should the publisher retain the existing event schema?"]),
    true,
  );
  await f.engine.action("FINISH_BRAINSTORM", { questId: q.id });
  assert.match(f.pending[0].options.prompt, /Keep the existing event schema/);
  assert.match(f.pending[0].options.prompt, /final technical specification/i);
  assert.equal(f.pending[0].options.readOnly, true);
  await f.finish(
    designResult(
      "brainstorm",
      "# Technical specification\nUse one publisher and preserve the event schema.",
    ),
  );
  assert.match(f.store.content(f.store.latest(q.id, "spec")), /preserve the event schema/);
  await f.engine.action("ANALYZE_PRD", { questId: q.id });
  assert.equal(f.pending.length, 1);
});

test("relinking a moved repository preserves Quest identity and repairs failed design sessions", async (t) => {
  const f = await fixture(t);
  const repo = f.repos[0];
  f.store.put("repositories", {
    ...repo,
    remote: "git@github.com:example/project.git",
    error: "Missing folder",
  });
  f.adapters.git.register = async (path) => ({
    path,
    name: "project",
    remote: "https://github.com/example/project.git",
  });
  await f.engine.action("ANALYZE_PRD", { questId: f.quest.id });
  await assert.rejects(
    f.engine.action("UPDATE_REPOSITORY", {
      repositoryId: repo.id,
      path: "/moved/project",
    }),
    /agent process/,
  );
  f.pending.shift().reject(new Error("spawn claude ENOENT"));
  await Promise.all([...f.engine.jobs.values()].map((job) => job.done));
  const run = f.store.all("runs").at(-1);
  await f.engine.action("UPDATE_REPOSITORY", {
    repositoryId: repo.id,
    path: "/moved/project",
  });
  assert.equal(f.store.get("repositories", repo.id).path, "/moved/project");
  assert.equal(f.store.get("repositories", repo.id).error, null);
  assert.equal(f.store.get("runs", run.id).cwd, "/moved/project");
  assert.ok(f.store.get("quests", f.quest.id).repositoryIds.includes(repo.id));
  f.adapters.git.register = async (path) => ({
    path,
    remote: "https://github.com/example/other.git",
  });
  await assert.rejects(
    f.engine.action("UPDATE_REPOSITORY", {
      repositoryId: repo.id,
      path: "/wrong/project",
    }),
    /same Git remote/,
  );
});

import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  writeFile,
  rm,
  symlink,
  realpath,
} from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { preflightAccess } from "../src/access.js";
import { ClaudeCodeRuntime, CodexRuntime } from "../src/adapters.js";
import { fixture } from "./engine-fixture.js";

async function directories(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "devquest scope "));
  t.after(() => rm(root, { recursive: true, force: true }));
  const repos = [];
  for (const name of [
    "personal finance",
    "funding transactions",
    "unrelated",
  ]) {
    const folder = path.join(root, name);
    await mkdir(folder);
    await writeFile(path.join(folder, "go.mod"), "module example.test/probe\n");
    repos.push({ id: name, name, path: folder });
  }
  return { root, repos };
}

test("access preflight checks every selected root, canonicalizes symlinks, and excludes unrelated paths", async (t) => {
  const { root, repos } = await directories(t);
  const alias = path.join(root, "finance alias");
  await symlink(repos[0].path, alias, "dir");
  const scope = {
    cwd: alias,
    readOnly: true,
    repositories: [{ ...repos[0], path: alias }, repos[1]],
  };
  const checked = await preflightAccess(scope);
  assert.equal(checked.cwd, await realpath(repos[0].path));
  assert.deepEqual(checked.additionalDirectories, [
    await realpath(repos[1].path),
  ]);
  assert.ok(
    checked.repositories.every(
      (repo) => repo.status === "PASSED" && repo.readProbe === "go.mod",
    ),
  );
  assert.ok(!JSON.stringify(checked).includes(repos[2].path));
  await assert.rejects(
    preflightAccess({ ...scope, cwd: repos[2].path }),
    /outside its assigned/,
  );
  await assert.rejects(
    preflightAccess({
      cwd: alias,
      readOnly: false,
      repositories: [{ ...repos[0], path: alias }],
      forbiddenWriteDirectories: [await realpath(repos[0].path)],
    }),
    /original repositories are forbidden/,
  );
});

test("one inaccessible repository preserves the actual denial and prevents any runtime spawn", async (t) => {
  const { repos } = await directories(t);
  await assert.rejects(
    preflightAccess(
      { cwd: repos[0].path, readOnly: true, repositories: repos.slice(0, 2) },
      async (folder) => {
        if (folder === (await realpath(repos[1].path)))
          throw Object.assign(
            new Error("permission denied, access funding transactions"),
            {
              code: "EACCES",
            },
          );
      },
    ),
    (error) => {
      assert.match(
        error.message,
        /funding transactions.*EACCES.*permission denied/,
      );
      assert.equal(error.accessPreflight.repositories[0].status, "PASSED");
      assert.equal(error.accessPreflight.repositories[1].status, "FAILED");
      return true;
    },
  );
  let spawned = false;
  const runtime = new ClaudeCodeRuntime({
    runner: async () => {
      spawned = true;
    },
  });
  runtime.detectCapabilities = async () => ({ available: true });
  const events = [];
  await assert.rejects(
    runtime.start({
      cwd: repos[0].path,
      readOnly: true,
      accessScope: {
        cwd: repos[0].path,
        readOnly: true,
        repositories: [
          repos[0],
          { ...repos[1], path: path.join(repos[1].path, "missing") },
        ],
      },
      onEvent: (event) => events.push(event),
    }),
    /funding transactions.*ENOENT/,
  );
  assert.equal(spawned, false);
  assert.equal(events[0].preflight.status, "FAILED");
});

test("Claude initial and resumed runs pass precise directory argv and preserve read-only tools", async (t) => {
  const { repos } = await directories(t);
  const calls = [],
    events = [];
  const runtime = new ClaudeCodeRuntime({
    persistence: true,
    runner: async (_file, args, options) => {
      calls.push({ args, cwd: options.cwd });
      return {
        code: 0,
        stdout:
          JSON.stringify({
            type: "result",
            result: "Read-only probe complete",
          }) + "\n",
        stderr: "",
      };
    },
  });
  runtime.help =
    "--restricted --permission-mode --tools --add-dir --settings --disallowedTools";
  runtime.detectCapabilities = async () => ({
    available: true,
    nativeResume: true,
  });
  const scope = {
    cwd: repos[0].path,
    readOnly: true,
    repositories: repos.slice(0, 2),
  };
  for (const sessionId of [undefined, "prior-session"])
    await runtime.start({
      cwd: scope.cwd,
      readOnly: true,
      accessScope: scope,
      sessionId,
      onEvent: (event) => events.push(event),
    });
  for (const { args } of calls) {
    assert.equal(
      args[args.indexOf("--add-dir") + 1],
      await realpath(repos[1].path),
    );
    assert.equal(args[args.indexOf("--tools") + 1], "Read,Glob,Grep");
    assert.equal(args[args.indexOf("--permission-mode") + 1], "dontAsk");
    assert.ok(args.includes("--restricted"));
    assert.ok(!args.includes(repos[2].path));
    assert.ok(!args.includes("Bash"));
  }
  assert.ok(calls[1].args.includes("prior-session"));
  assert.equal(
    events.filter(
      (event) => event.type === "access" && event.preflight.status === "PASSED",
    ).length,
    2,
  );
  assert.throws(
    () =>
      runtime.buildArgs({
        readOnly: false,
        additionalDirectories: [repos[1].path],
      }),
    /Writable agents/,
  );
  assert.throws(
    () =>
      new CodexRuntime().buildArgs({
        readOnly: true,
        additionalDirectories: [repos[1].path],
      }),
    /not verified.*select Claude/,
  );
});

test("Engine rebuilds design grants on resume, scopes developers to worktrees, and reviewers to integrations", async (t) => {
  const f = await fixture(t, { realGit: true });
  for (const purpose of ["analysis", "plan"]) {
    const run = f.engine.launch(f.quest, {
      purpose,
      runtime: "claude",
      cwd: f.repos[0].path,
      readOnly: true,
    });
    await Promise.resolve();
    const options = f.pending[0].options;
    assert.deepEqual(
      options.accessScope.repositories.map((repo) => repo.id),
      f.quest.repositoryIds,
    );
    assert.equal(options.readOnly, true);
    await f.finish("Read-only design complete");
    if (purpose === "analysis") {
      f.store.put("runs", {
        ...f.store.get("runs", run.id),
        accessScope: { repositories: [{ path: "/unregistered/old-root" }] },
      });
      await f.engine.action("SEND_MESSAGE", {
        runId: run.id,
        message: "Continue analysis",
      });
      assert.deepEqual(
        f.pending[0].options.accessScope.repositories.map((repo) => repo.path),
        f.repos.map((repo) => repo.path),
      );
      await f.finish("Design checkpoint");
    }
  }
  const works = f.repos.map((repo, i) =>
    f.store.put("works", {
      id: `scope-work-${i}`,
      questId: f.quest.id,
      repoId: repo.id,
      path: path.join(f.dir, `integration ${i}`),
    }),
  );
  const taskPath = path.join(f.dir, "task worktree");
  f.store.put("tasks", {
    id: "scope-task",
    questId: f.quest.id,
    repoId: f.repos[0].id,
    state: "RUNNING",
  });
  f.engine.launch(f.quest, {
    purpose: "scope-probe",
    role: "developer",
    taskId: "scope-task",
    workId: works[0].id,
    runtime: "claude",
    cwd: taskPath,
    readOnly: false,
  });
  await Promise.resolve();
  assert.deepEqual(
    f.pending[0].options.accessScope.repositories.map((repo) => repo.path),
    [taskPath],
  );
  // Do not finish a synthetic task through implementation handling.
  f.pending.shift().reject(new Error("Test probe stopped"));
  await Promise.all([...f.engine.jobs.values()].map((job) => job.done));
  const quest = { ...f.quest, workflowVersion: 2 };
  f.engine.launch(quest, {
    purpose: "scope-probe",
    role: "reviewer",
    workId: works[0].id,
    runtime: "claude",
    cwd: works[0].path,
    readOnly: true,
  });
  await Promise.resolve();
  assert.equal(f.pending[0].options.readOnly, true);
  assert.deepEqual(
    f.pending[0].options.accessScope.repositories.map((repo) => repo.path),
    works.map((work) => work.path),
  );
  await f.finish("Read-only integration review");
});

test("runtime tool permission denials cannot become successful fabricated analysis", async (t) => {
  const { repos } = await directories(t);
  const denied = path.join(repos[1].path, "go.mod");
  const runtime = new ClaudeCodeRuntime({
    runner: async () => ({
      code: 0,
      stderr: "",
      stdout:
        [
          {
            type: "assistant",
            message: {
              content: [
                {
                  type: "tool_use",
                  id: "read-denied",
                  name: "Read",
                  input: { file_path: denied },
                },
              ],
            },
          },
          {
            type: "user",
            message: {
              content: [
                {
                  type: "tool_result",
                  tool_use_id: "read-denied",
                  is_error: true,
                  content:
                    "Permission denied: --restricted confines the file tools to the working directory",
                },
              ],
            },
          },
          { type: "result", result: "Both repositories analyzed successfully" },
        ]
          .map((event) => JSON.stringify(event))
          .join("\n") + "\n",
    }),
  });
  runtime.help = "--restricted --permission-mode --add-dir";
  runtime.detectCapabilities = async () => ({ available: true });
  const events = [];
  await assert.rejects(
    runtime.start({
      cwd: repos[0].path,
      readOnly: true,
      accessScope: {
        cwd: repos[0].path,
        readOnly: true,
        repositories: repos.slice(0, 2),
      },
      onEvent: (event) => events.push(event),
    }),
    /funding transactions.*Permission denied/,
  );
  const denial = events.filter((event) => event.type === "access").at(-1);
  assert.equal(denial.preflight.status, "FAILED");
  assert.match(denial.preflight.runtimeDenial, /restricted confines/);
});

test("preflight checks sibling roots individually and never probes their parent", async (t) => {
  const { root, repos } = await directories(t);
  const visited = [];
  const checked = await preflightAccess(
    { cwd: repos[0].path, readOnly: true, repositories: repos.slice(0, 2) },
    async (folder) => {
      visited.push(folder);
      assert.notEqual(folder, await realpath(root));
    },
  );
  assert.deepEqual(
    visited,
    await Promise.all(repos.slice(0, 2).map((repo) => realpath(repo.path))),
  );
  assert.equal(checked.runtimeToolRead, "NOT_VERIFIED");
});

test("restricted Claude reads both selected siblings, rejects parent and unselected sibling, and records operation evidence", async (t) => {
  const { root, repos } = await directories(t);
  const events = [],
    calls = [];
  let deniedTarget;
  const runtime = new ClaudeCodeRuntime({
    runner: async (_file, args, options) => {
      calls.push({ args, cwd: options.cwd, input: options.input });
      const stream = [];
      const tool = (id, name, input, content, is_error = false) =>
        stream.push(
          {
            type: "assistant",
            message: { content: [{ type: "tool_use", id, name, input }] },
          },
          {
            type: "user",
            message: {
              content: [
                { type: "tool_result", tool_use_id: id, content, is_error },
              ],
            },
          },
        );
      if (deniedTarget)
        tool(
          "denied",
          "Glob",
          { path: deniedTarget, pattern: "*" },
          `${deniedTarget} is outside the selected roots; --restricted confines the file tools to the working directory.`,
          true,
        );
      else
        for (const [i, repo] of repos.slice(0, 2).entries())
          tool(
            `read-${i}`,
            "Read",
            { file_path: path.join(repo.path, "go.mod") },
            "module example.test/probe",
          );
      stream.push({ type: "result", result: "Read-only design result" });
      return {
        code: 0,
        stderr: "",
        stdout: stream.map((event) => JSON.stringify(event)).join("\n") + "\n",
      };
    },
  });
  runtime.help = "--restricted --permission-mode --add-dir";
  runtime.detectCapabilities = async () => ({
    available: true,
    nativeResume: true,
  });
  const input = {
    cwd: repos[0].path,
    readOnly: true,
    accessScope: {
      cwd: repos[0].path,
      readOnly: true,
      repositories: repos.slice(0, 2),
    },
    onEvent: (event) => events.push(event),
  };
  await runtime.start(input);
  assert.equal(
    events.filter((event) => event.type === "access").at(-1).preflight
      .runtimeToolRead,
    "VERIFIED",
  );
  assert.match(calls[0].input, /Glob with path set to that exact gitRoot/);
  assert.match(
    calls[0].input,
    /Never discover repositories by listing\/globbing their common parent/,
  );
  assert.deepEqual(
    events[0].preflight.permittedDirectories,
    await Promise.all(repos.slice(0, 2).map((repo) => realpath(repo.path))),
  );
  for (const [target, category] of [
    [root, "DISALLOWED_PARENT_TRAVERSAL"],
    [repos[2].path, "AGENT_UNAUTHORIZED_OPERATION"],
    [repos[1].path, "RUNTIME_SANDBOX_DENIAL"],
  ]) {
    deniedTarget = target;
    await assert.rejects(
      runtime.start({ ...input, sessionId: "same-stage-session" }),
      (error) => {
        assert.equal(error.accessFailure.category, category);
        assert.equal(error.accessFailure.operation, "Glob");
        assert.equal(error.accessFailure.target, target);
        assert.match(error.accessFailure.detail, /restricted confines/);
        return true;
      },
    );
  }
  for (const call of calls) {
    assert.equal(call.cwd, await realpath(repos[0].path));
    assert.ok(call.args.includes("--restricted"));
    assert.deepEqual(
      call.args.slice(
        call.args.indexOf("--add-dir") + 1,
        call.args.indexOf("--add-dir") + 2,
      ),
      [await realpath(repos[1].path)],
    );
    assert.equal(call.args[call.args.indexOf("--tools") + 1], "Read,Glob,Grep");
    assert.ok(!call.args.includes(root) && !call.args.includes(repos[2].path));
  }
});

test("missing CLI grants stop before spawn, while agent prose cannot fabricate a tool denial", async (t) => {
  const { repos } = await directories(t);
  let spawned = 0;
  const runtime = new ClaudeCodeRuntime({
    runner: async () => {
      spawned++;
      return {
        code: 0,
        stderr: "",
        stdout:
          JSON.stringify({
            type: "result",
            result: "I think permission denied at the parent",
          }) + "\n",
      };
    },
  });
  runtime.help = "--restricted --permission-mode --add-dir";
  runtime.detectCapabilities = async () => ({ available: true });
  const build = runtime.buildArgs.bind(runtime);
  runtime.buildArgs = (options) =>
    build({ ...options, additionalDirectories: [] });
  const events = [];
  const input = {
    cwd: repos[0].path,
    readOnly: true,
    accessScope: {
      cwd: repos[0].path,
      readOnly: true,
      repositories: repos.slice(0, 2),
    },
    onEvent: (event) => events.push(event),
  };
  await assert.rejects(runtime.start(input), /Missing repository grant/);
  assert.equal(spawned, 0);
  assert.equal(events.at(-1).preflight.category, "MISSING_REPOSITORY_GRANT");
  runtime.buildArgs = build;
  await runtime.start(input);
  assert.equal(spawned, 1);
  assert.equal(
    events.filter((event) => event.type === "access").at(-1).preflight.status,
    "PASSED",
  );
  assert.equal(
    events.filter((event) => event.type === "access").at(-1).preflight
      .runtimeToolRead,
    "NOT_VERIFIED",
  );
});

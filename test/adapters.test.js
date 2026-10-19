import { jiraEvidence } from "./jira-fixture.js";
import { readyPublisherInput } from "./publisher-input.js";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile, readFile, realpath, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";

import {
  ClaudeCodeRuntime,
  CodexRuntime,
  ConfluenceAdapter,
  GitHubProvider,
  GoogleChatWebhook,
  SkillRunner,
  createAdapters,
  runProcess,
} from "../src/adapters.js";

const execute = promisify(execFile);

async function git(cwd, ...args) {
  return execute("git", args, { cwd });
}

async function repositoryFixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), "devquest-adapters-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await git(directory, "init", "-b", "development");
  await git(directory, "config", "user.email", "devquest@example.test");
  await git(directory, "config", "user.name", "DevQuest Test");
  await git(directory, "remote", "add", "origin", "https://example.test/acme/repo.git");
  await writeFile(path.join(directory, "README.md"), "base\n");
  await git(directory, "add", "README.md");
  await git(directory, "commit", "-m", "base");
  return directory;
}

test("adapter bundle exposes its trusted configuration for engine status", async () => {
  const config = {
    jiraSkill: { executable: "bridge" },
    confluence: { host: "https://docs.example.test" },
  };
  const resolved = (await createAdapters(config)).config;
  assert.equal(resolved.jiraSkill, config.jiraSkill);
  assert.equal(resolved.confluence, config.confluence);
});

test("missing base branch reports a recoverable setup error without creating work", async (t) => {
  const repo = await repositoryFixture(t);
  const worktree = path.join(path.dirname(repo), `${path.basename(repo)}-missing-base`);
  t.after(() => rm(worktree, { recursive: true, force: true }));
  const { git: adapter } = await createAdapters();
  await adapter.register(repo);
  await assert.rejects(
    adapter.prepare({
      repoPath: repo,
      path: worktree,
      branch: "devquest/missing-base",
      baseBranch: "unavailable",
    }),
    /Base branch unavailable is unavailable/,
  );
  await adapter.prepare({
    repoPath: repo,
    path: worktree,
    branch: "devquest/missing-base",
  });
  await adapter.reconcile({
    repoPath: repo,
    path: worktree,
    branch: "devquest/missing-base",
  });
});

test("v1.1 Claude args enforce explicit models, Auto capability and no nested or shell tools", () => {
  const runtime = new ClaudeCodeRuntime();
  runtime.help = "--permission-mode --restricted --disallowedTools --settings --model --effort";
  runtime.capabilities = { autoMode: true };
  const route = { resolvedModel: "claude-opus-5-5", resolvedEffort: "high" };
  const args = runtime.buildArgs({
    readOnly: false,
    route,
    executionPolicy: {},
  });
  assert.equal(args[args.indexOf("--model") + 1], "claude-opus-5-5");
  assert.equal(args[args.indexOf("--effort") + 1], "high");
  assert.equal(args[args.indexOf("--permission-mode") + 1], "auto");
  assert.ok(args.includes("--restricted"));
  const settings = JSON.parse(args[args.indexOf("--settings") + 1]);
  assert.deepEqual(settings.availableModels, ["claude-opus-5-5"]);
  assert.ok(settings.permissions.deny.includes("Agent"));
  assert.match(args[args.indexOf("--disallowedTools") + 1], /Agent.*Bash/);
  assert.doesNotMatch(args.join(" "), /dangerously|bypassPermissions/);
  runtime.capabilities.autoMode = false;
  assert.throws(
    () => runtime.buildArgs({ route, readOnly: false, executionPolicy: {} }),
    /Auto Mode unavailable/,
  );
  const fallback = runtime.buildArgs({
    route,
    readOnly: false,
    executionPolicy: { safeFallback: "acceptEdits" },
  });
  assert.equal(fallback[fallback.indexOf("--permission-mode") + 1], "acceptEdits");
  assert.throws(
    () =>
      runtime.buildArgs({
        route: { ...route, resolvedModel: "fable-5" },
        executionPolicy: {},
      }),
    /Fable/,
  );
  const readonly = runtime.buildArgs({
    route,
    readOnly: true,
    executionPolicy: {},
  });
  assert.equal(readonly[readonly.indexOf("--permission-mode") + 1], "dontAsk");
  assert.equal(readonly[readonly.indexOf("--tools") + 1], "Read,Glob,Grep");
});

test("publication rejects protected/unowned branches and pins the reviewed push SHA", async () => {
  const calls = [];
  let pushed = false;
  const commit = "b".repeat(40);
  const provider = new GitHubProvider({
    runner: async (file, args) => {
      calls.push([file, args]);
      if (file === "git" && args[0] === "rev-parse") return { code: 0, stdout: commit, stderr: "" };
      if (file === "git" && args[0] === "push") {
        pushed = true;
        return { code: 0, stdout: "", stderr: "" };
      }
      if (file === "gh" && args[1] === "list")
        return {
          code: 0,
          stdout: JSON.stringify(
            pushed
              ? [
                  {
                    url: "https://github.com/test/repo/pull/1",
                    number: 1,
                    headRefOid: commit,
                  },
                ]
              : [],
          ),
          stderr: "",
        };
      return { code: 0, stdout: "", stderr: "" };
    },
  });
  for (const branch of ["main", "master", "feature/unowned", "task/no-owner"])
    await assert.rejects(
      provider.create({ path: process.cwd(), branch, baseBranch: "main" }),
      /Push refused|ownership/,
    );
  assert.equal(calls.length, 0);
  const branch = "quest/q-r";
  await provider.create({
    path: process.cwd(),
    branch,
    baseBranch: "main",
    title: "Reviewed",
    body: "Validated",
    ownership: { path: process.cwd(), branch },
    expectedHead: commit,
    protectedBranches: ["main", "master"],
  });
  assert.ok(
    calls.some(
      ([file, args]) =>
        file === "git" && args[0] === "push" && args.includes(`${commit}:refs/heads/${branch}`),
    ),
  );
});

test("runtime-reported forbidden models cannot be accepted as successful turns", async () => {
  const runtime = new ClaudeCodeRuntime({
    runner: async () => ({
      code: 0,
      stdout:
        JSON.stringify({ type: "system", model: "claude-fable-5" }) +
        "\n" +
        JSON.stringify({ type: "result", result: "Done" }),
      stderr: "",
    }),
  });
  runtime.capabilities = {
    available: true,
    modelSelection: true,
    effortSelection: true,
  };
  runtime.help = "--permission-mode";
  await assert.rejects(
    runtime.start({
      cwd: process.cwd(),
      prompt: "Read",
      readOnly: true,
      route: { resolvedModel: "claude-opus-5-5", resolvedEffort: "high" },
    }),
    /Fable|unexpected model/,
  );
});

test("git adapter registers only repository roots and reconciles its own worktrees", async (t) => {
  const repo = await repositoryFixture(t);
  const nested = path.join(repo, "nested");
  const worktree = path.join(path.dirname(repo), `${path.basename(repo)}-worktree`);
  await mkdir(nested);
  t.after(() => rm(worktree, { recursive: true, force: true }));

  const { git: adapter } = await createAdapters();
  await assert.rejects(adapter.register(nested), /repository root/i);
  assert.deepEqual(await adapter.register(repo), {
    path: await import("node:fs/promises").then(({ realpath }) => realpath(repo)),
    name: path.basename(repo),
    remote: "https://example.test/acme/repo.git",
  });

  const prepared = await adapter.prepare({
    repoPath: repo,
    path: worktree,
    branch: "devquest/quest-1",
  });
  assert.match(prepared.head, /^[0-9a-f]{40}$/);
  await adapter.reconcile({
    repoPath: repo,
    path: worktree,
    branch: "devquest/quest-1",
  });
  await assert.rejects(
    adapter.reconcile({ repoPath: repo, path: worktree, branch: "wrong" }),
    /branch/i,
  );
  await assert.rejects(
    adapter.prepare({
      repoPath: repo,
      path: path.join(path.dirname(repo), "other"),
      branch: "devquest/quest-1",
    }),
    /already exists/i,
  );
});

test("git inspection fingerprints untracked content and fixed test profiles reject commands", async (t) => {
  const repo = await repositoryFixture(t);
  const { git: adapter } = await createAdapters();
  await adapter.register(repo);

  const clean = await adapter.inspect(repo);
  await writeFile(path.join(repo, "new.txt"), "one\n");
  const first = await adapter.inspect(repo);
  await writeFile(path.join(repo, "new.txt"), "two\n");
  const second = await adapter.inspect(repo);

  assert.equal(clean.dirty, false);
  assert.equal(first.dirty, true);
  assert.notEqual(first.fingerprint, second.fingerprint);
  assert.match(second.diff, /new\.txt/);
  await assert.rejects(adapter.test(repo, "node --test"), /profile/i);
});

test("git inspection fingerprint includes staged bytes independently of working-tree bytes", async (t) => {
  const repo = await repositoryFixture(t);
  const { git: adapter } = await createAdapters();
  await adapter.register(repo);
  const file = path.join(repo, "README.md");

  await writeFile(file, "staged one\n");
  await git(repo, "add", "README.md");
  await writeFile(file, "same working copy\n");
  const first = await adapter.inspect(repo);

  await writeFile(file, "staged two\n");
  await git(repo, "add", "README.md");
  await writeFile(file, "same working copy\n");
  const second = await adapter.inspect(repo);

  assert.notEqual(first.fingerprint, second.fingerprint);
});

test("git commit is idempotent when an explicit PR retry has no new changes", async (t) => {
  const repo = await repositoryFixture(t);
  const { git: adapter } = await createAdapters();
  await adapter.register(repo);
  await writeFile(path.join(repo, "change.txt"), "change\n");

  const first = await adapter.commit(repo, "test: change");
  const retry = await adapter.commit(repo, "test: change");

  assert.equal(retry.head, first.head);
});

test("content fingerprint remains stable when reviewed files are committed unchanged", async (t) => {
  const repo = await repositoryFixture(t);
  const { git: adapter } = await createAdapters();
  await adapter.register(repo);
  await writeFile(path.join(repo, "change.txt"), "reviewed content\n");
  await rm(path.join(repo, "README.md"));

  const reviewed = await adapter.inspect(repo);
  await adapter.commit(repo, "test: reviewed content");
  const committed = await adapter.inspect(repo);

  assert.notEqual(committed.fingerprint, reviewed.fingerprint);
  assert.match(reviewed.contentFingerprint, /^[0-9a-f]{64}$/);
  assert.equal(committed.contentFingerprint, reviewed.contentFingerprint);
});

test("fixed test profiles report process failures as failed summaries", async () => {
  const runner = async () => {
    throw new Error("test process timed out");
  };
  const { git: adapter } = await createAdapters({ runner });
  assert.deepEqual(await adapter.test(process.cwd(), "node-test"), {
    passed: false,
    summary: "test process timed out",
  });
});

test(
  "npm test profile invokes npm through Node on Windows without a shell",
  { skip: process.platform !== "win32" },
  async () => {
    const calls = [];
    const runner = async (file, args) => {
      calls.push({ file, args });
      return { code: 0, stdout: "ok", stderr: "" };
    };
    const { git: adapter } = await createAdapters({ runner });
    assert.equal((await adapter.test(process.cwd(), "npm-test")).passed, true);
    assert.equal(calls[0].file, process.execPath);
    assert.match(calls[0].args[0], /node_modules[\\/]npm[\\/]bin[\\/]npm-cli\.js$/);
    assert.equal(calls[0].args[1], "test");
  },
);

test("Codex runtime verifies flags, streams events, disables persistence, and returns bounded artifacts", async () => {
  const calls = [];
  const runner = async (file, args, options = {}) => {
    calls.push({ file, args, options });
    if (args.includes("--help"))
      return {
        code: 0,
        stdout: "--json --ephemeral --sandbox resume",
        stderr: "",
      };
    if (args.includes("--version")) return { code: 0, stdout: "codex 1.0", stderr: "" };
    options.onStdout?.('{"type":"thread.started","thread_id":"native-1"}\n');
    options.onStdout?.(
      `${JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "finished" } })}\n`,
    );
    return { code: 0, stdout: "", stderr: "" };
  };
  const runtime = new CodexRuntime({ runner });
  assert.deepEqual(await runtime.detectCapabilities(), {
    available: true,
    interactive: true,
    nativeResume: false,
    streaming: true,
    version: "codex 1.0",
    modelSelection: false,
    effortSelection: false,
    autoMode: false,
    nestedRestriction: false,
  });
  assert.ok(calls.some(({ args }) => args.join(" ") === "exec --help"));

  const events = [];
  const result = await runtime.start({
    cwd: process.cwd(),
    prompt: "review this",
    readOnly: true,
    sessionId: "ignored-without-persistence",
    onEvent: (event) => events.push(event),
  });
  const invocation = calls.at(-1);
  assert.equal(invocation.file, "codex");
  assert.ok(invocation.args.includes("--ephemeral"));
  assert.ok(invocation.args.includes("read-only"));
  assert.ok(!invocation.args.includes("ignored-without-persistence"));
  assert.ok(invocation.options.input.startsWith("review this"));
  assert.equal(result.text, "finished");
  assert.equal(result.summary, "finished");
  assert.equal(result.sessionId, undefined);
  assert.equal(result.waitingInput, false);
  assert.ok(events.some(({ type, text }) => type === "output" && text.includes("finished")));
});

test("Claude runtime uses native resume only when persistence is configured", async () => {
  const calls = [];
  const runner = async (_file, args, options = {}) => {
    calls.push({ args, options });
    if (args.includes("--help"))
      return {
        code: 0,
        stdout:
          "--print --output-format --verbose --no-session-persistence --permission-mode --allowedTools --resume --tools --strict-mcp-config --mcp-config",
        stderr: "",
      };
    if (args.includes("--version")) return { code: 0, stdout: "claude 1.0", stderr: "" };
    options.onStdout?.(
      `${JSON.stringify({ type: "result", result: "continued", session_id: "session-2" })}\n`,
    );
    return { code: 0, stdout: "", stderr: "" };
  };
  const runtime = new ClaudeCodeRuntime({ runner, persistence: true });
  assert.equal((await runtime.detectCapabilities()).nativeResume, true);

  const result = await runtime.resume({
    cwd: process.cwd(),
    prompt: "continue",
    sessionId: "session-1",
    readOnly: true,
  });
  assert.ok(calls.at(-1).args.includes("--resume"));
  assert.ok(calls.at(-1).args.includes("session-1"));
  assert.ok(!calls.at(-1).args.includes("--no-session-persistence"));
  assert.ok(!calls.at(-1).args.includes("plan"));
  assert.ok(calls.at(-1).args.includes("dontAsk"));
  const args = calls.at(-1).args;
  assert.equal(args[args.indexOf("--allowedTools") + 1], "Read,Glob,Grep");
  assert.equal(args[args.indexOf("--tools") + 1], "Read,Glob,Grep");
  assert.equal(result.text, "continued");
  assert.equal(result.sessionId, "session-2");
});

test("runtime final artifacts never exceed their public size bounds", async () => {
  const runner = async (_file, args, options = {}) => {
    if (args.includes("--help"))
      return { code: 0, stdout: "--json --ephemeral --sandbox", stderr: "" };
    if (args.includes("--version")) return { code: 0, stdout: "codex 1.0", stderr: "" };
    options.onStdout?.(
      `${JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "x".repeat(101_000) } })}\n`,
    );
    return { code: 0, stdout: "", stderr: "" };
  };
  const result = await new CodexRuntime({ runner }).start({
    cwd: process.cwd(),
    prompt: "large",
  });
  assert.ok(result.text.length <= 100_000);
  assert.ok(result.summary.length <= 4_000);
});

test("process runner tolerates a child closing stdin early", async () => {
  const result = await runProcess(process.execPath, ["-e", "process.stdin.destroy()"], {
    input: "x".repeat(5_000_000),
  });
  assert.equal(result.code, 0);
});

test("Codex recognizes resume when help advertises it as an exec subcommand", async () => {
  const calls = [];
  const runner = async (_file, args, options = {}) => {
    calls.push(args);
    if (args.includes("--version")) return { code: 0, stdout: "codex 1.0", stderr: "" };
    if (args.join(" ") === "exec --help")
      return {
        code: 0,
        stdout: "--json --sandbox\nCommands:\n  resume  Resume a session",
        stderr: "",
      };
    if (args.join(" ") === "exec resume --help")
      return { code: 0, stdout: "--json --config", stderr: "" };
    options.onStdout?.(
      `${JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "resumed" } })}\n`,
    );
    return { code: 0, stdout: "", stderr: "" };
  };
  const runtime = new CodexRuntime({ runner, persistence: true });
  assert.equal((await runtime.detectCapabilities()).nativeResume, true);
  await runtime.resume({
    cwd: process.cwd(),
    prompt: "continue",
    sessionId: "session-1",
    readOnly: true,
  });
  assert.ok(calls.some((args) => args.join(" ") === "exec resume --help"));
  assert.deepEqual(calls.at(-1), [
    "exec",
    "resume",
    "--json",
    "--config",
    'sandbox_mode="read-only"',
    "session-1",
    "-",
  ]);
});

test("runtime error events fail turns even when the CLI exits zero", async () => {
  const codexRunner = async (_file, args, options = {}) => {
    if (args.includes("--version")) return { code: 0, stdout: "codex 1.0", stderr: "" };
    if (args.includes("--help"))
      return { code: 0, stdout: "--json --sandbox --ephemeral", stderr: "" };
    options.onStdout?.(
      `${JSON.stringify({ type: "turn.failed", error: { message: "codex boom" } })}\n`,
    );
    return { code: 0, stdout: "", stderr: "" };
  };
  const claudeRunner = async (_file, args, options = {}) => {
    if (args.includes("--version")) return { code: 0, stdout: "claude 1.0", stderr: "" };
    if (args.includes("--help"))
      return {
        code: 0,
        stdout:
          "--print --output-format --no-session-persistence --permission-mode --allowedTools --tools --strict-mcp-config --mcp-config",
        stderr: "",
      };
    options.onStdout?.(
      `${JSON.stringify({ type: "result", is_error: true, result: "claude boom" })}\n`,
    );
    return { code: 0, stdout: "", stderr: "" };
  };
  await assert.rejects(
    new CodexRuntime({ runner: codexRunner }).start({
      cwd: process.cwd(),
      prompt: "go",
    }),
    /codex boom/,
  );
  await assert.rejects(
    new ClaudeCodeRuntime({ runner: claudeRunner }).start({
      cwd: process.cwd(),
      prompt: "go",
    }),
    /claude boom/,
  );
});

test("Jira skill bridge receives stable idempotency keys and preserves partial results", async () => {
  const payloads = [];
  const runner = async (_file, _args, options) => {
    payloads.push(JSON.parse(options.input));
    return {
      code: 1,
      stdout: JSON.stringify({
        results: [null, { taskId: "task-a", key: "APP-1", url: "https://jira.example/APP-1" }],
      }),
      stderr: "one task failed",
    };
  };
  const skill = new SkillRunner({
    bridge: { executable: "jira-bridge", args: ["publish"] },
    runner,
  });
  const input = {
    quest: { id: "quest-1", title: "Quest" },
    tasks: [
      { id: "task-a", title: "A" },
      { id: "task-b", title: "B" },
    ],
    planPath: "C:\\plans\\plan.md",
  };
  assert.deepEqual(await skill.publish(input), [
    { taskId: "task-a", key: "APP-1", url: "https://jira.example/APP-1" },
  ]);
  await skill.publish(input);
  assert.deepEqual(
    payloads[0].tasks.map(({ taskId, idempotencyKey }) => [taskId, idempotencyKey]),
    [
      ["task-a", "devquest:quest-1:task-a"],
      ["task-b", "devquest:quest-1:task-b"],
    ],
  );
  assert.deepEqual(payloads[0].tasks, payloads[1].tasks);
  await assert.rejects(new SkillRunner().publish(input), /Publisher input contract/i);
});

test("Confluence fetch imports the main page and direct same-host pages only", async () => {
  const requested = [];
  const pages = new Map([
    [
      "1",
      {
        id: "1",
        title: "Main",
        version: { number: 3 },
        body: {
          storage: {
            value:
              '<p>Main</p><a href="/wiki/spaces/X/pages/2/Child">Child</a><a href="https://outside.test/wiki/spaces/X/pages/9">Outside</a><a href="/wiki/spaces/X/pages/3/Missing">Missing</a>',
          },
        },
      },
    ],
    [
      "2",
      {
        id: "2",
        title: "Child",
        version: { number: 4 },
        body: {
          storage: {
            value: '<p>Child</p><a href="/wiki/spaces/X/pages/4/Grandchild">Do not follow</a>',
          },
        },
      },
    ],
  ]);
  const fetch = async (url) => {
    requested.push(String(url));
    const id = /\/pages\/(\d+)/.exec(String(url))?.[1];
    return pages.has(id)
      ? new Response(JSON.stringify(pages.get(id)), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      : new Response("missing", { status: 404 });
  };
  const adapter = new ConfluenceAdapter({
    host: "https://docs.example.test",
    fetch,
  });
  const result = await adapter.fetch("https://docs.example.test/wiki/spaces/X/pages/1/Main");

  assert.deepEqual(
    result.sources.map(({ id, version }) => [id, version]),
    [
      ["1", 3],
      ["2", 4],
    ],
  );
  assert.match(result.content, /Main/);
  assert.match(result.content, /Child/);
  assert.equal(result.warnings.length, 1);
  assert.equal(requested.length, 3);
  assert.ok(requested.every((url) => new URL(url).host === "docs.example.test"));
  await assert.rejects(
    adapter.fetch("https://outside.test/wiki/spaces/X/pages/1/Main"),
    /configured Confluence host/i,
  );
});

test("Confluence fetch enforces its timeout even when an injected fetch ignores abort", async () => {
  const fetch = () => new Promise((resolve) => setTimeout(() => resolve(new Response("{}")), 50));
  const adapter = new ConfluenceAdapter({
    host: "https://docs.example.test",
    fetch,
    timeoutMs: 5,
  });
  await assert.rejects(
    adapter.fetch("https://docs.example.test/wiki/spaces/X/pages/1/Main"),
    /timed out/i,
  );
});

test("Confluence page cap counts failed attempts and warns about omitted direct links", async () => {
  const requested = [];
  const main = {
    id: "1",
    title: "Main",
    version: { number: 1 },
    body: {
      storage: {
        value:
          '<a href="/wiki/spaces/X/pages/2/A">A</a><a href="/wiki/spaces/X/pages/3/B">B</a><a href="/wiki/spaces/X/pages/4/C">C</a>',
      },
    },
  };
  const fetch = async (url) => {
    requested.push(String(url));
    return /\/pages\/1(?:\?|$)/.test(String(url))
      ? new Response(JSON.stringify(main))
      : new Response("missing", { status: 404 });
  };
  const result = await new ConfluenceAdapter({
    host: "https://docs.example.test",
    fetch,
    maxPages: 2,
  }).fetch("https://docs.example.test/wiki/spaces/X/pages/1/Main");
  assert.equal(requested.length, 2);
  assert.ok(result.warnings.some((warning) => /omitted 2/i.test(warning)));
});

test("Confluence resolves direct storage page references by exact title without recursion", async () => {
  const requested = [];
  const main = {
    id: "1",
    title: "Main",
    version: { number: 1 },
    body: {
      storage: {
        value: '<ac:link><ri:page ri:content-title="Child &amp; Notes" /></ac:link>',
      },
    },
  };
  const child = {
    id: "2",
    title: "Child & Notes",
    version: { number: 2 },
    body: {
      storage: {
        value: '<ri:page ri:content-title="Grandchild" />',
      },
    },
  };
  const fetch = async (url) => {
    const parsed = new URL(url);
    requested.push(parsed);
    if (/\/pages\/1$/.test(parsed.pathname)) return new Response(JSON.stringify(main));
    if (
      parsed.pathname.endsWith("/pages") &&
      parsed.searchParams.get("title") === "Child & Notes"
    ) {
      return new Response(JSON.stringify({ results: [child] }));
    }
    return new Response("unexpected", { status: 500 });
  };
  const result = await new ConfluenceAdapter({
    host: "https://docs.example.test",
    fetch,
  }).fetch("https://docs.example.test/wiki/spaces/X/pages/1/Main");
  assert.deepEqual(
    result.sources.map(({ id }) => id),
    ["1", "2"],
  );
  assert.equal(requested.length, 2);
});

test("GitHub provider reuses a matching PR only after verifying its head", async () => {
  const calls = [];
  const runner = async (file, args) => {
    calls.push([file, args]);
    return {
      code: 0,
      stdout:
        file === "git"
          ? "abc"
          : JSON.stringify([
              {
                number: 7,
                url: "https://github.test/acme/repo/pull/7",
                headRefOid: "abc",
              },
            ]),
      stderr: "",
    };
  };
  const provider = new GitHubProvider({ runner });
  assert.deepEqual(
    await provider.create({
      repoPath: "C:\\repo",
      path: "C:\\repo-worktree",
      branch: "devquest/one",
      title: "One",
      body: "Body",
    }),
    { url: "https://github.test/acme/repo/pull/7", number: 7 },
  );
  assert.equal(calls.length, 2);
  assert.equal(calls[0][0], "gh");
  assert.equal(
    calls.some(([file, args]) => file === "git" && args[0] === "push"),
    false,
  );
});

test("node validation refuses an empty test suite", async (t) => {
  const repo = await repositoryFixture(t);
  const { git: adapter } = await createAdapters();
  const result = await adapter.test(repo, "node-test");
  assert.equal(result.passed, false, result.summary);
});

test("runtime marks an explicit human question as waiting for input", async () => {
  const runner = async (_file, args, options = {}) => {
    if (args.includes("--version")) return { code: 0, stdout: "codex 1", stderr: "" };
    if (args.includes("--help"))
      return { code: 0, stdout: "--json --sandbox --ephemeral", stderr: "" };
    options.onStdout(
      JSON.stringify({
        type: "item.completed",
        item: {
          type: "agent_message",
          text: "DEVQUEST_WAITING_INPUT\nWhich API version should remain compatible?",
        },
      }) + "\n",
    );
    return { code: 0, stdout: "", stderr: "" };
  };
  assert.equal(
    (
      await new CodexRuntime({ runner }).start({
        cwd: process.cwd(),
        prompt: "implement",
      })
    ).waitingInput,
    true,
  );
});

test("missing native session falls back once to logical continuation", async () => {
  let attempts = 0;
  const runner = async (_file, args, options = {}) => {
    if (args.includes("--version")) return { code: 0, stdout: "codex 1", stderr: "" };
    if (args.join(" ") === "exec --help")
      return { code: 0, stdout: "--json --sandbox resume", stderr: "" };
    if (args.includes("--help")) return { code: 0, stdout: "--json --config", stderr: "" };
    attempts++;
    if (args.includes("resume")) return { code: 1, stdout: "", stderr: "Session not found" };
    options.onStdout(
      JSON.stringify({
        type: "item.completed",
        item: { type: "agent_message", text: "Logically continued" },
      }) + "\n",
    );
    return { code: 0, stdout: "", stderr: "" };
  };
  const result = await new CodexRuntime({ runner, persistence: true }).start({
    cwd: process.cwd(),
    prompt: "continue from checkpoint",
    sessionId: "missing",
  });
  assert.equal(attempts, 2);
  assert.equal(result.text, "Logically continued");
});

test("review fingerprint changes when development advances", async (t) => {
  const repo = await repositoryFixture(t);
  const work = path.join(repo, "../" + path.basename(repo) + "-review");
  t.after(() => rm(work, { recursive: true, force: true }));
  const { git: adapter } = await createAdapters();
  await adapter.register(repo);
  await adapter.prepare({ repoPath: repo, path: work, branch: "audit/review" });
  const before = await adapter.inspect(work);
  await writeFile(path.join(repo, "README.md"), "upstream change\n");
  await git(repo, "add", ".");
  await git(repo, "commit", "-m", "advance base");
  const after = await adapter.inspect(work);
  assert.notEqual(before.diff, after.diff);
  assert.notEqual(before.fingerprint, after.fingerprint);
  assert.equal(before.contentFingerprint, after.contentFingerprint);
});

test("review diff includes files in new directories", async (t) => {
  const repo = await repositoryFixture(t);
  await mkdir(path.join(repo, "new-module"));
  await writeFile(path.join(repo, "new-module", "index.js"), "export const answer = 42;\n");
  const { git: adapter } = await createAdapters();
  assert.match((await adapter.inspect(repo)).diff, /export const answer = 42/);
});

test("npm validation refuses a zero-test suite", async (t) => {
  const repo = await repositoryFixture(t);
  await writeFile(
    path.join(repo, "package.json"),
    JSON.stringify({ scripts: { test: "node --test" } }),
  );
  const { git: adapter } = await createAdapters();
  const result = await adapter.test(repo, "npm-test");
  assert.equal(result.passed, false, result.summary);
});

test("existing PR is updated and verified before delivery succeeds", async () => {
  const calls = [];
  let pushed = false;
  const runner = async (file, args) => {
    calls.push([file, args]);
    if (file === "git" && args[0] === "push") pushed = true;
    return {
      code: 0,
      stderr: "",
      stdout:
        file === "git"
          ? "new-head"
          : JSON.stringify([
              {
                number: 7,
                url: "https://github.test/acme/repo/pull/7",
                headRefOid: pushed ? "new-head" : "old-head",
              },
            ]),
    };
  };
  const result = await new GitHubProvider({ runner }).create({
    path: process.cwd(),
    branch: "devquest/one",
    title: "One",
    body: "Body",
  });
  assert.equal(result.number, 7);
  assert.ok(pushed);
  assert.equal(
    calls.some(([file, args]) => file === "gh" && args[1] === "create"),
    false,
  );
  assert.equal(calls.filter(([file]) => file === "gh").length, 2);
});

test("a PR with the wrong remote head never reports successful publication", async () => {
  const runner = async (file) => ({
    code: 0,
    stderr: "",
    stdout:
      file === "git"
        ? "reviewed-head"
        : JSON.stringify([
            {
              number: 7,
              url: "https://github.test/acme/repo/pull/7",
              headRefOid: "wrong-head",
            },
          ]),
  });
  await assert.rejects(
    new GitHubProvider({ runner }).create({
      path: process.cwd(),
      branch: "devquest/one",
    }),
    /reviewed commit/,
  );
});

test("reviewer requests are validated and verified with GitHub", async () => {
  const calls = [];
  const provider = new GitHubProvider({
    runner: async (_file, args) => {
      calls.push(args);
      return {
        code: 0,
        stderr: "",
        stdout: JSON.stringify({ reviewRequests: [{ login: "teammate" }] }),
      };
    },
  });
  await assert.rejects(provider.requestReview({ reviewers: ["--help"] }), /usernames/);
  assert.equal(calls.length, 0);
  await provider.requestReview({
    path: process.cwd(),
    number: 7,
    reviewers: ["teammate"],
  });
  assert.ok(calls[0].includes("--add-reviewer"));
  await assert.rejects(
    provider.requestReview({
      path: process.cwd(),
      number: 7,
      reviewers: ["missing"],
    }),
    /not confirmed/,
  );
});

test("Google Chat retries retain request IDs and never disclose webhook credentials", async (t) => {
  const name = "DEVQUEST_TEST_CHAT_WEBHOOK";
  process.env[name] =
    "https://chat.googleapis.com/v1/spaces/test/messages?key=secret-key&token=secret-token";
  t.after(() => delete process.env[name]);
  const calls = [];
  const adapter = new GoogleChatWebhook({
    webhookEnv: name,
    fetch: async (url, options) => {
      calls.push({ url: new URL(url), options });
      if (calls.length === 1) throw new Error("secret-token");
      return new Response(JSON.stringify({ name: "spaces/test/messages/receipt" }), {
        status: 200,
      });
    },
  });
  const input = { text: "Review PR", requestId: "stable-request" };
  await assert.rejects(
    adapter.send(input),
    (error) => !error.message.includes("secret-token") && /not confirmed/.test(error.message),
  );
  assert.deepEqual(await adapter.send(input), {
    name: "spaces/test/messages/receipt",
  });
  assert.equal(
    calls[0].url.searchParams.get("requestId"),
    calls[1].url.searchParams.get("requestId"),
  );
  assert.equal(calls[0].options.body, calls[1].options.body);
  process.env[name] = "https://outside.test/messages";
  await assert.rejects(adapter.send(input), /HTTPS Google Chat/);
  assert.equal(calls.length, 2);
});

test("test credentials reach child processes but not test summaries or model output", async (t) => {
  const name = "DEVQUEST_TEST_LOGIN_TOKEN";
  process.env[name] = "test-credential-value";
  t.after(() => delete process.env[name]);
  const runner = async (_file, args, options = {}) => {
    if (args.includes("--version")) return { code: 0, stdout: "codex 1", stderr: "" };
    if (args.includes("--help"))
      return {
        code: 0,
        stdout: "--json --sandbox --ephemeral --model --config",
        stderr: "",
      };
    assert.equal(options.env[name], "test-credential-value");
    options.onStdout?.(
      JSON.stringify({
        type: "item.completed",
        item: { type: "agent_message", text: "token test-credential-value" },
      }) + "\n",
    );
    return {
      code: 0,
      stdout: "# tests 1\n# pass 1\ntest-credential-value",
      stderr: "",
    };
  };
  const adapters = await createAdapters({
    runner,
    testing: { credentialEnv: [name] },
    orchestration: {
      models: [
        {
          id: "gpt-6.1-sol",
          runtime: "codex",
          family: "gpt",
          verified: true,
          available: true,
          efforts: ["high"],
        },
      ],
    },
  });
  const result = await adapters.git.test(process.cwd(), "node-test");
  assert.equal(result.passed, true);
  assert.doesNotMatch(result.summary, /test-credential-value/);
  const events = [];
  const turn = await adapters.runtimes.codex.start({
    cwd: process.cwd(),
    prompt: "test",
    onEvent: (event) => events.push(event),
  });
  assert.doesNotMatch(JSON.stringify({ turn, events }), /test-credential-value/);
});

test("local skill paths and appendix bridge retain the approved plan contract", async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), "devquest-skills-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const skillPath = path.join(dir, "SKILL.md");
  await writeFile(skillPath, "# Local skill\nUse office format.");
  let payload;
  const adapters = await createAdapters({
    workflow: { skills: { commit: skillPath } },
    skill: { bridge: { executable: "local-bridge" } },
    runner: async (_file, _args, options) => {
      payload = JSON.parse(options.input);
      return {
        code: 0,
        stdout: JSON.stringify({ content: "# Weighted appendix" }),
        stderr: "",
      };
    },
  });
  assert.match(await adapters.workflow.instructions("commit"), /Use office format/);
  assert.match(await adapters.workflow.instructions("commit"), /Do not commit/);
  assert.equal(
    await adapters.skill.appendix({ planPath: "approved-plan.md" }),
    "# Weighted appendix",
  );
  assert.equal(payload.planPath, "approved-plan.md");
  assert.equal(payload.operation, "generate-appendix");
});

test("direct local Jira skills isolate the configured MCP server and preserve partial mappings", async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), "devquest-direct-jira-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, "SKILL.md");
  const mcpConfigPath = path.join(dir, "claude.json");
  await writeFile(
    file,
    "---\nname: upload-task-to-jira\n---\n# Upload tasks\nCreate one sample, then batches of five.",
  );
  await writeFile(
    mcpConfigPath,
    JSON.stringify({
      mcpServers: {
        atlassian: { type: "http", url: "https://jira.example/mcp" },
        unrelated: { type: "http", url: "https://other.example/mcp" },
      },
    }),
  );
  const appendixContent = await readFile(new URL("./fixtures/jira-appendix.md", import.meta.url), "utf8");
  const appendixPath = path.join(dir, "appendix.md");
  await writeFile(appendixPath, appendixContent);
  let copied, calls = 0;
  const runtime = {
    start: async (input) => {
      copied = input.mcpConfig;
      const config = JSON.parse(
        await import("node:fs/promises").then(({ readFile }) => readFile(copied, "utf8")),
      );
      assert.deepEqual(Object.keys(config.mcpServers), ["atlassian"]);
      calls++;
      const verification = false;
      assert.equal(input.mcpTools.includes("mcp__atlassian__createJiraIssue"), !verification);
      assert.ok(!input.mcpTools.some((tool) => /delete|edit/i.test(tool)));
      if (!verification) assert.match(input.prompt, /at most maxIssues/);
      if (!verification) {
        assert.match(input.prompt, /appendixTaskMapping/);
        assert.match(input.prompt, /appendixIdempotencyPrefix/);
        assert.match(input.prompt, /publicationManifest/);
        assert.match(input.prompt, /existingIssues/);
        assert.deepEqual(input.mcpGuard.taskIds, ["T1.1"]);
        assert.equal(input.mcpGuard.issueMarkers["T1.1"], "devquest:q:appendix:T1.1");
      }
      input.onEvent({ type: "native-skill" });
      assert.ok(input.prompt.includes(JSON.stringify(appendixContent)));
      assert.equal(input.readOnly, true);
      assert.equal(input.nativeSkill, "devquest-jira:upload-task-to-jira");
      assert.doesNotMatch(input.prompt, /https:\/\/other.example/);
      if (verification) { for (const event of jiraEvidence("FFE")) input.onEvent(event); return { text: '{"prepared":true}' }; }
      input.onEvent({ type: "jira-read", method: "getJiraIssue", input: { issueIdOrKey: "FFE-1" }, content: { key: "FFE-1", fields: { project: { key: "FFE" }, description: "devquest:q:appendix:T1.1" } } });
      return {
        text: JSON.stringify({
          results: [
            {
              taskId: "task-a",
              appendixTaskId: "T1.1",
              key: "FFE-1",
              url: "https://jira.example/FFE-1",
            },
          ],
        }),
      };
    },
  };
  const skill = new SkillRunner({ runtime, mcpConfigPath });
  const result = await skill.publish(readyPublisherInput({
    quest: { id: "q", jiraContext: { project: "FFE", epic: "FFE-1", assignee: "synthetic" } },
    tasks: [{ id: "task-a" }],
    planPath: path.join(dir, "plan.md"),
    appendixPath,
    appendixContent,
    skillPaths: { upload: file },
    maxIssues: 1,
    publicationPhase: "sample",
  }));
  assert.equal(result.length, 1);
  assert.equal(result[0].complete, false);
  await assert.rejects(
    import("node:fs/promises").then(({ stat }) => stat(copied)),
    /ENOENT/,
  );
  skill.close();
  await assert.rejects(
    skill.appendix({
      planPath: path.join(dir, "plan.md"),
      skillPaths: { appendix: file },
    }),
    { name: "AbortError" },
  );
});

test("Claude Jira skill mode allows only named MCP tools and denies other permissions", () => {
  const runtime = new ClaudeCodeRuntime();
  runtime.help = "--permission-mode --allowedTools --allowedTools";
  const args = runtime.buildArgs({
    readOnly: true,
    mcpConfig: "/private/mcp.json",
    mcpTools: ["mcp__atlassian__createJiraIssue"],
  });
  assert.equal(args[args.indexOf("--permission-mode") + 1], "dontAsk");
  assert.equal(args[args.indexOf("--tools") + 1], "Read");
  assert.equal(args[args.indexOf("--mcp-config") + 1], "/private/mcp.json");
  assert.equal(args[args.indexOf("--allowedTools") + 1], "Read,mcp__atlassian__createJiraIssue");
  assert.ok(args.includes("--no-session-persistence"));
});

test("desktop command lookup finds Node when the launch PATH is empty", async () => {
  const result = await runProcess(
    path.basename(process.execPath),
    ["-e", "process.stdout.write('resolved')"],
    { env: { PATH: "" } },
  );
  assert.equal(result.code, 0);
  assert.equal(result.stdout, "resolved");
});

test("a missing working directory is reported before spawning an installed CLI", async () => {
  const cwd = path.join(tmpdir(), "devquest-missing-directory-" + Date.now());
  await assert.rejects(
    runProcess(process.execPath, ["--version"], { cwd }),
    /Working directory is unavailable/,
  );
});

test("restricted Codex continuation reapplies policy in a fresh checkpoint session", async () => {
  let invocation;
  const runtime = new CodexRuntime({
    persistence: true,
    runner: async (_file, args, options) => {
      invocation = { args, options };
      options.onStdout(
        JSON.stringify({
          type: "item.completed",
          item: { type: "agent_message", text: "Continued safely" },
        }) + "\n",
      );
      return { code: 0, stdout: "", stderr: "" };
    },
  });
  runtime.detectCapabilities = async () => ({
    available: true,
    nativeResume: true,
    modelSelection: true,
    effortSelection: true,
    nestedRestriction: true,
  });
  await runtime.resume({
    cwd: process.cwd(),
    sessionId: "old-thread",
    prompt: "Continue from saved checkpoint",
    bootstrap: "Required instructions",
    route: { resolvedModel: "gpt-5.4", resolvedEffort: "high" },
    executionPolicy: { nestedSpawning: false },
  });
  assert.ok(!invocation.args.includes("resume"));
  assert.ok(!invocation.args.includes("old-thread"));
  assert.ok(invocation.args.includes("gpt-5.4"));
  for (const feature of ["multi_agent", "multi_agent_v2", "shell_tool", "unified_exec"])
    assert.ok(invocation.args.includes(feature));
  assert.match(invocation.options.input, /^Required instructions\nContinue from saved checkpoint/);
});

test("Claude integration skills retain the routed model allowlist without worker policy", () => {
  const runtime = new ClaudeCodeRuntime();
  runtime.help = "--permission-mode --settings --model --effort";
  const args = runtime.buildArgs({
    readOnly: true,
    route: { resolvedModel: "claude-sonnet-5-5", resolvedEffort: "high" },
    mcpConfig: '{"mcpServers":{}}',
    mcpTools: ["mcp__jira__create"],
  });
  assert.deepEqual(JSON.parse(args[args.indexOf("--settings") + 1]), {
    availableModels: ["claude-sonnet-5-5"],
  });
  assert.ok(args.includes("Read,mcp__jira__create"));
});

test("managed Claude appendix exposes only its native skill and read-only metadata tools, records actual Skill results", async () => {
  const events = [];
  let invocation;
  const runtime = new ClaudeCodeRuntime({
    runner: async (_file, args, options) => {
      invocation = { args, options };
      options.onSpawn?.(1234);
      for (const event of [
        {
          type: "assistant",
          message: {
            content: [
              {
                type: "tool_use",
                id: "skill-1",
                name: "Skill",
                input: { skill: "devquest-jira:create-appendix-task-list" },
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
                tool_use_id: "skill-1",
                content: "Skill loaded",
              },
            ],
          },
        },
        { type: "assistant", message: { content: [{ type: "tool_use", id: "metadata-1", name: "mcp__atlassian__getJiraIssueTypeMetaWithFields", input: { projectIdOrKey: "SYN" } }] } },
        { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "metadata-1", content: [{ type: "text", text: JSON.stringify({ customfield_11543: { allowedValues: [{ id: "11515", value: "Refactor or add 1 generic function" }] } }) }] }] } },
        {
          type: "result",
          result: '{"content":"synthetic only"}',
          session_id: "fixture-session",
        },
      ])
        options.onStdout(JSON.stringify(event) + "\n");
      return { code: 0, stdout: "", stderr: "" };
    },
  });
  runtime.help =
    "--restricted --disallowedTools --disable-slash-commands --permission-mode --plugin-dir";
  runtime.detectCapabilities = async () => ({
    available: true,
    modelSelection: true,
    effortSelection: true,
    nativeResume: false,
  });
  await runtime.start({
    cwd: process.cwd(),
    readOnly: true,
    nativeSkill: "devquest-jira:create-appendix-task-list",
    skillPluginDir: "/tmp/approved-plugin",
    mcpConfig: "fixture.json",
    mcpTools: ["mcp__atlassian__getJiraIssue"],
    executionPolicy: { nestedSpawning: false },
    route: { resolvedModel: "claude-sonnet-test", resolvedEffort: "low" },
    timeoutMs: 60000,
    onEvent: (e) => events.push(e),
    prompt: "Synthetic task",
  });
  const args = invocation.args;
  assert.equal(args[args.indexOf("--tools") + 1], "Read,Skill");
  assert.equal(
    args[args.indexOf("--allowedTools") + 1],
    "Read,Skill(devquest-jira:create-appendix-task-list),mcp__atlassian__getJiraIssue",
  );
  assert.ok(args.includes("--restricted"));
  assert.match(args[args.indexOf("--disallowedTools") + 1], /Bash.*Edit,Write/);
  assert.ok(!args.includes("--disable-slash-commands"));
  assert.ok(events.some((e) => e.type === "native-skill"));
  assert.ok(events.some((e) => e.type === "heartbeat"));
  assert.equal(invocation.options.timeoutMs, 60000);
  assert.deepEqual(events.find((e) => e.type === "appendix-metadata"), { type: "appendix-metadata", project: "SYN", options: [{ id: "11515", value: "Refactor or add 1 generic function" }] });
});

test("missing native appendix skill fails before spawning any runtime", async () => {
  const skill = new SkillRunner();
  await assert.rejects(
    skill.prepareAppendix({ skillPaths: {} }),
    /Install.*create-appendix-task-list/,
  );
  await assert.rejects(
    skill.prepareAppendix({
      skillPaths: { appendix: "/missing/skill/SKILL.md" },
    }),
    /missing or unreadable/,
  );
});

test("per-run appendix asset contains only the unchanged approved skill and keeps live Jira field requirements", async (t) => {
  const { readFile, readdir, stat } = await import("node:fs/promises");
  const dir = await mkdtemp(path.join(tmpdir(), "devquest skill asset "));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, "SKILL.md"),
    config = path.join(dir, "mcp.json");
  const original =
    "---\nname: create-appendix-task-list\ndescription: Synthetic approved contract\n---\n# Approved skill\nUse live categories only.\n";
  await writeFile(file, original);
  await writeFile(
    config,
    JSON.stringify({
      mcpServers: {
        atlassian: { type: "http", url: "https://synthetic.invalid/mcp" },
      },
    }),
  );
  const prepared = await new SkillRunner({
    mcpConfigPath: config,
  }).prepareAppendix({
    skillPaths: { appendix: file },
    quest: { jiraContext: { project: "FCAD", epic: "FCAD-6205" } },
    planContent: "# Approved plan",
    trdContent: "# Rationale only",
  });
  t.after(prepared.cleanup);
  assert.equal(prepared.nativeSkill, "devquest-jira:create-appendix-task-list");
  assert.deepEqual(
    (await readdir(prepared.skillPluginDir, { recursive: true })).sort(),
    [
      ".claude-plugin",
      ".claude-plugin/plugin.json",
      "skills",
      "skills/create-appendix-task-list",
      "skills/create-appendix-task-list/SKILL.md",
    ].sort(),
  );
  assert.equal(
    await readFile(
      path.join(prepared.skillPluginDir, "skills/create-appendix-task-list/SKILL.md"),
      "utf8",
    ),
    original,
  );
  assert.equal(await readFile(file, "utf8"), original);
  assert.equal(
    JSON.parse(
      await readFile(path.join(prepared.skillPluginDir, ".claude-plugin/plugin.json"), "utf8"),
    ).name,
    "devquest-jira",
  );
  assert.match(prepared.skillHash, /^[a-f0-9]{64}$/);
  assert.match(prepared.prompt, /skill="devquest-jira:create-appendix-task-list"/);
  assert.match(prepared.prompt, /customfield_11543/);
  assert.match(prepared.prompt, /never invent categories/);
  assert.match(prepared.prompt, /matching saved weight reference/);
  assert.ok(!prepared.prompt.includes(original));
  assert.ok(!prepared.mcpTools.some((tool) => /create|update|delete/i.test(tool)));
  assert.equal((await stat(prepared.skillPluginDir)).mode & 0o077, 0);
  await prepared.cleanup();
  await assert.rejects(stat(prepared.skillPluginDir), /ENOENT/);
  await writeFile(file, original.replace("description:", "context: fork\ndescription:"));
  await assert.rejects(
    new SkillRunner({ mcpConfigPath: config }).prepareAppendix({
      skillPaths: { appendix: file },
    }),
    /incompatible/,
  );
});

test("native appendix fails closed when safe mode disables skills or explicit asset support is missing", async () => {
  const runtime = new ClaudeCodeRuntime({
    env: { CLAUDE_CODE_SAFE_MODE: "1" },
    runner: async () => {
      throw new Error("Must not spawn");
    },
  });
  await assert.rejects(
    runtime.start({ nativeSkill: "devquest-jira:create-appendix-task-list" }),
    /safe mode disables native skills/,
  );
  const adapter = new ClaudeCodeRuntime();
  adapter.help = "--restricted --disallowedTools --disable-slash-commands --permission-mode";
  assert.throws(
    () =>
      adapter.buildArgs({
        readOnly: true,
        nativeSkill: "devquest-jira:create-appendix-task-list",
        skillPluginDir: "/tmp/approved-plugin",
        mcpConfig: "fixture",
        mcpTools: [],
        executionPolicy: {},
      }),
    /per-session skill loading/,
  );
});

test("appendix metadata paths use the canonical controlled directory, including spaces and symlinks", async t => {
  const dir = await mkdtemp(path.join(tmpdir(), "devquest-metadata-path-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const target = path.join(dir, "approved inputs"), alias = path.join(dir, "input alias");
  await mkdir(target);
  await symlink(target, alias, "junction");
  const prepared = { inputDirectory: alias, prompt: "Fixture only" };
  const proof = { project: "SYN", checkedAt: "2026-10-18", selectedOptions: [{ id: "1", value: "BE synthetic", points: 1 }] };
  await SkillRunner.prototype.attachAppendixMetadata(prepared, proof, { hash: "snapshot" });
  assert.equal(prepared.inputDirectory, await realpath(target));
  assert.equal(prepared.appendixMetadata.file, path.join(await realpath(target), "appendix-options.json"));
  assert.deepEqual(JSON.parse(await readFile(prepared.appendixMetadata.file, "utf8")).options, proof.selectedOptions);
});

test("native metadata read evidence verifies actual returned file lines; claims, partial and stale contents cannot count as a full read", async t => {
  const { createHash } = await import("node:crypto");
  const dir = await mkdtemp(path.join(tmpdir(), "devquest-read-evidence-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, "appendix-options.json"), content = JSON.stringify({ options: [{ id: "1", value: "BE synthetic", points: 1 }] }, null, 2);
  await writeFile(file, content);
  const contract = { file, hash: createHash("sha256").update(content).digest("hex"), lineCount: content.split("\n").length };
  const events = [];
  const runtime = new ClaudeCodeRuntime({ runner: async (_file, _args, options) => {
    for (const [id, name, target, text] of [
      ["full", "Read", file, content.split("\n").map((line,i) => `${i+1}→${line}`).join("\n")],
      ["tabbed", "Read", file, content.split("\n").map((line,i) => `${i+1}\t${line}`).join("\n")],
      ["partial", "Read", file, "1→{"],
      ["claim", "Read", file, "I read all verified metadata"],
      ["stale", "Read", file, "1→changed"],
      ["other", "Read", path.join(dir,"other.json"), content],
    ]) {
      options.onStdout(JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", id, name, input: { file_path: target } }] } }) + "\n");
      options.onStdout(JSON.stringify({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: id, content: [{ type: "text", text }] }] } }) + "\n");
    }
    options.onStdout(JSON.stringify({ type: "result", result: "Fixture only" }) + "\n");
    return { code: 0, stdout: "", stderr: "" };
  } });
  runtime.help = "--restricted --disallowedTools --disable-slash-commands --permission-mode --plugin-dir";
  runtime.detectCapabilities = async () => ({ available: true, modelSelection: true, effortSelection: true });
  await runtime.start({ cwd: dir, readOnly: true, accessScope: { cwd: dir, readOnly: true, repositories: [{ id: "inputs", name: "Approved inputs", path: dir }] }, appendixMetadata: contract, nativeSkill: "devquest-jira:create-appendix-task-list", skillPluginDir: path.join(dir,"plugin"), mcpConfig: "fixture.json", mcpTools: [], executionPolicy: { nestedSpawning: false }, route: { resolvedModel: "claude-sonnet-test", resolvedEffort: "medium" }, onEvent: event => events.push(event) });
  const proof = events.filter(e => e.type === "appendix-metadata-read");
  assert.equal(proof.length, 5);
  assert.deepEqual(proof.find(e => e.toolUseId === "full").ranges, [[1, contract.lineCount]]);
  assert.deepEqual(proof.find(e => e.toolUseId === "tabbed").ranges, [[1, contract.lineCount]]);
  assert.deepEqual(proof.find(e => e.toolUseId === "partial").ranges, [[1,1]]);
  assert.deepEqual(proof.find(e => e.toolUseId === "claim").ranges, []);
  assert.deepEqual(proof.find(e => e.toolUseId === "stale").ranges, []);
  assert.ok(proof.every(e => e.hash === contract.hash));
});

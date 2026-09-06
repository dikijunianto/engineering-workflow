import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readFile, readlink, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

const DIFF_LIMIT = 200_000;
const OUTPUT_LIMIT = 100_000;
const SUMMARY_LIMIT = 4_000;
const JSON_BUFFER_LIMIT = 1_000_000;

function bounded(value, limit, label = "output") {
  const text = String(value ?? "");
  if (text.length <= limit) return text;
  const marker = `\n[${label} truncated]`;
  return `${text.slice(0, Math.max(0, limit - marker.length))}${marker}`.slice(
    0,
    limit,
  );
}

function abortError(message = "Operation aborted") {
  const error = new Error(message);
  error.name = "AbortError";
  return error;
}

function stopProcessTree(child) {
  if (!child.pid) return;
  if (process.platform === "win32") {
    spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
      shell: false,
      stdio: "ignore",
      windowsHide: true,
    })
      .on("error", () => child.kill())
      .unref();
  } else {
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {
      child.kill("SIGTERM");
    }
    const force = setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) {
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {
          child.kill("SIGKILL");
        }
      }
    }, 1000);
    force.unref();
  }
}

export function runProcess(
  file,
  args,
  {
    cwd,
    input,
    signal,
    timeoutMs = 30_000,
    maxOutput = OUTPUT_LIMIT,
    onStdout,
    onStderr,
    onSpawn,
  } = {},
) {
  if (signal?.aborted) return Promise.reject(abortError());
  return new Promise((resolve, reject) => {
    // A test runner's child marker must not suppress tests inside a target repository.
    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT;
    const child = spawn(file, args, {
      cwd,
      env,
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      detached: process.platform !== "win32",
    });
    child.once("spawn", () => onSpawn?.(child.pid));
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const append = (current, chunk) => bounded(current + chunk, maxOutput);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout = append(stdout, chunk);
      onStdout?.(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr = append(stderr, chunk);
      onStderr?.(chunk);
    });
    const onAbort = () => stopProcessTree(child);
    signal?.addEventListener("abort", onAbort, { once: true });
    const timer = setTimeout(() => {
      timedOut = true;
      stopProcessTree(child);
    }, timeoutMs);
    timer.unref?.();
    child.once("error", (error) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      reject(error);
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      if (signal?.aborted) return reject(abortError());
      if (timedOut)
        return reject(new Error(`${file} timed out after ${timeoutMs}ms`));
      resolve({ code: code ?? 1, stdout, stderr });
    });
    child.stdin.on("error", (error) => {
      if (!["EPIPE", "EOF"].includes(error.code)) reject(error);
    });
    child.stdin.end(input ?? "");
  });
}

function commandError(file, args, result) {
  return new Error(
    `${file} ${args.join(" ")} failed (${result.code}): ${bounded(result.stderr || result.stdout, SUMMARY_LIMIT)}`,
  );
}

async function checked(runner, file, args, options) {
  const result = await runner(file, args, options);
  if (result.code !== 0) throw commandError(file, args, result);
  if (args.includes("-z") && result.stdout.includes("[output truncated]"))
    throw new Error("Repository listing exceeds the inspection limit");
  return args.includes("-z") ? result.stdout : result.stdout.trim();
}

async function exists(target) {
  try {
    await stat(target);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

function assertNarrowPath(target) {
  const resolved = path.resolve(target);
  const root = path.parse(resolved).root;
  if (
    resolved === root ||
    resolved.toLowerCase() === path.resolve(homedir()).toLowerCase()
  ) {
    throw new Error("Refusing broad repository path");
  }
  return resolved;
}

function inside(root, target) {
  const relative = path.relative(root, target);
  return (
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

class GitAdapter {
  constructor({ runner = runProcess } = {}) {
    this.runner = runner;
    this.repositories = new Map();
  }

  async #facts(target) {
    const rootText = await checked(
      this.runner,
      "git",
      ["rev-parse", "--show-toplevel"],
      { cwd: target },
    );
    const root = await realpath(rootText);
    const commonText = await checked(
      this.runner,
      "git",
      ["rev-parse", "--git-common-dir"],
      { cwd: target },
    );
    const common = await realpath(path.resolve(target, commonText));
    return { root, common };
  }

  async register(target) {
    const requested = assertNarrowPath(
      await realpath(assertNarrowPath(target)),
    );
    let facts;
    try {
      facts = await this.#facts(requested);
    } catch (error) {
      throw new Error(`Path is not a Git repository: ${error.message}`);
    }
    if (facts.root !== requested)
      throw new Error("Register the repository root, not a nested path");
    const remoteResult = await this.runner(
      "git",
      ["config", "--get", "remote.origin.url"],
      { cwd: requested },
    );
    if (![0, 1].includes(remoteResult.code))
      throw commandError(
        "git",
        ["config", "--get", "remote.origin.url"],
        remoteResult,
      );
    this.repositories.set(requested, { common: facts.common });
    return {
      path: requested,
      name: path.basename(requested),
      remote: remoteResult.stdout.trim(),
    };
  }

  async #registered(repoPath) {
    const canonical = await realpath(assertNarrowPath(repoPath));
    const registration = this.repositories.get(canonical);
    if (!registration) throw new Error("Repository is not registered");
    return { canonical, ...registration };
  }

  async prepare({
    repoPath,
    path: worktreePath,
    branch,
    baseBranch = "development",
  }) {
    if (!branch?.trim()) throw new Error("Branch is required");
    const registered = await this.#registered(repoPath);
    const target = assertNarrowPath(worktreePath);
    if (await exists(target)) {
      await this.reconcile({ repoPath, path: target, branch });
    } else {
      const branchResult = await this.runner(
        "git",
        ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`],
        {
          cwd: registered.canonical,
        },
      );
      if (branchResult.code === 0)
        throw new Error(
          `Branch already exists without the expected worktree: ${branch}`,
        );
      if (branchResult.code !== 1)
        throw commandError(
          "git",
          ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`],
          branchResult,
        );
      await checked(
        this.runner,
        "git",
        ["worktree", "add", "-b", branch, target, baseBranch],
        {
          cwd: registered.canonical,
        },
      );
      await this.reconcile({ repoPath, path: target, branch });
    }
    return {
      head: await checked(this.runner, "git", ["rev-parse", "HEAD"], {
        cwd: target,
      }),
    };
  }

  async reconcile({ repoPath, path: worktreePath, branch }) {
    const registered = await this.#registered(repoPath);
    let target;
    let facts;
    try {
      target = await realpath(assertNarrowPath(worktreePath));
      facts = await this.#facts(target);
    } catch (error) {
      throw new Error(`Worktree is missing or invalid: ${error.message}`);
    }
    if (facts.root !== target)
      throw new Error("Worktree path is not its Git root");
    if (facts.common !== registered.common)
      throw new Error("Worktree does not belong to the registered repository");
    const actualBranch = await checked(
      this.runner,
      "git",
      ["branch", "--show-current"],
      { cwd: target },
    );
    if (actualBranch !== branch)
      throw new Error(
        `Worktree branch mismatch: expected ${branch}, found ${actualBranch || "detached HEAD"}`,
      );
    return {
      head: await checked(this.runner, "git", ["rev-parse", "HEAD"], {
        cwd: target,
      }),
    };
  }

  async #fingerprint(root, head, statusText) {
    const staged = await checked(
      this.runner,
      "git",
      ["ls-files", "--stage", "-z"],
      {
        cwd: root,
        maxOutput: 2_000_000,
      },
    );
    const listed = await checked(
      this.runner,
      "git",
      ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
      {
        cwd: root,
        maxOutput: 2_000_000,
      },
    );
    const contentHash = createHash("sha256");
    for (const relative of [
      ...new Set(listed.split("\0").filter(Boolean)),
    ].sort()) {
      const file = path.resolve(root, relative);
      if (!inside(root, file)) continue;
      try {
        const info = await lstat(file);
        contentHash.update(relative).update("\0");
        contentHash.update(info.mode.toString(8)).update("\0");
        if (info.isSymbolicLink())
          contentHash.update(`link:${await readlink(file)}`);
        else if (info.isFile())
          for await (const chunk of createReadStream(file))
            contentHash.update(chunk);
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
        continue;
      }
      contentHash.update("\0");
    }
    const contentFingerprint = contentHash.digest("hex");
    return {
      contentFingerprint,
      fingerprint: createHash("sha256")
        .update(`${head}\0${statusText}\0${staged}\0${contentFingerprint}`)
        .digest("hex"),
    };
  }

  async inspect(target) {
    const root = await realpath(assertNarrowPath(target));
    const facts = await this.#facts(root);
    if (facts.root !== root)
      throw new Error("Inspect path must be a repository or worktree root");
    const head = await checked(this.runner, "git", ["rev-parse", "HEAD"], {
      cwd: root,
    });
    const branch = await checked(
      this.runner,
      "git",
      ["branch", "--show-current"],
      { cwd: root },
    );
    const statusText = await checked(
      this.runner,
      "git",
      ["status", "--porcelain=v1", "-z"],
      { cwd: root, maxOutput: 2_000_000 },
    );
    const trackedDiff = await checked(
      this.runner,
      "git",
      ["diff", "--no-ext-diff", "--binary", "development"],
      {
        cwd: root,
        maxOutput: DIFF_LIMIT,
      },
    );
    const untracked = [];
    for (const entry of statusText.split("\0")) {
      if (!entry.startsWith("?? ")) continue;
      const relative = entry.slice(3);
      const file = path.resolve(root, relative);
      if (!inside(root, file)) continue;
      try {
        const info = await lstat(file);
        if (info.isFile()) {
          const content = bounded(await readFile(file, "utf8"), 20_000, "file");
          untracked.push(
            `diff --git a/${relative} b/${relative}\nnew file mode 100644\n--- /dev/null\n+++ b/${relative}\n${content}`,
          );
        }
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
    }
    const fingerprints = await this.#fingerprint(root, head, statusText);
    return {
      head,
      branch,
      dirty: statusText.length > 0,
      diff: bounded(
        [trackedDiff, ...untracked].filter(Boolean).join("\n"),
        DIFF_LIMIT,
        "diff",
      ),
      ...fingerprints,
    };
  }

  async test(target, profile) {
    const npm =
      process.platform === "win32"
        ? [
            process.execPath,
            [
              path.join(
                path.dirname(process.execPath),
                "node_modules",
                "npm",
                "bin",
                "npm-cli.js",
              ),
              "test",
            ],
          ]
        : ["npm", ["test"]];
    const profiles = {
      "node-test": [process.execPath, ["--test", "--test-reporter=tap"]],
      "npm-test": npm,
      "go-test": ["go", ["test", "./..."]],
      pytest: [
        process.platform === "win32" ? "python.exe" : "python3",
        ["-m", "pytest"],
      ],
    };
    const command = profiles[profile];
    if (!command) throw new Error(`Unknown test profile: ${profile}`);
    let result;
    try {
      result = await this.runner(command[0], command[1], {
        cwd: await realpath(assertNarrowPath(target)),
        timeoutMs: 300_000,
        maxOutput: 20_000,
      });
    } catch (error) {
      return { passed: false, summary: bounded(error.message, SUMMARY_LIMIT) };
    }
    return {
      passed:
        result.code === 0 &&
        !(profile === "node-test" && /# tests 0\b/.test(result.stdout)),
      summary: bounded(
        [result.stdout, result.stderr].filter(Boolean).join("\n").trim(),
        SUMMARY_LIMIT,
      ),
    };
  }

  async commit(target, message) {
    if (!message?.trim()) throw new Error("Commit message is required");
    const cwd = await realpath(assertNarrowPath(target));
    await checked(this.runner, "git", ["add", "--all"], { cwd });
    const head = () =>
      checked(this.runner, "git", ["rev-parse", "HEAD"], { cwd });
    if (
      !(await checked(this.runner, "git", ["status", "--porcelain=v1"], {
        cwd,
      }))
    )
      return { head: await head() };
    await checked(this.runner, "git", ["commit", "-m", message], { cwd });
    return { head: await head() };
  }
}

export class AgentRuntime {
  constructor({
    name,
    executable,
    runner = runProcess,
    persistence = false,
  } = {}) {
    this.name = name;
    this.executable = executable;
    this.runner = runner;
    this.persistence = persistence;
    this.capabilities = null;
    this.help = "";
    this.resumeHelp = "";
  }

  requiredFlags() {
    return [];
  }

  helpArgs() {
    return ["--help"];
  }

  resumeHelpArgs() {
    return null;
  }

  supportsNativeResume() {
    return /(?:^|\s)(?:--?)?resume(?:\s|,|$)/im.test(this.help);
  }

  async detectCapabilities() {
    if (this.capabilities) return this.capabilities;
    try {
      const [version, help] = await Promise.all([
        this.runner(this.executable, ["--version"], {
          timeoutMs: 5_000,
          maxOutput: SUMMARY_LIMIT,
        }),
        this.runner(this.executable, this.helpArgs(), {
          timeoutMs: 5_000,
          maxOutput: 20_000,
        }),
      ]);
      if (version.code !== 0 || help.code !== 0)
        throw new Error(
          (version.stderr || help.stderr || "CLI probe failed").trim(),
        );
      this.help = help.stdout;
      const missing = this.requiredFlags().filter(
        (flag) => !this.help.includes(flag),
      );
      if (missing.length)
        throw new Error(
          `Installed ${this.name} CLI lacks required flags: ${missing.join(", ")}`,
        );
      const resumeArgs = this.resumeHelpArgs();
      if (this.persistence && resumeArgs) {
        const resume = await this.runner(this.executable, resumeArgs, {
          timeoutMs: 5_000,
          maxOutput: 20_000,
        });
        if (resume.code === 0) this.resumeHelp = resume.stdout;
      }
      this.capabilities = {
        available: true,
        interactive: true,
        nativeResume: this.persistence && this.supportsNativeResume(),
        streaming: true,
      };
    } catch (error) {
      this.capabilities = {
        available: false,
        interactive: true,
        nativeResume: false,
        streaming: true,
        reason: `${this.name} CLI unavailable: ${error.message}`,
      };
    }
    return this.capabilities;
  }

  buildArgs() {
    throw new Error("AgentRuntime subclasses must implement buildArgs");
  }

  parseEvent(event) {
    return {
      text: typeof event === "string" ? event : "",
      sessionId: undefined,
      waitingInput: false,
    };
  }

  async start({
    cwd,
    prompt,
    onEvent,
    signal,
    readOnly = false,
    sessionId,
  } = {}) {
    const capabilities = await this.detectCapabilities();
    if (!capabilities.available) throw new Error(capabilities.reason);
    if (signal?.aborted) throw abortError();
    const args = this.buildArgs({
      readOnly,
      sessionId: capabilities.nativeResume ? sessionId : undefined,
    });
    let buffer = "";
    let sawChunk = false;
    let parsedText = "";
    let resultText = "";
    let nativeSessionId;
    let waitingInput = false;
    let failure;
    const consumeLine = (line) => {
      if (!line.trim()) return;
      let parsed;
      try {
        parsed = JSON.parse(line);
      } catch {
        parsed = line;
      }
      const event = this.parseEvent(parsed);
      if (event.text) {
        parsedText = bounded(
          `${parsedText}${parsedText ? "\n" : ""}${event.text}`,
          OUTPUT_LIMIT,
          "response",
        );
        if (event.final) resultText = event.text;
        onEvent?.({
          type: "output",
          text: bounded(event.text, 8_000, "event"),
        });
      }
      nativeSessionId = event.sessionId ?? nativeSessionId;
      waitingInput ||= Boolean(event.waitingInput);
      failure = event.error ?? failure;
    };
    const onStdout = (chunk) => {
      sawChunk = true;
      buffer = bounded(buffer + chunk, JSON_BUFFER_LIMIT, "JSON event");
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop();
      for (const line of lines) consumeLine(line);
    };
    const result = await this.runner(this.executable, args, {
      cwd,
      input: `${String(prompt ?? "")}\n\nIf a human decision or permission is needed, begin your final response with DEVQUEST_WAITING_INPUT and ask the question. Do not claim implementation is complete while blocked.`,
      signal,
      timeoutMs: 60 * 60_000,
      maxOutput: OUTPUT_LIMIT,
      onStdout,
      onSpawn: (pid) => onEvent?.({ type: "process", pid }),
    });
    if (!sawChunk && result.stdout) onStdout(result.stdout);
    consumeLine(buffer);
    if (
      result.code !== 0 &&
      sessionId &&
      /(?:session|thread).*(?:not found|does not exist|unknown)|no saved.*(?:session|thread)/i.test(
        result.stderr || result.stdout,
      )
    ) {
      onEvent?.({
        type: "output",
        text: "Native session is unavailable. Continuing logically from checkpoint.\n",
      });
      return this.start({ cwd, prompt, onEvent, signal, readOnly });
    }
    if (result.code !== 0) throw commandError(this.executable, args, result);
    if (failure) throw new Error(failure);
    const text = bounded(
      resultText || parsedText || (waitingInput ? "Agent requires input." : ""),
      OUTPUT_LIMIT,
      "response",
    );
    if (!text)
      throw new Error(
        "Agent ended without a final response. Inspect the session and continue from its checkpoint.",
      );
    return {
      text,
      summary: bounded(text.slice(-SUMMARY_LIMIT), SUMMARY_LIMIT, "summary"),
      ...(nativeSessionId && capabilities.nativeResume
        ? { sessionId: nativeSessionId }
        : {}),
      waitingInput:
        waitingInput || /^DEVQUEST_WAITING_INPUT\b/.test(text.trim()),
    };
  }

  sendMessage(input) {
    return this.start(input);
  }

  resume(input) {
    return this.start(input);
  }
}

export class CodexRuntime extends AgentRuntime {
  constructor(options = {}) {
    super({ name: "Codex", executable: "codex", ...options });
  }

  requiredFlags() {
    return [
      "--json",
      "--sandbox",
      ...(this.persistence ? [] : ["--ephemeral"]),
    ];
  }

  helpArgs() {
    return ["exec", "--help"];
  }

  resumeHelpArgs() {
    return ["exec", "resume", "--help"];
  }

  supportsNativeResume() {
    return (
      this.resumeHelp.includes("--json") && this.resumeHelp.includes("--config")
    );
  }

  buildArgs({ readOnly, sessionId }) {
    if (sessionId) {
      return [
        "exec",
        "resume",
        "--json",
        "--config",
        `sandbox_mode="${readOnly ? "read-only" : "workspace-write"}"`,
        sessionId,
        "-",
      ];
    }
    const args = [
      "exec",
      "--json",
      "--sandbox",
      readOnly ? "read-only" : "workspace-write",
    ];
    if (!this.persistence) args.push("--ephemeral");
    args.push("-");
    return args;
  }

  parseEvent(event) {
    if (typeof event === "string") return {};
    if (event.type === "thread.started") return { sessionId: event.thread_id };
    if (event.type === "item.completed" && event.item?.type === "agent_message")
      return { text: event.item.text ?? "", final: true };
    if (event.type === "turn.failed" || event.type === "error") {
      return {
        error: event.error?.message ?? event.message ?? "Codex turn failed",
      };
    }
    return { waitingInput: /waiting.*input/i.test(event.type ?? "") };
  }
}

export class ClaudeCodeRuntime extends AgentRuntime {
  constructor(options = {}) {
    super({ name: "Claude Code", executable: "claude", ...options });
  }

  requiredFlags() {
    return [
      "--print",
      "--output-format",
      "--permission-mode",
      "--tools",
      "--strict-mcp-config",
      "--mcp-config",
      ...(this.persistence ? [] : ["--no-session-persistence"]),
    ];
  }

  buildArgs({ readOnly, sessionId }) {
    if (readOnly && !this.help.includes("--permission-mode")) {
      throw new Error(
        "Installed Claude Code CLI cannot enforce read-only plan mode",
      );
    }
    const args = ["--print", "--output-format", "stream-json", "--verbose"];
    if (!this.persistence) args.push("--no-session-persistence");
    args.push("--permission-mode", readOnly ? "plan" : "acceptEdits");
    args.push(
      "--tools",
      readOnly ? "Read,Glob,Grep" : "Read,Glob,Grep,Edit,Write",
    );
    args.push("--strict-mcp-config", "--mcp-config", '{"mcpServers":{}}');
    if (sessionId) args.push("--resume", sessionId);
    return args;
  }

  parseEvent(event) {
    if (typeof event === "string") return {};
    if (event.type === "result") {
      if (event.is_error)
        return {
          error: event.result || "Claude Code turn failed",
          sessionId: event.session_id,
        };
      return {
        text: typeof event.result === "string" ? event.result : "",
        final: true,
        sessionId: event.session_id,
      };
    }
    if (event.type === "assistant") {
      const text =
        event.message?.content
          ?.filter((item) => item.type === "text")
          .map((item) => item.text)
          .join("") ?? "";
      return { text, sessionId: event.session_id };
    }
    return {
      waitingInput: /waiting.*input/i.test(event.type ?? ""),
      sessionId: event.session_id,
    };
  }
}

export class SkillRunner {
  constructor({ bridge, runner = runProcess } = {}) {
    this.bridge = bridge;
    this.runner = runner;
  }

  async publish({ quest, tasks, planPath }) {
    if (!this.bridge?.executable) {
      throw new Error(
        "Configure an existing Jira skill bridge executable and arguments before publishing",
      );
    }
    const normalizedTasks = tasks.map((task) => {
      if (!task.id)
        throw new Error("Every Jira task requires a stable task id");
      return {
        ...task,
        taskId: task.id,
        idempotencyKey: `devquest:${quest.id}:${task.id}`,
      };
    });
    const result = await this.runner(
      this.bridge.executable,
      this.bridge.args ?? [],
      {
        input: JSON.stringify({ quest, tasks: normalizedTasks, planPath }),
        timeoutMs: 120_000,
        maxOutput: 100_000,
      },
    );
    let parsed;
    try {
      parsed = JSON.parse(result.stdout);
    } catch {
      throw commandError(
        this.bridge.executable,
        this.bridge.args ?? [],
        result,
      );
    }
    const allowed = new Set(normalizedTasks.map(({ taskId }) => taskId));
    const published = (Array.isArray(parsed) ? parsed : (parsed.results ?? []))
      .filter(
        (item) =>
          item &&
          allowed.has(item.taskId) &&
          typeof item.key === "string" &&
          item.key.length,
      )
      .map(({ taskId, key, url }) => ({
        taskId,
        key,
        ...(url ? { url } : {}),
      }));
    if (result.code !== 0 && published.length === 0)
      throw commandError(
        this.bridge.executable,
        this.bridge.args ?? [],
        result,
      );
    return published;
  }
}

function pageIdFromUrl(url) {
  return (
    /\/pages\/(\d+)(?:\/|$)/.exec(url.pathname)?.[1] ??
    url.searchParams.get("pageId")
  );
}

function linkedUrls(html, base) {
  const urls = [];
  for (const match of html.matchAll(/\bhref\s*=\s*["']([^"']+)["']/gi)) {
    try {
      urls.push(new URL(match[1].replaceAll("&amp;", "&"), base));
    } catch {
      // Invalid document links are ignored; the source body is still usable.
    }
  }
  return urls;
}

function storagePageTitles(html) {
  const decode = (value) =>
    value
      .replaceAll("&amp;", "&")
      .replaceAll("&quot;", '"')
      .replaceAll("&#39;", "'")
      .replaceAll("&lt;", "<")
      .replaceAll("&gt;", ">");
  return [
    ...html.matchAll(
      /<ri:page\b[^>]*\bri:content-title\s*=\s*["']([^"']+)["']/gi,
    ),
  ].map((match) => decode(match[1]));
}

export class ConfluenceAdapter {
  constructor({
    host,
    fetch = globalThis.fetch,
    tokenEnv,
    emailEnv,
    authProvider,
    maxPages = 10,
    maxBodyBytes = 1_000_000,
    timeoutMs = 15_000,
  } = {}) {
    this.origin = host ? new URL(host).origin : null;
    this.fetchImpl = fetch;
    this.tokenEnv = tokenEnv;
    this.emailEnv = emailEnv;
    this.authProvider = authProvider;
    this.maxPages = Math.max(1, maxPages);
    this.maxBodyBytes = maxBodyBytes;
    this.timeoutMs = timeoutMs;
  }

  #validate(url) {
    if (!this.origin) throw new Error("Configure an HTTPS Confluence host");
    if (url.protocol !== "https:" || url.origin !== this.origin) {
      throw new Error("URL must use the configured Confluence host over HTTPS");
    }
  }

  async #headers() {
    if (this.authProvider) {
      const auth = await this.authProvider();
      return auth?.headers ?? auth ?? {};
    }
    const token = this.tokenEnv ? process.env[this.tokenEnv] : undefined;
    const email = this.emailEnv ? process.env[this.emailEnv] : undefined;
    if (!token) return {};
    return {
      authorization: email
        ? `Basic ${Buffer.from(`${email}:${token}`).toString("base64")}`
        : `Bearer ${token}`,
    };
  }

  async #body(response) {
    if (!response.body?.getReader) {
      const text = await response.text();
      if (Buffer.byteLength(text) > this.maxBodyBytes)
        throw new Error("Confluence response exceeds configured body limit");
      return text;
    }
    const reader = response.body.getReader();
    const chunks = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > this.maxBodyBytes) {
        await reader.cancel();
        throw new Error("Confluence response exceeds configured body limit");
      }
      chunks.push(value);
    }
    return Buffer.concat(chunks).toString("utf8");
  }

  async #requestUrl(initialUrl, label) {
    let url = initialUrl;
    const headers = await this.#headers();
    for (let redirects = 0; redirects < 4; redirects += 1) {
      this.#validate(url);
      const controller = new AbortController();
      let timer;
      const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(
            new Error(`Confluence request timed out after ${this.timeoutMs}ms`),
          );
        }, this.timeoutMs);
      });
      timer.unref?.();
      let response;
      try {
        response = await Promise.race([
          this.fetchImpl(url, {
            headers,
            redirect: "manual",
            signal: controller.signal,
          }),
          timeout,
        ]);
        if ([301, 302, 303, 307, 308].includes(response.status)) {
          const location = response.headers.get("location");
          if (!location)
            throw new Error(
              "Confluence returned a redirect without a location",
            );
          url = new URL(location, url);
          this.#validate(url);
          continue;
        }
        if (!response.ok)
          throw new Error(
            `Confluence ${label} failed with HTTP ${response.status}`,
          );
        try {
          return JSON.parse(
            await Promise.race([this.#body(response), timeout]),
          );
        } catch (error) {
          if (/timed out/i.test(error.message)) throw error;
          throw new Error(
            `Confluence ${label} returned invalid JSON: ${error.message}`,
          );
        }
      } finally {
        clearTimeout(timer);
      }
    }
    throw new Error("Too many Confluence redirects");
  }

  #request(pageId) {
    return this.#requestUrl(
      new URL(
        `/wiki/api/v2/pages/${encodeURIComponent(pageId)}?body-format=storage`,
        this.origin,
      ),
      `page ${pageId}`,
    );
  }

  async #resolveTitle(title) {
    const url = new URL("/wiki/api/v2/pages", this.origin);
    url.searchParams.set("title", title);
    url.searchParams.set("limit", "2");
    url.searchParams.set("body-format", "storage");
    const response = await this.#requestUrl(url, `page titled "${title}"`);
    const exact = (response.results ?? []).filter(
      (page) => page?.title === title,
    );
    if (exact.length !== 1)
      throw new Error(
        `Expected one Confluence page titled "${title}", found ${exact.length}`,
      );
    return exact[0];
  }

  async fetch(rawUrl) {
    const mainUrl = new URL(rawUrl);
    this.#validate(mainUrl);
    const mainId = pageIdFromUrl(mainUrl);
    if (!mainId)
      throw new Error("Confluence page URL does not contain a page id");
    const main = await this.#request(mainId);
    const pages = [{ page: main, url: mainUrl.href }];
    const warnings = [];
    const seen = new Set([String(mainId)]);
    const mainBody = main.body?.storage?.value ?? "";
    const candidates = [];
    for (const linked of linkedUrls(mainBody, mainUrl)) {
      if (linked.protocol !== "https:" || linked.origin !== this.origin)
        continue;
      const id = pageIdFromUrl(linked);
      if (!id || seen.has(String(id))) continue;
      seen.add(String(id));
      candidates.push({ id, url: linked.href });
    }
    for (const title of new Set(storagePageTitles(mainBody)))
      candidates.push({ title });
    let attempted = 1;
    for (let index = 0; index < candidates.length; index += 1) {
      if (attempted >= this.maxPages) {
        warnings.push(
          `Omitted ${candidates.length - index} direct Confluence link(s) because the page limit is ${this.maxPages}`,
        );
        break;
      }
      attempted += 1;
      const { id, title } = candidates[index];
      try {
        const page = id
          ? await this.#request(id)
          : await this.#resolveTitle(title);
        if (seen.has(String(page.id)) && !id) continue;
        seen.add(String(page.id));
        const sourceUrl =
          candidates[index].url ??
          new URL(
            page._links?.webui ??
              `/wiki/pages/viewpage.action?pageId=${encodeURIComponent(page.id)}`,
            this.origin,
          ).href;
        pages.push({ page, url: sourceUrl });
      } catch (error) {
        warnings.push(
          `Could not load linked Confluence page ${id ?? `"${title}"`}: ${error.message}`,
        );
      }
    }
    return {
      content: pages
        .map(
          ({ page }) =>
            `# ${page.title ?? `Page ${page.id}`}\n\n${page.body?.storage?.value ?? ""}`,
        )
        .join("\n\n"),
      sources: pages.map(({ page, url }) => ({
        id: String(page.id),
        title: page.title ?? `Page ${page.id}`,
        url,
        version: page.version?.number,
      })),
      warnings,
    };
  }
}

export class SourceControlProvider {
  async create() {
    throw new Error("SourceControlProvider subclasses must implement create");
  }
}

export class GitHubProvider extends SourceControlProvider {
  constructor({ runner = runProcess, git } = {}) {
    super();
    this.runner = runner;
    this.git = git;
  }

  async #find(cwd, branch, baseBranch) {
    const result = await this.runner(
      "gh",
      [
        "pr",
        "list",
        "--head",
        branch,
        "--base",
        baseBranch,
        "--state",
        "open",
        "--json",
        "number,url",
        "--limit",
        "1",
      ],
      { cwd, timeoutMs: 30_000, maxOutput: 20_000 },
    );
    if (result.code !== 0) throw commandError("gh", ["pr", "list"], result);
    let prs;
    try {
      prs = JSON.parse(result.stdout);
    } catch {
      throw new Error(
        "gh returned invalid JSON while looking up pull requests",
      );
    }
    return prs[0] ? { url: prs[0].url, number: Number(prs[0].number) } : null;
  }

  async create({
    repoPath,
    path: worktreePath,
    branch,
    baseBranch = "development",
    title,
    body,
  }) {
    await this.git?.reconcile({ repoPath, path: worktreePath, branch });
    const existing = await this.#find(worktreePath, branch, baseBranch);
    if (existing) return existing;
    await checked(
      this.runner,
      "git",
      ["push", "--set-upstream", "origin", branch],
      {
        cwd: worktreePath,
        timeoutMs: 120_000,
        maxOutput: 20_000,
      },
    );
    let creation;
    try {
      creation = await this.runner(
        "gh",
        [
          "pr",
          "create",
          "--base",
          baseBranch,
          "--head",
          branch,
          "--title",
          title,
          "--body",
          body,
        ],
        { cwd: worktreePath, timeoutMs: 60_000, maxOutput: 20_000 },
      );
    } catch {
      creation = { code: 1, stdout: "", stderr: "gh invocation failed" };
    }
    const match = /https:\/\/\S+\/pull\/(\d+)/.exec(creation.stdout ?? "");
    if (creation.code === 0 && match)
      return { url: match[0], number: Number(match[1]) };
    const recovered = await this.#find(worktreePath, branch, baseBranch);
    if (recovered) return recovered;
    throw commandError("gh", ["pr", "create"], creation);
  }
}

export async function createAdapters(config = {}) {
  const runner = config.runner ?? config.processRunner ?? runProcess;
  const git = new GitAdapter({ runner });
  return {
    config,
    git,
    runtimes: {
      codex: new CodexRuntime({ runner, ...(config.runtimes?.codex ?? {}) }),
      claude: new ClaudeCodeRuntime({
        runner,
        ...(config.runtimes?.claude ?? {}),
      }),
    },
    skill: new SkillRunner({
      runner,
      bridge:
        config.skill?.bridge ?? config.jiraSkill?.bridge ?? config.jiraSkill,
    }),
    confluence: new ConfluenceAdapter({
      fetch: config.fetch,
      ...(config.confluence ?? {}),
    }),
    sourceControl: new GitHubProvider({
      runner,
      git,
      ...(config.sourceControl ?? {}),
    }),
  };
}

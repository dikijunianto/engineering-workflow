import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  glob,
  lstat,
  mkdtemp,
  readFile,
  readlink,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
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

export async function runProcess(
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
    env: extraEnv,
  } = {},
) {
  if (cwd) {
    let directory;
    try {
      directory = await stat(cwd);
    } catch {
      throw new Error(
        `Working directory is unavailable: ${cwd}. Repair the repository path in Repositories.`,
      );
    }
    if (!directory.isDirectory())
      throw new Error(`Working directory is not a folder: ${cwd}`);
  }
  if (signal?.aborted) return Promise.reject(abortError());
  return new Promise((resolve, reject) => {
    // A test runner's child marker must not suppress tests inside a target repository.
    const env = { ...process.env, ...extraEnv };
    const searchPath =
      extraEnv?.PATH ?? process.env.PATH ?? process.env.Path ?? "";
    for (const key of Object.keys(env))
      if (key.toUpperCase() === "PATH") delete env[key];
    // Desktop launches often omit Homebrew and native CLI installation folders.
    env.PATH = [
      ...new Set([
        ...searchPath.split(path.delimiter).filter(Boolean),
        path.dirname(process.execPath),
        path.join(homedir(), ".local", "bin"),
        ...(process.platform === "darwin"
          ? ["/opt/homebrew/bin", "/usr/local/bin"]
          : []),
      ]),
    ].join(path.delimiter);
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
  constructor({ runner = runProcess, testEnv = {} } = {}) {
    this.runner = runner;
    this.testEnv = testEnv;
    this.repositories = new Map();
  }

  async #facts(target) {
    const rootText = await checked(
      this.runner,
      "git",
      ["rev-parse", "--show-toplevel"],
      {
        cwd: target,
      },
    );
    const root = await realpath(rootText);
    const commonText = await checked(
      this.runner,
      "git",
      ["rev-parse", "--git-common-dir"],
      {
        cwd: target,
      },
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
      {
        cwd: requested,
      },
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
      try {
        await checked(
          this.runner,
          "git",
          ["rev-parse", "--verify", `${baseBranch}^{commit}`],
          { cwd: registered.canonical },
        );
      } catch {
        throw new Error(
          `Base branch ${baseBranch} is unavailable. Fetch or create the correct local ${baseBranch} branch, then retry execution.`,
        );
      }
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
      {
        cwd: target,
      },
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

  async #fingerprint(root, head, statusText, baseHead) {
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
        .update(
          `${head}\0${baseHead}\0${statusText}\0${staged}\0${contentFingerprint}`,
        )
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
      ["status", "--porcelain=v1", "-z", "--untracked-files=all"],
      { cwd: root, maxOutput: 2_000_000 },
    );
    const baseHead = await checked(
      this.runner,
      "git",
      ["rev-parse", "development"],
      { cwd: root },
    );
    const trackedDiff = await checked(
      this.runner,
      "git",
      ["diff", "--no-ext-diff", "--binary", baseHead],
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
    const fingerprints = await this.#fingerprint(
      root,
      head,
      statusText,
      baseHead,
    );
    return {
      head,
      baseHead,
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
        env: this.testEnv,
        timeoutMs: 300_000,
        maxOutput: 20_000,
      });
    } catch (error) {
      return {
        passed: false,
        summary: bounded(redact(error.message, this.testEnv), SUMMARY_LIMIT),
      };
    }
    return {
      passed:
        result.code === 0 &&
        !(
          ["node-test", "npm-test"].includes(profile) &&
          /(?:#|ℹ) tests 0\b/.test(result.stdout)
        ),
      summary: bounded(
        redact(
          [result.stdout, result.stderr].filter(Boolean).join("\n").trim(),
          this.testEnv,
        ),
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

function redact(value, env) {
  let result = String(value ?? "");
  for (const secret of Object.values(env)) {
    if (secret) result = result.replaceAll(secret, "[REDACTED]");
  }
  return result;
}

export class AgentRuntime {
  constructor({
    name,
    executable,
    runner = runProcess,
    persistence = false,
    env = {},
  } = {}) {
    this.name = name;
    this.executable = executable;
    this.runner = runner;
    this.persistence = persistence;
    this.env = env;
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
    mcpConfig,
    mcpTools,
    timeoutMs = 60 * 60_000,
  } = {}) {
    const capabilities = await this.detectCapabilities();
    if (!capabilities.available) throw new Error(capabilities.reason);
    if (signal?.aborted) throw abortError();
    const args = this.buildArgs({
      readOnly,
      mcpConfig,
      mcpTools,
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
      if (event.text) event.text = redact(event.text, this.env);
      if (event.error) event.error = redact(event.error, this.env);
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
      env: this.env,
      input: `${String(prompt ?? "")}\n\nIf a human decision or permission is needed, begin your final response with DEVQUEST_WAITING_INPUT and ask the question. Do not claim implementation is complete while blocked.`,
      signal,
      timeoutMs,
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
      return this.start({ cwd, prompt, onEvent, signal, readOnly, timeoutMs });
    }
    if (result.code !== 0)
      throw commandError(this.executable, args, {
        ...result,
        stderr: redact(result.stderr, this.env),
        stdout: redact(result.stdout, this.env),
      });
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
      "--allowedTools",
      "--tools",
      "--strict-mcp-config",
      "--mcp-config",
      ...(this.persistence ? [] : ["--no-session-persistence"]),
    ];
  }

  buildArgs({ readOnly, sessionId, mcpConfig, mcpTools }) {
    if (readOnly && !this.help.includes("--permission-mode")) {
      throw new Error(
        "Installed Claude Code CLI lacks permission-mode support",
      );
    }
    const args = ["--print", "--output-format", "stream-json", "--verbose"];
    if (!this.persistence) args.push("--no-session-persistence");
    args.push(
      "--permission-mode",
      mcpConfig || readOnly ? "dontAsk" : "acceptEdits",
    );
    args.push(
      "--tools",
      mcpConfig
        ? "Read"
        : readOnly
          ? "Read,Glob,Grep"
          : "Read,Glob,Grep,Edit,Write",
    );
    args.push(
      "--strict-mcp-config",
      "--mcp-config",
      mcpConfig || '{"mcpServers":{}}',
    );
    if (mcpConfig || readOnly)
      args.push(
        "--allowedTools",
        mcpConfig ? ["Read", ...mcpTools].join(",") : "Read,Glob,Grep",
      );
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
  constructor({
    bridge,
    runner = runProcess,
    runtime,
    mcpConfigPath,
    mcpServer = "atlassian",
  } = {}) {
    this.bridge = bridge;
    this.runner = runner;
    this.runtime = runtime;
    this.mcpConfigPath = mcpConfigPath;
    this.mcpServer = mcpServer;
  }

  close() {
    this.closed = true;
    this.controller?.abort();
  }

  async #direct(name, input) {
    const file = input.skillPaths?.[name];
    if (!/^[a-zA-Z0-9_-]+$/.test(this.mcpServer))
      throw new Error("Invalid Jira MCP server name");
    if (!file || !this.runtime)
      throw new Error(`Configure the local ${name} skill path and Claude Code`);
    const skill = await readFile(file, "utf8");
    if (skill.length > 100000)
      throw new Error("Local skill exceeds 100,000 characters");
    let server;
    try {
      server = JSON.parse(await readFile(this.mcpConfigPath, "utf8"))
        .mcpServers?.[this.mcpServer];
    } catch {
      throw new Error("Configure Claude Code's Atlassian MCP connection first");
    }
    if (!server)
      throw new Error("Configure Claude Code's Atlassian MCP connection first");
    const directory = await mkdtemp(path.join(tmpdir(), "devquest-jira-"));
    const mcpConfig = path.join(directory, "mcp.json");
    this.controller = new AbortController();
    const methods = [
      "getAccessibleAtlassianResources",
      "getVisibleJiraProjects",
      "getJiraProjectIssueTypesMetadata",
      "getJiraIssueTypeMetaWithFields",
      "getJiraIssue",
      "lookupJiraAccountId",
      "searchJiraIssuesUsingJql",
    ];
    if (name === "upload") methods.push("createJiraIssue");
    try {
      await writeFile(
        mcpConfig,
        JSON.stringify({ mcpServers: { [this.mcpServer]: server } }),
        {
          mode: 0o600,
        },
      );
      const output =
        name === "appendix"
          ? '{"content":"complete weighted Markdown appendix"}'
          : '{"results":[{"taskId":"provided execution task UUID","key":"actual Jira key","url":"actual issue URL","complete":false}]}';
      if (this.closed) throw abortError();
      const result = await this.runtime.start({
        cwd: path.dirname(input.planPath),
        readOnly: true,
        signal: this.controller.signal,
        timeoutMs: 120000,
        mcpConfig,
        mcpTools: methods.map((method) => `mcp__${this.mcpServer}__${method}`),
        prompt: `Use this local skill: ${file}\n${skill}\nApplication input:\n${JSON.stringify(input)}\nUse the configured MCP server ${this.mcpServer}; tool prefixes in the skill may differ. Resolve the actual tenant through this connection; do not use another developer's cached memory path. The approved plan is the only source of work. Read it and the appendix when supplied. ${name === "upload" ? "Publish only the provided tasks, never the whole backlog. Create at most maxIssues actual Jira issues from the application input. Preserve any existing task.jira.issues mappings; search and verify existing issues before creation to recover an interrupted request using the stable idempotency key. This button authorizes this sample or this batch only; return after verifying the created issues. Return every verified issue mapping, with complete=false while any appendix issues for that execution task remain uncreated. Set complete=true only after verifying all its issues. Keep issue descriptions tied to the stable execution-task idempotency key for recovery." : "Only read Jira metadata; do not create issues. Return the appendix in your response; do not write files."} Return only JSON ${output}. Do not commit, push or merge. If required input is missing, return JSON {"waitingInput":true,"question":"what is missing","results":[]} and stop.`,
      });
      let parsed;
      try {
        parsed = JSON.parse(
          result.text
            .trim()
            .replace(/^DEVQUEST_WAITING_INPUT\s*/, "")
            .replace(/^```(?:json)?\s*/, "")
            .replace(/\s*```$/, ""),
        );
      } catch {
        throw new Error(
          "Local Jira skill did not return structured results; inspect the skill output and retry",
        );
      }
      if (
        (parsed.waitingInput || result.waitingInput) &&
        !parsed.results?.length
      )
        throw new Error(
          String(parsed.question || "Local Jira skill needs input").slice(
            0,
            1000,
          ),
        );
      return parsed;
    } finally {
      this.controller = null;
      await rm(directory, { recursive: true, force: true });
    }
  }

  async appendix(input) {
    if (!this.bridge?.executable) {
      const parsed = await this.#direct("appendix", input);
      if (
        typeof parsed.content !== "string" ||
        !parsed.content.trim() ||
        parsed.content.length > 100000
      )
        throw new Error("Jira appendix generation failed");
      return parsed.content;
    }
    const result = await this.runner(
      this.bridge.executable,
      this.bridge.args ?? [],
      {
        input: JSON.stringify({ ...input, operation: "generate-appendix" }),
        timeoutMs: 120000,
        maxOutput: 110000,
      },
    );
    let parsed;
    try {
      parsed = JSON.parse(result.stdout);
    } catch {
      throw new Error("Jira appendix bridge returned invalid JSON");
    }
    if (parsed.waitingInput)
      throw new Error(
        String(parsed.question || "Jira appendix needs more input").slice(
          0,
          1000,
        ),
      );
    if (
      result.code !== 0 ||
      typeof parsed.content !== "string" ||
      !parsed.content.trim() ||
      parsed.content.length > 100000
    )
      throw new Error("Jira appendix generation failed");
    return parsed.content;
  }

  async publish({
    quest,
    tasks,
    planPath,
    appendixPath,
    skillPaths,
    publicationPhase,
    maxIssues,
  }) {
    const normalizedTasks = tasks.map((task) => {
      if (!task.id)
        throw new Error("Every Jira task requires a stable task id");
      return {
        ...task,
        taskId: task.id,
        idempotencyKey: `devquest:${quest.id}:${task.id}`,
      };
    });
    if (!this.bridge?.executable) {
      const parsed = await this.#direct("upload", {
        quest,
        tasks: normalizedTasks,
        planPath,
        appendixPath,
        skillPaths,
        publicationPhase,
        maxIssues,
      });
      if (!Array.isArray(parsed.results))
        throw new Error("Local Jira skill returned invalid mappings");
      const allowed = new Set(normalizedTasks.map((task) => task.taskId));
      return parsed.results
        .filter(
          (item) =>
            item &&
            allowed.has(item.taskId) &&
            /^[A-Z][A-Z0-9_]*-\d+$/.test(item.key),
        )
        .map((item) => ({ ...item, complete: item.complete === true }));
    }
    const result = await this.runner(
      this.bridge.executable,
      this.bridge.args ?? [],
      {
        input: JSON.stringify({
          operation: "publish",
          quest,
          tasks: normalizedTasks,
          planPath,
          appendixPath,
          skillPaths,
          publicationPhase,
          maxIssues,
        }),
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
      .map(({ taskId, key, url, complete }) => ({
        taskId,
        key,
        ...(typeof complete === "boolean" ? { complete } : {}),
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

export class GoogleChatWebhook {
  constructor({ webhookEnv, fetch = globalThis.fetch } = {}) {
    this.webhookEnv = webhookEnv;
    this.fetch = fetch;
  }
  async send({ text, requestId }) {
    const raw = this.webhookEnv && process.env[this.webhookEnv];
    if (!raw)
      throw new Error("Configure the Google Chat webhook environment variable");
    let url;
    try {
      url = new URL(raw);
    } catch {
      throw new Error("Invalid Google Chat webhook configuration");
    }
    if (
      url.protocol !== "https:" ||
      url.host !== "chat.googleapis.com" ||
      !/^\/v1\/spaces\/[^/]+\/messages$/.test(url.pathname) ||
      url.username ||
      url.password
    )
      throw new Error("Use an HTTPS Google Chat incoming webhook");
    url.searchParams.set("requestId", requestId);
    let response;
    try {
      response = await this.fetch(url, {
        method: "POST",
        redirect: "error",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
        signal: AbortSignal.timeout(15000),
      });
    } catch {
      throw new Error(
        "Google Chat delivery was not confirmed; retry the saved request",
      );
    }
    if (!response.ok)
      throw new Error(`Google Chat delivery failed (HTTP ${response.status})`);
    let result;
    try {
      result = await response.json();
    } catch {
      throw new Error(
        "Google Chat delivery was not confirmed; retry the saved request",
      );
    }
    if (!result.name)
      throw new Error(
        "Google Chat returned no message receipt; retry the saved request",
      );
    return { name: result.name };
  }
}

export class GitHubProvider extends SourceControlProvider {
  constructor({ runner = runProcess, git } = {}) {
    super();
    this.runner = runner;
    this.git = git;
  }

  async requestReview({ path: cwd, number, reviewers }) {
    if (
      !Array.isArray(reviewers) ||
      !reviewers.length ||
      reviewers.some(
        (name) => !/^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,37}[a-zA-Z0-9])?$/.test(name),
      )
    )
      throw new Error("Provide GitHub reviewer usernames");
    await checked(
      this.runner,
      "gh",
      ["pr", "edit", String(number), "--add-reviewer", reviewers.join(",")],
      { cwd },
    );
    const result = JSON.parse(
      await checked(
        this.runner,
        "gh",
        ["pr", "view", String(number), "--json", "reviewRequests"],
        {
          cwd,
        },
      ),
    );
    const requested = new Set(
      (result.reviewRequests || []).map((reviewer) =>
        reviewer.login?.toLowerCase(),
      ),
    );
    if (reviewers.some((name) => !requested.has(name.toLowerCase())))
      throw new Error(
        "Reviewer assignment was not confirmed; retry the review request",
      );
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
        "number,url,headRefOid",
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
    return prs[0]
      ? {
          url: prs[0].url,
          number: Number(prs[0].number),
          head: prs[0].headRefOid,
        }
      : null;
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
    const head = await checked(this.runner, "git", ["rev-parse", "HEAD"], {
      cwd: worktreePath,
    });
    const verified = (pr) => {
      if (!pr || pr.head !== head)
        throw new Error(
          "PR does not contain the reviewed commit; retry publication",
        );
      return { url: pr.url, number: pr.number };
    };
    if (existing?.head === head) return verified(existing);
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
    if (existing)
      return verified(await this.#find(worktreePath, branch, baseBranch));
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
    const recovered = await this.#find(worktreePath, branch, baseBranch);
    if (recovered) return verified(recovered);
    throw commandError("gh", ["pr", "create"], creation);
  }
}

export async function createAdapters(config = {}) {
  const runner = config.runner ?? config.processRunner ?? runProcess;
  const testEnv = {};
  for (const name of config.testing?.credentialEnv || []) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) || !process.env[name])
      throw new Error(`Missing test credential environment variable: ${name}`);
    testEnv[name] = process.env[name];
  }
  const skillPaths = { ...config.workflow?.skills };
  for (const [name, folder] of Object.entries({
    appendix: "create-appendix-task-list",
    upload: "upload-task-to-jira",
    commit: "commit-message-creator",
  })) {
    const file = path.join(homedir(), ".claude", "skills", folder, "SKILL.md");
    if (!skillPaths[name] && (await exists(file))) skillPaths[name] = file;
  }
  for (const [name, folder] of Object.entries({
    brainstorming: "brainstorming",
    planning: "writing-plans",
    implementation: "executing-plans",
  })) {
    if (skillPaths[name]) continue;
    const files = [];
    for await (const file of glob(
      path.join(
        homedir(),
        ".claude/plugins/cache/*/superpowers/*/skills",
        folder,
        "SKILL.md",
      ),
    ))
      files.push(file);
    files.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    if (files.length) skillPaths[name] = files.at(-1);
  }
  config = { ...config, workflow: { ...config.workflow, skills: skillPaths } };
  const runtimes = {
    codex: new CodexRuntime({
      runner,
      env: testEnv,
      ...(config.runtimes?.codex ?? {}),
    }),
    claude: new ClaudeCodeRuntime({
      runner,
      env: testEnv,
      ...(config.runtimes?.claude ?? {}),
    }),
  };
  const git = new GitAdapter({ runner, testEnv });
  return {
    config,
    git,
    workflow: {
      async instructions(name) {
        const file = skillPaths[name];
        if (!file) return "";
        const content = await readFile(file, "utf8");
        if (content.length > 100000)
          throw new Error("Local skill exceeds 100,000 characters");
        return `Local skill (${file}):\n${content}\nDevQuest constraints: return the requested artifact in this turn. Use the existing worktree. Do not commit, push, merge, or publish external records. Application actions own publication and approvals.`;
      },
    },
    chat: new GoogleChatWebhook({ ...config.googleChat, fetch: config.fetch }),
    runtimes,
    skill: new SkillRunner({
      runner,
      runtime: runtimes.claude,
      mcpConfigPath:
        config.workflow?.jiraMcpConfig || path.join(homedir(), ".claude.json"),
      mcpServer: config.workflow?.jiraMcpServer || "atlassian",
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

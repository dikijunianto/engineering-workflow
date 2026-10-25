// Actual installed CLI + local synthetic API only. No paid provider or Jira calls.
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir, homedir } from "node:os";
import path from "node:path";
import { SkillRunner, ClaudeCodeRuntime, runProcess } from "../src/adapters.js";
const root = await mkdtemp(path.join(tmpdir(), "devquest-native-skill-local-"));
await mkdir(path.join(root, "config"));
const source = path.join(
  homedir(),
  ".claude/skills/create-appendix-task-list/SKILL.md",
);
const body = await readFile(source, "utf8");
await writeFile(
  path.join(root, "mcp.json"),
  JSON.stringify({
    mcpServers: {
      atlassian: { type: "http", url: "https://synthetic.invalid/never-used" },
    },
  }),
);
const prepared = await new SkillRunner({
  mcpConfigPath: path.join(root, "mcp.json"),
}).prepareAppendix({
  skillPaths: { appendix: source },
  planContent: "# Synthetic plan only",
});
let calls = 0,
  instructionsLoaded = false;
const events = [];
let invocationArguments, availableTools;
const model = "claude-sonnet-5-5";
const server = http.createServer(async (req, res) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (req.url.includes("count_tokens")) {
    res.writeHead(200, { "content-type": "application/json" });
    return res.end('{"input_tokens":1}');
  }
  if (!req.url.startsWith("/v1/messages")) {
    res.writeHead(404);
    return res.end();
  }
  calls++;
  if (calls > 2) {
    res.writeHead(400);
    return res.end(
      '{"error":{"type":"invalid_request_error","message":"Local two-request limit"}}',
    );
  }
  const input = JSON.parse(Buffer.concat(chunks).toString());
  availableTools ||= input.tools?.map((t) => t.name);
  instructionsLoaded ||=
    JSON.stringify(input.messages).includes(
      "Every line item in the task list must trace back",
    ) &&
    JSON.stringify(input.messages).includes(
      "No duplicate appendix category within a task",
    );
  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
  });
  const send = (type, data) =>
    res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
  send("message_start", {
    message: {
      id: `msg_${calls}`,
      type: "message",
      role: "assistant",
      model,
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: 1, output_tokens: 0 },
    },
  });
  const tool = calls === 1;
  send("content_block_start", {
    index: 0,
    content_block: tool
      ? { type: "tool_use", id: "skill_local_probe", name: "Skill", input: {} }
      : { type: "text", text: "" },
  });
  send("content_block_delta", {
    index: 0,
    delta: tool
      ? {
          type: "input_json_delta",
          partial_json: JSON.stringify({ skill: prepared.nativeSkill }),
        }
      : {
          type: "text_delta",
          text: JSON.stringify({
            waitingInput: true,
            question: "Synthetic local probe: no live Jira metadata supplied.",
          }),
        },
  });
  send("content_block_stop", { index: 0 });
  send("message_delta", {
    delta: { stop_reason: tool ? "tool_use" : "end_turn", stop_sequence: null },
    usage: { output_tokens: 1 },
  });
  send("message_stop", {});
  res.end();
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;
try {
  const runtime = new ClaudeCodeRuntime({
    env: {
      ANTHROPIC_API_KEY: "devquest-local-synthetic",
      ANTHROPIC_BASE_URL: base,
      CLAUDE_CODE_OAUTH_TOKEN: "",
      CLAUDE_CONFIG_DIR: path.join(root, "config"),
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
    },
    runner: (file, args, options) => {
      if (args.includes("--print")) invocationArguments = args;
      return runProcess(file, args, options);
    },
  });
  const result = await runtime.start({
    cwd: root,
    readOnly: true,
    executionPolicy: { nestedSpawning: false },
    nativeSkill: prepared.nativeSkill,
    skillPluginDir: prepared.skillPluginDir,
    mcpConfig: '{"mcpServers":{}}',
    mcpTools: [],
    route: { resolvedModel: model, resolvedEffort: "low" },
    timeoutMs: 30000,
    onEvent: (event) => events.push(event),
    prompt:
      "Local protocol test only. Invoke the supplied native skill, then stop for missing Jira metadata. No repositories, no Jira, no generated appendix.",
  });
  assert.equal(calls, 2);
  assert.ok(
    !availableTools.some((t) =>
      ["Bash", "Edit", "Write", "Agent", "Task", "WebFetch"].includes(t),
    ),
  );
  assert.ok(events.some((e) => e.type === "native-skill"));
  assert.ok(instructionsLoaded);
  assert.equal(
    body,
    await readFile(
      path.join(
        prepared.skillPluginDir,
        "skills/create-appendix-task-list/SKILL.md",
      ),
      "utf8",
    ),
  );
  console.log(
    JSON.stringify({
      result: "PASS",
      modelProvider: "localhost synthetic responses only",
      paidCalls: 0,
      jiraCalls: 0,
      nativeSkill: prepared.nativeSkill,
      registry: events.find((e) => e.type === "skill-registry"),
      invocationAccepted: true,
      cliArguments: invocationArguments,
      availableTools,
      instructionsLoaded,
      sourceHash: prepared.skillHash,
      waitingInput: JSON.parse(result.text).waitingInput,
      artifactGenerated: false,
    }),
  );
} finally {
  await prepared.cleanup();
  await new Promise((resolve) => server.close(resolve));
  await rm(root, { recursive: true, force: true });
}

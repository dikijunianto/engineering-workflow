// Actual Claude CLI, localhost model/MCP stubs only; no provider billing or real Jira.
import http from "node:http";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir, homedir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { SkillRunner, ClaudeCodeRuntime } from "../src/adapters.js";
const root = await mkdtemp(path.join(tmpdir(), "devquest-mcp-policy-"));
let writes = 0,
  denied = false,
  sent = false;
const rpc = http.createServer(async (req, res) => {
  if (req.method !== "POST") {
    res.writeHead(405);
    return res.end();
  }
  let raw = "";
  for await (const c of req) raw += c;
  const msg = JSON.parse(raw);
  if (msg.id === undefined) {
    res.writeHead(202);
    return res.end();
  }
  let result;
  if (msg.method === "initialize")
    result = {
      protocolVersion: msg.params.protocolVersion,
      capabilities: { tools: {} },
      serverInfo: { name: "synthetic", version: "1" },
    };
  else if (msg.method === "tools/list")
    result = {
      tools: [
        {
          name: "createJiraIssue",
          description: "Fake write counter",
          inputSchema: {
            type: "object",
            properties: { projectKey: { type: "string" }, summary: { type: "string" } },
          },
        },
      ],
    };
  else if (msg.method === "tools/call") {
    writes++;
    result = { content: [{ type: "text", text: "Synthetic write" }] };
  }
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result }));
});
await new Promise((r) => rpc.listen(0, "127.0.0.1", r));
const prefix = "/" + randomUUID();
const model = http.createServer(async (req, res) => {
  let raw = "";
  for await (const c of req) raw += c;
  if (req.url.includes("count_tokens")) return res.end('{"input_tokens":1}');
  const body = JSON.parse(raw);
  let block = { type: "text", text: "Local policy test complete." };
  if (body.tools?.some((t) => t.name === "mcp__atlassian__createJiraIssue")) {
    if (!sent) {
      sent = true;
      block = {
        type: "tool_use",
        id: "policy_forbidden",
        name: "mcp__atlassian__createJiraIssue",
        input: { projectKey: "FCAD", summary: "T1.1 — Fake forbidden write" },
      };
    } else {
      denied = JSON.stringify(body.messages).includes(
        "DevQuest blocked this MCP operation before dispatch",
      );
    }
  }
  res.writeHead(200, { "content-type": "text/event-stream" });
  const send = (type, data) =>
    res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
  send("message_start", {
    message: {
      id: "local",
      type: "message",
      role: "assistant",
      model: body.model,
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: 1, output_tokens: 0 },
    },
  });
  send("content_block_start", {
    index: 0,
    content_block: block.type === "tool_use" ? { ...block, input: {} } : { type: "text", text: "" },
  });
  send("content_block_delta", {
    index: 0,
    delta:
      block.type === "tool_use"
        ? { type: "input_json_delta", partial_json: JSON.stringify(block.input) }
        : { type: "text_delta", text: block.text },
  });
  send("content_block_stop", { index: 0 });
  send("message_delta", {
    delta: {
      stop_reason: block.type === "tool_use" ? "tool_use" : "end_turn",
      stop_sequence: null,
    },
    usage: { output_tokens: 1 },
  });
  send("message_stop", {});
  res.end();
});
await new Promise((r) => model.listen(0, "127.0.0.1", r));
let prepared;
try {
  const config = path.join(root, "mcp.json");
  await writeFile(
    config,
    JSON.stringify({
      mcpServers: {
        atlassian: { type: "http", url: `http://127.0.0.1:${rpc.address().port}/mcp` },
      },
    }),
  );
  const skill = new SkillRunner({ mcpConfigPath: config });
  prepared = await skill.prepareAppendix({
    quest: { jiraContext: { project: "FCAD" } },
    skillPaths: {
      appendix: path.join(homedir(), ".claude/skills/create-appendix-task-list/SKILL.md"),
    },
  });
  const runtime = new ClaudeCodeRuntime({ env: { CLAUDE_CONFIG_DIR: root } });
  await runtime.start({
    ...prepared,
    cwd: root,
    readOnly: true,
    executionPolicy: { nestedSpawning: false },
    route: { resolvedModel: "claude-sonnet-5-5", resolvedEffort: "low" },
    localApiUrl: `http://127.0.0.1:${model.address().port}${prefix}`,
    mcpTools: ["mcp__atlassian__createJiraIssue"],
    timeoutMs: 30000,
    prompt: "Local adversarial policy test only.",
  });
  assert.ok(sent);
  assert.ok(
    denied,
    "App-owned hook must deny the attempted write even when CLI allowedTools includes it",
  );
  assert.equal(writes, 0);
  console.log(
    JSON.stringify({
      result: "PASS",
      nativeHookDenied: true,
      remoteWriteCalls: writes,
      paidCalls: 0,
      realJiraCalls: 0,
    }),
  );
} finally {
  await prepared?.cleanup();
  model.closeAllConnections();
  rpc.closeAllConnections();
  await Promise.all([new Promise((r) => model.close(r)), new Promise((r) => rpc.close(r))]);
  await rm(root, { recursive: true, force: true });
}

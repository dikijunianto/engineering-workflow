import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, stat, mkdir, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ConfluenceMcpAdapter } from "../src/confluence-mcp.js";
import { confluenceReads, mcpDecision, mcpGuardSettings } from "../src/jira-mcp-policy.js";
import { preflightJiraMcp } from "../src/jira-mcp.js";
import { ClaudeCodeRuntime, createAdapters } from "../src/adapters.js";

const host = "https://docs.example.test";
const mainUrl = host + "/wiki/spaces/ENG/pages/1/Main";
const cloudId = "verified-tenant";
const tools = confluenceReads.map((method) => ({
  name: "mcp__atlassian__" + method,
  input_schema: {
    type: "object",
    properties:
      method === "getConfluencePage"
        ? { contentFormat: { enum: ["html", "markdown", "adf"] } }
        : {},
  },
}));
const page = (id, body, title = "Page " + id) => ({
  id: String(id),
  title,
  version: { number: 3 },
  body: { html: { value: body } },
});
async function fixture(
  t,
  {
    responses = {},
    resources = [{ id: cloudId, url: host }],
    inventory = tools,
    spill = false,
    timeoutMethod,
    shouldTimeout,
    timeoutOnce = false,
  } = {},
) {
  const directory = await mkdtemp(path.join(tmpdir(), "devquest-confluence-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const configPath = path.join(directory, "claude.json");
  await writeFile(
    configPath,
    JSON.stringify({
      mcpServers: {
        atlassian: { type: "http", url: "https://mcp.example.test/mcp" },
        unrelated: { type: "stdio", command: "never-start" },
      },
    }),
  );
  const calls = [],
    sessions = [];
  let timedOut = false;
  const runtime = {
    name: "Claude Code",
    env: { CLAUDE_CONFIG_DIR: directory },
    async start(options) {
      assert.match(options.localApiUrl, /^http:\/\/127\.0\.0\.1:/);
      assert.equal(options.readOnly, true);
      assert.equal(options.mcpGuard.stage, "confluence");
      const selected = JSON.parse(await readFile(options.mcpConfig, "utf8"));
      assert.deepEqual(Object.keys(selected.mcpServers), ["atlassian"]);
      assert.equal((await stat(options.mcpConfig)).mode & 0o777, 0o600);
      const sessionId = "12345678-1234-1234-1234-123456789012";
      options.onEvent({
        type: "mcp-status",
        sessionId,
        servers: [{ name: "atlassian", status: "connected" }],
      });
      sessions.push({ directory: path.dirname(options.mcpConfig), policy: options.mcpGuard });
      const messages = [];
      for (let i = 0; i < 30; i++) {
        const response = await fetch(options.localApiUrl + "/v1/messages", {
          method: "POST",
          body: JSON.stringify({ model: "local-only", tools: inventory, messages }),
        });
        const events = (await response.text())
          .split("\n")
          .filter((line) => line.startsWith("data: "))
          .map((line) => JSON.parse(line.slice(6)));
        const block = events.find(
          (e) => e.type === "content_block_start" && e.content_block.type === "tool_use",
        )?.content_block;
        if (!block) return { text: "Local read completed" };
        const input = JSON.parse(
          events.find((e) => e.type === "content_block_delta").delta.partial_json,
        );
        assert.equal(mcpDecision(options.mcpGuard, block.name, input), true);
        const method = block.name.split("__").at(-1);
        if (shouldTimeout?.(method, input) || (method === timeoutMethod && (!timedOut || !timeoutOnce))) {
          timedOut = true;
          throw new Error("claude timed out after 120000ms");
        }
        calls.push({ method, input });
        const result =
          method === "getAccessibleAtlassianResources"
            ? resources
            : typeof responses[method] === "function"
              ? responses[method](input)
              : responses[input.pageId];
        let content = [{ type: "text", text: JSON.stringify(result?.error || result || {}) }];
        if (spill && method === "getConfluencePage") {
          const cwd = await realpath(options.artifactDirectory);
          const folder = path.join(
            directory,
            "projects",
            cwd.replace(/[^a-zA-Z0-9]/g, "-"),
            sessionId,
            "tool-results",
          );
          await mkdir(folder, { recursive: true });
          const file = path.join(folder, "mcp-atlassian-getConfluencePage-1792990582303.txt");
          await writeFile(file, JSON.stringify({ content: { totalCount: 1, nodes: [result] } }));
          content = "Response exceeds maximum allowed tokens. Output has been saved to " + file;
        }
        messages.push(
          { role: "assistant", content: [{ ...block, input }] },
          {
            role: "user",
            content: [
              {
                type: "tool_result",
                tool_use_id: block.id,
                ...(result?.error ? { is_error: true } : {}),
                content,
              },
            ],
          },
        );
      }
      throw new Error("Test exceeded bounded loop");
    },
  };
  return {
    adapter: new ConfluenceMcpAdapter({ host, runtime, mcpConfigPath: configPath }),
    calls,
    sessions,
    runtime,
    configPath,
  };
}

test("Confluence MCP verifies its tenant and live schema without reading pages or invoking a model", async (t) => {
  const f = await fixture(t);
  const proof = await f.adapter.inspect();
  assert.equal(proof.cloudId, cloudId);
  assert.deepEqual(proof.pageFormat, { contentFormat: "markdown" });
  assert.deepEqual(
    f.calls.map((c) => c.method),
    ["getAccessibleAtlassianResources"],
  );
  await assert.rejects(stat(f.sessions[0].directory), { code: "ENOENT" });
});

test("Confluence MCP imports nested selected-site pages, retains versions and warns on omissions", async (t) => {
  const f = await fixture(t, {
    responses: {
      1: page(
        1,
        '<a href="/wiki/spaces/ENG/pages/2/Child">Child</a><a href="https://outside.test/wiki/pages/9">Outside</a><a href="/wiki/pages/3">Missing</a><ri:page ri:content-title="Named &amp; Notes"/>',
      ),
      2: page(2, '<p>Child</p><a href="/wiki/pages/99">Nested</a>'),
      99: page(99, "Nested requirement"),
      3: { error: "Not found" },
      4: page(4, "<p>Named content</p>", "Named & Notes"),
      searchConfluenceUsingCql: (input) => {
        assert.equal(input.cql, 'type = page AND title = "Named & Notes"');
        return { results: [{ content: { id: "4", title: "Named & Notes", type: "page" } }] };
      },
    },
  });
  const result = await f.adapter.fetch(mainUrl);
  assert.deepEqual(
    result.sources.map((s) => [s.id, s.version]),
    [
      ["1", 3],
      ["2", 3],
      ["4", 3],
      ["99", 3],
    ],
  );
  assert.match(result.content, /# Page 1/);
  assert.ok(result.warnings.some((warning) => warning.includes("outside.test")));
  assert.match(result.warnings[0], /linked Confluence page 3/);
  assert.ok(
    f.calls.every(
      (c) => c.method === "getAccessibleAtlassianResources" || c.input.cloudId === cloudId,
    ),
  );
  assert.ok(!f.calls.some((c) => c.input.pageId === "9"));
  assert.equal(f.sessions.length, 2);
  assert.equal(f.sessions[0].policy.cloudId, undefined);
  assert.equal(f.sessions[1].policy.cloudId, cloudId);
  await assert.rejects(stat(f.sessions[1].directory), { code: "ENOENT" });
});

test("Confluence MCP rejects wrong hosts, missing tenant, missing tools and incomplete main content", async (t) => {
  const f = await fixture(t);
  await assert.rejects(
    f.adapter.fetch("http://docs.example.test/wiki/pages/1"),
    /configured Confluence host/,
  );
  await assert.rejects(
    f.adapter.fetch("https://outside.test/wiki/pages/1"),
    /configured Confluence host/,
  );
  assert.equal(f.calls.length, 0);
  const missing = await fixture(t, { resources: [{ id: "other", url: "https://other.test" }] });
  await assert.rejects(missing.adapter.inspect(), /missing or ambiguous/);
  const toolsMissing = await fixture(t, {
    inventory: tools.filter((t) => !t.name.endsWith("getConfluencePage")),
  });
  await assert.rejects(toolsMissing.adapter.inspect(), /does not expose getConfluencePage/);
  const incomplete = await fixture(t, {
    responses: { 1: { id: "wrong", title: "Wrong page", body: "Do not use" } },
  });
  await assert.rejects(incomplete.adapter.fetch(mainUrl), /matching page ID/);
});

test("Confluence MCP enforces body/page limits and rejects ambiguous title resolution", async (t) => {
  const f = await fixture(t, {
    responses: {
      1: page(1, '<a href="/wiki/pages/2">2</a><a href="/wiki/pages/3">3</a>'),
      2: { error: "unavailable" },
    },
  });
  f.adapter.maxPages = 2;
  const result = await f.adapter.fetch(mainUrl);
  assert.equal(f.calls.filter((c) => c.method === "getConfluencePage").length, 2);
  assert.ok(result.warnings.some((w) => /Omitted 1/.test(w)));
  const big = await fixture(t, { responses: { 1: page(1, "a".repeat(200)) } });
  big.adapter.maxBodyBytes = 100;
  await assert.rejects(big.adapter.fetch(mainUrl), /body limit/);
  const ambiguous = await fixture(t, {
    responses: {
      1: page(1, '<ri:page ri:content-title="Duplicate"/>'),
      searchConfluenceUsingCql: () => ({
        results: [
          { id: "2", title: "Duplicate" },
          { id: "3", title: "Duplicate" },
        ],
      }),
    },
  });
  const partial = await ambiguous.adapter.fetch(mainUrl);
  assert.equal(partial.sources.length, 1);
  assert.match(partial.warnings[0], /one verified page/);
});

test("Confluence read policy denies all writes, unknown tools, other tenants and broad searches before dispatch", () => {
  const policy = { server: "atlassian", stage: "confluence", cloudId };
  for (const method of [
    "createJiraIssue",
    "updateJiraIssue",
    "createConfluencePage",
    "updateConfluencePage",
    "deleteConfluencePage",
    "getJiraIssue",
    "unknown",
  ])
    assert.equal(mcpDecision(policy, "mcp__atlassian__" + method, { cloudId }), false);
  assert.equal(
    mcpDecision(policy, "mcp__other__getConfluencePage", {
      cloudId,
      pageId: "1",
      contentFormat: "html",
    }),
    false,
  );
  assert.equal(
    mcpDecision(policy, "mcp__atlassian__getConfluencePage", {
      cloudId: "other",
      pageId: "1",
      contentFormat: "html",
    }),
    false,
  );
  assert.equal(
    mcpDecision({ ...policy, cloudId: undefined }, "mcp__atlassian__getConfluencePage", {
      cloudId,
      pageId: "1",
      contentFormat: "html",
    }),
    false,
  );
  assert.equal(
    mcpDecision(policy, "mcp__atlassian__searchConfluenceUsingCql", {
      cloudId,
      cql: "type = page",
      limit: 2,
    }),
    false,
  );
  assert.equal(
    mcpDecision(policy, "mcp__atlassian__searchConfluenceUsingCql", {
      cloudId,
      cql: 'type = page AND title = "Exact"',
      limit: 2,
    }),
    true,
  );
  assert.ok(mcpGuardSettings(policy).PreToolUse);
  const runtime = new ClaudeCodeRuntime();
  runtime.help = "--permission-mode --restricted --disallowedTools";
  const args = runtime.buildArgs({
    readOnly: true,
    mcpConfig: "/private/test.json",
    mcpTools: ["mcp__atlassian__getConfluencePage"],
    mcpGuard: policy,
    executionPolicy: { nestedSpawning: false },
  });
  assert.ok(!args[args.indexOf("--disallowedTools") + 1].includes("mcp__*"));
  assert.match(args[args.indexOf("--disallowedTools") + 1], /Edit,Write/);
});

test("local dispatcher blocks a write even when a read workflow requests one", async (t) => {
  const f = await fixture(t);
  const isolated = path.join(path.dirname(f.configPath), "selected.json");
  await writeFile(
    isolated,
    JSON.stringify({
      mcpServers: { atlassian: { type: "http", url: "https://mcp.example.test" } },
    }),
    { mode: 0o600 },
  );
  await assert.rejects(
    preflightJiraMcp({
      start: f.runtime.start.bind(f.runtime),
      prepared: {
        artifactDirectory: tmpdir(),
        mcpConfig: isolated,
        mcpGuard: { server: "atlassian", stage: "confluence" },
        mcpTools: ["mcp__atlassian__createConfluencePage"],
      },
      readWorkflow: () => ({ request: ["createConfluencePage", {}] }),
    }),
    /denied before dispatch/,
  );
  assert.equal(f.calls.length, 0);
});

test("adapter factory selects MCP explicitly and preserves REST compatibility", async () => {
  const adapters = await createAdapters({ confluence: { provider: "atlassian-mcp", host } });
  assert.ok(adapters.confluence instanceof ConfluenceMcpAdapter);
  const rest = await createAdapters({ confluence: { host } });
  assert.equal(rest.confluence.constructor.name, "ConfluenceAdapter");
});

test("Confluence close aborts pending reads and new imports cannot launch a model call", async (t) => {
  const f = await fixture(t);
  f.adapter.close();
  await assert.rejects(f.adapter.inspect(), /stopping/);
  assert.equal(f.calls.length, 0);
  const runtime = new ClaudeCodeRuntime();
  await assert.rejects(
    runtime.start({ mcpGuard: { stage: "confluence" } }),
    /paid model execution is not permitted/,
  );
});

test("large Confluence page spilled by the native MCP client is imported from its owned file", async (t) => {
  const f = await fixture(t, {
    spill: true,
    responses: {
      1: {
        id: "1",
        title: "Large PRD",
        body: "<p>" + "content ".repeat(28000) + "</p>",
        version: { number: 7 },
      },
    },
  });
  const result = await f.adapter.fetch(mainUrl);
  assert.equal(result.sources[0].version, 7);
  assert.ok(result.content.length > 200000);
  assert.ok(result.warnings.every((warning) => /descendant discovery/.test(warning)));
});

test("Markdown imports traverse nested and reference-style links without fetching external documents", async (t) => {
  const f = await fixture(t, {
    responses: {
      1: {
        id: "1",
        title: "Markdown PRD",
        body: {
          markdown: {
            value:
              "## Requirements\n\n[Child][ref] and [outside](https://outside.test/wiki/pages/8).\n\n[ref]: /wiki/pages/2",
          },
        },
        version: { number: 2 },
      },
      2: {
        id: "2",
        title: "Child",
        body: "Preserved text. https://docs.example.test/wiki/pages/3",
        version: { number: 1 },
      },
      3: page(3, "Grandchild"),
    },
  });
  const result = await f.adapter.fetch(mainUrl);
  assert.deepEqual(
    result.sources.map((s) => s.id),
    ["1", "2", "3"],
  );
  assert.match(result.content, /## Requirements/);
  assert.equal(f.calls.filter((c) => c.method === "getConfluencePage").length, 3);
  assert.ok(
    f.calls
      .filter((c) => c.method === "getConfluencePage")
      .every((c) => c.input.contentFormat === "markdown"),
  );
});

test("Confluence reconnects once after a page-read timeout and completes without duplicate source entries", async (t) => {
  const f = await fixture(t, {
    timeoutMethod: "getConfluencePage",
    timeoutOnce: true,
    responses: { 1: page(1, "Retained requirement") },
  });
  const result = await f.adapter.fetch(mainUrl);
  assert.equal(result.sources.length, 1);
  assert.match(result.content, /Retained requirement/);
  assert.equal(f.sessions.length, 3);
  assert.deepEqual(
    f.calls.map((c) => c.method),
    ["getAccessibleAtlassianResources", "getConfluencePage"],
  );
});

test("repeated read timeouts stop after one reconnect and identify the stalled tool", async (t) => {
  const f = await fixture(t, { timeoutMethod: "getConfluencePage" });
  await assert.rejects(
    f.adapter.fetch(mainUrl),
    (error) => error.code === "MCP_READ_TIMEOUT" && /getConfluencePage/.test(error.message),
  );
  assert.equal(f.sessions.length, 3);
  assert.equal(f.calls.filter((c) => c.method === "getConfluencePage").length, 0);
  assert.equal(f.adapter.controllers.size, 0);
  await assert.rejects(stat(f.sessions[0].directory), { code: "ENOENT" });
});

test("Confluence uses one overall deadline and aborts a stalled runtime", async (t) => {
  const f = await fixture(t);
  f.adapter.timeoutMs = 30;
  let aborted = false,
    starts = 0;
  f.runtime.start = (options) =>
    new Promise((resolve, reject) => {
      starts++;
      options.signal.addEventListener(
        "abort",
        () => {
          aborted = true;
          reject(new Error("Operation aborted"));
        },
        { once: true },
      );
    });
  await assert.rejects(f.adapter.fetch(mainUrl), /timed out after 1 seconds during connecting/);
  assert.equal(aborted, true);
  assert.equal(starts, 1);
  assert.equal(f.adapter.controllers.size, 0);
});

test("Confluence does not reconnect on authentication or permission failures", async (t) => {
  const f = await fixture(t);
  let starts = 0;
  f.runtime.start = async () => {
    starts++;
    throw new Error("403 permission denied");
  };
  await assert.rejects(f.adapter.inspect(), /403 permission denied/);
  assert.equal(starts, 1);
});

test("resource-discovery tool timeouts retain their stage and use only one reconnect", async (t) => {
  const f = await fixture(t, { resources: { error: "MCP error -32001: Request timed out" } });
  await assert.rejects(
    f.adapter.inspect(),
    (error) =>
      error.code === "MCP_READ_TIMEOUT" && /getAccessibleAtlassianResources/.test(error.message),
  );
  assert.equal(f.sessions.length, 2);
  assert.ok(f.calls.every((c) => c.method === "getAccessibleAtlassianResources"));
});

test("verified descendant discovery finds an unlinked child and warns about pagination", async (t) => {
  const f = await fixture(t, {
    inventory: tools.map(tool => tool.name.endsWith("__searchConfluenceUsingCql")
      ? { ...tool, input_schema: { properties: { cql: { type: "string" }, limit: { type: "number" } } } }
      : tool),
    responses: {
      1: page(1, "Root"),
      2: page(2, "Unlinked child"),
      searchConfluenceUsingCql: ({ cql }) => {
        assert.equal(cql, "type = page AND ancestor = 1");
        return { results: [{ content: { id: "2", type: "page" } }], _links: { next: "/next" } };
      },
    },
  });
  const result = await f.adapter.fetch(mainUrl);
  assert.deepEqual(result.sources.map(source => source.id), ["1", "2"]);
  assert.match(result.warnings.join(" "), /result limit/);
  assert.equal(mcpDecision({ server: "atlassian", stage: "confluence", cloudId, mainId: "1" },
    "mcp__atlassian__searchConfluenceUsingCql", { cloudId, cql: "type = page AND ancestor = 2", limit: 10 }), false);
});

test("large imports cross the old transcript cap and resume completed pages after a timeout", async (t) => {
  let blocked = true;
  const f = await fixture(t, {
    shouldTimeout: (method, input) => blocked && method === "getConfluencePage" && input.pageId === "3",
    responses: {
      1: page(1, "[two](/wiki/pages/2) [three](/wiki/pages/3) [four](/wiki/pages/4) [five](/wiki/pages/5) [six](/wiki/pages/6) " + "a".repeat(850_000)),
      ...Object.fromEntries([2, 3, 4, 5, 6].map(id => [id, page(id, "b".repeat(850_000))])),
    },
  });
  const progress = [];
  const options = { importId: "fixture", onProgress: message => progress.push(message) };
  await assert.rejects(f.adapter.fetch(mainUrl, options), /timed out/);
  blocked = false;
  const result = await f.adapter.fetch(mainUrl, options);
  assert.ok(result.content.length > 5_000_000);
  assert.deepEqual(f.calls.filter(call => call.method === "getConfluencePage").map(call => call.input.pageId), ["1", "2", "3", "4", "5", "6"]);
  assert.ok(progress.some(message => message.startsWith("Resuming")));
  assert.match(progress.at(-1), /6 pages imported/);
});

import { mkdtemp, mkdir, writeFile, rm, realpath } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { preflightJiraMcp } from "../src/jira-mcp.js";
import { mcpDecision, mcpGuardSettings, jiraMetadataReads, jiraPublishReads } from "../src/jira-mcp-policy.js";
import { jiraEvidence } from "./jira-fixture.js";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const policy = { server: "atlassian", project: "FCAD", stage: "appendix" };
const prepared = {
  mcpGuard: policy,
  mcpTools: jiraMetadataReads.map((m) => "mcp__atlassian__" + m),
  artifactDirectory: "/tmp",
};
async function stub(
  t,
  {
    missingTool,
    skillProof,
    unknownSkill,
    disconnected,
    authentication,
    invalidField,
    absentField,
    spill,
    escapeSpill,
    truncated,
    publication,
  } = {},
) {
  const calls = [];
  const configDirectory = await mkdtemp(path.join(tmpdir(), "devquest-mcp-test-"));
  t.after(() => rm(configDirectory, { recursive: true, force: true }));
  const sessionId = "12345678-1234-1234-1234-123456789012";
  const evidence = jiraEvidence("FCAD");
  const schema = JSON.parse(evidence[3].content[0].text);
  if (invalidField) schema.fields.customfield_11543.schema.type = "string";
  if (absentField) delete schema.fields.customfield_11543;
  const api = http.createServer(async (req, res) => {
    let text = "";
    for await (const c of req) text += c;
    const rpc = JSON.parse(text);
    calls.push(rpc.params.name);
    const data = publication && rpc.params.name === "searchJiraIssuesUsingJql" ? { issues: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } } }
      : publication && rpc.params.name === "lookupJiraAccountId" ? [{ accountId: "synthetic-user", active: true }] :
      rpc.params.name === "getJiraIssueTypeMetaWithFields"
        ? schema
        : JSON.parse(evidence.find((e) => e.method === rpc.params.name).content[0].text);
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify({
        jsonrpc: "2.0",
        id: rpc.id,
        result: { content: [{ type: "text", text: JSON.stringify(data) }] },
      }),
    );
  });
  await new Promise((r) => api.listen(0, "127.0.0.1", r));
  t.after(() => new Promise((r) => api.close(r)));
  const start = async (options) => {
    assert.ok(options.localApiUrl.startsWith("http://127.0.0.1:"));
    assert.equal(options.readOnly, true);
    options.onEvent({
      type: "mcp-status",
      sessionId,
      servers: [
        {
          name: "atlassian",
          status: disconnected ? "failed" : authentication ? "needs-auth" : "connected",
        },
      ],
    });
    if (skillProof) options.onEvent({ type: "skill-registry", registered: !unknownSkill });
    const messages = [];
    const tools =
      disconnected || authentication
        ? [{ name: "Read" }]
        : (publication ? jiraPublishReads : jiraMetadataReads)
            .filter((m) => m !== missingTool)
            .map((m) => ({ name: "mcp__atlassian__" + m, input_schema: { type: "object" } }));
    if (skillProof) tools.push({ name: "Skill", input_schema: { type: "object" } });
    for (let i = 0; i < 12; i++) {
      const response = await fetch(options.localApiUrl + "/v1/messages", {
        method: "POST",
        body: JSON.stringify({ model: "synthetic", tools, messages }),
      });
      const text = await response.text();
      const events = text
        .split("\n")
        .filter((l) => l.startsWith("data: "))
        .map((l) => JSON.parse(l.slice(6)));
      const call = events.find(
        (e) => e.type === "content_block_start" && e.content_block.type === "tool_use",
      )?.content_block;
      if (!call) return { text: "Local preflight finished" };
      const input = JSON.parse(
        events.find((e) => e.type === "content_block_delta").delta.partial_json,
      );
      if (call.name === "Skill") {
        assert.equal(input.skill, options.nativeSkill);
        messages.push({ role: "assistant", content: [{ ...call, input }] }, { role: "user", content: [{ type: "tool_result", tool_use_id: call.id, content: "Approved skill instructions loaded" }] });
        continue;
      }
      assert.equal(mcpDecision(options.mcpGuard || policy, call.name, input), true);
      if (call.name.endsWith("getJiraIssueTypeMetaWithFields"))
        assert.equal(input.requiredFieldsOnly, false);
      const remote = await fetch(`http://127.0.0.1:${api.address().port}/mcp`, {
        method: "POST",
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: i,
          method: "tools/call",
          params: { name: call.name.split("__").at(-1), arguments: input },
        }),
      }).then((r) => r.json());
      let content = remote.result.content;
      if (
        (spill || escapeSpill || truncated) &&
        call.name.endsWith("getJiraIssueTypeMetaWithFields")
      ) {
        if (truncated)
          content =
            "Error: result exceeds maximum allowed tokens. Output has been saved to another location.";
        else {
          const cwd = await realpath(prepared.artifactDirectory);
          const root = path.join(
            configDirectory,
            "projects",
            cwd.replace(/[^a-zA-Z0-9]/g, "-"),
            sessionId,
            "tool-results",
          );
          await mkdir(root, { recursive: true });
          const file = path.join(escapeSpill ? configDirectory : root, call.id + ".json");
          await writeFile(file, JSON.stringify(content));
          content = `<persisted-output>\nFull output saved to: ${file}\nPreview omitted`;
        }
      }
      messages.push(
        { role: "assistant", content: [{ ...call, input }] },
        { role: "user", content: [{ type: "tool_result", tool_use_id: call.id, content }] },
      );
    }
    throw new Error("Stub exceeded bounded steps");
  };
  return { start, calls, configDirectory };
}

test("localhost MCP/API preflight verifies actual read metadata without generation or write calls", async (t) => {
  const fake = await stub(t);
  const proof = await preflightJiraMcp({
    start: fake.start,
    prepared,
    context: { project: "FCAD", siteUrl: "https://jira.example" },
  });
  assert.equal(proof.status, "READY");
  assert.equal(proof.options.length, 2);
  assert.deepEqual(fake.calls, jiraMetadataReads);
});

test("MCP preflight distinguishes authentication, disconnected and missing tools before generation", async (t) => {
  for (const [config, reason] of [
    [{ authentication: true }, /needs-auth/],
    [{ disconnected: true }, /failed/],
    [{ missingTool: "getJiraIssueTypeMetaWithFields" }, /Required Atlassian read tool unavailable/],
  ]) {
    const fake = await stub(t, config);
    await assert.rejects(
      preflightJiraMcp({ start: fake.start, prepared, context: { project: "FCAD" } }),
      reason,
    );
    assert.equal(fake.calls.length, 0);
  }
});

test("missing/incompatible appendix metadata fails closed with no writes", async (t) => {
  for (const config of [{ invalidField: true }, { absentField: true }]) {
    const fake = await stub(t, config);
    await assert.rejects(
      preflightJiraMcp({ start: fake.start, prepared, context: { project: "FCAD" } }),
      /multiselect|absent/,
    );
    assert.ok(fake.calls.every((m) => jiraMetadataReads.includes(m)));
  }
});

test("app-owned MCP hook denies every non-read operation for generation before dispatch", () => {
  const forbidden = [
    "createJiraIssue",
    "editJiraIssue",
    "deleteJiraIssue",
    "transitionJiraIssue",
    "addCommentToJiraIssue",
    "createConfluencePage",
    "unknownWrite",
  ];
  for (const method of forbidden)
    assert.equal(mcpDecision(policy, "mcp__atlassian__" + method, { projectKey: "FCAD" }), false);
  assert.equal(mcpDecision(policy, "mcp__bitbucket__readFile", {}), false);
  assert.equal(
    mcpDecision(policy, "mcp__atlassian__getJiraIssueTypeMetaWithFields", {
      projectIdOrKey: "OTHER",
    }),
    false,
  );
  const guard = fileURLToPath(new URL("../src/jira-mcp-policy.js", import.meta.url));
  const result = JSON.parse(
    execFileSync(
      process.execPath,
      [guard, "--check", Buffer.from(JSON.stringify(policy)).toString("base64")],
      {
        input: JSON.stringify({
          tool_name: "mcp__atlassian__createJiraIssue",
          tool_input: { projectKey: "FCAD" },
        }),
        encoding: "utf8",
      },
    ),
  );
  assert.equal(result.hookSpecificOutput.permissionDecision, "deny");
  assert.ok(mcpGuardSettings(policy).PreToolUse[0].matcher.includes("mcp__"));
});

test("spilled native MCP output is read only from the owned session; escapes/truncation are rejected", async (t) => {
  for (const [config, expected] of [
    [{ spill: true }, null],
    [{ escapeSpill: true }, /outside this preflight/],
    [{ truncated: true }, /response was truncated/],
  ]) {
    const fake = await stub(t, config);
    const request = preflightJiraMcp({
      start: fake.start,
      prepared,
      context: { project: "FCAD" },
      configDirectory: fake.configDirectory,
    });
    if (expected) await assert.rejects(request, expected);
    else assert.equal((await request).options.length, 2);
  }
});

test('publishing guard permits only approved task IDs in the verified tenant/project', () => {
  const publishing={...policy,stage:'publish',cloudId:'verified-cloud',siteUrl:'https://jira.example',taskIds:['T1.1']};
  const input={cloudId:'verified-cloud',projectKey:'FCAD',summary:'T1.1 — Approved title'};
  assert.equal(mcpDecision(publishing,'mcp__atlassian__createJiraIssue',input),true);
  assert.equal(mcpDecision(publishing,'mcp__atlassian__createJiraIssue',{...input,cloudId:'other-cloud'}),false);
  assert.equal(mcpDecision(publishing,'mcp__atlassian__createJiraIssue',{...input,projectKey:'OTHER'}),false);
  assert.equal(mcpDecision(publishing,'mcp__atlassian__createJiraIssue',{...input,summary:'T2.1 — Unapproved task'}),false);
});

 test("managed skill registration and invocation are verified locally before paid generation", async t => {
  for (const unknownSkill of [false, true]) {
    const fake = await stub(t, { skillProof: true, unknownSkill });
    const request = () => preflightJiraMcp({ start: fake.start, prepared: { ...prepared, nativeSkill: "devquest-jira:create-appendix-task-list" }, context: { project: "FCAD", siteUrl: "https://jira.example" }, requireSkillProof: true });
    if (unknownSkill) await assert.rejects(request(), /not registered/);
    else assert.equal((await request()).skillVerified, true);
    assert.deepEqual(fake.calls, jiraMetadataReads);
  }
});

test("publication metadata, Epic, assignee and marker search use deterministic localhost API and read-only MCP", async t => {
  const { SkillRunner } = await import("../src/adapters.js");
  const fake = await stub(t, { publication: true });
  const dir = await mkdtemp(path.join(tmpdir(), "devquest-publication-read-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const content = await (await import("node:fs/promises")).readFile(new URL("./fixtures/jira-appendix.md", import.meta.url), "utf8");
  const file = path.join(dir, "approved.md"); await writeFile(file, content);
  const manifest = { project: "FCAD", epic: "FCAD-1", appendixIdempotencyPrefix: "devquest:synthetic:appendix:", entries: [{ appendixTaskId: "T1.1" }] };
  const receiver = { validateUpload() {}, runtime: { start: fake.start }, prepareAppendix: async () => ({ ...prepared, mcpGuard: { ...policy, stage: "verify" }, mcpTools: jiraPublishReads.map(m => "mcp__atlassian__" + m), cleanup() {} }) };
  const result = await SkillRunner.prototype.preflightPublication.call(receiver, {
    quest: { jiraContext: { project: "FCAD", siteUrl: "https://jira.example", epic: "FCAD-1", assignee: "Synthetic Engineer" } },
    appendixPath: file, appendixContent: content, appendixHash: "fixture", publicationManifest: manifest,
    appendixIdempotencyPrefix: manifest.appendixIdempotencyPrefix, appendixTaskMapping: [{ appendixTaskId: "T1.1", executionTaskIds: ["A"] }], existingIssues: [],
  });
  assert.equal(result.project, "FCAD"); assert.equal(result.assigneeAccountId, "synthetic-user");
  assert.equal(result.searchPages.length, 1); assert.equal(result.searchPages[0].visibilityComplete, false);
  assert.deepEqual(fake.calls, [...jiraMetadataReads, "getJiraIssue", "lookupJiraAccountId", "searchJiraIssuesUsingJql"]);
  assert.ok(!fake.calls.some(m => /create|edit|delete|transition/i.test(m)));
});

test("publisher hook requires the exact stable marker and reserves each card before dispatch to prevent repeated creates", async t => {
  const dir = await mkdtemp(path.join(tmpdir(), "devquest-create-guard-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const policy = { server: "atlassian", project: "FCAD", stage: "publish", cloudId: "verified-cloud", taskIds: ["T1.1"], issueMarkers: { "T1.1": "devquest:q:appendix:T1.1" }, reservationDirectory: dir };
  const input = { cloudId: "verified-cloud", projectKey: "FCAD", summary: "T1.1 — Approved", description: "Task\ndevquest:q:appendix:T1.1" };
  assert.equal(mcpDecision(policy, "mcp__atlassian__createJiraIssue", { ...input, description: "devquest:q:appendix:T1.10" }), false);
  const call = () => JSON.parse(execFileSync(process.execPath, [fileURLToPath(new URL("../src/jira-mcp-policy.js", import.meta.url)), "--check", Buffer.from(JSON.stringify(policy)).toString("base64")], { input: JSON.stringify({ tool_name: "mcp__atlassian__createJiraIssue", tool_input: input }), encoding: "utf8" })).hookSpecificOutput.permissionDecision;
  assert.equal(call(), "allow"); assert.equal(call(), "deny");
});

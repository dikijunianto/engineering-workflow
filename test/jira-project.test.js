import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { jiraContext, verifyJiraProject, jiraIssuePage } from "../src/jira-project.js";
import { jiraEvidence } from "./jira-fixture.js";
import { readyPublisherInput } from "./publisher-input.js";
const markdown = await readFile(new URL("./fixtures/jira-appendix.md", import.meta.url), "utf8");
const context = (project) => ({
  project,
  epic: `${project}-1`,
  assignee: "Synthetic Engineer",
  siteUrl: "https://jira.example",
  projectUrl: `https://jira.example/jira/software/c/projects/${project}`,
});

test("Jira search decodes REST and actual MCP connection envelopes without inventing missing pages", () => {
  const empty = jiraIssuePage({ issues: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } } });
  assert.deepEqual(empty.issues, []); assert.equal(empty.isLast, true);
  const page = jiraIssuePage([{ type: "text", text: JSON.stringify({ issues: { nodes: [{ key: "FCAD-1" }], pageInfo: { hasNextPage: true, endCursor: "next" } } }) }]);
  assert.equal(page.nextPageToken, "next"); assert.equal(page.isLast, false); assert.equal(page.issues[0].key, "FCAD-1");
  assert.equal(jiraIssuePage({ error: "permission denied" }), null);
  assert.equal(jiraIssuePage({ issues: [], total: 0 }).total, 0);
});

test("actual FCAD cascading Story Point Type v2 preserves its verified Technical parent option", () => {
  const evidence = jiraEvidence("FCAD"), fields = JSON.parse(evidence[3].content[0].text).fields;
  fields.customfield_11312.schema.type = "option-with-child";
  evidence[3].content = { fields: { legacy: { name: "Story Point Type", schema: { type: "option" }, allowedValues: [{ id: "old", value: "Other" }] }, ...fields } };
  evidence[3].content.fields = { customfield_10008: { name: "Epic Link", schema: { type: "any" } }, ...evidence[3].content.fields };
  const verified = verifyJiraProject(context("FCAD"), markdown, evidence);
  assert.equal(verified.storyTypeField, "customfield_11312");
  assert.equal(verified.technicalOptionId, "10949");
  assert.equal(verified.parentField, "parent");
});

test("FFE and FCAD use verified metadata, exact approved Markdown and target-project Epic", () => {
  for (const project of ["FFE", "FCAD"]) {
    const result = verifyJiraProject(
      jiraContext(context(project)),
      markdown,
      jiraEvidence(project),
    );
    assert.equal(result.project, project);
    assert.equal(result.weightField, "customfield_10751");
    assert.equal(result.parentField, "parent");
    assert.equal(result.projectUrl, context(project).projectUrl);
  }
});

test("project and site URLs, optional Epic and project membership are validated without invented URLs", () => {
  assert.equal(jiraContext({ project: "FCAD" }).epic, "");
  assert.equal(jiraContext({ project: "FCAD" }).projectUrl, undefined);
  for (const input of [
    { project: "FCAD", epic: "FFE-1" },
    { ...context("FCAD"), siteUrl: "https://other.example" },
    { ...context("FCAD"), projectUrl: "https://jira.example/jira/software/c/projects/FFE" },
    { ...context("FCAD"), siteUrl: "https://user:secret@jira.example" },
    { ...context("FCAD"), projectUrl: "http://jira.example/projects/FCAD" },
  ])
    assert.throws(() => jiraContext(input));
  const evidence = jiraEvidence();
  evidence[1].content = { values: [{ id: "100", key: "FCAD" }] };
  const result = verifyJiraProject(
    { project: "FCAD", epic: "FCAD-1", assignee: "Synthetic" },
    markdown,
    evidence,
  );
  assert.equal(result.siteUrl, "https://jira.example");
  assert.equal(result.projectUrl, undefined);
});

test("missing metadata, authentication, fields, categories and Epic relationships block publication", () => {
  assert.throws(() => verifyJiraProject(context("FCAD"), markdown, []), /not verified/);
  const denied = jiraEvidence();
  denied[3] = { ...denied[3], error: true, content: "401: Please log in" };
  assert.throws(() => verifyJiraProject(context("FCAD"), markdown, denied), /401: Please log in/);
  for (const update of [
    (fields) => delete fields.customfield_11543,
    (fields) => (fields.customfield_11543.allowedValues = []),
    (fields) => (fields.customfield_11543.allowedValues[0].value = "Unknown category"),
    (fields) =>
      (fields.requiredOther = {
        name: "Business unit",
        required: true,
        schema: { type: "string" },
      }),
    (fields) => delete fields.parent,
  ]) {
    const evidence = jiraEvidence();
    const data = JSON.parse(evidence[3].content[0].text);
    update(data.fields);
    evidence[3].content = data;
    assert.throws(() => verifyJiraProject(context("FCAD"), markdown, evidence));
  }
  const wrongEpic = jiraEvidence();
  wrongEpic[4].content = {
    key: "FCAD-1",
    fields: { project: { key: "FFE" }, issuetype: { name: "Epic" } },
  };
  assert.throws(
    () => verifyJiraProject(context("FCAD"), markdown, wrongEpic),
    /Epic was not verified/,
  );
  assert.throws(
    () =>
      verifyJiraProject(
        { ...context("FCAD"), siteUrl: "https://other.example" },
        markdown,
        jiraEvidence(),
      ),
    /authenticated target site/,
  );
});

test("metadata from a different project, tenant or issue type is not accepted", () => {
  for (const key of ["projectIdOrKey", "cloudId", "issueTypeId"]) {
    const evidence = jiraEvidence();
    evidence[3].input[key] = "other";
    assert.throws(
      () => verifyJiraProject(context("FCAD"), markdown, evidence),
      /multiselect field/,
    );
  }
});

test("FCAD native skill dry run verifies read-only before enabling the fake publish call", async (t) => {
  const { mkdtemp, writeFile, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const path = await import("node:path");
  const { SkillRunner } = await import("../src/adapters.js");
  const dir = await mkdtemp(path.join(tmpdir(), "devquest project dry run "));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const skillPath = path.join(dir, "SKILL.md"),
    appendixPath = path.join(dir, "approved.md"),
    mcpConfigPath = path.join(dir, "claude.json");
  await writeFile(
    skillPath,
    "---\nname: upload-task-to-jira\n---\nSynthetic installed skill fixture",
  );
  await writeFile(appendixPath, markdown);
  await writeFile(
    mcpConfigPath,
    JSON.stringify({ mcpServers: { atlassian: { type: "http", url: "https://mcp.example" } } }),
  );
  const calls = [];
  let missing = false;
  const skill = new SkillRunner({
    mcpConfigPath,
    runtime: {
      start: async (input) => {
        calls.push(input);
        assert.equal(input.nativeSkill, "devquest-jira:upload-task-to-jira");
        assert.equal(input.readOnly, true);
        assert.equal(input.executionPolicy.nestedSpawning, false);
        assert.ok(input.prompt.includes(JSON.stringify(markdown)));
        assert.ok(input.prompt.includes(context("FCAD").projectUrl));
        input.onEvent({ type: "native-skill" });
        if (!input.mcpTools.includes("mcp__atlassian__createJiraIssue")) {
          if (!missing) for (const evidence of jiraEvidence()) input.onEvent(evidence);
          return { text: '{"prepared":true}' };
        }
        if (!missing) input.onEvent({ type: "jira-read", method: "getJiraIssue", input: { issueIdOrKey: "FCAD-2" }, content: { key: "FCAD-2", fields: { project: { key: "FCAD" }, description: "devquest:q:appendix:T1.1" } } });
        return {
          text: JSON.stringify({
            results: [
              { taskId: "execution-1", appendixTaskId: "T1.1", key: "FCAD-2", complete: true },
            ],
          }),
        };
      },
    },
  });
  const input = readyPublisherInput({
    quest: { id: "q", jiraContext: context("FCAD") },
    appendixPath,
    appendixContent: markdown,
    skillPaths: { upload: skillPath },
    tasks: [{ id: "execution-1" }],
    maxIssues: 1,
  });
  assert.equal((await skill.publish(input))[0].key, "FCAD-2");
  assert.equal(calls.length, 1);
  assert.ok(calls[0].mcpTools.includes("mcp__atlassian__createJiraIssue"));
  missing = true;
  calls.length = 0;
  await assert.rejects(skill.publish({ ...input, verifiedCapabilities: null }), /input contract/);
  assert.equal(calls.length, 0);
  await assert.rejects(skill.publish(input), /unconfirmed issue key/);
  assert.equal(calls.length, 1);
});

test("incomplete field pages and non-writable fields are not accepted as publishing capability", () => {
  const partial = jiraEvidence();
  const fields = JSON.parse(partial[3].content[0].text).fields;
  partial[3].content = {
    startAt: 0,
    total: 20,
    values: Object.entries(fields).map(([fieldId, field]) => ({ fieldId, ...field })),
  };
  assert.throws(
    () => verifyJiraProject(context("FCAD"), markdown, partial),
    /pagination is incomplete/,
  );
  const readonly = jiraEvidence();
  const data = JSON.parse(readonly[3].content[0].text);
  data.fields.customfield_11543.operations = [];
  readonly[3].content = data;
  assert.throws(() => verifyJiraProject(context("FCAD"), markdown, readonly), /cannot be set/);
});

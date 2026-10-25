import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { ACTIONS } from "../src/engine.js";
import { uiFixture } from "./ui-fixture.js";
import { Marked } from "marked";

test("compact workspace presents operational links without decorative or empty dashboard sections", async () => {
  const data = uiFixture();
  data.quests[0].sprint = "";
  const app = await frontend(data);
  const before = JSON.stringify(data);
  app.location.hash = "#home";
  app.ui.render();
  assert.match(app.html(), /aria-label="Workspace summary"/);
  assert.match(app.html(), /href="#agents"[^>]*><strong>1<\/strong> running agent/);
  assert.match(app.html(), /href="#repositories"[^>]*><strong>2<\/strong> repositories/);
  assert.match(app.html(), /data-action="new-quest"/);
  assert.doesNotMatch(app.html(), /hero-quote|stat-number|A greater world|Your next great idea|No sprint assigned/);
  assert.equal(app.element("#sidebar-sprint").hidden, true);
  assert.equal(JSON.stringify(data), before);
  assert.equal(app.requests.length, 0);
  data.quests[0].sprint = "Sprint <24>";
  app.ui.render();
  assert.equal(app.element("#sidebar-sprint").hidden, false);
  assert.match(app.element("#sidebar-sprint").innerHTML, /Sprint &lt;24&gt;/);
});

test("project rows omit empty progress and internal IDs while retaining navigation and delete controls", async () => {
  const data = uiFixture();
  data.tasks = [];
  data.quests[0].sprint = "";
  const app = await frontend(data);
  app.location.hash = "#quests";
  app.ui.render();
  assert.match(app.html(), /No tasks yet/);
  assert.match(app.html(), /href="#quest\/quest-ui-fixture\/overview"/);
  assert.match(app.html(), /data-action="delete-project"/);
  assert.doesNotMatch(app.html(), /<progress|No sprint assigned|QUEST-UI/);
});

test("project list delete and restore controls use confirmed typed actions and recoverable history", async () => {
  const data = uiFixture();
  const quest = data.quests[0];
  quest.updatedAt = "2026-10-20T00:00:00.000Z";
  const app = await frontend(data);
  app.location.hash = "#quests";
  app.ui.render();
  assert.match(app.html(), /data-action="delete-project"/);
  assert.match(app.html(), /href="#quests\/deleted"/);
  assert.match(app.html(), /<\/a><div class="task-actions">/);
  const click = (action) => app.listeners.click({ target: {
    closest: (selector) => selector === "[data-action]" ? { dataset: { action, questId: quest.id } } : null,
  } });
  await click("delete-project");
  assert.equal(app.requests.length, 0);
  assert.match(app.element("#dialog-content").innerHTML, /Type the project title to confirm/);
  assert.match(app.element("#dialog-content").innerHTML, /worktrees are preserved/);
  const submit = async (form, values) => app.listeners.submit({ preventDefault() {}, target: { closest: () => ({
    dataset: { form }, values, querySelector: () => ({}),
  }) } });
  await submit("delete-project", { questId: quest.id, confirmTitle: quest.title, expectedUpdatedAt: quest.updatedAt, reason: "Incorrect PRD" });
  assert.deepEqual(app.requests.at(-1), { type: "DELETE_QUEST", questId: quest.id, confirmTitle: quest.title, expectedUpdatedAt: quest.updatedAt, reason: "Incorrect PRD" });
  data.quests = data.quests.filter((item) => item.id !== quest.id);
  data.deletedQuests = [{ ...quest, deletedAt: "2026-10-20T00:01:00.000Z", deletionReason: "Canceled <unsafe>" }];
  app.location.hash = "#quests/deleted";
  app.ui.render();
  assert.match(app.html(), /data-action="restore-project"/);
  assert.match(app.html(), /Canceled &lt;unsafe&gt;/);
  assert.doesNotMatch(app.html(), /<unsafe>/);
  await click("restore-project");
  assert.match(app.element("#dialog-content").innerHTML, /automation will remain stopped/);
  await submit("restore-project", { questId: quest.id, deletedAt: data.deletedQuests[0].deletedAt });
  assert.deepEqual(app.requests.at(-1), { type: "RESTORE_QUEST", questId: quest.id, deletedAt: data.deletedQuests[0].deletedAt });
  assert.ok(app.requests.every((item) => ["DELETE_QUEST", "RESTORE_QUEST"].includes(item.type)));
  app.location.hash = `#quest/${quest.id}/overview`;
  app.ui.render();
  assert.match(app.html(), /Project deleted/);
  assert.match(app.html(), /Restore this project/);
});

test("Skills page distinguishes portable declarations, external setup and unassessed support", async () => {
  const data = uiFixture();
  const base = {
    id: "skill-1", name: "Writing <unsafe>", description: "Clear explanations", revision: 1,
    path: "/skills/writing/SKILL.md", sourceHash: "a".repeat(64), sourceHints: [],
    updatedAt: "2026-10-20T00:00:00Z", declarationConfirmed: true,
    requirements: { mode: "instructions", mcp: [], tools: [], other: "" },
    compatibility: { claude: "DECLARED_COMPATIBLE", codex: "DECLARED_COMPATIBLE" },
  };
  data.skills = [base, { ...base, id: "skill-2", name: "Jira appendix", sourceHints: ["MCP references"],
    requirements: { mode: "external", mcp: ["atlassian <unsafe>"], tools: ["Read"], other: "Jira account required" },
    compatibility: { claude: "REQUIRES_SETUP", codex: "NOT_ASSESSED" } }];
  const app = await frontend(data);
  app.location.hash = "#skills";
  app.ui.render();
  assert.match(app.html(), /Compatible instructions \(declared\)/);
  assert.match(app.html(), /Requires setup/);
  assert.match(app.html(), /Not assessed/);
  assert.match(app.html(), /MCP: atlassian &lt;unsafe&gt; · connection not checked/);
  assert.match(app.html(), /Tool: Read · permission not checked/);
  assert.match(app.html(), /Jira account required/);
  assert.match(app.html(), /Registration does not activate a skill/);
  assert.doesNotMatch(app.html(), /<unsafe>/);
  assert.equal(app.requests.length, 0);
});

test("skill registration inspects source, prefills MCP references, and saves declarations without execution", async () => {
  const inspected = { path: "/canonical/skill/SKILL.md", sourceHash: "fixture-hash", name: "jira-helper", description: "Metadata lookup", sourceHints: ["MCP references"], detectedMcp: ["atlassian"] };
  const app = await frontend(uiFixture(), { INSPECT_SKILL: inspected });
  const click = (button) => app.listeners.click({ target: { closest: (selector) => selector === "[data-action]" ? button : null } });
  await click({ dataset: { action: "register-skill" } });
  assert.match(app.element("#dialog-content").innerHTML, /Declared runtime compatibility/);
  assert.match(app.element("#dialog-content").innerHTML, /Never enter secret values/);
  const preview = {}, error = {};
  const elements = Object.fromEntries(["path", "sourceHash", "name", "description", "mcp", "declarationConfirmed"].map((name) => [name, { value: "", checked: true }]));
  elements.path.value = "/selected/skill";
  const form = { elements, querySelector: (selector) => selector === ".form-error" ? error : preview };
  await click({ dataset: { action: "inspect-skill" }, closest: () => form });
  assert.equal(elements.path.value, inspected.path);
  assert.equal(elements.sourceHash.value, inspected.sourceHash);
  assert.equal(elements.mcp.value, "atlassian");
  assert.equal(elements.declarationConfirmed.checked, false);
  assert.match(preview.textContent, /Compatibility and connections remain untested/);
  const save = { dataset: { form: "skill-registration" }, values: {
    skillId: "", revision: "0", path: inspected.path, sourceHash: inspected.sourceHash,
    name: inspected.name, description: inspected.description, runtimes: ["claude"],
    requirementMode: "external", mcp: "atlassian", tools: "Read, Skill", other: "Read-only Jira account", declarationConfirmed: "on",
  }, querySelector: () => ({}) };
  await app.listeners.submit({ preventDefault() {}, target: { closest: () => save } });
  const payload = app.requests.at(-1);
  assert.equal(payload.type, "REGISTER_SKILL");
  assert.deepEqual(payload.runtimes, ["claude"]);
  assert.deepEqual(payload.requirements, { mode: "external", mcp: ["atlassian"], tools: ["Read", "Skill"], other: "Read-only Jira account" });
  assert.ok(app.requests.every((item) => ["INSPECT_SKILL", "REGISTER_SKILL"].includes(item.type)));
});

// Exercise actual frontend renderers and delegated handlers without a new DOM dependency.
async function frontend(data = uiFixture(), results = {}, session = { token: "test-token", actions: [...ACTIONS] }, dashboardMock) {
  const source = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
  const elements = new Map();
  const element = (selector) => {
    if (!elements.has(selector))
      elements.set(selector, {
        innerHTML: "",
        textContent: "",
        attributes: new Map(),
        classes: new Set(),
        setAttribute(name, value) { this.attributes.set(name, value); },
        getAttribute(name) { return this.attributes.get(name); },
        classList: {
          toggle(name, value) { const classes = element(selector).classes; const enabled = value ?? !classes.has(name); enabled ? classes.add(name) : classes.delete(name); return enabled; },
          contains(name) { return element(selector).classes.has(name); },
        },
        showModal() {},
        close() {},
        focus() {},
      });
    return elements.get(selector);
  };
  const listeners = {},
    requests = [];
  const eventSources = [], reads = [];
  const location = { hash: "#home" };
  const context = {
    Marked,
    dashboardMock,
    document: {
      querySelector: element,
      querySelectorAll: () => [],
      addEventListener: (name, fn) => {
        listeners[name] = fn;
      },
      getElementById: element,
    },
    window: {
      addEventListener: (name, fn) => {
        listeners[name] = fn;
      },
    },
    location,
    URL,
    console,
    setTimeout: () => 0,
    clearTimeout() {},
    EventSource: class { constructor() { eventSources.push(this); } },
    FormData: class {
      constructor(form) {
        this.values = form.values;
      }
      get(name) {
        return this.values[name];
      }
      getAll(name) {
        return this.values[name] || [];
      }
    },
    fetch: async (url, options) => {
      if (!options) reads.push(url);
      if (options) requests.push(JSON.parse(options.body));
      return {
        ok: true,
        json: async () =>
          url === "/api/session"
            ? session
            : url === "/api/state"
              ? data
              : {
                  result: results[JSON.parse(options.body).type] || {
                    id: "created-quest",
                  },
                },
      };
    },
  };
  const ui = await runInNewContext(
    `(async () => {${source.replace('import { Marked } from "/vendor/marked.js";', "").replace('await import("/dashboard.js")', "dashboardMock")}\nreturn { render, questChain, partyCards, badge, runCard, liveOutput, newQuest, addRepository, editArtifact, documentPreview };})()`,
    context,
  );
  return {
    ui,
    data,
    document: context.document,
    location,
    listeners,
    requests,
    eventSources,
    reads,
    element,
    html: () => element("#main").innerHTML,
  };
}

test("all frontend routes retain their populated and empty presentation", async () => {
  for (const populated of [true, false]) {
    const data = uiFixture();
    if (!populated)
      for (const key of ["quests", "tasks", "works", "runs", "artifacts", "events", "repositories"])
        data[key] = [];
    const app = await frontend(data);
    for (const route of [
      "home",
      "quests",
      "repositories",
      "agents",
      "skills",
      "jira",
      "settings",
      ...["overview", "architect", "tasks", "repositories", "artifacts", "activity"].map(
        (t) => `quest/quest-ui-fixture/${t}`,
      ),
    ]) {
      app.location.hash = `#${route}`;
      app.ui.render();
      assert.match(app.html(), /<h1>/, route);
      assert.doesNotMatch(app.html(), /undefined|NaN|Unable to connect/, route);
    }
  }
});

test("Quest chain and party represent saved state without advancing workflow", async () => {
  const app = await frontend(),
    quest = app.data.quests[0];
  const before = JSON.stringify(app.data);
  assert.equal((app.ui.questChain(quest).match(/<li /g) || []).length, 5);
  assert.match(app.ui.questChain(quest), /aria-current="step"[^]*?Build/);
  app.ui.partyCards();
  assert.equal(JSON.stringify(app.data), before);
  for (const state of ["WAITING_INPUT", "INTERRUPTED", "PAUSED", "FAILED"]) {
    app.data.runs.at(-1).state = state;
    assert.ok(app.ui.partyCards().includes(state.replaceAll("_", " ")));
    assert.match(app.ui.questChain(quest), /Needs attention/);
  }
  assert.match(
    app.ui.runCard({ ...app.data.runs.at(-1), state: "INTERRUPTED" }),
    /Progress preserved/,
  );
  assert.doesNotMatch(
    app.ui.runCard({
      ...app.data.runs.at(-1),
      state: "INTERRUPTED",
      summary: "",
    }),
    /The session is running/,
  );
  quest.state = "PRS_CREATED";
  assert.equal((app.ui.questChain(quest).match(/class="done"/g) || []).length, 5);
});

test("retry summaries supersede failed attempts only for the same work", async () => {
  const app = await frontend(),
    quest = app.data.quests[0];
  quest.state = "READY_FOR_PR";
  const review = {
    id: "review-failed",
    questId: quest.id,
    workId: "work-payment",
    purpose: "review",
    runtime: "codex",
    state: "FAILED",
  };
  app.data.runs.push(review);
  assert.match(app.ui.partyCards(), /FAILED/);
  app.data.runs.push({ ...review, id: "review-retry", state: "COMPLETED" });
  assert.doesNotMatch(app.ui.partyCards(), /FAILED/);
  assert.doesNotMatch(app.ui.questChain(quest), /Needs attention/);
  app.data.runs.push({
    ...review,
    id: "review-other",
    workId: "work-notification",
  });
  assert.match(app.ui.partyCards(), /FAILED/);
  assert.match(app.ui.questChain(quest), /Needs attention/);
  app.data.works = [];
  app.location.hash = `#quest/${quest.id}/overview`;
  app.ui.render();
  assert.match(app.html(), /Current work/);
});

test("existing forms, runtime choice and typed action payloads remain available", async () => {
  const app = await frontend();
  app.ui.newQuest();
  for (const field of [
    "kind",
    "sprint",
    "title",
    "sourceType",
    "content",
    "file",
    "url",
    "repositoryIds",
  ])
    assert.ok(app.element("#dialog-content").innerHTML.includes(`name="${field}"`), field);
  app.ui.editArtifact("plan", app.data.quests[0].id);
  assert.match(app.element("#dialog-content").innerHTML, /name="tasks"/);
  app.ui.addRepository();
  assert.match(app.element("#dialog-content").innerHTML, /name="path"/);
  const target = {
    dataset: {
      action: "START_TASK",
      questId: "quest-ui-fixture",
      taskId: "t4",
    },
  };
  app.element('[data-task-runtime="t4"]').value = "claude";
  await app.listeners.click({
    target: { closest: (s) => (s === "[data-action]" ? target : null) },
  });
  assert.deepEqual(app.requests.at(-1), {
    type: "START_TASK",
    questId: "quest-ui-fixture",
    taskId: "t4",
    runtime: "claude",
    acceptWarnings: false,
  });
  const form = {
    dataset: { form: "repository" },
    values: { path: "E:\\Workspace\\example" },
    querySelector: () => ({}),
  };
  await app.listeners.submit({
    preventDefault() {},
    target: { closest: () => form },
  });
  assert.deepEqual(app.requests.at(-1), {
    type: "REGISTER_REPOSITORY",
    path: "E:\\Workspace\\example",
  });
});

test("presentation escapes untrusted names, paths, summaries and Jira URLs", async () => {
  const data = uiFixture();
  data.quests[0].title = '<img src=x onerror="bad()">';
  data.repositories[0].name = "<script>bad()</script>";
  data.repositories[0].path = 'x" onmouseover="bad()';
  data.tasks[0].jira.url = "javascript:bad()";
  const app = await frontend(data);
  for (const route of ["home", "repositories", "jira", "quest/quest-ui-fixture/overview"]) {
    app.location.hash = `#${route}`;
    app.ui.render();
    assert.doesNotMatch(app.html(), /<img|<script>|href="javascript:|title="x" onmouseover/);
  }
});

test("office commit and reviewer dialogs send typed publication actions", async () => {
  const app = await frontend();
  const work = app.data.works[0];
  const click = async (action) =>
    app.listeners.click({
      target: {
        closest: (selector) =>
          selector === "[data-action]"
            ? { dataset: { action, questId: work.questId, workId: work.id } }
            : null,
      },
    });
  await click("create-pr-dialog");
  assert.match(app.element("#dialog-content").innerHTML, /name="commitMessage"/);
  assert.equal(app.requests.length, 0);
  const submit = async (form, values) =>
    app.listeners.submit({
      preventDefault() {},
      target: {
        closest: () => ({
          dataset: { form },
          values,
          querySelector: () => ({}),
        }),
      },
    });
  await submit("create-pr", {
    questId: work.questId,
    workId: work.id,
    commitMessage: "fix : repair task (devquest/test)",
  });
  assert.equal(app.requests.at(-1).type, "CREATE_PR");
  assert.equal(app.requests.at(-1).commitMessage, "fix : repair task (devquest/test)");
  await click("reviewers-dialog");
  assert.match(app.element("#dialog-content").innerHTML, /name="reviewers"/);
  await submit("reviewers", {
    questId: work.questId,
    workId: work.id,
    reviewers: "alice, bob",
  });
  assert.equal(app.requests.at(-1).type, "REQUEST_REVIEW");
  assert.deepEqual(app.requests.at(-1).reviewers, ["alice", "bob"]);
});

test("team handoff remains current and every weighted Jira issue is visible", async () => {
  const app = await frontend();
  const quest = app.data.quests[0];
  quest.state = "REVIEW_HANDOFF";
  assert.match(app.ui.questChain(quest), /Team review/);
  assert.match(app.ui.questChain(quest), /Current stage/);
  const task = app.data.tasks.find((item) => item.jira);
  task.jira.issues = [
    { key: "FFE-101", url: "https://jira.example/FFE-101" },
    { key: "FFE-102", url: "https://jira.example/FFE-102" },
  ];
  app.location.hash = "#jira";
  app.ui.render();
  assert.match(app.html(), /FFE-101/);
  assert.match(app.html(), /FFE-102/);
});

test("waiting brainstorm exposes a finish action without enabling other design stages", async () => {
  const app = await frontend();
  const quest = app.data.quests[0];
  quest.kind = "TECH";
  quest.state = "INTAKE_READY";
  app.data.artifacts = [];
  app.data.runs = [
    {
      id: "brainstorm-wait",
      questId: quest.id,
      purpose: "brainstorm",
      state: "WAITING_INPUT",
      runtime: "claude",
      summary: "Ready for final brief",
    },
  ];
  app.location.hash = `#quest/${quest.id}/overview`;
  app.ui.render();
  assert.match(app.html(), /data-action="FINISH_BRAINSTORM"/);
  assert.doesNotMatch(app.html(), /data-action="GENERATE_TRD"/);
});

test("repository repair form keeps the existing repository ID", async () => {
  const app = await frontend();
  const repo = app.data.repositories[0];
  await app.listeners.click({
    target: {
      closest: (selector) =>
        selector === "[data-action]"
          ? { dataset: { action: "repository-path", repositoryId: repo.id } }
          : null,
    },
  });
  assert.match(app.element("#dialog-content").innerHTML, /name="repositoryId"/);
  const form = {
    dataset: { form: "repository-path" },
    values: { repositoryId: repo.id, path: "/moved/project" },
    querySelector: () => ({}),
  };
  await app.listeners.submit({
    preventDefault() {},
    target: { closest: () => form },
  });
  assert.deepEqual(app.requests.at(-1), {
    type: "UPDATE_REPOSITORY",
    repositoryId: repo.id,
    path: "/moved/project",
  });
});

test("existing Jira form skips publishing and binds the current plan", async () => {
  const app = await frontend();
  const quest = app.data.quests[0];
  quest.state = "PLAN_APPROVED";
  app.data.runs = [];
  for (const task of app.data.tasks) delete task.jira;
  app.location.hash = `#quest/${quest.id}/overview`;
  app.ui.render();
  assert.match(app.html(), /Use existing Jira task/);
  await app.listeners.click({
    target: {
      closest: (selector) =>
        selector === "[data-action]"
          ? { dataset: { action: "existing-jira-dialog", questId: quest.id } }
          : null,
    },
  });
  assert.match(
    app.element("#dialog-content").innerHTML,
    /Appendix generation and Jira upload will be skipped/,
  );
  const plan = app.data.artifacts.filter((a) => a.kind === "plan").at(-1);
  const form = {
    dataset: { form: "existing-jira" },
    values: {
      questId: quest.id,
      planArtifactId: plan.id,
      key: "QA-123",
      url: "",
    },
    querySelector: () => ({}),
  };
  await app.listeners.submit({
    preventDefault() {},
    target: { closest: () => form },
  });
  assert.deepEqual(app.requests.at(-1), {
    type: "USE_EXISTING_JIRA",
    ...form.values,
  });
  app.data.tasks[0].jira = { key: "DEV-1", complete: false };
  app.ui.render();
  assert.doesNotMatch(app.html(), /Use existing Jira task/);
});

test("Architect previews saved Markdown and submits revision-bound specs", async () => {
  const app = await frontend();
  const quest = app.data.quests[0];
  quest.state = "PLAN_APPROVED";
  app.data.runs = [];
  for (const task of app.data.tasks) delete task.jira;
  app.data.artifacts.push({
    id: "spec-fixture",
    questId: quest.id,
    kind: "spec",
    revision: 1,
    content: "# Spec\n<script>alert(1)</script>",
    file: "/local/spec.md",
    trdArtifactId: "old",
  });
  app.location.hash = `#quest/${quest.id}/architect`;
  app.ui.render();
  assert.ok((app.html().match(/data-document=/g) || []).length >= 4);
  assert.doesNotMatch(app.html(), /<details[^>]*\sopen(?:\s|>)/);
  assert.match(app.html(), /<summary class="panel-head">/);
  assert.match(app.html(), /Expand ▾/);
  assert.match(app.html(), /Specification|Implementation plan|Jira tickets/);
  assert.match(app.html(), /\/api\/artifacts\/spec-fixture/);
  assert.match(app.html(), /&lt;script&gt;/);
  assert.doesNotMatch(app.html(), /<script>/);
  assert.match(app.html(), /The TRD changed/);
  assert.match(app.html(), /Generate spec/);
  await app.listeners.click({
    target: {
      closest: (selector) =>
        selector === "[data-action]"
          ? { dataset: { action: "edit-spec", questId: quest.id } }
          : null,
    },
  });
  assert.match(app.element("#dialog-content").innerHTML, /name="trdArtifactId"/);
  const trd = app.data.artifacts.find((a) => a.kind === "trd");
  const form = {
    dataset: { form: "edit-spec" },
    values: { questId: quest.id, trdArtifactId: trd.id, content: "# New spec" },
    querySelector: () => ({}),
  };
  await app.listeners.submit({
    preventDefault() {},
    target: { closest: () => form },
  });
  assert.deepEqual(app.requests.at(-1), { type: "SAVE_SPEC", ...form.values });
});

test("Markdown viewer formats documents, blocks active content and retains source selection", async () => {
  const app = await frontend();
  const content =
    "# Clean document\n\n**Important**\n\n- First\n- Second\n\n| Name | Value |\n| --- | --- |\n| Test | Pass |\n\n```js\nconst count = 1;\n```\n\n<script>alert(1)</script>\n\n[Unsafe](javascript:alert) ![Hidden](https://tracker.test/image)\n\n[Safe](https://example.com/docs)\n\n<!-- devquest-tasks\nprivate metadata\n-->";
  const preview = app.ui.documentPreview("doc-test", "Test", content);
  const viewer = preview.split('<pre class="document markdown-source"')[0];
  assert.match(viewer, /<h1>Clean document<\/h1>/);
  assert.match(viewer, /<strong>Important<\/strong>/);
  assert.match(viewer, /<ul>/);
  assert.match(viewer, /<table>/);
  assert.match(viewer, /<pre><code class="language-js">/);
  assert.doesNotMatch(viewer, /<script>|<img|href="javascript:|private metadata/);
  assert.match(viewer, /href="https:\/\/example.com\/docs"/);
  assert.match(preview, /private metadata/);
  const views = { dataset: {} };
  app.listeners.change({
    target: {
      dataset: { documentView: "doc-test" },
      value: "source",
      closest: () => ({ querySelector: () => views }),
    },
  });
  assert.equal(views.dataset.view, "source");
  assert.match(app.ui.documentPreview("doc-test", "Test", content), /data-view="source"/);
});

test("repository view exposes escaped baseline failures", async () => {
  const app = await frontend();
  const work = app.data.works[0];
  work.baselineFailure = {
    profile: "npm-test",
    summary: "Missing package <script>bad()</script>",
    changedFiles: true,
  };
  app.location.hash = `#quest/${work.questId}/repositories`;
  app.ui.render();
  assert.match(app.html(), /Baseline check: npm-test/);
  assert.match(app.html(), /Tests changed worktree files/);
  assert.match(app.html(), /Missing package &lt;script&gt;/);
  assert.doesNotMatch(app.html(), /<script>bad/);
});

test("new Quests expose bounded v1.1 execution, optional Epic and explicit PR consent", async () => {
  const app = await frontend();
  app.data.modelRegistry = [
    {
      id: "claude-opus-5-5",
      runtime: "claude",
      available: true,
      verified: true,
    },
  ];
  app.ui.newQuest();
  const formHtml = app.element("#dialog-content").innerHTML;
  assert.match(formHtml, /Jira Epic \(optional\)/);
  assert.match(formHtml, /Agent execution and model routing/);
  assert.match(formHtml, /name="developerLimit"[^>]*max="5"/);
  assert.match(formHtml, /name="allowAutoPr"/);
  const form = {
    dataset: { form: "new-quest" },
    values: {
      kind: "TECH",
      title: "Bug fix",
      sourceType: "text",
      content: "Fix validation",
      repositoryIds: [app.data.repositories[0].id],
      epic: "PAY-100",
      executionRuntime: "claude",
      routingMode: "dynamic",
      developerLimit: "3",
      executionMode: "autonomous",
    },
    querySelector: () => ({}),
  };
  await app.listeners.submit({
    preventDefault() {},
    target: { closest: () => form },
  });
  const payload = app.requests.at(-1);
  assert.equal(payload.workflowVersion, 2);
  assert.equal(payload.epic, "PAY-100");
  assert.equal(payload.execution.limits.developers, 3);
  assert.equal(payload.execution.permissions.createPr, false);
  assert.equal(payload.execution.roles.reviewer.runtime, "inherit");
  assert.equal(payload.execution.routing.orchestrator.model, "claude-opus-5-5");
});

test("agent response appears once inside the box, including after reload", async () => {
  const app = await frontend();
  const run = {
    ...app.data.runs[0],
    state: "WAITING_INPUT",
    summary: "DEVQUEST_WAITING_INPUT\nChoose the publisher design.",
  };
  const saved = app.ui.runCard(run);
  assert.equal((saved.match(/Choose the publisher design\./g) || []).length, 1);
  assert.match(saved, /<pre[^>]*data-output=[^>]*>Choose the publisher design\.<\/pre>/);
  assert.doesNotMatch(saved, /DEVQUEST_WAITING_INPUT/);
  app.ui.liveOutput.set(run.id, "DEVQUEST_WAITING_INPUT\nFull live response with decisions.");
  const live = app.ui.runCard(run);
  assert.equal((live.match(/Full live response with decisions\./g) || []).length, 1);
  assert.doesNotMatch(live, /Choose the publisher design|DEVQUEST_WAITING_INPUT/);
  const failed = app.ui.runCard({
    ...run,
    state: "FAILED",
    summary: "Runtime failed: missing permission",
  });
  assert.match(failed, /Runtime failed: missing permission/);
  assert.doesNotMatch(failed, /Full live response/);
});

test("AgentRun access failures show escaped per-repository evidence and CLI grants", async () => {
  const app = await frontend();
  const run = app.data.runs[0];
  const html = app.ui.runCard({
    ...run,
    accessPreflight: {
      status: "FAILED",
      repositories: [{ name: "second repository", error: "EACCES <script>denied</script>" }],
    },
    cliArguments: ["--restricted", "--add-dir", "/registered/repo with spaces"],
  });
  assert.match(html, /Repository access: FAILED/);
  assert.match(html, /second repository/);
  assert.match(html, /EACCES &lt;script&gt;/);
  assert.match(html, /--add-dir/);
  assert.doesNotMatch(html, /<script>/);
});

test("all agent cards distinguish quiet runtime progress, waiting, failure and restart recovery", async () => {
  const app = await frontend();
  const run = { ...app.data.runs[0], state: "RUNNING", runtimeActivity: "TOOL_RUNNING", lastProgressAt: new Date(Date.now() - 90000).toISOString() };
  const html = app.ui.runCard(run);
  assert.match(html, /Inspecting or using a tool/);
  assert.match(html, /No recent events; the agent may still be working/);
  assert.match(html, /data-run-progress=/);
  assert.match(app.ui.runCard({ ...run, state: "WAITING_INPUT" }), /Waiting for your answer/);
  assert.match(app.ui.runCard({ ...run, state: "FAILED" }), /Review the error before retrying/);
  assert.match(app.ui.runCard({ ...run, state: "INTERRUPTED", recoveryReason: "Server restarted <unsafe>" }), /Server restarted &lt;unsafe&gt;/);
  assert.match(app.ui.runCard({ ...run, lastProgressAt: null, runtimeActivity: "STARTING" }), /Waiting for the first runtime event/);
});

test("live progress updates state without a page refresh; reconnect refreshes missed state once", async () => {
  const app = await frontend();
  const events = app.eventSources[0];
  const run = app.data.runs[0];
  run.state = "RUNNING";
  const reads = app.reads.length;
  events.onmessage({ data: JSON.stringify({ type: "run-progress", runId: run.id, runtimeActivity: "CONNECTED", lastProgressAt: "2026-10-20T00:00:00.000Z" }) });
  assert.equal(run.runtimeActivity, "CONNECTED");
  assert.equal(run.lastProgressAt, "2026-10-20T00:00:00.000Z");
  assert.equal(app.reads.length, reads);
  events.onerror();
  events.onerror();
  events.onopen();
  await Promise.resolve();
  assert.equal(app.reads.length, reads + 1);
  events.onopen();
  assert.equal(app.reads.length, reads + 1);
});

test("Browse and manual checks populate canonical paths and block invalid selections", async () => {
  const chosen = {
    valid: true,
    path: "/canonical/repo with spaces",
    gitRoot: "/canonical/repo with spaces",
    name: "repo <unsafe>",
    currentBranch: "staging",
    defaultBranch: "master",
  };
  const results = {
    PICK_REPOSITORY_FOLDER: chosen,
    INSPECT_REPOSITORY_FOLDER: {
      ...chosen,
      valid: false,
      error: "Repository already registered",
    },
  };
  const app = await frontend(uiFixture(), results);
  app.ui.addRepository();
  assert.match(app.element("#dialog-content").innerHTML, /data-action="browse-repository"/);
  assert.match(app.element("#dialog-content").innerHTML, /type="submit" disabled/);
  const input = { value: "/old/path" },
    preview = {},
    submit = {};
  const form = {
    dataset: { form: "repository" },
    elements: { path: input },
    querySelector: (selector) => (selector === ".repository-preview" ? preview : submit),
  };
  const click = async (action) => {
    const button = { dataset: { action }, closest: () => form };
    await app.listeners.click({
      target: {
        closest: (selector) => (selector === "[data-action]" ? button : null),
      },
    });
  };
  await click("browse-repository");
  assert.deepEqual(app.requests.at(-1), { type: "PICK_REPOSITORY_FOLDER" });
  assert.equal(input.value, chosen.path);
  assert.equal(submit.disabled, false);
  assert.match(preview.innerHTML, /Current branch: staging/);
  assert.match(preview.innerHTML, /repo &lt;unsafe&gt;/);
  await click("inspect-repository");
  assert.equal(submit.disabled, true);
  assert.match(preview.innerHTML, /already registered/);
  results.PICK_REPOSITORY_FOLDER = { cancelled: true };
  await click("browse-repository");
  assert.equal(input.value, chosen.path);
  assert.match(preview.textContent, /cancelled/);
  results.PICK_REPOSITORY_FOLDER = {
    unavailable: true,
    message: "Enter a path manually",
  };
  await click("browse-repository");
  assert.match(preview.textContent, /manually/);
});

test("completed Tech brainstorming exposes canonical spec controls and separate Analyze only", async () => {
  const app = await frontend();
  const quest = app.data.quests[0];
  quest.kind = "TECH";
  quest.state = "BRAINSTORM_COMPLETED";
  quest.designProtocol = 1;
  app.data.tasks = [];
  app.data.runs = [];
  app.data.artifacts = [
    {
      id: "brainstorm-spec",
      questId: quest.id,
      kind: "spec",
      sourceStage: "brainstorm",
      revision: 1,
      content: "# Funding specification\nRetain the current contracts.",
      file: "/data/spec.md",
    },
  ];
  app.location.hash = `#quest/${quest.id}/overview`;
  app.ui.render();
  assert.match(app.html(), /Brainstorm completed/);
  assert.match(app.ui.questChain(quest), /Define<small>Current stage/);
  assert.doesNotMatch(app.ui.questChain(quest), /Plan<small>Current stage/);
  assert.match(app.html(), /View Specification/);
  assert.match(app.html(), /Edit Specification/);
  assert.match(app.html(), /data-action="ANALYZE_PRD"/);
  assert.doesNotMatch(
    app.html(),
    /data-action="(?:START_BRAINSTORM|FINISH_BRAINSTORM|EXECUTE_QUEST|GENERATE_TRD|GENERATE_PLAN)"/,
  );
  app.location.hash = `#quest/${quest.id}/architect`;
  app.ui.render();
  assert.doesNotMatch(app.html(), /The TRD changed/);
  assert.match(app.html(), /Edit Specification/);
  assert.doesNotMatch(app.html(), /data-action="GENERATE_SPEC"/);
  app.ui.editArtifact("spec", quest.id);
  assert.doesNotMatch(app.element("#dialog-content").innerHTML, /name="trdArtifactId"/);
  quest.state = "ANALYSIS_COMPLETED";
  app.data.artifacts.push({
    id: "brainstorm-analysis",
    questId: quest.id,
    kind: "analysis",
    content: "# Impact analysis",
  });
  app.location.hash = `#quest/${quest.id}/overview`;
  app.ui.render();
  assert.match(app.html(), /data-action="GENERATE_TRD"/);
  assert.doesNotMatch(app.html(), /data-action="EXECUTE_QUEST"/);
});

test("appendix UI submits typed job options, shows progress/errors and links review without publishing", async () => {
  const app = await frontend();
  const q = app.data.quests[0];
  q.state = "PLAN_APPROVED";
  app.data.runs = [];
  app.data.works = [];
  app.data.tasks.forEach((task) => {
    delete task.jira;
    task.state = "PLANNED";
  });
  app.location.hash = `#quest/${q.id}/overview`;
  app.ui.render();
  await app.listeners.click({
    preventDefault() {},
    target: {
      closest: (selector) =>
        selector === "[data-action]"
          ? { dataset: { action: "appendix-dialog", questId: q.id } }
          : null,
    },
  });
  assert.match(app.element("#dialog-content").innerHTML, /Assignee \(optional\)/);
  assert.doesNotMatch(app.element("#dialog-content").innerHTML, /name="assignee" required/);
  const err = { textContent: "" },
    submit = { disabled: false };
  const form = {
    dataset: { form: "generate-appendix" },
    values: {
      questId: q.id,
      planArtifactId: "plan-current",
      project: "SYN",
      epic: "SYN-1",
      assignee: "",
      weightReference: "",
      requestId: "ui-request",
    },
    querySelector: (selector) => (selector.includes("submit") ? submit : err),
  };
  form.closest = () => form;
  await app.listeners.submit({ preventDefault() {}, target: form });
  assert.equal(app.requests.at(-1).type, "GENERATE_APPENDIX");
  assert.equal(app.requests.at(-1).requestId, "ui-request");
  assert.equal(app.requests.at(-1).assignee, "");
  assert.match(app.element("#toast").textContent, /Generating Jira Appendix/);
  assert.ok(!app.requests.some((r) => r.type === "PUBLISH_JIRA" || r.type === "EXECUTE_QUEST"));
  app.data.operations = [
    {
      id: `appendix:${q.id}`,
      state: "RUNNING",
      generationActive: true,
      skill: "/create-appendix-task-list",
      runtime: "fake",
    },
  ];
  app.ui.render();
  assert.match(app.html(), /Generating Jira Appendix/);
  assert.match(app.html(), /disabled>Generating/);
  app.data.operations[0] = {
    ...app.data.operations[0],
    state: "INTERRUPTED",
    generationActive: false,
    error: "MCP failed <retry>",
  };
  app.ui.render();
  assert.match(app.html(), /Status: FAILED/);
  assert.match(app.html(), /MCP failed &lt;retry&gt;/);
  app.data.operations[0].state = "COMPLETED";
  app.data.artifacts.push({
    id: "appendix-test",
    questId: q.id,
    kind: "appendix",
    planArtifactId: "plan-current",
    content: "# Weighted tasks\n#### T1.1 — Alpha\nDepends on T1.0",
    revision: 1,
  });
  app.ui.render();
  assert.match(app.html(), /View Appendix/);
  assert.match(app.html(), /Regenerate Appendix/);
  app.location.hash = `#quest/${q.id}/appendix`;
  app.ui.render();
  assert.match(app.html(), /Depends on T1.0/);
});

test("managed Jira Appendix Agent appears in Party and details with progress, model, elapsed time and recovery controls", async () => {
  const app = await frontend(),
    q = app.data.quests[0];
  app.data.runs = [
    {
      id: "appendix-managed",
      questId: q.id,
      purpose: "jira_appendix_generation",
      role: "JIRA_APPENDIX",
      displayName: "Jira Appendix Agent",
      runtime: "claude",
      workflowVersion: 2,
      state: "RUNNING",
      skill: "create-appendix-task-list",
      phase: "GENERATING_APPENDIX",
      resolvedModel: "claude-sonnet-test",
      resolvedEffort: "low",
      startedAt: new Date().toISOString(),
      lastProgressAt: new Date().toISOString(),
    },
  ];
  app.location.hash = `#quest/${q.id}/overview`;
  app.ui.render();
  assert.match(app.html(), /Jira Appendix Agent/);
  assert.match(app.html(), /Claude Code/);
  assert.match(app.html(), /Cancel generation/);
  assert.match(app.html(), /data-agent-elapsed/);
  assert.match(app.html(), /claude-sonnet-test/);
  app.data.runs[0].state = "WAITING_INPUT";
  app.data.runs[0].summary = "Which board field is available?";
  app.ui.render();
  assert.match(app.html(), /needs input/);
  assert.match(app.html(), /Which board field/);
  assert.match(app.html(), /CANCEL_APPENDIX/);
  assert.match(app.html(), /Continue/);
});

test("legacy failed/interrupted and stale generating states enable Retry after refresh; active generation retains error history", async () => {
  const app = await frontend(),
    q = app.data.quests[0];
  q.state = "PLAN_APPROVED";
  app.data.runs = [];
  app.data.works = [];
  for (const t of app.data.tasks) {
    delete t.jira;
    t.state = "PLANNED";
  }
  q.jiraContext = {
    project: "FCAD",
    epic: "FCAD-6205",
    assignee: "",
    weightReference: "Saved weights",
  };
  app.data.operations = [
    {
      id: `appendix:${q.id}`,
      questId: q.id,
      state: "INTERRUPTED",
      phase: "GENERATING",
      generationActive: false,
      error: "/opt/homebrew/bin/claude timed out after 120000ms",
    },
  ];
  app.location.hash = `#quest/${q.id}/overview`;
  app.ui.render();
  assert.match(app.html(), /Status: FAILED/);
  assert.match(app.html(), /Claude execution timed out after 120 seconds/);
  assert.match(app.html(), /View Error/);
  assert.match(app.html(), /Retry Generation/);
  assert.doesNotMatch(app.html(), /disabled>Generating/);
  app.data.operations[0].state = "FAILED";
  app.ui.render();
  assert.match(app.html(), /Retry Generation/);
  const refreshed = await frontend(app.data);
  refreshed.location.hash = app.location.hash;
  refreshed.ui.render();
  assert.match(refreshed.html(), /Retry Generation/);
  assert.equal(refreshed.requests.length, 0);
  app.data.runs = [
    {
      id: "new-appendix",
      questId: q.id,
      purpose: "jira_appendix_generation",
      role: "JIRA_APPENDIX",
      state: "RUNNING",
      generationActive: true,
      runtime: "claude",
      startedAt: new Date().toISOString(),
    },
  ];
  app.ui.render();
  assert.match(app.html(), /Generating Jira Appendix/);
  assert.match(app.html(), /Previous attempt error/);
  assert.match(app.html(), /120000ms/);
  assert.doesNotMatch(app.html(), />Retry Generation</);
  app.data.runs[0].state = "FAILED";
  app.data.runs[0].generationActive = false;
  app.data.runs[0].summary = "New runtime failed";
  app.ui.render();
  assert.match(app.html(), /Retry Generation/);
});

test("Artifacts shows original appendix Markdown, approval binds the displayed revision and never publishes", async () => {
  const data = uiFixture(),
    q = data.quests[0];
  q.state = "PLAN_APPROVED";
  data.tasks = [];
  data.artifacts.push({
    id: "appendix-reviewed",
    questId: q.id,
    kind: "appendix",
    revision: 2,
    hash: "hash",
    planArtifactId: "plan-current",
    content: "# Jira Tasks\n#### T1.1 — Synthetic",
    approved: false,
  });
  const app = await frontend(data);
  app.location.hash = `#quest/${q.id}/artifacts`;
  app.ui.render();
  assert.match(app.html(), /Approve appendix revision/);
  assert.match(app.html(), /Download .md/);
  await app.listeners.click({
    preventDefault() {},
    target: {
      closest: (selector) =>
        selector === "[data-action]"
          ? {
              dataset: {
                action: "APPROVE_APPENDIX",
                questId: q.id,
                artifactId: "displayed-revision",
              },
            }
          : null,
    },
  });
  assert.equal(app.requests.at(-1).type, "APPROVE_APPENDIX");
  assert.equal(app.requests.at(-1).artifactId, "displayed-revision");
  assert.ok(!app.requests.some((r) => r.type === "PUBLISH_JIRA"));
});

test("appendix approval refresh uses backend readiness, then submits only the displayed revision", async () => {
  const data = uiFixture(),
    q = data.quests[0];
  q.state = "PLAN_APPROVED";
  const doc = {
    id: "existing-appendix",
    questId: q.id,
    kind: "appendix",
    revision: 1,
    content: "# Synthetic appendix",
    approved: false,
    approvalReady: false,
    approvalError: "Finish or interrupt the active design session before editing",
  };
  data.artifacts.push(doc);
  const app = await frontend(data);
  app.location.hash = `#quest/${q.id}/artifacts`;
  app.ui.render();
  assert.match(app.html(), /disabled[^>]*>Approve appendix revision/);
  assert.match(app.html(), /active design session/);
  assert.equal(app.requests.length, 0);
  doc.approvalReady = true;
  doc.approvalError = "";
  const refreshed = await frontend(data);
  refreshed.location.hash = app.location.hash;
  refreshed.ui.render();
  assert.match(refreshed.html(), /data-action="APPROVE_APPENDIX"/);
  assert.doesNotMatch(refreshed.html(), /disabled[^>]*>Approve appendix revision/);
  await refreshed.listeners.click({
    preventDefault() {},
    target: {
      closest: (selector) =>
        selector === "[data-action]"
          ? { dataset: { action: "APPROVE_APPENDIX", questId: q.id, artifactId: doc.id } }
          : null,
    },
  });
  assert.equal(refreshed.requests.length, 1);
  assert.equal(refreshed.requests[0].type, "APPROVE_APPENDIX");
  assert.equal(refreshed.requests[0].artifactId, doc.id);
});

test("publish opens a revision-bound confirmation through read-only preview; refresh preserves eligibility", async () => {
  const data = uiFixture(),
    q = data.quests[0];
  q.state = "PLAN_APPROVED";
  data.runs = [];
  const doc = {
    id: "approved-appendix",
    questId: q.id,
    kind: "appendix",
    revision: 1,
    planArtifactId: data.artifacts.find((a) => a.questId === q.id && a.kind === "plan").id,
    content: "# Synthetic appendix",
    approved: true,
    publicationReady: true,
  };
  data.artifacts.push(doc);
  data.runs.push({
    id: "old-jira",
    questId: q.id,
    purpose: "jira_appendix_generation",
    state: "WAITING_INPUT",
    generationActive: false,
  });
  data.runs.push({
    id: "new-jira",
    questId: q.id,
    purpose: "jira_appendix_generation",
    state: "COMPLETED",
    generationActive: false,
  });
  const preview = {
    questId: q.id,
    project: "SYN",
    epic: "SYN-1",
    artifactId: doc.id,
    hash: "approved-hash",
    revision: 1,
    maxIssues: 1,
  };
  const app = await frontend(data, { PREVIEW_JIRA_PUBLICATION: preview });
  app.location.hash = `#quest/${q.id}/overview`;
  app.ui.render();
  assert.match(app.html(), /data-action="PUBLISH_JIRA"/);
  await app.listeners.click({
    preventDefault() {},
    target: {
      closest: (selector) =>
        selector === "[data-action]"
          ? { dataset: { action: "PUBLISH_JIRA", questId: q.id } }
          : null,
    },
  });
  assert.deepEqual(
    app.requests.map((r) => r.type),
    ["PREVIEW_JIRA_PUBLICATION"],
  );
  assert.match(app.element("#dialog-content").innerHTML, /Confirm Jira publication/);
  assert.match(app.element("#dialog-content").innerHTML, /1 real Jira issue/);
  assert.match(app.element("#dialog-content").innerHTML, /value="approved-appendix"/);
  assert.match(app.element("#dialog-content").innerHTML, /value="approved-hash"/);
  const submit = { disabled: false },
    errorBox = { textContent: "" };
  const form = {
    dataset: { form: "publish-jira" },
    values: { questId: q.id, appendixArtifactId: preview.artifactId, appendixHash: preview.hash },
    querySelector: (selector) => (selector === ".form-error" ? errorBox : submit),
  };
  await app.listeners.submit({ preventDefault() {}, target: { closest: () => form } });
  assert.equal(app.requests.at(-1).type, "PUBLISH_JIRA");
  assert.equal(app.requests.at(-1).appendixArtifactId, preview.artifactId);
  assert.equal(app.requests.at(-1).appendixHash, preview.hash);
  const refreshed = await frontend(data);
  refreshed.location.hash = app.location.hash;
  refreshed.ui.render();
  assert.match(refreshed.html(), /data-action="PUBLISH_JIRA"/);
  doc.publicationReady = false;
  doc.publicationError = "Jira publication is already active";
  refreshed.ui.render();
  assert.match(refreshed.html(), /disabled[^>]*>Publish to Jira/);
  assert.doesNotMatch(refreshed.html(), /data-action="PUBLISH_JIRA"/);
  assert.match(refreshed.html(), /publication is already active/);
  assert.equal(refreshed.requests.length, 0);
});

test("Jira settings expose saved site/project URLs and submit configuration without generating or publishing", async () => {
  const data = uiFixture(),
    quest = data.quests[0];
  quest.jiraContext = {
    project: "FCAD",
    siteUrl: "https://jira.example",
    projectUrl: "https://jira.example/jira/software/c/projects/FCAD",
    epic: "FCAD-6205",
    assignee: "Synthetic",
    weightReference: "",
  };
  const app = await frontend(data);
  await app.listeners.click({
    preventDefault() {},
    target: {
      closest: (selector) =>
        selector === "[data-action]"
          ? { dataset: { action: "jira-settings", questId: quest.id } }
          : null,
    },
  });
  assert.match(app.element("#dialog-content").innerHTML, /name="siteUrl"/);
  assert.match(app.element("#dialog-content").innerHTML, /name="projectUrl"/);
  assert.match(app.element("#dialog-content").innerHTML, /FCAD-6205/);
  const submit = { disabled: false },
    error = { textContent: "" };
  const form = {
    dataset: { form: "jira-settings" },
    values: { questId: quest.id, ...quest.jiraContext },
    querySelector: (selector) => (selector.includes("submit") ? submit : error),
  };
  form.closest = () => form;
  await app.listeners.submit({ preventDefault() {}, target: form });
  assert.equal(app.requests.at(-1).type, "SAVE_JIRA_CONTEXT");
  assert.equal(app.requests.at(-1).projectUrl, quest.jiraContext.projectUrl);
  assert.ok(!app.requests.some((r) => ["GENERATE_APPENDIX", "PUBLISH_JIRA"].includes(r.type)));
});

test("saved Jira defaults prefill new Quests and one-click Generate starts immediately without a parameter modal", async () => {
  const data = uiFixture(),
    q = data.quests[0];
  const defaults = {
    project: "SYN",
    siteUrl: "https://jira.example",
    projectUrl: "https://jira.example/projects/SYN",
    categoryFamily: "BE",
    mcpServer: "atlassian",
    backendWeights: {
      project: "SYN",
      source: "User Confirmed",
      version: "1.0.0",
      scale: "Mobile-equivalent",
      levels: { V: 1, L: 2, M: 4, H: 8 },
    },
  };
  data.settings.jiraWorkspace = { version: 3, defaultProject: "SYN", projects: { SYN: defaults } };
  const app = await frontend(data);
  app.location.hash = "#settings";
  app.ui.render();
  assert.match(app.html(), /Save Jira defaults/);
  assert.match(app.html(), /value="3"/);
  app.ui.newQuest();
  const form = app.element("#dialog-content").innerHTML;
  assert.match(form, /name="jiraEnabled" checked/);
  assert.match(form, /name="project"[^>]*value="SYN"/);
  assert.match(form, /name="weightH"[^>]*value="8"/);
  assert.match(form, /name="epic" value=""/);
  app.element("#dialog-content").innerHTML = "";
  q.jiraContext = defaults;
  q.jiraConfig = { enabled: true, categoryFamily: "BE" };
  q.state = "PLAN_APPROVED";
  const target = { dataset: { action: "appendix-dialog", questId: q.id } };
  await app.listeners.click({
    preventDefault() {},
    target: { closest: (selector) => (selector === "[data-action]" ? target : null) },
  });
  assert.equal(app.element("#dialog-content").innerHTML, "");
  assert.equal(app.requests.at(-1).type, "GENERATE_APPENDIX");
  assert.equal(app.requests.at(-1).questId, q.id);
  assert.equal(app.requests.at(-1).project, undefined);
  assert.ok(app.requests.at(-1).requestId);
  assert.ok(!app.requests.some((r) => r.type === "PUBLISH_JIRA"));
});

test("Workspace Jira form saves project-scoped weights and repository associations through a typed action", async () => {
  const app = await frontend();
  const submit = { disabled: false },
    error = { textContent: "" };
  const form = {
    dataset: { form: "workspace-jira" },
    values: {
      project: "SYN",
      siteUrl: "https://jira.example",
      projectUrl: "https://jira.example/projects/SYN",
      categoryFamily: "BE",
      mcpServer: "atlassian",
      expectedVersion: "0",
      makeDefault: "on",
      weightV: "1",
      weightL: "2",
      weightM: "4",
      weightH: "8",
      weightVersion: "1.0.0",
      weightScale: "Mobile-equivalent",
      jiraRepositoryIds: ["payment"],
    },
    querySelector: (s) => (s.includes("submit") ? submit : error),
  };
  form.closest = () => form;
  await app.listeners.submit({ preventDefault() {}, target: form });
  assert.equal(error.textContent, "");
  const request = app.requests.at(-1);
  assert.equal(request.type, "SAVE_WORKSPACE_JIRA");
  assert.equal(request.backendWeights.project, "SYN");
  assert.equal(request.backendWeights.levels.H, 8);
  assert.equal(request.expectedVersion, 0);
  assert.equal(request.repositoryIds[0], "payment");
});

test("changing affected repositories keeps disabled Jira fields out of non-Jira Quest validation", async () => {
  const app = await frontend();
  const inputs = [{ disabled: false }, { disabled: false }];
  const fields = { outerHTML: "", querySelectorAll: () => inputs };
  const form = {
    dataset: { form: "new-quest" },
    elements: { jiraEnabled: { checked: false } },
    querySelector: () => fields,
    querySelectorAll: () => [{ value: "payment" }],
  };
  await app.listeners.change({
    target: { name: "repositoryIds", dataset: {}, closest: () => form },
  });
  assert.ok(inputs.every((input) => input.disabled));
});

test("AgentRun profile details show effective provenance without Soul text or private standards", async () => {
  const app = await frontend();
  const run = {
    ...app.data.runs[0],
    logicalRunId: "logical-root",
    attemptNumber: 2,
    profileSnapshot: {
      profile: {
        id: "devquest-developer",
        name: "Developer",
        version: "1.0.0",
        hash: "a".repeat(64),
      },
      runtime: "claude",
      stage: "v11-task",
      requestedModel: "claude-sonnet-5-5",
      requestedEffort: "medium",
      route: { resolvedModel: "claude-sonnet-5-5", resolvedEffort: "medium" },
      readOnly: false,
      soul: { content: "PRIVATE SOUL SHOULD NOT APPEAR" },
      capabilities: { repositories: [{ id: "payment" }], mcp: null },
      repositoryStandards: [
        {
          repositoryId: "payment",
          sourceType: "AGENTS.md",
          status: "LOADED",
          hash: "b".repeat(64),
          commit: "c".repeat(40),
          content: "PRIVATE STANDARDS SHOULD NOT APPEAR",
        },
      ],
      skills: [{ name: "implementation", hash: "d".repeat(64) }],
    },
  };
  const html = app.ui.runCard(run);
  for (const text of [
    "Agent Profile",
    "devquest-developer@1.0.0",
    "aaaaaaaaaaaa",
    "AGENTS.md",
    "bbbbbbbbbbbb",
    "implementation",
    "Assigned worktree writes",
    "Attempt 2",
    "logical-root",
  ])
    assert.ok(html.includes(text), text);
  assert.doesNotMatch(html, /PRIVATE SOUL|PRIVATE STANDARDS/);
  assert.match(app.ui.runCard(app.data.runs[0]), /LEGACY \/ UNKNOWN/);
});

test("profile adoption is an explicit typed action; new Quests do not opt in automatically", async () => {
  const app = await frontend();
  app.ui.newQuest();
  assert.match(app.element("#dialog-content").innerHTML, /name="agentProfilesEnabled"/);
  assert.doesNotMatch(
    app.element("#dialog-content").innerHTML,
    /name="agentProfilesEnabled" checked/,
  );
  const target = {
    dataset: { action: "SET_AGENT_PROFILES", questId: app.data.quests[0].id, enabled: "true" },
    disabled: false,
  };
  await app.listeners.click({
    preventDefault() {},
    target: { closest: (selector) => (selector === "[data-action]" ? target : null) },
  });
  assert.equal(app.requests.at(-1).type, "SET_AGENT_PROFILES");
  assert.equal(app.requests.at(-1).enabled, true);
});

test("Quest room, QA and reference views escape content and preserve explicit agent boundaries", async () => {
  const data = uiFixture(),
    q = data.quests[0];
  data.questRooms = {
    [q.id]: {
      timeline: [
        {
          id: "note",
          kind: "note",
          body: "<script>unsafe</script>",
          createdAt: "synthetic",
          state: "SENT",
        },
      ],
      blockers: [
        {
          title: "Answer needed",
          detail: "<img src=x onerror=alert(1)>",
          href: `#quest/${q.id}/room`,
        },
      ],
    },
  };
  data.qaCases = [
    {
      id: "case",
      questId: q.id,
      title: "QA <unsafe>",
      expected: "Expected",
      revision: 1,
      evidence: [],
    },
  ];
  data.projectReferences = [
    {
      id: "ref",
      repositoryId: q.repositoryIds[0],
      name: "Conventions <unsafe>",
      versions: [{ revision: 1, hash: "hash", content: "# Reference" }],
    },
  ];
  const app = await frontend(data);
  for (const tab of ["room", "qa", "references", "overview"]) {
    app.location.hash = `#quest/${q.id}/${tab}`;
    app.ui.render();
    assert.doesNotMatch(app.html(), /<script>unsafe|<img src=x|<unsafe>/);
    assert.match(app.html(), /Project sections/);
  }
  app.location.hash = `#quest/${q.id}/room`;
  app.ui.render();
  assert.match(app.html(), /starts an agent turn and may consume paid usage/);
  assert.match(app.html(), /Saving a note starts no agent/);
  assert.match(app.html(), /&lt;script&gt;unsafe/);
  app.location.hash = `#quest/${q.id}/qa`;
  app.ui.render();
  assert.match(app.html(), /not verified/);
});

test("collaboration forms submit notes, explicit replies, version pins, QA evidence and read-only previews", async () => {
  const data = uiFixture(),
    questId = data.quests[0].id,
    app = await frontend(data, {
      PREVIEW_QUEST_ACCESS: {
        role: "architect",
        runtimeToolAccess: "NOT_VERIFIED",
        scope: {
          readOnly: true,
          cwd: "/synthetic/repo",
          repositories: [{ name: "Synthetic", path: "/synthetic/repo" }],
        },
        preflight: { status: "PASSED" },
        note: "Scope only; actual runtime permissions remain unverified",
      },
    });
  const submit = async (kind, values) => {
    const form = {
      dataset: { form: kind, collaboration: "true", draftKey: kind },
      values: { questId, ...values },
      querySelector: () => ({}),
      reset() {},
    };
    await app.listeners.submit({ preventDefault() {}, target: { closest: () => form } });
    return app.requests.at(-1);
  };
  assert.equal((await submit("room-note", { message: "A note" })).type, "POST_ROOM_NOTE");
  const reply = await submit("room-reply", {
    message: "Answer",
    runToken: "run-1|version-1",
    requestId: "reply-1",
    confirmAgentRun: "on",
  });
  assert.equal(reply.type, "SEND_ROOM_REPLY");
  assert.equal(reply.confirmAgentRun, true);
  assert.equal(reply.expectedUpdatedAt, "version-1");
  const refs = await submit("quest-references", { referenceIds: ["reference-1|2|digest"] });
  assert.deepEqual(refs.references, [{ id: "reference-1", revision: 2, hash: "digest" }]);
  assert.equal(
    (await submit("qa-case", { repositoryId: "payment", title: "Scenario", expected: "Result" }))
      .type,
    "ADD_QA_CASE",
  );
  const evidence = await submit("qa-result", {
    caseId: "case-1|3",
    status: "PASSED",
    actual: "Observed",
  });
  assert.equal(evidence.revision, 3);
  assert.equal(evidence.type, "RECORD_QA_RESULT");
  app.location.hash = `#quest/${questId}/overview`;
  assert.equal(
    (await submit("access-preview", { role: "architect" })).type,
    "PREVIEW_QUEST_ACCESS",
  );
  assert.match(app.html(), /Filesystem checks: PASSED/);
  assert.match(app.html(), /Actual runtime tool access: not verified/);
  assert.equal(
    app.requests.some(
      (r) =>
        r.type === "PUBLISH_JIRA" || r.type === "EXECUTE_QUEST" || r.type === "APPROVE_APPENDIX",
    ),
    false,
  );
});

test("reference drafts retain reviewed revisions and checkbox selections across state refresh", async () => {
  const data = uiFixture(),
    q = data.quests[0];
  data.projectReferences = [
    {
      id: "ref",
      repositoryId: q.repositoryIds[0],
      name: "Conventions",
      versions: [{ revision: 1, hash: "old", content: "Old reference" }],
    },
  ];
  const app = await frontend(data);
  const input = (draftKey, values) => {
    const form = {
      dataset: { collaboration: "true", draftKey },
      values: { questId: q.id, ...values },
    };
    app.listeners.input({ target: { closest: () => form } });
  };
  input("quest-references", { referenceIds: ["ref|1|old"] });
  input("ref", {
    referenceId: "ref",
    expectedRevision: "1",
    name: "Conventions",
    content: "My unsaved edit",
  });
  data.projectReferences[0].versions.push({ revision: 2, hash: "new", content: "Concurrent edit" });
  app.location.hash = `#quest/${q.id}/references`;
  app.ui.render();
  assert.match(app.html(), /value="ref\|1\|old" checked/);
  assert.match(app.html(), /selected reference changed/);
  assert.match(app.html(), /name="expectedRevision" value="1"/);
  assert.match(app.html(), /My unsaved edit/);
});

test("simplified projects expose four sections, five stages and preserve old document/work links", async () => {
  const app = await frontend(),
    q = app.data.quests[0];
  for (const route of [
    "overview",
    "documents",
    "work",
    "room",
    "architect",
    "artifacts",
    "repositories",
    "qa",
  ]) {
    app.location.hash = `#quest/${q.id}/${route}`;
    app.ui.render();
    const nav = app.html().match(/<nav class="tabs"[^>]*>([\s\S]*?)<\/nav>/)[1];
    assert.equal((nav.match(/<a /g) || []).length, 4);
    for (const name of ["Overview", "Documents", "Work", "Room"])
      assert.match(nav, new RegExp(`>${name}</a>`));
    assert.equal((app.ui.questChain(q).match(/<li /g) || []).length, 5);
  }
  app.location.hash = `#quest/${q.id}/work`;
  app.ui.render();
  assert.match(app.html(), /Execution queue/);
  assert.match(app.html(), /Repository changes and reviews/);
  assert.match(app.html(), /Tests and QA/);
  app.location.hash = `#quest/${q.id}/settings`;
  app.ui.render();
  assert.match(app.html(), /project-settings" open/);
  assert.equal(app.requests.length, 0);
});

test("overview promotes one next action and keeps configuration out of the action toolbar", async () => {
  const app = await frontend(),
    q = app.data.quests[0];
  q.state = "TRD_DRAFT";
  app.data.runs = [];
  app.location.hash = `#quest/${q.id}/overview`;
  app.ui.render();
  const section = app.html().match(/<section class="next-step[^]*?<\/section>/)[0];
  assert.match(section, /documents\/trd">Review TRD/);
  assert.equal((section.match(/class="btn[^"]*\bprimary\b/g) || []).length, 1);
  assert.match(section, /More actions/);
  assert.doesNotMatch(section, /SET_AGENT_PROFILES|Preview agent access/);
  assert.equal(app.requests.length, 0);
});

test("Answer opens the exact stopped agent turn without starting inference", async () => {
  const data = uiFixture(),
    q = data.quests[0];
  const run = {
    id: "question-1",
    questId: q.id,
    purpose: "plan",
    runtime: "claude",
    state: "WAITING_INPUT",
    summary: "Which approach?",
    updatedAt: "version-1",
  };
  data.runs = [run];
  data.questRooms = {
    [q.id]: {
      timeline: [
        {
          id: run.id,
          runId: run.id,
          kind: "agent",
          role: "Planner",
          stage: "plan",
          state: run.state,
          body: run.summary,
        },
      ],
    },
  };
  const app = await frontend(data);
  app.location.hash = `#quest/${q.id}/room`;
  app.ui.render();
  assert.match(app.html(), /data-action="room-answer"/);
  await app.listeners.click({
    preventDefault() {},
    target: {
      closest: (selector) =>
        selector === "[data-action]"
          ? { dataset: { action: "room-answer", questId: q.id, runId: run.id } }
          : null,
    },
  });
  assert.match(app.html(), /value="question-1\|version-1" selected/);
  assert.match(app.html(), /data-form="room-reply"/);
  assert.equal(app.requests.length, 0);
});

test("bug intake saves an existing issue as context without linking, publishing or starting agents", async () => {
  const app = await frontend();
  app.ui.newQuest();
  const html = app.element("#dialog-content").innerHTML;
  assert.match(html, /New feature \(PRD\)/);
  assert.match(html, /Technical improvement/);
  assert.match(html, /Fix an existing bug/);
  assert.match(html, /Advanced agent settings/);
  const form = {
    dataset: { form: "new-quest" },
    values: {
      kind: "BUG",
      existingJiraKey: "QA-123",
      title: "Fix a regression",
      content: "Synthetic reproduction",
      sourceType: "text",
      repositoryIds: ["payment"],
    },
    querySelector: () => ({}),
  };
  await app.listeners.submit({ preventDefault() {}, target: { closest: () => form } });
  assert.equal(app.requests.at(-1).type, "CREATE_QUEST");
  assert.equal(app.requests.at(-1).kind, "TECH");
  assert.equal(app.requests.at(-1).existingJiraKey, "QA-123");
  assert.equal(app.requests.length, 1);
});

test("Review opens the selected document once and respects subsequent collapse during refresh", async () => {
  const app = await frontend(),
    id = app.data.quests[0].id;
  let scrolled = 0;
  const doc = {
    dataset: { document: `${id}-trd` },
    open: false,
    scrollIntoView() {
      scrolled++;
    },
  };
  app.document.querySelectorAll = (selector) =>
    selector === "#main details[data-document]"
      ? [doc]
      : selector === "#main details[data-document][open]" && doc.open
        ? [doc]
        : [];
  app.location.hash = `#quest/${id}/documents/trd`;
  app.ui.render();
  assert.equal(doc.open, true);
  assert.equal(scrolled, 1);
  doc.open = false;
  app.ui.render();
  assert.equal(doc.open, false);
  assert.equal(scrolled, 1);
});

test("readiness and role assignments use typed actions without starting agents", async () => {
  const app = await frontend();
  app.location.hash = "#settings";
  app.ui.render();
  assert.match(app.html(), /Check readiness · no agent starts/);
  app.location.hash = `#quest/${app.data.quests[0].id}/overview`;
  app.ui.render();
  assert.match(app.html(), /Assigned skills/);
  assert.match(app.html(), /No tools, MCP access or repository permissions are added/);
  const submit = (kind, values) => app.listeners.submit({ preventDefault() {}, target: { closest: () => ({
    dataset: { form: kind, collaboration: "true", draftKey: kind }, values,
    reset() {}, querySelector: () => ({}),
  }) } });
  await submit("quest-skills", { questId: app.data.quests[0].id, role: "architect", expectedRevision: "0", skillPins: ["skill:test|1|hash"] });
  assert.deepEqual(app.requests.at(-1), { type: "SET_QUEST_SKILLS", questId: app.data.quests[0].id, role: "architect", expectedRevision: 0, skills: [{ id: "skill:test", revision: 1, hash: "hash" }] });
  assert.equal(app.requests.some((request) => /GENERATE|START|EXECUTE/.test(request.type)), false);
});

test("stale backend sessions block unsupported actions with restart guidance before dispatch", async () => {
  for (const session of [{ token: "old-server" }, { token: "changed", actions: [...ACTIONS], restartRequired: true }]) {
    const app = await frontend(uiFixture(), {}, session);
    const form = { dataset: { form: "room-note", collaboration: "true", draftKey: "room-note" }, values: { questId: app.data.quests[0].id, message: "Note" }, reset() {}, querySelector: () => ({}) };
    await app.listeners.submit({ preventDefault() {}, target: { closest: () => form } });
    assert.equal(app.requests.length, 0);
  }
});

test("redesign presents compact run entries, separates history and preserves every existing run control", async () => {
  const data = uiFixture(), app = await frontend(data);
  const before = JSON.stringify(data);
  app.location.hash = "#agents";
  app.ui.render();
  const html = app.html();
  assert.equal((html.match(/class="run-entry"/g) || []).length, data.runs.length);
  assert.match(html, /Current runs/);
  assert.match(html, /data-disclosure="agent-roles"/);
  assert.match(html, /data-disclosure="agent-runtimes"/);
  assert.doesNotMatch(html, /data-disclosure="run-[^"]+" open/);
  assert.match(html, /data-action="PAUSE_AGENT"/);
  assert.equal(JSON.stringify(data), before);
  assert.equal(app.requests.length, 0);
});

test("semantic status badges never imply success for unknown states and retain text plus distinct symbols", async () => {
  const app = await frontend();
  assert.match(app.ui.badge("FUTURE_STATE"), /class="badge neutral"/);
  const pairs = [["WAITING_INPUT", "circle-question-mark"], ["RUNNING", "loader-circle"], ["FAILED", "triangle-alert"], ["BLOCKED", "lock-keyhole"], ["APPROVED", "circle-check"]];
  for (const [status, symbol] of pairs) {
    const html = app.ui.badge(status);
    assert.match(html, new RegExp(`/icons/lucide.svg#${symbol}`));
    assert.ok(html.includes(status.replaceAll("_", " ")));
  }
  assert.doesNotMatch(app.ui.badge('<script>unsafe</script>'), /<script>/);
});

test("mobile navigation opens, closes with Escape and never dispatches a workflow action", async () => {
  const app = await frontend();
  const button = app.element("#navigation-toggle");
  button.dataset = { action: "toggle-navigation" };
  await app.listeners.click({ target: { closest: (selector) => selector === "[data-action]" ? button : null } });
  assert.equal(button.getAttribute("aria-expanded"), "true");
  assert.equal(app.element("#primary-navigation").classList.contains("is-open"), true);
  let prevented = false;
  app.listeners.keydown({ key: "Escape", preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(button.getAttribute("aria-expanded"), "false");
  assert.equal(app.requests.length, 0);
});

test("settings sections, precise project stages and dialog names reuse existing forms", async () => {
  const app = await frontend();
  app.location.hash = "#settings";
  app.ui.render();
  for (const section of ["workspace", "agents", "integrations"]) assert.ok(app.html().includes(`data-disclosure="settings-${section}"`));
  app.location.hash = `#quest/${app.data.quests[0].id}/overview`;
  app.ui.render();
  assert.match(app.html(), /Current step: <strong>Implementation<\/strong>/);
  assert.match(app.html(), /All workflow stages/);
  app.ui.addRepository();
  assert.match(app.element("#dialog-content").innerHTML, /id="dialog-title"/);
  assert.match(app.element("#dialog-content").innerHTML, /aria-describedby="dialog-error"/);
  assert.match(readFileSync(new URL("../public/index.html", import.meta.url), "utf8"), /<dialog[^>]+aria-labelledby="dialog-title"/);
});

test("execution queue uses revision-stable disclosures without changing task actions or dependency evidence", async () => {
  const app = await frontend(), before = JSON.stringify(app.data);
  app.location.hash = `#quest/${app.data.quests[0].id}/work`;
  app.ui.render();
  assert.match(app.html(), /<details class="task-card" data-disclosure="task-t1">/);
  assert.match(app.html(), /data-action="RUN_TEST"/);
  assert.match(app.html(), /Depends on:/);
  assert.equal(JSON.stringify(app.data), before);
  assert.equal(app.requests.length, 0);
});

test("workspace chrome omits corner metadata and keeps Settings in the primary navigation", async () => {
  const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  assert.doesNotMatch(html, /top-right|local-tag|sidebar-bottom|id="today"|Local workspace/);
  assert.match(html, /<nav[^>]*id="primary-navigation"[\s\S]*href="#settings"[\s\S]*Settings<\/a>[\s\S]*<\/nav>/);
  const app = await frontend();
  app.location.hash = "#home";
  app.ui.render();
  assert.doesNotMatch(app.html(), /agent-row|No active runs|Runs start only after an explicit action|grid-main/);
  assert.match(app.html(), /data-disclosure="overview-activity"/);
  assert.match(app.html(), /href="#agents"/);
  assert.equal(app.requests.length, 0);
});


test("React Overview retains its mount across refresh, reuses safe setup dialogs and unmounts on navigation", async () => {
  const updates = [];
  let unmounts = 0;
  const app = await frontend(uiFixture(), {}, undefined, { updateDashboard(state, actions) { updates.push({ state, actions }); }, unmountOverview() { unmounts++; } });
  assert.match(app.html(), /id="dashboard-root"/);
  app.element("#main").innerHTML = '<div id="dashboard-root">React state retained</div>';
  app.ui.render();
  assert.match(app.html(), /React state retained/);
  updates.at(-1).actions.newProject();
  assert.match(app.element("#dialog-content").innerHTML, /Create a Project/);
  updates.at(-1).actions.addRepository();
  assert.match(app.element("#dialog-content").innerHTML, /Browse/);
  assert.equal(app.requests.length, 0);
  app.location.hash = "#repositories";
  app.ui.render();
  assert.equal(unmounts, 1);
  assert.match(app.html(), /Repository registry/);
  app.location.hash = "#home";
  app.ui.render();
  assert.match(app.html(), /id="dashboard-root"/);
});


test("React shell receives current route and truthful connection events without workflow actions", async () => {
  const connections = [], routes = [];
  const app = await frontend(uiFixture(), {}, undefined, {
    updateDashboard(state, actions, shell) { routes.push(shell); },
    unmountOverview() {},
    setConnection(connected) { connections.push(connected); },
  });
  app.eventSources[0].onopen();
  app.eventSources[0].onerror();
  app.eventSources[0].onopen();
  assert.deepEqual(connections, [true, false, true]);
  app.location.hash = "#repositories";
  app.ui.render();
  assert.equal(routes.at(-1).route, "repositories");
  assert.equal(routes.at(-1).restartRequired, false);
  assert.equal(app.requests.length, 0);
});


test("React project intake uses the same typed creation path and starts no agents", async () => {
  let modal;
  const data = uiFixture();
  data.settings.maxDeveloperAgents = 2;
  const app = await frontend(data, {}, undefined, {updateDashboard(){},unmountOverview(){},openCreateProject(props){modal=props;}});
  app.ui.newQuest();
  assert.equal(modal.state, data);
  const values = {kind:"TECH",title:"Synthetic modal test",sprint:"Sprint 42",sourceType:"text",content:"Synthetic only",repositoryIds:["payment"]};
  await modal.onCreate({get:key=>values[key],getAll:key=>values[key] || []});
  assert.equal(app.requests.length,1);
  assert.equal(app.requests[0].type,"CREATE_QUEST");
  assert.equal(app.requests[0].title,"Synthetic modal test");
  assert.equal(app.requests[0].execution.limits.developers,2);
  assert.equal(app.requests[0].execution.permissions.publishJira,false);
  assert.equal(app.requests[0].execution.permissions.createPr,false);
  assert.equal(app.requests[0].execution.roles.architect.runtime,"inherit");
  assert.equal(app.requests[0].jira.enabled,false);
});

test("Agents React route reuses typed readiness, interruption and existing detailed run controls", async () => {
  let actions;
  const data=uiFixture();
  const app=await frontend(data,{},undefined,{updateDashboard(state,callbacks){actions=callbacks;},unmountOverview(){}});
  app.location.hash="#agents";app.ui.render();
  assert.match(app.html(),/dashboard-root/);
  await actions.checkRuntime("claude");
  assert.equal(app.requests.at(-1).type,"CHECK_READINESS");
  assert.equal(app.requests.at(-1).runtime,"claude");
  const run=data.runs.find(run=>run.state==="RUNNING");
  actions.viewRun(run.id);
  assert.match(app.element("#dialog-content").innerHTML,/Agent session logs/);
  assert.match(app.element("#dialog-content").innerHTML,/INTERRUPT_AGENT/);
  await actions.terminateRun(run.id);
  assert.equal(app.requests.at(-1).type,"INTERRUPT_AGENT");
  assert.equal(app.requests.at(-1).runId,run.id);
  run.state="COMPLETED";
  assert.throws(()=>actions.terminateRun(run.id),/no longer running/);
  assert.equal(app.requests.filter(request=>request.type==="CREATE_QUEST"||request.type==="EXECUTE_QUEST").length,0);
});

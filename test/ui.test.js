import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { uiFixture } from "./ui-fixture.js";
import { Marked } from "marked";

// Exercise actual frontend renderers and delegated handlers without a new DOM dependency.
async function frontend(data = uiFixture(), results = {}) {
  const source = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
  const elements = new Map();
  const element = (selector) => {
    if (!elements.has(selector))
      elements.set(selector, {
        innerHTML: "",
        textContent: "",
        showModal() {},
        close() {},
        focus() {},
      });
    return elements.get(selector);
  };
  const listeners = {},
    requests = [];
  const location = { hash: "#home" };
  const context = {
    Marked,
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
    EventSource: class {},
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
      if (options) requests.push(JSON.parse(options.body));
      return {
        ok: true,
        json: async () =>
          url === "/api/session"
            ? { token: "test-token" }
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
    `(async () => {${source.replace('import { Marked } from "/vendor/marked.js";', "")}\nreturn { render, questChain, partyCards, badge, runCard, liveOutput, newQuest, addRepository, editArtifact, documentPreview };})()`,
    context,
  );
  return {
    ui,
    data,
    location,
    listeners,
    requests,
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
  assert.equal((app.ui.questChain(quest).match(/<li /g) || []).length, 8);
  assert.match(app.ui.questChain(quest), /aria-current="step"[^]*?Execute/);
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
  assert.equal((app.ui.questChain(quest).match(/class="done"/g) || []).length, 8);
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
  assert.match(app.html(), /PLANNED/);
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
  assert.equal((app.html().match(/<details /g) || []).length, 4);
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
  assert.match(app.ui.questChain(quest), /Analysis<small>Upcoming/);
  assert.doesNotMatch(app.ui.questChain(quest), /Analysis<small>Current stage/);
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

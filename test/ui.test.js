import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { uiFixture } from "./ui-fixture.js";
import { Marked } from "marked";

// Exercise actual frontend renderers and delegated handlers without a new DOM dependency.
async function frontend(data = uiFixture()) {
  const source = readFileSync(
    new URL("../public/app.js", import.meta.url),
    "utf8",
  );
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
              : { result: { id: "created-quest" } },
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
      for (const key of [
        "quests",
        "tasks",
        "works",
        "runs",
        "artifacts",
        "events",
        "repositories",
      ])
        data[key] = [];
    const app = await frontend(data);
    for (const route of [
      "home",
      "quests",
      "repositories",
      "agents",
      "jira",
      "settings",
      ...[
        "overview",
        "architect",
        "tasks",
        "repositories",
        "artifacts",
        "activity",
      ].map((t) => `quest/quest-ui-fixture/${t}`),
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
  assert.equal(
    (app.ui.questChain(quest).match(/class="done"/g) || []).length,
    8,
  );
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
    assert.ok(
      app.element("#dialog-content").innerHTML.includes(`name="${field}"`),
      field,
    );
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
  for (const route of [
    "home",
    "repositories",
    "jira",
    "quest/quest-ui-fixture/overview",
  ]) {
    app.location.hash = `#${route}`;
    app.ui.render();
    assert.doesNotMatch(
      app.html(),
      /<img|<script>|href="javascript:|title="x" onmouseover/,
    );
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
  assert.match(
    app.element("#dialog-content").innerHTML,
    /name="commitMessage"/,
  );
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
  assert.equal(
    app.requests.at(-1).commitMessage,
    "fix : repair task (devquest/test)",
  );
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
  assert.match(
    app.element("#dialog-content").innerHTML,
    /name="trdArtifactId"/,
  );
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
  assert.doesNotMatch(
    viewer,
    /<script>|<img|href="javascript:|private metadata/,
  );
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
  assert.match(
    app.ui.documentPreview("doc-test", "Test", content),
    /data-view="source"/,
  );
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
  assert.match(
    saved,
    /<pre[^>]*data-output=[^>]*>Choose the publisher design\.<\/pre>/,
  );
  assert.doesNotMatch(saved, /DEVQUEST_WAITING_INPUT/);
  app.ui.liveOutput.set(
    run.id,
    "DEVQUEST_WAITING_INPUT\nFull live response with decisions.",
  );
  const live = app.ui.runCard(run);
  assert.equal(
    (live.match(/Full live response with decisions\./g) || []).length,
    1,
  );
  assert.doesNotMatch(
    live,
    /Choose the publisher design|DEVQUEST_WAITING_INPUT/,
  );
  const failed = app.ui.runCard({
    ...run,
    state: "FAILED",
    summary: "Runtime failed: missing permission",
  });
  assert.match(failed, /Runtime failed: missing permission/);
  assert.doesNotMatch(failed, /Full live response/);
});

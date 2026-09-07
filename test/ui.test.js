import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { uiFixture } from "./ui-fixture.js";

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
    `(async () => {${source}\nreturn { render, questChain, partyCards, badge, runCard, newQuest, addRepository, editArtifact };})()`,
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
      ...["overview", "tasks", "repositories", "artifacts", "activity"].map(
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

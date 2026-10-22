import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import path from "node:path";
import { dashboardData, projectStatus, workspaceSearch } from "../ui/model.js";
import { uiFixture } from "./ui-fixture.js";

const bundle = await build({
  stdin: {
    contents: `import React from 'react'; import { renderToStaticMarkup } from 'react-dom/server'; import { Overview } from './ui/dashboard.jsx'; import { Sidebar } from './ui/sidebar.jsx'; import { Agents } from './ui/agents.jsx'; export const renderAgents = state => renderToStaticMarkup(React.createElement(Agents,{state,actions:{}})); import { CreateProjectForm, permittedModels, inheritedJira } from './ui/create-project.jsx'; export { permittedModels, inheritedJira }; export const renderProjectForm = state => renderToStaticMarkup(React.createElement(CreateProjectForm,{state,jiraDefault:'FCAD',busy:false,setBusy(){},onCreate(){},onClose(){}})); export const renderSidebar = (state,props={}) => renderToStaticMarkup(React.createElement(Sidebar,{state,...props})); export const render = state => renderToStaticMarkup(React.createElement(Overview,{state,actions:{}}));`,
    resolveDir: process.cwd(),
    loader: "jsx",
  },
  bundle: true,
  platform: "node",
  format: "cjs",
  write: false,
  define: { "process.env.NODE_ENV": '"production"' },
});
const temp = mkdtempSync(path.join(tmpdir(), "devquest-dashboard-test-"));
const file = path.join(temp, "render.cjs");
writeFileSync(file, bundle.outputFiles[0].text);
const { render, renderSidebar, renderProjectForm, permittedModels, inheritedJira, renderAgents } =
  createRequire(import.meta.url)(file);
rmSync(temp, { recursive: true });

test("dashboard cards use actual data and all/active/archived filters preserve state", () => {
  const state = uiFixture();
  state.quests.push({ ...state.quests[0], id: "done", state: "PRS_CREATED" });
  state.deletedQuests = [{ id: "deleted", title: "Deleted test", deletedAt: "2026-10-20" }];
  const before = JSON.stringify(state);
  assert.equal(dashboardData(state).active, 1);
  assert.equal(dashboardData(state).running, 1);
  assert.equal(dashboardData(state).repositories, 2);
  assert.equal(dashboardData(state).projects.length, 2);
  assert.equal(dashboardData(state, "active").projects.length, 1);
  assert.equal(dashboardData(state, "archived").projects[0].id, "deleted");
  assert.equal(projectStatus(state.quests[1]), "Completed");
  assert.equal(projectStatus(state.deletedQuests[0]), "Archived");
  assert.equal(JSON.stringify(state), before);
});
test("workspace search includes selected saved entities, excludes deleted and escapes through React", () => {
  const state = uiFixture();
  state.quests[0].title = "<script>unsafe</script>";
  state.deletedQuests = [{ title: "hidden project" }];
  assert.equal(workspaceSearch(state, "  PAYMENT ").length, 1);
  assert.equal(workspaceSearch(state, "hidden").length, 0);
  assert.equal(workspaceSearch(state, " ").length, 0);
  const html = render(state);
  assert.match(html, /&lt;script&gt;unsafe/);
  assert.doesNotMatch(html, /<script>unsafe/);
});
test("empty dashboard has creation action, accessible tabs and no invented projects or metrics", () => {
  const state = uiFixture();
  state.quests = [];
  state.events = [];
  const html = render(state);
  assert.match(html, /Create First Project/);
  assert.match(html, /border-dashed/);
  assert.match(html, /role="tablist"/);
  assert.match(html, /Recent Activity Log/);
  assert.match(html, /Quick Actions/);
  assert.match(html, /Trend unavailable/);
  assert.match(html, /Show.*sample project preview/);
  assert.doesNotMatch(html, /Payment API improvements|\+0%/);
});
test("populated dashboard displays repositories, active agents, status and actual activity", () => {
  const html = render(uiFixture());
  assert.match(html, /payment-service/);
  assert.match(html, /In Progress/);
  assert.match(html, /active agents/);
  assert.match(html, /diff n\/a/);
  assert.doesNotMatch(html, /Create First Project/);
});

test("sidebar groups saved counts and running agents, and maps project detail routes to Projects", () => {
  const state = uiFixture();
  const html = renderSidebar(state, { route: "quest", connected: true });
  for (const group of ["WORKSPACE", "AI ENGINE", "INTEGRATION", "SYSTEM"])
    assert.ok(html.includes(`aria-label="${group}"`));
  assert.match(html, /data-nav="quests" aria-current="page"/);
  assert.match(html, /id="repository-count"[^>]*>2</);
  assert.match(html, /aria-label="1 running agents"/);
  assert.match(html, /Local engine ready/);
  assert.match(html, /lucide-layout-dashboard/);
  assert.match(html, /lucide-folder-git-2/);
  state.runs = [];
  assert.doesNotMatch(renderSidebar(state), /role="img"/);
});
test("sidebar never shows ready on disconnect or a stale backend", () => {
  const state = uiFixture();
  assert.match(renderSidebar(state), /Engine reconnecting/);
  const stale = renderSidebar(state, { connected: true, restartRequired: true });
  assert.match(stale, /Restart required/);
  assert.doesNotMatch(stale, /Local engine ready/);
});

test("project modal keeps all three tabs, existing import paths and sticky submit actions", () => {
  const html = renderProjectForm(uiFixture());
  for (const title of [
    "Project Details",
    "Jira &amp; Sync",
    "AI Execution Settings",
    "Defaults applied",
    "Create Project",
    "Use Workspace Defaults",
    "Custom Model Routing",
  ])
    assert.ok(html.includes(title), title);
  assert.match(html, /overflow-y-auto/);
  assert.match(html, /sticky bottom-0/);
  assert.match(html, /name="sourceType"/);
  assert.match(html, /name="file"/);
  assert.match(html, /name="url"/);
  assert.match(html, /name="repositoryIds"/);
  for (const role of ["architect", "planner", "developer", "reviewer", "orchestrator"])
    assert.match(html, new RegExp(`name="${role}Runtime"`));
  assert.match(html, /fieldset disabled="" hidden=""/);
  assert.match(html, /FE · not supported by Jira integration/);
});
test("project modal preserves inherited Jira weights and never lists unverified or forbidden models", () => {
  const state = uiFixture();
  state.settings.jiraWorkspace = {
    defaultProject: "FCAD",
    projects: {
      FCAD: {
        project: "FCAD",
        categoryFamily: "BE",
        siteUrl: "https://example.test",
        projectUrl: "https://example.test/projects/FCAD",
        backendWeights: { levels: { V: 1, L: 2, M: 4, H: 8 }, scale: "Mobile-equivalent" },
      },
    },
  };
  const html = renderProjectForm(state);
  for (const [level, value] of Object.entries({ V: 1, L: 2, M: 4, H: 8 }))
    assert.match(html, new RegExp(`name="weight${level}"[^>]*value="${value}"`));
  const registry = [
    { id: "sonnet", runtime: "claude", available: true, verified: true },
    { id: "Fable", runtime: "claude", available: true, verified: true },
    { id: "unverified", runtime: "claude", available: true },
    { id: "codex", runtime: "codex", available: true, verified: true },
  ];
  assert.deepEqual(
    permittedModels(registry, "claude").map((m) => m.id),
    ["sonnet"],
  );
  assert.equal(
    inheritedJira(
      {
        defaultProject: "FCAD",
        projects: {
          FCAD: { project: "FCAD", repositoryIds: ["a"] },
          OTHER: { project: "OTHER", repositoryIds: ["b"] },
        },
      },
      ["a", "b"],
    ),
    "",
  );
});

test("Agents dashboard keeps six visible roles, truthful runtime metadata and empty launch setup", () => {
  const state = uiFixture();
  state.runs = [];
  const html = renderAgents(state);
  for (const label of [
    "Active Sessions",
    "Agent Mesh",
    "Orchestrator",
    "Architect",
    "Planner",
    "Developer",
    "Reviewer",
    "Jira Specialist",
    "Runtime Connections &amp; CLI",
    "Launch Agent Task",
  ])
    assert.ok(html.includes(label), label);
  assert.match(html, /No active agent sessions running/);
  assert.match(html, /Authentication/);
  assert.match(html, /Not verified/);
  assert.match(html, /Not reported/);
  assert.doesNotMatch(html, /DeepSeek|0\.153\.4|Auto-Mode: Standby|<details/);
});
test("Agents dashboard shows running and historical sessions without fabricated percentage progress", () => {
  const state = uiFixture();
  const html = renderAgents(state);
  assert.match(html, /View Logs/);
  assert.match(html, /Terminate/);
  assert.match(html, /Session History/);
  assert.match(html, /percentage not reported/);
  assert.doesNotMatch(html, /aria-valuenow/);
  assert.match(html, /Recurring payment/);
});

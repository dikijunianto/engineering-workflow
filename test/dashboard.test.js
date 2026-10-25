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
    contents: `export { bindSceneWheel } from './ui/engineering-viewport.jsx'; import React from 'react'; import { renderToStaticMarkup } from 'react-dom/server'; import { Overview } from './ui/dashboard.jsx'; import { Sidebar } from './ui/sidebar.jsx'; import { Agents } from './ui/agents.jsx'; import { ProjectDetail } from './ui/project-detail.jsx'; import { ONBOARDING_STAGES, Onboarding3DCanvas } from './ui/onboarding-3d.jsx'; export { ONBOARDING_STAGES }; export const renderOnboardingCanvas = (stageIndex=0) => renderToStaticMarkup(React.createElement(Onboarding3DCanvas,{stageIndex,onSelectStage(){},autoPlay:true,progressRatio:0.5,cameraPreset:'orbit',zoomDelta:0,workspaceCounts:{quests:1,repos:2,agents:1}})); export const renderAgents = state => renderToStaticMarkup(React.createElement(Agents,{state,actions:{}})); export const renderProjectDetail = (state, props = {}) => renderToStaticMarkup(React.createElement(ProjectDetail, { state, actions: {}, questId: state.quests?.[0]?.id || 'quest-ui-fixture', tab: 'overview', ...props })); import { CreateProjectForm, permittedModels, inheritedJira } from './ui/create-project.jsx'; export { permittedModels, inheritedJira }; export const renderProjectForm = state => renderToStaticMarkup(React.createElement(CreateProjectForm,{state,jiraDefault:'FCAD',busy:false,setBusy(){},onCreate(){},onClose(){}})); export const renderSidebar = (state,props={}) => renderToStaticMarkup(React.createElement(Sidebar,{state,...props})); export const render = state => renderToStaticMarkup(React.createElement(Overview,{state,actions:{}}));`,
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
const {
  render,
  renderSidebar,
  renderProjectForm,
  permittedModels,
  inheritedJira,
  renderAgents,
  renderProjectDetail,
  ONBOARDING_STAGES,
  renderOnboardingCanvas,
  bindSceneWheel,
} = createRequire(import.meta.url)(file);
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
  assert.doesNotMatch(html, /Trend unavailable/);
  assert.match(html, /Show.*sample project preview/);
  assert.doesNotMatch(html, /Payment API improvements|\+0%/);
});
test("populated dashboard displays repositories, active agents, status and actual activity", () => {
  const html = render(uiFixture());
  assert.match(html, /payment-service/);
  assert.match(html, /In Progress/);
  assert.match(html, /active agents/);
  assert.doesNotMatch(html, /diff n\/a/);
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

test("3D onboarding stages explain app purpose, workflow mechanics and governance gates", () => {
  const state = uiFixture();
  const overviewHtml = render(state);
  const sidebarHtml = renderSidebar(state);
  const canvasHtml = renderOnboardingCanvas(0);
  assert.match(overviewHtml, /Interactive 3D Onboarding/);
  assert.match(overviewHtml, /Explore How DevQuest Works in 3D/);
  assert.match(overviewHtml, /Launch 3D Tour/);
  assert.match(sidebarHtml, /3D Workflow Guide/);
  assert.match(canvasHtml, /<canvas[^>]*class="dq-onboarding-canvas/);
  assert.equal(ONBOARDING_STAGES.length, 7);
  const stationSteps = ONBOARDING_STAGES.slice(1).map((s) => s.stepNumber);
  assert.deepEqual(stationSteps, ["01", "02", "03", "04", "05", "06"]);
  for (const stage of ONBOARDING_STAGES) {
    assert.ok(stage.title && stage.purpose && stage.mechanism && stage.governance && stage.workflowStage);
    assert.ok(Array.isArray(stage.highlights) && stage.highlights.length === 4);
    assert.ok(typeof stage.camera.yaw === "number" && typeof stage.camera.zoom === "number");
  }
});

test("ProjectDetail renders compact sticky header, horizontal stepper and 65/35 Overview workstation", () => {
  const state = uiFixture();
  state.quests[0].title = "Refactor Modul PIN";
  state.quests[0].kind = "TECH";
  state.quests[0].state = "INTAKE_READY";
  state.quests[0].sprint = "Sprint 71";
  state.runs = state.runs.filter((r) => r.state !== "RUNNING");
  state.works = [];
  state.repositories = [
    {
      id: "pf",
      name: "personal-finance-svc",
      path: "/workspace/personal-finance-svc",
      defaultBranch: "development",
      status: "READY",
    },
    {
      id: "ft",
      name: "funding-transaction-svc",
      path: "/workspace/funding-transaction-svc",
      defaultBranch: "master",
      status: "READY",
    },
  ];
  state.quests[0].repositoryIds = ["pf", "ft"];
  state.artifacts = [
    {
      id: "art-goal",
      questId: state.quests[0].id,
      kind: "tech_goal",
      title: "Technical Goal",
      version: 1,
      status: "APPROVED",
      markdown:
        "# Refactor Modul PIN\n\n- Target repos: personal-finance-svc, funding-transaction-svc",
    },
  ];
  const html = renderProjectDetail(state, { tab: "overview" });
  // Row 1: Breadcrumb, badges, actions
  assert.match(html, /Workspace/);
  assert.match(html, /Projects/);
  assert.match(html, /Refactor Modul PIN/);
  assert.match(html, /TECHNICAL/);
  assert.match(html, /INTAKE READY/);
  assert.match(html, /Sprint 71/);
  assert.match(html, /Back to Projects/);
  // Row 2: Horizontal compact stepper & primary CTA
  for (const step of ["Define", "Plan", "Build", "Review", "Done"]) {
    assert.ok(html.includes(step), step);
  }
  assert.match(html, /\+ Start Brainstorm/);
  // Underlined tabs
  for (const tabLabel of ["Overview", "Documents", "Work", "Room"]) {
    assert.ok(html.includes(tabLabel), tabLabel);
  }
  // 2-Column Overview cards
  assert.match(html, /Next Action/);
  assert.match(html, /Project Brief/);
  assert.match(html, /Linked Repositories/);
  assert.match(html, /Recent Agent Activity/);
  assert.match(html, /personal-finance-svc/);
  assert.match(html, /funding-transaction-svc/);
  assert.match(html, /development/);
  assert.match(html, /master/);
  assert.doesNotMatch(html, /<details/);
});

test("ProjectDetail Documents tab renders 25/75 file tree nav and Markdown viewport without accordions", () => {
  const state = uiFixture();
  state.quests[0].kind = "TECH";
  state.runs = [];
  state.tasks = [];
  state.artifacts = [
    {
      id: "art-trd",
      questId: state.quests[0].id,
      kind: "trd",
      title: "TRD",
      version: 2,
      status: "DRAFT",
      markdown: "## PIN Verification Architecture\n\nUse constant-time comparison.",
    },
  ];
  const html = renderProjectDetail(state, { tab: "documents", focusDocument: "trd" });
  for (const docLabel of [
    "Technical Goal",
    "TRD",
    "Specification",
    "Implementation Plan",
    "Jira Tickets",
  ]) {
    assert.ok(html.includes(docLabel), docLabel);
  }
  assert.match(html, /PIN Verification Architecture/);
  assert.match(html, /Copy/);
  assert.match(html, /Download/);
  assert.match(html, /Edit/);
  assert.doesNotMatch(html, /<details/);
});

test("ProjectDetail Work tab renders 4-column task pipeline with agent roles, git branches and test status pills", () => {
  const state = uiFixture();
  const html = renderProjectDetail(state, { tab: "work" });
  for (const col of ["Queue", "In Progress", "Code Review", "Done"]) {
    assert.ok(html.includes(col), col);
  }
  assert.match(html, /PAY-T01/);
  assert.match(html, /PAY-T03/);
  assert.match(html, /PAY-T04/);
  assert.match(html, /Developer/);
  assert.match(html, /devquest\/recurring-payment/);
  assert.match(html, /node-test: PASS/);
  assert.doesNotMatch(html, /<details/);
});

test("ProjectDetail Room tab renders live execution log, bottom input bar and preset agent triggers", () => {
  const state = uiFixture();
  const html = renderProjectDetail(state, { tab: "room" });
  assert.match(html, /Agent Room · Live Execution &amp; Decision Stream/);
  assert.match(html, /Send Note \/ Instruction to Agent/);
  assert.match(html, /@Architect analyze impact/);
  assert.match(html, /@Developer write tests/);
  assert.doesNotMatch(html, /<details/);
});

test("scene wheel captures focused zoom, preserves page scrolling and browser zoom, and cleans up", () => {
  const canvas = new EventTarget();
  canvas.ownerDocument = { activeElement: null };
  const zoom = [];
  const cleanup = bindSceneWheel(canvas, (delta) => zoom.push(delta));
  const wheel = (deltaY, ctrlKey = false) => {
    const event = new Event("wheel", { cancelable: true });
    Object.assign(event, { deltaY, ctrlKey });
    canvas.dispatchEvent(event);
    return event.defaultPrevented;
  };
  assert.equal(wheel(20), false);
  canvas.ownerDocument.activeElement = canvas;
  assert.equal(wheel(20), true);
  assert.equal(wheel(-20), true);
  assert.equal(wheel(0), false);
  assert.equal(wheel(20, true), false);
  assert.deepEqual(zoom, [-0.05, 0.05]);
  cleanup();
  assert.equal(wheel(20), false);
  assert.equal(zoom.length, 2);
});


test("approved appendix advances to publication preparation and explains the actual blocker", () => {
  const state=uiFixture(); const quest=state.quests[0];quest.state="PLAN_APPROVED";
  state.runs=[];
  state.artifacts=[{id:"plan-current",questId:quest.id,kind:"plan"},
    {id:"appendix-current",questId:quest.id,kind:"appendix",planArtifactId:"plan-current",approved:true,approvalReady:true,publicationReady:false,publicationError:"Mapping review required: assign appendix cards to execution tasks",content:"# Approved appendix",revision:1}];
  const html=renderProjectDetail(state,{tab:"documents",document:"appendix"});
  assert.match(html,/Prepare Jira Publication/);
  assert.match(html,/Mapping review required/);
  assert.doesNotMatch(html,/>Review Appendix<|>Approve Appendix</);
});

test("Room exposes a failed publishing AgentRun as Jira Specialist with its actual error", () => {
  const state = uiFixture();
  state.runs = [{id:'publisher-failed',questId:state.quests[0].id,purpose:'jira_publish',role:'jira-specialist',runtime:'claude',state:'FAILED',summary:'Publisher rejected before Claude started: visibility proof mismatch',createdAt:'2026-10-22T18:53:35.230Z'}];
  state.questRooms = {[state.quests[0].id]:{timeline:[{id:'publish-error',runId:'publisher-failed',kind:'agent',role:'Jira Specialist',stage:'Jira publication',state:'FAILED',body:state.runs[0].summary}]}};
  const html = renderProjectDetail(state, {tab:'room'});
  assert.match(html, /Jira Specialist/);
  assert.match(html, /Jira publication/);
  assert.match(html, /Publisher rejected before Claude started: visibility proof mismatch/);
  assert.doesNotMatch(html, />Reply</);
});

test("blocked task cards expose the actual diagnostic and a review action without retrying", () => {
  const state=uiFixture();
  state.tasks[0].state='NEEDS_HUMAN_ATTENTION';
  state.tasks[0].error='Configured base master differs from origin/master; explicitly configure baseResolution';
  const html=renderProjectDetail(state,{tab:'work'});
  assert.match(html,/Configured base master differs from origin\/master/);
  assert.match(html,/data-action="task-attention"/);
  assert.match(html,/Review blocker/);
});

test('completed implementation shows review even when a completed reviewer requires human attention',()=>{
 const state=uiFixture();
 state.tasks=state.tasks.map(t=>({...t,state:'COMPLETED'}));
 state.runs=[];
 const html=renderProjectDetail(state,{tab:'overview'});
 assert.match(html,/Implementation complete/);
 assert.match(html,/Review Findings/);
 assert.doesNotMatch(html,/Start Implementation/);
 assert.match(html,/Stage 4 of 5/);
 state.tasks[0].state='NEEDS_HUMAN_ATTENTION';
 const blocked=renderProjectDetail(state,{tab:'overview'});
 assert.match(blocked,/Start Implementation/);
 assert.doesNotMatch(blocked,/Implementation complete/);
});

test('PR cards surface saved publication errors and show approvals and running publication',()=>{
 const state=uiFixture();const work=state.works[0];work.state='READY_FOR_PR';work.humanApprovedCommit='reviewed-head';
 state.operations=[{id:`pr:${work.id}`,state:'INTERRUPTED',error:'GitHub provider cannot create a Bitbucket PR'}];
 let html=renderProjectDetail(state,{tab:'work'});
 assert.match(html,/GitHub provider cannot create a Bitbucket PR/);
 assert.match(html,/Review approved/);
 state.operations[0]={id:`pr:${work.id}`,state:'RUNNING'};
 html=renderProjectDetail(state,{tab:'work'});
 assert.match(html,/Creating pull request/);
 assert.doesNotMatch(html,/GitHub provider cannot create a Bitbucket PR/);
});

test('PR conflict recovery displays the preserved clean snapshot and keeps review actions available',()=>{
 const state=uiFixture(),work=state.works[0];
 work.productionReview={verdict:'PASSED',reviewedCommit:'a'.repeat(40)};
 let html=renderProjectDetail(state,{tab:'work'});
 assert.match(html,/Resolve PR conflicts/);assert.match(html,/data-expected-head="a{40}"/);
 work.targetRecovery={state:'MERGING',branch:'epic/project-clean',head:'a'.repeat(40),previousPr:{url:'https://bitbucket.org/team/repo/pull-requests/7'}};
 html=renderProjectDetail(state,{tab:'work'});
 assert.match(html,/epic\/project-clean/);assert.match(html,/local, not pushed/);assert.match(html,/Existing PR/);
 work.targetRecovery.state='RESOLVED';work.pr={url:'https://bitbucket.org/team/repo/pull-requests/7'};
 html=renderProjectDetail(state,{tab:'work'});
 assert.match(html,/Review Repository/);assert.doesNotMatch(html,/Resolve PR conflicts/);
});

test("CreateProjectForm requires deliberate repository selection and never pre-selects all repositories", () => {
  const state = uiFixture();
  const html = renderProjectForm(state);
  assert.match(html, /0 of 2 selected/);
  assert.match(html, /No repositories granted yet/);
  assert.doesNotMatch(html, /name="repositoryIds"[^>]*checked/);
});

test("WorkTab switches to adaptive completed task board when all tasks are completed and preserves Jira links", () => {
  const state = uiFixture();
  state.quests[0].state = "PRS_CREATED";
  state.tasks = state.tasks.map((t) => ({
    ...t,
    state: "COMPLETED",
    jira: {
      key: "FFE-101",
      url: "https://example.atlassian.net/browse/FFE-101",
      issues: [
        { key: "FFE-101", url: "https://example.atlassian.net/browse/FFE-101" },
        { key: "FFE-102", url: "https://example.atlassian.net/browse/FFE-102" },
        { key: "FFE-103", url: "https://example.atlassian.net/browse/FFE-103" },
      ],
    },
  }));
  const html = renderProjectDetail(state, { tab: "work" });
  assert.match(html, /All 4 Execution Tasks Completed/);
  assert.match(html, /Show 4-column board/);
  assert.match(html, /https:\/\/example\.atlassian\.net\/browse\/FFE-101/);
  assert.match(html, /\+1 more/);
  assert.match(html, /Awaiting External Merge/);
});

test("RoomTab shows readable summaries before raw JSON and clarifies paid CLI turns vs free room notes", () => {
  const state = uiFixture();
  state.questRooms = {
    [state.quests[0].id]: {
      timeline: [
        {
          id: "evt-json",
          runId: "run-1",
          taskId: "PAY-T01",
          kind: "agent",
          role: "Developer",
          stage: "Implementation",
          state: "WAITING_INPUT",
          body: 'Readable summary before telemetry.\n\n{"type":"waiting_input","taskId":"PAY-T01"}',
        },
      ],
    },
  };
  const html = renderProjectDetail(state, { tab: "room" });
  assert.match(html, /Readable summary before telemetry/);
  assert.match(html, /Show Raw JSON \/ Telemetry/);
  assert.match(html, /Waiting for human input/);
  assert.match(html, /Paid Turn/);
  assert.match(html, /Free · No Agent/);
});

test("DocumentsTab hides full local filesystem paths behind an explicit toggle", () => {
  const state = uiFixture();
  state.artifacts = [
    {
      id: "art-trd",
      questId: state.quests[0].id,
      kind: "trd",
      title: "TRD",
      version: 2,
      status: "APPROVED",
      file: "/Users/secret/local/path/.devquest/artifacts/quest-1/trd-v2.md",
      markdown: "# Architecture",
    },
  ];
  const html = renderProjectDetail(state, { tab: "documents", focusDocument: "trd" });
  assert.match(html, /trd-v2\.md/);
  assert.match(html, /Show full path/);
  assert.doesNotMatch(html, /\/Users\/secret\/local\/path/);
});


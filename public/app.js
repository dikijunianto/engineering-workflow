let dashboardUI;
import { Marked } from "/vendor/marked.js";

const $ = (selector) => document.querySelector(selector);
const esc = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char],
  );
const safeUrl = (value) => {
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? esc(url.href) : "#";
  } catch {
    return "#";
  }
};
let state,
  token,
  serverSession,
  loading = false,
  workspaceJiraDirty = false;
const liveOutput = new Map();
const documentModes = new Map();
const markdown = new Marked({
  renderer: {
    html({ text }) {
      return esc(text);
    },
    link({ href, tokens }) {
      const label = this.parser.parseInline(tokens);
      const url = safeUrl(href);
      return url === "#" ? label : `<a href="${url}" target="_blank" rel="noreferrer">${label}</a>`;
    },
    image({ text }) {
      return esc(text);
    },
  },
});
const documentViewSelect = (key, title) =>
  `<label class="document-view-label">View<select data-document-view="${esc(key)}" aria-label="View ${esc(title)}"><option value="viewer"${documentModes.get(key) !== "source" ? " selected" : ""}>Markdown viewer</option><option value="source"${documentModes.get(key) === "source" ? " selected" : ""}>Original Markdown</option></select></label>`;
const documentPreview = (key, title, content = "") =>
  `<div class="document-views" data-view="${documentModes.get(key) || "viewer"}"><article class="document markdown-view" tabindex="0" aria-label="${esc(title)} rendered Markdown">${markdown.parse(content.split("<!-- devquest-tasks")[0])}</article><pre class="document markdown-source" tabindex="0" aria-label="${esc(title)} original Markdown">${esc(content)}</pre></div>`;
// Presentation-only primitives. Action handlers and API payloads stay below.
const icons = {
  "folder": "folder-open",
  "sword": "sword",
  "home": "house",
  "quest": "flag",
  "repository": "git-fork",
  "party": "users",
  "jira": "list-checks",
  "settings": "settings-2",
  "branch": "git-branch",
  "architect": "compass",
  "planner": "list-tree",
  "developer": "square-terminal",
  "reviewer": "shield-check",
  "clock": "clock",
  "document": "file-text",
  "spark": "book-open",
  "arrow": "arrow-right",
  "check": "check",
  "alert": "triangle-alert",
  "orchestrator": "workflow",
  "jira_appendix": "list-checks",
  "waiting": "circle-question-mark",
  "blocked": "lock-keyhole",
  "running": "loader-circle",
  "complete": "circle-check",
  "menu": "menu"
};
const icon = (name) =>
  `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><use href="/icons/lucide.svg#${icons[name] || icons.quest}"></use></svg>`;
const roles = [
  {
    key: "architect",
    label: "Architect",
    purposes: ["brainstorm", "analysis", "trd"],
  },
  { key: "planner", label: "Planner", purposes: ["plan"] },
  { key: "developer", label: "Developer", purposes: ["task"] },
  { key: "reviewer", label: "Reviewer", purposes: ["review"] },
];
const orchestratorRole = {
  key: "orchestrator",
  label: "Orchestrator",
  purposes: ["v11-route"],
};
const appendixRole = {
  key: "jira_appendix",
  label: "Jira Specialist",
  purposes: ["jira_appendix_generation"],
};
const roleFor = (run) =>
  [appendixRole, orchestratorRole, ...roles].find(
    (r) => r.key === run.role || r.purposes.includes(run.purpose),
  ) || roles[2];
const stageNames = { brainstorm: "Brainstorm", analysis: "Repository analysis", trd: "Technical design", spec: "Specification", plan: "Implementation plan", jira_appendix_generation: "Jira appendix", task: "Implementation", "v11-task": "Implementation", "v11-fix": "Implementation fix", "v11-route": "Routing", review: "Independent review", "v11-review": "Independent review" };
const runtimeName = (key) => (key === "codex" ? "Codex" : "Claude Code");
const labels = {
  home: "Overview",
  quests: "Projects",
  repositories: "Repositories",
  agents: "Agents",
  skills: "Skills",
  jira: "Jira tasks",
  settings: "Settings & integrations",
  quest: "Project detail",
};
const runtimeOptions = () =>
  Object.entries(state.runtimes)
    .map(
      ([key, value]) =>
        `<option value="${esc(key)}" ${value.available ? "" : "disabled"}>${key === "codex" ? "Codex" : "Claude Code"}${value.available ? "" : " · unavailable"}</option>`,
    )
    .join("");
const button = (label, action, data = {}, style = "") =>
  `<button class="btn ${style}" data-action="${action}" ${Object.entries(data)
    .map(([key, value]) => `data-${key}="${esc(value)}"`)
    .join(" ")}>${label}</button>`;
const appendixApprovalButton = (doc, style) =>
  doc.approvalReady === false
    ? `<button class="btn ${style}" disabled title="${esc(doc.approvalError)}">Approve appendix revision</button><small role="status">${esc(doc.approvalError)}</small>`
    : button(
        "Approve appendix revision",
        "APPROVE_APPENDIX",
        { "quest-id": doc.questId, "artifact-id": doc.id },
        style,
      );
const statusGroups = {
  bad: ["FAILED", "BLOCKED", "RECOVERY_REQUIRED", "TEST_FAILED", "BASELINE_FAILED", "NEEDS_HUMAN_ATTENTION"],
  warn: ["WAITING_INPUT", "PAUSED", "INTERRUPTED", "AWAITING_TEST", "AWAITING_REVIEW", "TRD_DRAFT", "PLAN_DRAFT", "REVIEW_HANDOFF", "DRAFT", "UNCERTAIN"],
  running: ["RUNNING", "EXECUTING", "PREPARING", "STARTING", "GENERATING_APPENDIX", "SENDING"],
  success: ["COMPLETED", "APPROVED", "PASSED", "READY", "AVAILABLE", "CONFIGURED", "TRD_APPROVED", "PLAN_APPROVED", "PRS_CREATED", "TEAM_NOTIFIED"],
  special: ["TECH", "TECHNICAL", "PRODUCT", "FEATURE"],
};
function badge(status) {
  const tone = Object.keys(statusGroups).find((key) => statusGroups[key].includes(status)) || "neutral";
  const symbol = tone === "bad" ? (status === "BLOCKED" ? "blocked" : "alert") : tone === "warn" ? "waiting" : tone === "running" ? "running" : tone === "success" ? "complete" : null;
  return `<span class="badge ${tone}" data-status="${esc(status)}">${symbol ? icon(symbol) : '<span class="status-dot" aria-hidden="true"></span>'}${esc(String(status).replaceAll("_", " "))}</span>`;
}
const repository = (id) => state.repositories.find((r) => r.id === id);
const questTasks = (id) => state.tasks.filter((t) => t.questId === id);
const artifact = (id, kind) => state.artifacts.find((a) => a.questId === id && a.kind === kind);
const pct = (quest) => {
  const tasks = questTasks(quest.id);
  return tasks.length
    ? Math.round((tasks.filter((t) => t.state === "COMPLETED").length / tasks.length) * 100)
    : 0;
};
const bar = (value) =>
  `<progress class="native-progress" max="100" value="${value}" aria-label="Progress ${value}%">${value}%</progress>`;
const empty = (title, copy, action = "") =>
  `<div class="empty"><h3>${title}</h3><p>${copy}</p>${action}</div>`;
const head = (title, subtitle, action = "") =>
  `<div class="page-head"><div class="hero-copy"><h1>${esc(title)}</h1><p>${esc(subtitle)}</p></div>${action ? `<div class="hero-aside">${action}</div>` : ""}</div>`;
const panel = (title, body, link = "") =>
  `<section class="panel"><div class="panel-head"><h2>${title}</h2>${link}</div>${body}</section>`;
const notice = (title, copy, detail = "", extra = "", tone = "") =>
  `<section class="notice ${tone}" role="status">${icon(tone === "warning" ? "alert" : tone === "success" ? "check" : tone === "info" ? "running" : "document")}<div><strong>${esc(title)}</strong><p>${esc(copy)}</p>${extra}${detail ? `<details class="notice-details"><summary>Verification details</summary><pre>${esc(detail)}</pre></details>` : ""}</div></section>`;
const architectDocument = (key, title, body, controls = "") =>
  `<details class="panel architect-document" data-document="${esc(key)}"><summary class="panel-head"><h2>${title}</h2><span class="disclosure-label"><span class="expand-label">Expand ▾</span><span class="collapse-label">Collapse ▴</span></span></summary>${controls ? `<div class="panel-body toolbar">${controls}</div>` : ""}${body}</details>`;
const time = (value) =>
  new Date(value).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
function latestAttempts(runs) {
  // The store returns insertion order; retries replace only their own scope.
  const latest = new Map();
  for (const run of runs)
    latest.set(JSON.stringify([run.questId, run.purpose, run.taskId || run.workId || null]), run);
  return [...latest.values()];
}
function partyCards(runs = state.runs) {
  return `<div class="party-grid">${[orchestratorRole, ...roles, appendixRole]
    .map((role) => {
      const matching = latestAttempts(runs).filter((r) => roleFor(r).key === role.key);
      const run =
        matching.find((r) =>
          ["RUNNING", "WAITING_INPUT", "PAUSED", "INTERRUPTED", "FAILED"].includes(r.state),
        ) || matching.at(-1);
          return `<article class="party-member ${role.key}"><span class="role-avatar">${icon(role.key)}</span><div><h3>${role.label}</h3><small title="${esc(run?.route ? `${run.actualModel || run.resolvedModel} · ${run.resolvedEffort}; runtime model ${run.actualModel ? "reported" : "unverified"}` : "")}">${run ? runtimeName(run.runtime) : "No runs yet"}</small></div>${badge(run ? run.state : "IDLE")}${run ? `<a class="party-context" href="#quest/${esc(run.questId)}/overview">${esc(state.quests.find((q) => q.id === run.questId)?.title || "View Project")}</a>` : '<small>No active session</small>'}</article>`;
    })
    .join("")}</div>`;
}
function stageLabel(quest) {
  const active = latestAttempts(state.runs).find((run) => run.questId === quest.id && ["RUNNING", "WAITING_INPUT"].includes(run.state));
  if (active && stageNames[active.purpose]) return stageNames[active.purpose];
  return ({ INTAKE_READY: quest.kind === "TECH" ? "Brainstorm" : "Requirements analysis", BRAINSTORM_COMPLETED: "Repository analysis", ANALYZED: "Technical design", TRD_DRAFT: "Review TRD", TRD_APPROVED: "Implementation plan", PLAN_DRAFT: "Review plan", PLAN_APPROVED: artifact(quest.id, "appendix") ? "Jira appendix" : "Plan approved", TASKS_PUBLISHED: "Implementation", EXECUTING: "Implementation", READY_FOR_PR: "Independent review", REVIEW_HANDOFF: "Team review", PRS_CREATED: "Pull requests created" })[quest.state] || String(quest.state).replaceAll("_", " ");
}
function questChain(quest) {
  const stage =
    quest.state === "PRS_CREATED"
      ? 4
      : ["READY_FOR_PR", "REVIEW_HANDOFF"].includes(quest.state)
        ? 3
        : ["EXECUTING", "TASKS_PUBLISHED"].includes(quest.state)
          ? 2
          : ["TRD_APPROVED", "PLAN_DRAFT", "PLAN_APPROVED"].includes(quest.state)
            ? 1
            : 0;
  const blocked =
    latestAttempts(state.runs).some(
      (run) =>
        run.questId === quest.id && /FAILED|WAITING_INPUT|INTERRUPTED|PAUSED/.test(run.state),
    ) ||
    state.works.some((work) => work.questId === quest.id && work.state === "RECOVERY_REQUIRED");
  const steps = [
    ["Define", "Requirements, brainstorming, analysis and TRD", "documents"],
    ["Plan", "Implementation plan and Jira task linking", "documents"],
    ["Build", "Implementation, repository changes and tests", "work"],
    [
      "Review",
      quest.state === "REVIEW_HANDOFF" ? "Team review" : "Independent review, QA and team handoff",
      "work",
    ],
    ["Done", "Pull requests and handoff complete", "overview"],
  ];
  return `<ol class="pipeline" aria-label="Project workflow">${steps
    .map(([name, detail, tab], index) => {
      const done = index < stage || quest.state === "PRS_CREATED",
        current = index === stage && !done;
      return `<li class="${done ? "done" : current ? `current${blocked ? " blocked" : ""}` : "future"}" ${current ? 'aria-current="step"' : ""}><a href="#quest/${quest.id}/${tab}" title="${detail}"><span class="step-number">${done ? icon("check") : index + 1}</span><span>${name}<small>${done ? "Complete" : current ? (blocked ? "Needs attention" : "Current stage") : "Upcoming"}</small></span></a></li>`;
    })
    .join("")}</ol>`;
}
async function refresh() {
  if (loading) return;
  loading = true;
  try {
    const response = await fetch("/api/state");
    if (!response.ok) throw new Error("Cannot load workspace");
    state = await response.json();
    render();
  } catch (error) {
    toast(error.message);
  } finally {
    loading = false;
  }
}
function toast(message) {
  const box = $("#toast");
  box.textContent = message;
  box.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (box.hidden = true), 7000);
}
async function action(type, data = {}) {
  if (serverSession?.restartRequired) throw new Error("DevQuest files changed. Restart DevQuest and reload this page before continuing.");
  if (serverSession && (!Array.isArray(serverSession.actions) || !serverSession.actions.includes(type))) throw new Error("This server does not support that action. Restart DevQuest and reload this page.");
  const response = await fetch("/api/action", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-DevQuest-Token": token },
    body: JSON.stringify({ type, ...data }),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "Action failed");
  await refresh();
  return body.result;
}
function questRow(quest) {
  const tasks = questTasks(quest.id);
  const completed = tasks.filter((task) => task.state === "COMPLETED").length;
  return `<article class="quest-row"><div class="row-head"><a href="#quest/${quest.id}/overview" class="quest-title"><span class="quest-icon">${icon("document")}</span><div><h3>${esc(quest.title)}</h3><small>${quest.kind === "PRODUCT" ? "Feature" : "Technical"}</small></div></a><div class="task-actions">${badge(quest.state)}${button("Delete", "delete-project", { "quest-id": quest.id }, "small danger")}</div></div><div class="row-meta"><span>${quest.repositoryIds.length} ${quest.repositoryIds.length === 1 ? "repository" : "repositories"}</span><span>${tasks.length ? `${completed} of ${tasks.length} tasks complete` : "No tasks yet"}</span>${quest.sprint ? `<span>${esc(quest.sprint)}</span>` : ""}</div>${tasks.length ? `<div class="progress-row">${bar(pct(quest))}</div>` : ""}</article>`;
}

function agentsPanel() {
  return (
    Object.entries(state.runtimes)
      .map(([key, runtime]) => {
        const runs = state.runs.filter((r) => r.runtime === key && r.state === "RUNNING");
        return `<div class="agent-row"><span class="agent-avatar ${key}">${icon(key === "codex" ? "developer" : "spark")}</span><div><strong>${key === "codex" ? "Codex" : "Claude Code"}</strong><small>${runs.length ? `${runs.length} active session${runs.length > 1 ? "s" : ""}` : "No active runs"}</small></div>${badge(!runtime.available ? "UNAVAILABLE" : runs.length ? "RUNNING" : "IDLE")}</div>`;
      })
      .join("") +
    '<div class="hint">Runs start only after an explicit action.</div>'
  );
}
function activity(events = state.events) {
  return events.length
    ? events
        .slice(0, 7)
        .map(
          (event) =>
            `<div class="activity-row"><i></i><div>${esc(event.message)}<time>${time(event.createdAt)}</time></div></div>`,
        )
        .join("")
    : empty("No activity yet", "Project updates and agent results will appear here.");
}
function repoTable(repos = state.repositories) {
  if (!repos.length)
    return empty("Connect your first repository",
      "Add a local Git repository before creating a project.",
      button("+ Add repository", "add-repository", {}, "small"),
    );
  return `<div class="table-scroll" tabindex="0" role="region" aria-label="Repository registry"><table class="registry-table"><thead><tr><th>Repository</th><th>Base branch</th><th>Status</th><th>Works</th><th>Actions</th></tr></thead><tbody>${repos
    .map((repo) => {
      const works = state.works.filter((w) => w.repoId === repo.id);
      return `<tr><td class="repo-name"><div class="repository-identity"><span class="repo-emblem">${icon("repository")}</span><div><strong title="${esc(repo.name)}">${esc(repo.name)}</strong><small class="truncate" title="${esc(repo.path)}">${esc(repo.path)}</small></div></div></td><td><span class="branch-label">${icon("branch")}${esc(repo.baseBranch || repo.defaultBranch || "Not configured")}</span></td><td>${badge(repo.error ? "RECOVERY_REQUIRED" : works.find((w) => w.state === "EXECUTING") ? "EXECUTING" : "READY")}${repo.error ? `<small>${esc(repo.error)}</small>` : ""}</td><td><span class="work-count">${works.length}</span></td><td><div class="registry-actions">${button("Update path", "repository-path", { "repository-id": repo.id }, "small") + button("Branch policy", "repository-config", { "repository-id": repo.id }, "small")}</div></td></tr>`;
    })
    .join("")}</tbody></table></div>`;
}
function home() {
  const active = state.quests.filter((q) => q.state !== "PRS_CREATED");
  const running = state.runs.filter((r) => r.state === "RUNNING").length;
  const attention = state.runs.filter((r) =>
    ["WAITING_INPUT", "FAILED", "INTERRUPTED", "PAUSED"].includes(r.state),
  ).length;
  return head("Overview", "Projects and recent activity.", button("New project", "new-quest", {}, "primary")) +
    `<nav class="workspace-summary" aria-label="Workspace summary"><a href="#quests"><strong>${active.length}</strong> active ${active.length === 1 ? "project" : "projects"}</a><a href="#agents"><strong>${running}</strong> running ${running === 1 ? "agent" : "agents"}</a><a href="#repositories"><strong>${state.repositories.length}</strong> ${state.repositories.length === 1 ? "repository" : "repositories"}</a>${attention ? `<a href="#agents" class="amber"><strong>${attention}</strong> ${attention === 1 ? "run needs" : "runs need"} attention</a>` : ""}</nav>` +
    `<div class="overview-content">${panel("Active projects", active.length ? active.slice(0, 5).map(questRow).join("") : empty("No active projects", "Create a project from a PRD, technical task or bug report."), '<a href="#quests" class="subtle-link">All projects →</a>')}${state.events.length ? `<details class="overview-activity" data-disclosure="overview-activity"><summary>Recent activity</summary>${activity()}</details>` : ""}</div>`;
}

function quests(deleted = false) {
  return (
    head(
      "Projects",
      "Manage active and canceled work.",
      button("New project", "new-quest", {}, "primary"),
    ) +
    `<nav class="tabs" aria-label="Project lists"><a href="#quests" class="${deleted ? "" : "active"}">Active projects</a><a href="#quests/deleted" class="${deleted ? "active" : ""}">Deleted projects (${(state.deletedQuests || []).length})</a></nav>` +
    (deleted ? panel("Deleted projects", (state.deletedQuests || []).length ? state.deletedQuests.map((quest) => `<article class="quest-row"><div class="row-head"><div><h3>${esc(quest.title)}</h3><small>Deleted ${time(quest.deletedAt)}</small></div>${button("Restore", "restore-project", { "quest-id": quest.id }, "small")}</div>${quest.deletionReason ? `<p>${esc(quest.deletionReason)}</p>` : ""}<small>Documents, local work and history are preserved. Restoring does not restart agents.</small></article>`).join("") : empty("No deleted projects", "Projects you delete can be restored here.")) : panel(
      "All Projects",
      state.quests.length
        ? state.quests.map(questRow).join("")
        : empty("No active projects", "Create a feature, technical improvement or bug fix, or restore a project from Deleted projects."),
    ))
  );
}
function runEntry(run) {
  const role = roleFor(run);
  const quest = state.quests.find((q) => q.id === run.questId);
  return `<details class="run-entry" data-disclosure="run-${esc(run.id)}"><summary class="run-row"><span class="role-avatar ${role.key}">${icon(role.key)}</span><span><strong>${esc(run.purpose === "jira_appendix_generation" ? role.label : run.displayName || role.label)} · ${esc(stageNames[run.purpose] || run.purpose.replaceAll("_", " "))}</strong><small>${esc(quest?.title || "Project unavailable")} · ${runtimeName(run.runtime)}${run.updatedAt ? ` · ${time(run.updatedAt)}` : ""}</small></span>${badge(run.state)}</summary>${runCard(run)}</details>`;
}
function agents() {
  const rank = (run) => run.state === "WAITING_INPUT" ? 0 : run.state === "RUNNING" ? 1 : ["FAILED", "BLOCKED", "PAUSED", "INTERRUPTED"].includes(run.state) ? 2 : 3;
  const runs = state.runs.slice().reverse();
  const currentIds = new Set(latestAttempts(state.runs).map((run) => run.id));
  const current = runs.filter((run) => currentIds.has(run.id) && rank(run) < 3).sort((a,b) => rank(a) - rank(b));
  const history = runs.filter((run) => !current.includes(run));
  return head("Agents", "Review runs, answer questions and continue saved work.") +
    `<section class="run-group">${panel(`Current runs${current.length ? ` · ${current.length}` : ""}`, current.length ? current.map(runEntry).join("") : empty("No active sessions", "Start an architect from a Project, or execute a published task."))}</section>` +
    (history.length ? `<section class="run-group">${panel(`Run history · ${history.length}`, history.map(runEntry).join(""))}</section>` : "") +
    `<details class="agent-support" data-disclosure="agent-roles"><summary>Agent roles</summary>${partyCards()}</details>` +
    `<details class="agent-support" data-disclosure="agent-runtimes"><summary>Runtime connections</summary><div class="setting-grid">${Object.entries(state.runtimes).map(([key,r]) => panel(runtimeName(key), `<div class="panel-body">${badge(r.available ? "AVAILABLE" : "UNAVAILABLE")}<p>${esc(r.reason || "Authentication is checked when a run starts.")}</p><details><summary>Runtime details</summary><small>Resume: ${r.nativeResume ? "native when available" : "logical from checkpoints"}</small><small>CLI ${esc(r.version || "NOT_AVAILABLE")} · Auto Mode: ${r.autoMode ? "CLI supported; organization NOT_VERIFIED" : "NOT_AVAILABLE"} · Nested-agent restriction: ${r.nestedRestriction ? "supported" : "NOT_AVAILABLE"}</small></details></div>`)).join("")}</div></details>`;
}
const responseText = (value) =>
  String(value || "").replace(/^\s*DEVQUEST_WAITING_INPUT\b[ \t]*(?:\r?\n)?/, "");
function agentProfileDetails(run) {
  const s = run.profileSnapshot;
  if (!s) return '<details class="panel-body"><summary>Profile provenance</summary><small>Agent Profile: LEGACY / UNKNOWN</small></details>';
  return `<details class="panel-body"><summary>Agent Profile · ${esc(s.profile.id)}@${esc(s.profile.version)}</summary><p>${esc(s.profile.name)} · Hash: ${esc(s.profile.hash.slice(0, 12))}</p><p>Runtime: ${esc(runtimeName(s.runtime))} · Stage: ${esc(s.stage)}</p><p>Model: ${esc(s.requestedModel || "UNKNOWN")} → ${esc(s.route?.resolvedModel || "UNKNOWN")} · Effort: ${esc(s.requestedEffort || "UNKNOWN")} → ${esc(s.route?.resolvedEffort || "UNKNOWN")} (configured; runtime evidence reported separately)</p><p>Repositories: ${s.capabilities.repositories.map((r) => esc(repository(r.repositoryId || r.id)?.name || (s.role === "jira-specialist" ? "Approved Project documents" : r.id))).join(", ")}</p><p>Standards: ${s.repositoryStandards.map((p) => `${esc(repository(p.repositoryId)?.name || p.repositoryId)} · ${esc(p.sourceType)} · ${esc(p.status)} · ${esc(p.hash?.slice(0, 12) || "no hash")} · ${esc(p.commit?.slice(0, 8) || "no Git SHA")}`).join("<br>") || "Approved-document scope only"}</p><p>Skills: ${s.skills.map((p) => `${esc(p.name)} · ${esc(p.hash?.slice(0, 12) || p.status)}`).join(", ") || "None"}</p><p>Permissions: ${s.readOnly ? "Read only" : "Assigned worktree writes"}; no shell or nested agents. MCP: ${esc(s.capabilities.mcp?.stage || "none")}</p><small>Attempt ${esc(run.attemptNumber)} · Logical run ${esc(run.logicalRunId)}</small></details>`;
}
function runProgress(run) {
  if (run.state === "RUNNING") {
    const labels = {
      STARTING: "Preparing agent",
      PROCESS_STARTED: "Agent process started; waiting for runtime",
      CONNECTED: "Runtime connected",
      TOOL_RUNNING: "Inspecting or using a tool",
      TOOL_FINISHED: "Tool response received",
      RESPONDING: "Receiving agent response",
    };
    const elapsed = Math.max(0, Math.floor((Date.now() - Date.parse(run.lastProgressAt)) / 1000));
    return `${labels[run.runtimeActivity] || "Agent running"}${run.lastProgressAt ? ` · Last runtime event ${elapsed}s ago${elapsed >= 60 ? ". No recent events; the agent may still be working. You can interrupt and review saved progress." : ""}` : ". Waiting for the first runtime event."}`;
  }
  if (run.state === "WAITING_INPUT") return "Waiting for your answer. Review the response, then send an instruction.";
  if (run.state === "FAILED") return "Run failed. Review the error before retrying; continuing starts another agent turn.";
  if (["PAUSED", "INTERRUPTED"].includes(run.state))
    return run.recoveryReason || "Run stopped. Review saved progress before continuing; continuing starts another agent turn.";
  return run.state === "COMPLETED" ? "Agent turn completed. Review the result before the next step." : "Agent turn stopped.";
}

function runCard(run) {
  const task = state.tasks.find((t) => t.id === run.taskId);
  const waiting =
    ["PAUSED", "INTERRUPTED", "WAITING_INPUT", "FAILED", "COMPLETED"].includes(run.state) &&
    !(run.contractVersion === 1 && run.state === "COMPLETED") &&
    !(run.purpose === "jira_appendix_generation" && run.state === "COMPLETED");
  const role = roleFor(run);
  const output =
    (run.state === "FAILED" ? run.summary : liveOutput.get(run.id) || run.summary) ||
    (run.state === "RUNNING"
      ? "The session is running. Live output is temporary; save points preserve essential context."
      : "No summary is available yet. Inspect the preserved worktree and save points before continuing.");
  return `<section class="panel run-card ${role.key}" data-agent-run="${esc(run.id)}"><div class="row-head"><div class="run-identity"><span class="role-avatar">${icon(role.key)}</span><div><small>${role.label} · ${runtimeName(run.runtime)}</small><h3>${esc(run.displayName || task?.title || run.purpose)}</h3></div></div>${badge(run.state)}</div><p class="panel-body muted" data-run-progress="${esc(run.id)}" role="status">${esc(runProgress(run))}</p>${run.purpose === "jira_appendix_generation" ? `<div class="panel-body"><small>Skill: ${esc(run.skill || "create-appendix-task-list")} · ${esc(run.phase || run.state)}<br>Model: ${esc(run.actualModel || run.resolvedModel || "Unavailable")} · ${esc(run.resolvedEffort || "Unavailable")}<br>Elapsed: <span data-agent-elapsed data-start="${esc(run.startedAt || run.createdAt)}" data-end="${esc(run.finishedAt || (run.state !== "RUNNING" ? run.updatedAt : "") || "")}">${Math.max(0, Math.floor((Date.parse(run.finishedAt || (run.state !== "RUNNING" && run.updatedAt) || new Date().toISOString()) - Date.parse(run.startedAt || run.createdAt)) / 1000))}s</span> · Last progress: ${run.lastProgressAt ? time(run.lastProgressAt) : "Awaiting process"}</small></div>` : ""}${run.pid ? `<small class="truncate" title="${esc(run.cwd)}">Process ${run.pid} · ${esc(run.cwd)}</small>` : ""}${["PAUSED", "INTERRUPTED"].includes(run.state) ? `<div class="savepoint-note">${icon("clock")}<div><strong>Progress preserved</strong><small>Last Save Point${run.updatedAt ? ` · ${time(run.updatedAt)}` : ""}. Continue when you are ready.</small></div></div>` : ""}<pre class="run-output" data-output="${run.id}" tabindex="0" aria-label="Agent response">${esc(responseText(output))}</pre>${run.registeredSkills?.length ? `<details class="panel-body"><summary>Assigned guidance · ${run.registeredSkills.length}</summary><ul>${run.registeredSkills.map((skill) => `<li>${esc(skill.name)} · revision ${skill.revision} · ${esc(skill.runtime)}<br><code>${esc(skill.hash)}</code><br>Guidance included in prompt; native invocation and semantic consumption unverified.</li>`).join("")}</ul></details>` : ""}${agentProfileDetails(run)}${run.accessPreflight ? `<details class="panel-body"><summary>Repository access: ${esc(run.accessPreflight.status)}</summary><pre class="document">${esc(JSON.stringify({ ...run.accessPreflight, arguments: run.cliArguments }, null, 2))}</pre></details>` : ""}${run.route ? `<details class="panel-body"><summary>Model routing & usage</summary><p>${esc(run.role)} · ${esc(run.runtime)} · requested ${esc(run.requestedModel)} / ${esc(run.requestedEffort)} · resolved ${esc(run.resolvedModel)} / ${esc(run.resolvedEffort)}</p><p>Runtime-reported model: ${esc(run.actualModel || "NOT_AVAILABLE")} · ${esc(run.route.complexity)} / ${esc(run.route.risk)}</p><p>${esc(run.route.reason)}</p><small>Input tokens: ${esc(run.usage?.input_tokens ?? "NOT_AVAILABLE")} · Output tokens: ${esc(run.usage?.output_tokens ?? "NOT_AVAILABLE")} · Cost: NOT_AVAILABLE · Duration: ${esc(run.durationMs ?? "NOT_AVAILABLE")} ms</small><p>Optimization bootstrap: ${esc(JSON.stringify(run.optimizations || {}))}</p></details>` : ""}<div class="task-actions">${run.state === "RUNNING" ? button("Pause", "PAUSE_AGENT", { "run-id": run.id }) + button(run.purpose === "jira_appendix_generation" ? "Cancel generation" : "Interrupt", run.purpose === "jira_appendix_generation" ? "CANCEL_APPENDIX" : "INTERRUPT_AGENT", { "run-id": run.id }, "danger") : ""}${waiting && task?.state !== "COMPLETED" ? button("Continue", "CONTINUE_AGENT", { "run-id": run.id }, "primary small") : ""}${run.purpose === "jira_appendix_generation" && ["WAITING_INPUT", "PAUSED", "INTERRUPTED"].includes(run.state) ? button("Cancel generation", "CANCEL_APPENDIX", { "run-id": run.id }, "danger small") : ""}${button("Save checkpoint", "checkpoint", { "run-id": run.id }, "small")}</div>${waiting ? `<form data-form="message" data-run="${run.id}"><label>Instruction for this agent<textarea name="message" rows="2" required placeholder="Clarify a decision or give the next instruction…"></textarea></label><button class="btn small" type="submit">Send instruction ↗</button><div class="form-error" role="alert"></div></form>` : `<small>${(run.contractVersion === 1 || run.purpose === "jira_appendix_generation") && ["COMPLETED", "CANCELLED"].includes(run.state) ? "Use the Project actions to review or regenerate the appendix." : "Pause the current turn to send a new instruction."}</small>`}</section>`;
}
function jira() {
  const tasks = state.tasks.filter((t) => t.jira);
  return (
    head("Jira tasks", "Your approved plans, published with an explicit action.") +
    panel(
      "Published tasks",
      tasks.length
        ? `<div class="table-scroll" tabindex="0" role="region" aria-label="Published Jira tasks"><table><thead><tr><th>Issue</th><th>Task</th><th>Repository</th><th>State</th></tr></thead><tbody>${tasks.map((t) => `<tr><td>${(t.jira.issues || [t.jira]).map((issue) => `<a class="table-title" href="${safeUrl(issue.url)}" target="_blank" rel="noreferrer">${esc(issue.key)} ↗</a>`).join("<br>")}</td><td>${esc(t.title)}</td><td>${esc(repository(t.repoId)?.name)}</td><td>${badge(t.state)}</td></tr>`).join("")}</tbody></table></div>`
        : empty("Nothing published yet",
            "Approve a plan, then use Publish Tasks to Jira in its Project.",
          ),
    )
  );
}
function skillsView() {
  const labels = {
    NOT_ASSESSED: "Not assessed", NEEDS_REVIEW: "Needs review",
    REQUIRES_SETUP: "Requires setup", DECLARED_COMPATIBLE: "Compatible instructions (declared)",
  };
  const skills = state.skills || [];
  return head("Skills", "See which agents a skill supports and what it needs before using it.",
    button("+ Register skill", "register-skill", {}, "primary")) +
    `<p class="muted">Compatibility is user-declared, not runtime tested. Connections and tool permissions must be checked before execution. Registration does not activate a skill or grant permissions.</p>` +
    (skills.length ? skills.map((skill) => {
      const needs = skill.requirements;
      const requirements = [
        ...needs.mcp.map((name) => `MCP: ${name} · connection not checked`),
        ...needs.tools.map((name) => `Tool: ${name} · permission not checked`),
        ...(needs.other ? [needs.other] : []),
      ];
      return panel(`${icon("spark")} ${esc(skill.name)} · revision ${skill.revision}`,
        `<div class="panel-body"><p>${esc(skill.description || "No description supplied.")}</p><div class="row-meta">${["claude", "codex"].map((runtime) => `<span><strong>${runtimeName(runtime)}</strong>: ${esc(labels[skill.compatibility[runtime]])}${state.runtimes[runtime]?.available ? "" : " · runtime unavailable"}</span>`).join("")}</div><h3>Requirements</h3>${requirements.length ? `<ul>${requirements.map((item) => `<li>${esc(item)}</li>`).join("")}</ul>` : `<p>${needs.mode === "instructions" ? "Instructions only · no external requirements declared." : "Requirements have not been specified."}</p>`}${skill.sourceHints.length ? `<details><summary>Source references to review</summary><p>${skill.sourceHints.map(esc).join("; ")}. These hints are not a complete dependency check.</p></details>` : ""}<small>${skill.declarationConfirmed ? "Requirements reviewed by user" : "Requirements review pending"}</small><details><summary>Source and version</summary><p><code>${esc(skill.path)}</code></p><small>Source SHA-256: ${esc(skill.sourceHash)}${skill.declaredVersion ? `<br>Skill version: ${esc(skill.declaredVersion)}` : ""}<br>Captured ${time(skill.updatedAt)}. Reinspect after changing the source.</small></details><div class="task-actions">${button("Edit / reinspect", "edit-skill", { "skill-id": skill.id }, "small")}${button("Remove registration", "archive-skill", { "skill-id": skill.id }, "small")}</div></div>`);
    }).join("") : panel("Skill library", empty("No registered skills", "Register an existing SKILL.md folder. Your installed skills remain unchanged."))) +
    panel("Existing workflow skills", `<div class="panel-body"><p>${(state.settings.localSkills || []).length ? state.settings.localSkills.map(esc).join(", ") : "No configured workflow skills reported."}</p><small>Existing workflow integrations continue using their current configuration. This library does not replace or reassign them.</small></div>`);
}

function editSkill(skill = {}) {
  const needs = skill.requirements || { mode: "unknown", mcp: [], tools: [], other: "" };
  dialog(skill.id ? "Edit skill registration" : "Register local skill",
    `<input type="hidden" name="skillId" value="${esc(skill.id)}"><input type="hidden" name="revision" value="${skill.revision || 0}"><input type="hidden" name="sourceHash" value="${esc(skill.sourceHash)}"><label>Skill folder or SKILL.md path<input name="path" required value="${esc(skill.path)}" placeholder="~/.claude/skills/my-skill"></label>${button("Inspect skill", "inspect-skill", {}, "small")}<p data-skill-preview role="status">Inspect the source before saving. Only SKILL.md is read; nothing is executed.</p><label>Name<input name="name" maxlength="100" value="${esc(skill.name)}"></label><label>Description<textarea name="description" rows="2" maxlength="600">${esc(skill.description)}</textarea></label><fieldset><legend>Declared runtime compatibility</legend><div class="checks">${["claude", "codex"].map((runtime) => `<label><input type="checkbox" name="runtimes" value="${runtime}"${skill.runtimes?.includes(runtime) ? " checked" : ""}>${runtimeName(runtime)}</label>`).join("")}</div><small>Leave unchecked if not assessed. Selecting both does not prove native invocation works in both.</small></fieldset><label>Requirements category<select name="requirementMode">${[["unknown", "Not assessed"], ["instructions", "Instructions only — no external requirements"], ["external", "Requires tools, MCP or other setup"]].map(([value, label]) => `<option value="${value}"${needs.mode === value ? " selected" : ""}>${label}</option>`).join("")}</select></label><label>Required MCP servers (comma separated)<input name="mcp" value="${esc(needs.mcp.join(", "))}" placeholder="atlassian"></label><label>Required tools (comma separated)<input name="tools" value="${esc(needs.tools.join(", "))}" placeholder="Read, Skill"></label><label>Other requirements<textarea name="other" rows="2" maxlength="2000" placeholder="Required scripts, local assets, environment variable names or runtime-specific behavior. Never enter secret values.">${esc(needs.other)}</textarea></label><label class="checks"><input type="checkbox" name="declarationConfirmed"${skill.declarationConfirmed ? " checked" : ""}>I reviewed the skill's runtime support and requirements</label><small>This records compatibility declarations. It does not install dependencies, connect MCP servers, assign skills to agents or authorize execution.</small>`, "skill-registration", "Save registration");
}

function settings() {
  const group = (key, title, content, open = false) => `<details class="settings-group" data-disclosure="settings-${key}" ${open ? "open" : ""}><summary>${title}</summary><div class="setting-grid">${content}</div></details>`;
  return head("Settings & integrations", "Workspace preferences, agent runtimes and connected services.") + readinessView() +
    group("workspace", "Workspace", panel("Local workspace", `<div class="panel-body"><p>Data directory</p><div class="code">${esc(state.settings.dataDir)}</div><p>Maximum active sessions <strong>${state.settings.concurrency}</strong>. Repository branch policies are configured per repository.</p>${button("Reconcile saved state", "RECONCILE", {}, "small")}</div>`) + panel("Local configuration", `<div class="panel-body"><p>Machine-level settings are read at startup. Restart DevQuest after changing executable or integration settings.</p><div class="code">~/.devquest/config.json</div><small>Keep tokens out of this file. See README.md for setup.</small></div>`), true) +
    group("agents", "Agents & skills", panel("Agent runtimes", agentsPanel()) + panel("Local skills", `<div class="panel-body"><p>${esc((state.settings.localSkills || []).join(", ") || "No workflow skills configured.")}</p><a class="subtle-link" href="#skills">Manage skill library →</a></div>`)) +
    group("integrations", "Integrations", panel("Jira Configuration", workspaceJiraForm()) + panel("Jira publishing skill", `<div class="panel-body">${badge(state.settings.jiraConfigured ? "CONFIGURED" : "NOT_CONFIGURED")}<p>Uses your local /upload-task-to-jira skill and Claude Code’s Atlassian connection. Review each sample or batch before publishing more.</p><small>See docs/integrations.md for the bridge contract.</small></div>`) + panel("Confluence", `<div class="panel-body">${badge(state.settings.confluenceConfigured ? "CONFIGURED" : "NOT_CONFIGURED")}<p>Import a main page and one level of directly linked pages. Credentials come from the configured environment or authentication provider.</p><small>Review the imported page list before generating a TRD.</small></div>`) + panel("GitHub", `<div class="panel-body"><p>Uses your existing GitHub CLI login. Each repository work produces one PR to its configured target. Each publication has its own action.</p><div class="code">gh auth login</div></div>`) + panel("Google Chat", `<div class="panel-body">${badge(state.settings.chatConfigured ? "CONFIGURED" : "NOT_CONFIGURED")}<p>Set googleChat.webhookEnv to the environment variable holding your webhook. Requests retain a receipt and a stable retry ID.</p></div>`));
}
function appendixAttempt(id) {
  const managed = state.runs.filter(
    (r) => r.questId === id && r.purpose === "jira_appendix_generation",
  );
  const preflight = (state.operations || []).find((op) => op.id === `appendix-preflight:${id}`);
  if (
    preflight &&
    (preflight.state === "RUNNING" ||
      (preflight.state === "FAILED" &&
        (!managed.length || preflight.startedAt >= managed.at(-1).createdAt)))
  )
    return preflight;
  const legacy = (state.operations || []).find((op) => op.id === `appendix:${id}`);
  return (
    managed.find((r) => r.generationActive === true) ||
    (legacy?.generationActive === true ? legacy : managed.at(-1) || legacy)
  );
}
function appendixStatus(quest) {
  const attempt = appendixAttempt(quest.id);
  const operation = attempt ? { ...attempt, error: attempt.error || attempt.summary } : null;
  const doc = artifact(quest.id, "appendix");
  if (!operation && !doc) return "";
  const running = operation?.generationActive === true;
  const failed = operation && ["INTERRUPTED", "FAILED"].includes(operation.state);
  const title = running
    ? operation.phase?.startsWith("VERIFY")
      ? "Checking Jira configuration…"
      : "Generating Jira Appendix…"
    : failed
      ? "Jira Appendix Generation"
      : operation?.state === "CANCELLED"
        ? "Jira Appendix generation cancelled"
        : operation?.state === "WAITING_INPUT"
          ? "Jira Appendix Agent needs input"
          : "Jira Appendix generated successfully";
  if (!running && !failed && operation?.state !== "WAITING_INPUT" && operation?.state !== "CANCELLED")
    return notice(title, "Review generated tasks before publishing.", operation ? `${operation.phase || operation.state} · ${operation.runtime || "Claude Code"} · ${operation.resolvedModel || operation.model || "configured model"} · ${operation.resolvedEffort || operation.effort || "configured effort"}\nSkill: ${operation.skill || "create-appendix-task-list"}` : "", doc ? `<a class="subtle-link" href="#quest/${quest.id}/appendix">View Appendix →</a>` : "", "success");
  return panel(
    title,
    `<div class="panel-body" role="status" aria-live="polite">${failed ? `<p><strong>Status: FAILED</strong></p><details><summary>View Error</summary><pre class="document">${esc(operation.error || "Generation interrupted")}</pre></details>` : ""}${failed || operation?.state === "WAITING_INPUT" ? `<p class="warning">${esc(/timed out after 120000ms/.test(operation.error || "") ? "Claude execution timed out after 120 seconds." : operation.error || "Generation was interrupted. Retry generation; the previous appendix is preserved.")}</p>` : `<p>${running ? "The integrated skill is running. No Jira issues will be created." : operation?.state === "CANCELLED" ? "Previous appendix revisions are preserved. Regenerate when ready." : "Review generated tasks before publishing."}</p>`}${operation ? `<p>${esc(operation.phase || operation.state)} · ${esc(operation.runtime || "Claude Code")} · ${esc(operation.resolvedModel || operation.model || "configured model")} · ${esc(operation.resolvedEffort || operation.effort || "configured effort")}</p>` : ""}${operation?.skill ? `<small>Skill: ${esc(operation.skill)} · ${esc(operation.runtime || "configured runtime")}</small>` : ""}${
      running
        ? (() => {
            const previous = [
              ...state.runs.filter(
                (r) =>
                  r.questId === quest.id &&
                  r.purpose === "jira_appendix_generation" &&
                  r.id !== operation.id,
              ),
              ...(state.operations || []).filter(
                (o) => o.id === `appendix:${quest.id}` && o.id !== operation.id,
              ),
            ]
              .filter((r) => ["FAILED", "INTERRUPTED"].includes(r.state))
              .at(-1);
            return previous
              ? `<details><summary>Previous attempt error</summary><pre class="document">${esc(previous.error || previous.summary)}</pre></details>`
              : "";
          })()
        : ""
    }${doc ? `<p><a class="btn small" href="#quest/${quest.id}/appendix">View Appendix</a></p>` : ""}</div>`,
  );
}
function savedJiraContext(quest) {
  const context = quest.jiraContext || {};
  const verified = (state.operations || []).find(
    (op) => op.id === `jira-verify:${quest.id}`,
  )?.capabilities;
  return verified?.contextKey === JSON.stringify(context)
    ? {
        ...context,
        siteUrl: context.siteUrl || verified.siteUrl,
        projectUrl: context.projectUrl || verified.projectUrl,
      }
    : context;
}
function workspaceJira() {
  return state.settings.jiraWorkspace || { version: 0, defaultProject: "", projects: {} };
}
function jiraFields(context, workspace = false) {
  const w = context.backendWeights;
  return `<div data-jira-fields><div class="form-row"><label>Jira project key<input name="project" list="${workspace ? "workspace-jira-projects" : "quest-jira-projects"}" required value="${esc(context.project || "")}"><datalist id="${workspace ? "workspace-jira-projects" : "quest-jira-projects"}">${Object.keys(
    workspaceJira().projects,
  )
    .map((p) => `<option value="${esc(p)}"></option>`)
    .join(
      "",
    )}</datalist></label><label>Jira site URL<input name="siteUrl" type="url" required value="${esc(context.siteUrl || "")}" placeholder="https://your-team.atlassian.net"></label></div><label>Project URL<input name="projectUrl" type="url" required value="${esc(context.projectUrl || "")}"></label>${workspace ? "" : `<label>Jira Epic (optional)<input name="epic" value="${esc(context.epic || "")}"></label>`}<div class="form-row"><label>Appendix category family<select name="categoryFamily">${["BE", "MOB", "ALL"].map((f) => `<option${(context.categoryFamily || "ALL") === f ? " selected" : ""}>${f}</option>`).join("")}</select></label><label>Atlassian MCP server<input name="mcpServer" required value="${esc(context.mcpServer || "atlassian")}"></label></div><label>Assignee (optional)<input name="assignee" value="${esc(context.assignee || "")}"></label><details${workspace && context.categoryFamily === "BE" ? " open" : ""}><summary>Backend weight reference — project-specific, User Confirmed</summary><div class="panel-body"><div class="form-row">${["V", "L", "M", "H"].map((k) => `<label>BE-${k} points<input name="weight${k}" type="number" min="1" max="16" value="${esc(w?.levels?.[k] || "")}"></label>`).join("")}</div><div class="form-row"><label>Reference version<input name="weightVersion" value="${esc(w?.version || "1.0.0")}"></label><label>Scale<input name="weightScale" value="${esc(w?.scale || "User Confirmed")}"></label></div><small>Saving numeric values confirms this reference for this project. Exact Jira labels and option IDs are fetched live; they are never replaced with Mobile categories.</small></div></details><label>Weight reference / supporting notes<textarea name="weightReference" rows="3">${esc(context.weightReference || "")}</textarea></label><label>Live metadata timeout (seconds)<input name="metadataTimeout" type="number" min="10" max="120" value="${esc(context.metadataPreferences?.timeoutSeconds || 60)}"></label><small>Jira Specialist uses Claude Code and its existing agent model policy (Sonnet / medium by default). Model overrides remain in agent execution settings. Live metadata and native skill availability are checked before generation.</small></div>`;
}
function workspaceJiraForm(project = workspaceJira().defaultProject) {
  const w = workspaceJira(),
    p = w.projects[project] || { project: "" };
  return `<form class="panel-body" data-form="workspace-jira"><p>Project defaults · version ${w.version}. Existing Projects keep their saved settings.</p>${jiraFields(p, true)}<label>Repository associations (optional)</label><div class="checks">${state.repositories.map((r) => `<label><input type="checkbox" name="jiraRepositoryIds" value="${r.id}"${p.repositoryIds?.includes(r.id) ? " checked" : ""}>${esc(r.name)}</label>`).join("")}</div><label class="checks"><input type="checkbox" name="makeDefault"${w.defaultProject === project || !w.defaultProject ? " checked" : ""}>Use as Workspace default project</label><input type="hidden" name="expectedVersion" value="${w.version}"><div class="form-error" role="alert"></div><button class="btn primary" type="submit">Save Jira defaults</button></form>`;
}
function jiraInput(values) {
  const project = String(values.get("project") || "").trim();
  const result = Object.fromEntries(
    ["project", "siteUrl", "projectUrl", "epic", "assignee", "weightReference"].map((k) => [
      k,
      values.get(k) || "",
    ]),
  );
  if (values.get("categoryFamily")) result.categoryFamily = values.get("categoryFamily");
  if (values.get("mcpServer")) result.mcpServer = values.get("mcpServer");
  if (values.get("metadataTimeout"))
    result.metadataPreferences = {
      mode: "live",
      timeoutSeconds: Number(values.get("metadataTimeout")),
    };
  if (values.get("categoryFamily"))
    result.backendWeights = ["V", "L", "M", "H"].some((k) => values.get(`weight${k}`))
      ? {
          project,
          name: `${project} Backend Appendix Weights`,
          version: values.get("weightVersion"),
          source: "User Confirmed",
          scale: values.get("weightScale"),
          family: "BE",
          levels: Object.fromEntries(
            ["V", "L", "M", "H"].map((k) => [k, Number(values.get(`weight${k}`))]),
          ),
        }
      : null;
  return result;
}
function questJiraDefault(repositoryIds = state.repositories.map((r) => r.id)) {
  const w = workspaceJira(),
    matches = Object.values(w.projects).filter((p) =>
      p.repositoryIds?.some((id) => repositoryIds.includes(id)),
    );
  return matches.length > 1 ? "" : matches[0]?.project || w.defaultProject;
}
function questJiraFields() {
  const w = workspaceJira(),
    p = w.projects[questJiraDefault()] || {};
  return `<details open><summary>Jira configuration</summary><div class="panel-body"><label class="checks"><input type="checkbox" name="jiraEnabled"${p.project ? " checked" : ""}>Use Jira integration</label><div data-jira-config${p.project ? "" : " hidden"}><p>Prefilled from Workspace / project defaults. Epic stays specific to this Project.</p>${jiraFields(p)}</div></div></details>`;
}
function editJira(quest) {
  return dialog(
    "Edit Jira Configuration",
    `<input type="hidden" name="questId" value="${esc(quest.id)}">${jiraFields({ ...quest.jiraConfig, ...savedJiraContext(quest) })}<p>${button("Refresh inherited defaults", "REFRESH_QUEST_JIRA", { "quest-id": quest.id }, "small")}</p><small>Refresh preserves explicit Project overrides and Epic. Saving requires fresh appendix approval; generation and publication are separate actions.</small>`,
    "jira-settings",
    "Save settings",
  );
}
function jiraSummary(quest) {
  const c = quest.jiraContext || {},
    j = quest.jiraConfig || {};
  return `<div class="panel-body"><strong>Jira configuration</strong><p>Project: ${esc(c.project || "Not configured")} · Epic: ${esc(c.epic || "None (optional)")} · Category: ${esc(j.categoryFamily || "Legacy / all")} · Weight Reference: ${esc(j.backendWeights?.scale || (c.weightReference ? "Saved reference" : "Not configured"))} · Metadata: ${quest.jiraMetadata ? "Verified " + esc(quest.jiraMetadata.checkedAt) : "Unverified"}</p><small>${j.enabled === false ? "Jira integration is disabled or awaiting configuration." : `Snapshot version ${j.workspaceVersion ?? "legacy"}; Workspace updates require an explicit refresh.`}</small></div>`;
}
let lastRenderedProjectRoute = "";
const collaborationDrafts = new Map();
const draftValue = (questId, key, name, fallback = "") =>
  collaborationDrafts.get(`${questId}:${key}`)?.[name] ?? fallback;
function rememberCollaboration(form) {
  if (!form?.dataset?.collaboration) return;
  const values = new FormData(form);
  collaborationDrafts.set(`${values.get("questId")}:${form.dataset.draftKey}`, {
    ...Object.fromEntries(
      [
        "referenceId",
        "expectedRevision",
        "message",
        "runToken",
        "requestId",
        "title",
        "expected",
        "jiraKey",
        "repositoryId",
        "name",
        "content",
        "actual",
        "caseId",
        "status",
        "role",
        "runtime",
        "workId",
        "taskId",
      ].map((name) => [name, values.get(name) || ""]),
    ),
    referenceIds: values.getAll("referenceIds"),
    skillPins: values.getAll("skillPins"),
  });
}
function collaborationForm(questId, kind, title, fields, submit, key = kind) {
  const saved = collaborationDrafts.get(`${questId}:${key}`);
  if (saved)
    fields = fields.replace(
      /<select name="([^"]+)"([^>]*)>([\s\S]*?)<\/select>/g,
      (all, name, attrs, options) => {
        if (!saved[name]) return all;
        return `<select name="${name}"${attrs}>${options.replace(/<option value="([^"]*)"[^>]*>/g, (option, value) => `<option value="${value}" ${value === esc(saved[name]) ? "selected" : ""}>`)}</select>`;
      },
    );
  if (saved?.expectedRevision)
    fields = fields.replace(
      /<input type="hidden" name="expectedRevision" value="[^"]*">/,
      `<input type="hidden" name="expectedRevision" value="${esc(saved.expectedRevision)}">`,
    );
  for (const field of ["referenceIds", "skillPins"]) {
    if (!saved?.[field]) continue;
    let stale = false;
    fields = fields.replace(
      new RegExp(`<input type="checkbox" name="${field}" value="([^\\"]+)"[^>]*>`, "g"),
      (all, token) => {
        const prior = saved[field].find((value) => value.split("|")[0] === token.split("|")[0]);
        if (prior && prior !== token) stale = true;
        return `<input type="checkbox" name="${field}" value="${esc(prior || token)}" ${prior ? "checked" : ""}>`;
      },
    );
    if (stale) fields = `<p class="warning">A selected ${field === "skillPins" ? "skill" : "reference"} changed. Reload and review its latest revision before applying.</p>` + fields;
  }
  return `<details class="panel section-space" data-disclosure="collaboration-${esc(questId)}-${esc(key)}" ${saved ? "open" : ""}><summary class="panel-head">${esc(title)}</summary><form class="panel-body stack" data-form="${kind}" data-collaboration="true" data-route="${esc(location.hash)}" data-draft-key="${esc(key)}"><input type="hidden" name="questId" value="${esc(questId)}">${fields}<p class="form-error" role="alert"></p><button class="btn primary" type="submit">${esc(submit)}</button></form></details>`;
}
function questBlockers(quest) {
  const blockers = state.questRooms?.[quest.id]?.blockers || [];
  return blockers.length
    ? panel(
        "Project attention",
        blockers
          .map(
            (b) =>
              `<div class="quest-blocker"><strong>${esc(b.title)}</strong><p>${esc(b.detail)}</p><a class="btn small" href="${esc(b.href)}">Review next action</a></div>`,
          )
          .join(""),
      )
    : "";
}
function eligibleRoomRuns(id) {
  return state.runs.filter((r) => {
    const downstream = {
      brainstorm: ["analysis", "trd", "plan"],
      analysis: ["trd", "plan"],
      trd: ["plan"],
    }[r.purpose];
    const latest = state.runs
      .filter(
        (other) =>
          other.questId === id &&
          other.purpose === r.purpose &&
          other.taskId === r.taskId &&
          other.workId === r.workId,
      )
      .at(-1);
    return (
      r.questId === id &&
      !r.replacedBy &&
      latest?.id === r.id &&
      !downstream?.some((kind) => artifact(id, kind)) &&
      ["WAITING_INPUT", "PAUSED", "INTERRUPTED", "FAILED", "COMPLETED"].includes(r.state)
    );
  });
}
function roomView(quest) {
  const id = quest.id,
    room = state.questRooms?.[id];
  const timeline = room?.timeline || [];
  const stopped = eligibleRoomRuns(id);
  const priorToken = draftValue(id, "room-reply", "runToken");
  let choices = stopped
    .map((r) => {
      const value = `${r.id}|${r.updatedAt || ""}`;
      return `<option value="${esc(value)}" ${priorToken === value ? "selected" : ""}>${esc(roleFor(r).label)} · ${esc(r.purpose)} · ${esc(r.state)}</option>`;
    })
    .join("");
  if (priorToken && !stopped.some((r) => `${r.id}|${r.updatedAt || ""}` === priorToken))
    choices =
      `<option value="${esc(priorToken)}" selected>Selected turn changed; reload and choose a current turn</option>` +
      choices;
  const requestId = draftValue(
    id,
    "room-reply",
    "requestId",
    `${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  return (
    `<p class="muted">Shared findings, questions and handoffs. Notes stay in this room. Agents do not read or act on room messages automatically.</p>` +
    panel(
      "Agent timeline",
      timeline.length
        ? `<ol class="room-timeline">${timeline.map((m) => `<li><details><summary><strong>${esc(m.kind === "agent" ? m.role : "You")}</strong> · ${esc(m.stage || m.kind)} ${m.state ? badge(m.state) : ""}<small>${esc(m.createdAt || "")}</small></summary><pre class="document">${esc(m.body)}</pre>${m.delivery ? `<p><strong>Delivery: ${esc(m.delivery.status)}</strong></p><small>${esc(m.delivery.evidence)}</small>${m.delivery.resultRunId ? `<p>Resulting AgentRun: <code>${esc(m.delivery.resultRunId)}</code> · ${time(m.delivery.updatedAt)}</p>` : ""}` : ""}${m.error ? `<p class="warning">${esc(m.error)}</p>` : ""}${m.runId ? `<details><summary>Technical details</summary><small>AgentRun ${esc(m.runId)}</small></details>` : ""}</details>${m.kind === "agent" && stopped.some((run) => run.id === m.runId) ? button(m.state === "WAITING_INPUT" ? "Answer" : "Reply", "room-answer", { "quest-id": id, "run-id": m.runId }, "small") : ""}</li>`).join("")}</ol>`
        : "<p>No agent turns or notes yet.</p>",
    ) +
    collaborationForm(
      id,
      "room-note",
      "Post a room note",
      `<label>Note<textarea name="message" rows="4" required maxlength="8000">${esc(draftValue(id, "room-note", "message"))}</textarea></label><small>Saving a note starts no agent and changes no approval.</small>`,
      "Save note",
    ) +
    (stopped.length || priorToken
      ? collaborationForm(
          id,
          "room-reply",
          "Send an instruction to an agent",
          `<label>Stopped agent turn<select name="runToken" required>${choices}</select></label><input type="hidden" name="requestId" value="${esc(requestId)}"><label>Instruction<textarea name="message" rows="4" required maxlength="8000">${esc(draftValue(id, "room-reply", "message"))}</textarea></label><label class="checks"><input type="checkbox" name="confirmAgentRun" required>I understand this starts an agent turn and may consume paid usage.</label><small>Existing stage, permissions, concurrency and continuation rules still apply. Posting here does not approve artifacts or publish Jira issues.</small>`,
          "Send instruction · starts agent",
        )
      : '<p class="muted">Directed replies become available after an agent turn stops.</p>')
  );
}
function qaView(quest) {
  const id = quest.id,
    cases = (state.qaCases || []).filter((c) => c.questId === id);
  const repos = quest.repositoryIds
    .map((key) => state.repositories.find((r) => r.id === key))
    .filter(Boolean);
  const options = repos.map((r) => `<option value="${esc(r.id)}">${esc(r.name)}</option>`).join("");
  return (
    `<p class="muted">Manual QA evidence supplements existing automated validation and review gates. It never runs tests or changes Jira. Verify saved evidence again after code changes.</p>` +
    panel(
      "Scenarios and results",
      cases.length
        ? cases
            .map((c) => {
              const evidence = c.evidence.at(-1),
                verification = c.verification;
              return `<details class="qa-case"><summary>${esc(c.title)} · ${esc(evidence?.status || "NOT TESTED")}</summary><p>Expected: ${esc(c.expected)}</p><p>Existing QA issue: ${esc(c.jiraKey || "None")}</p>${evidence ? `<p>Human observation: ${esc(evidence.actual)}</p><p>Commit: <code>${esc(evidence.commit)}</code></p>` : ""}${verification ? `<p class="${verification.current ? "muted" : "warning"}">${verification.current ? "Evidence matched when checked" : "Retest required"} · ${esc(verification.checkedAt)} ${esc(verification.error)}</p>` : "<p>Current source match: not verified</p>"}<details><summary>Evidence history (${c.evidence.length})</summary>${c.evidence.map((e) => `<p>${esc(e.createdAt)} · Human · ${esc(e.status)} · ${esc(e.commit)}<br>${esc(e.actual)}</p>`).join("")}</details></details>`;
            })
            .join("")
        : "<p>No QA scenarios saved.</p>",
    ) +
    collaborationForm(
      id,
      "qa-case",
      "Add a QA scenario",
      `<label>Repository<select name="repositoryId">${options}</select></label><label>Scenario<input name="title" required maxlength="200" value="${esc(draftValue(id, "qa-case", "title"))}"></label><label>Expected result<textarea name="expected" required maxlength="2000">${esc(draftValue(id, "qa-case", "expected"))}</textarea></label><label>Existing QA Jira issue (optional)<input name="jiraKey" value="${esc(draftValue(id, "qa-case", "jiraKey"))}"></label>`,
      "Save scenario",
    ) +
    (cases.length
      ? collaborationForm(
          id,
          "qa-result",
          "Record a human test result",
          `<label>Scenario<select name="caseId">${cases.map((c) => `<option value="${esc(c.id)}|${c.revision}">${esc(c.title)}</option>`).join("")}</select></label><label>Outcome<select name="status"><option value="PASSED">Passed</option><option value="FAILED">Failed</option></select></label><label>What you observed<textarea name="actual" required maxlength="2000">${esc(draftValue(id, "qa-result", "actual"))}</textarea></label><small>DevQuest records the current clean integrated commit. This is your observation, not a claim that an agent executed the test.</small>`,
          "Record result",
        ) +
        collaborationForm(
          id,
          "qa-verify",
          "Recheck evidence against current source",
          "<p>Read-only inspection of the integrated worktrees. No tests or agents start.</p>",
          "Verify saved evidence",
        )
      : "")
  );
}
function referencesView(quest) {
  const id = quest.id,
    docs = (state.projectReferences || []).filter((r) =>
      quest.repositoryIds.includes(r.repositoryId),
    );
  const options = quest.repositoryIds
    .map((key) => `<option value="${esc(key)}">${esc(repository(key)?.name || key)}</option>`)
    .join("");
  return (
    `<p class="muted">Repository references are separate from Agent Souls and installed skills. Attach exact revisions explicitly. Changing the library does not change a Project's pinned references or historical runs. Live Jira metadata stays authoritative.</p>` +
    collaborationForm(
      id,
      "project-reference",
      "Save a repository reference",
      `<label>Repository<select name="repositoryId">${options}</select></label><label>Name<input name="name" required maxlength="120" value="${esc(draftValue(id, "project-reference", "name"))}"></label><label>Markdown<textarea name="content" required maxlength="16000" rows="6">${esc(draftValue(id, "project-reference", "content"))}</textarea></label>`,
      "Save reference",
    ) +
    (docs.length
      ? collaborationForm(
          id,
          "quest-references",
          "Attach or refresh Project references",
          docs
            .map((doc) => {
              const latest = doc.versions.at(-1),
                pin = quest.projectReferences?.find((p) => p.id === doc.id);
              return `<label class="checks"><input type="checkbox" name="referenceIds" value="${esc(doc.id)}|${latest.revision}|${latest.hash}" ${pin ? "checked" : ""}>${esc(doc.name)} · latest revision ${latest.revision}${pin ? ` · Project pinned revision ${pin.revision}` : ""}</label>`;
            })
            .join("") +
            "<p>Saving pins the selected latest revisions and requires reviewing design approvals again. Existing execution or Jira-linked Projects cannot change references.</p>",
          "Apply selected revisions",
        )
      : "") +
    docs
      .map((doc) => {
        const latest = doc.versions.at(-1);
        return collaborationForm(
          id,
          "project-reference",
          `${doc.name} · revision ${latest.revision}`,
          `<input type="hidden" name="referenceId" value="${esc(doc.id)}"><input type="hidden" name="expectedRevision" value="${latest.revision}"><input type="hidden" name="repositoryId" value="${esc(doc.repositoryId)}"><label>Name<input name="name" value="${esc(draftValue(id, doc.id, "name", doc.name))}" required maxlength="120"></label><label>Markdown<textarea name="content" rows="6" required maxlength="16000">${esc(draftValue(id, doc.id, "content", latest.content))}</textarea></label><small>Prior revisions are preserved. Updating this reference does not silently refresh any Project.</small>`,
          "Save new revision",
          doc.id,
        );
      })
      .join("")
  );
}
const readinessResults = new Map();
function readinessView(quest) {
  const result = readinessResults.get(quest?.id || "workspace");
  return collaborationForm(quest?.id || "", "readiness", "Check readiness · no agent starts",
    `<label>Runtime<select name="runtime"><option value="claude">Claude Code</option><option value="codex">Codex</option></select></label>${quest ? '<label>Role<select name="role"><option value="architect">Architect</option><option value="planner">Planner</option></select></label>' : ""}<small>Checks CLI, login and permitted models. Project checks include repository roots and assigned skills. No model calls or Jira changes.</small>${result ? `<p>${result.status === "BLOCKED" ? "Needs attention" : "Checks passed; some items remain unverified"} · ${time(result.checkedAt)}</p><ul>${result.rows.map((row) => `<li><strong>${esc(row.check)} · ${esc(row.status.replaceAll("_", " ").toLowerCase())}</strong><p>${esc(row.detail)}</p>${row.remediation ? `<small>${esc(row.remediation)}</small>` : ""}</li>`).join("")}</ul>` : ""}`, "Check readiness");
}
function skillAssignmentsView(quest) {
  const roles = ["orchestrator", "architect", "planner", "developer", "reviewer"];
  const skills = (state.skills || []).filter((skill) => Object.values(skill.compatibility).includes("DECLARED_COMPATIBLE"));
  return `<details data-disclosure="assigned-skills"><summary>Assigned skills</summary><p>Reviewed instructions are added to the selected role’s prompt. No tools, MCP access or repository permissions are added. Jira Specialist keeps its dedicated native skills.</p>${roles.map((role) => {
    const selected = quest.skillAssignments?.roles?.[role] || [];
    return collaborationForm(quest.id, "quest-skills", `${role} guidance`, `<input type="hidden" name="role" value="${role}"><input type="hidden" name="expectedRevision" value="${quest.skillAssignments?.revision || 0}">${skills.map((skill) => `<label class="checks"><input type="checkbox" name="skillPins" value="${esc(`${skill.id}|${skill.revision}|${skill.sourceHash}`)}" ${selected.some((pin) => pin.id === skill.id && pin.revision === skill.revision && pin.hash === skill.sourceHash) ? "checked" : ""}>${esc(skill.name)} · revision ${skill.revision} · ${skill.runtimes.map(esc).join(", ")}</label>`).join("")}${selected.some((pin) => !skills.some((skill) => skill.id === pin.id && skill.revision === pin.revision && skill.sourceHash === pin.hash)) ? '<p class="warning">An assignment is stale or unavailable. Review and save the intended selection before another run.</p>' : ""}<small>At most five. Source changes require reinspection and explicit reassignment. MCP and tool-dependent registrations require a managed integration.</small>`, "Save assignments", `quest-skills-${role}`);
  }).join("")}</details>`;
}
const accessPreviews = new Map();
function accessPreviewView(quest) {
  const works = state.works.filter((w) => w.questId === quest.id),
    tasks = state.tasks.filter((t) => t.questId === quest.id && t.workspace?.path);
  const preview = accessPreviews.get(quest.id);
  return collaborationForm(
    quest.id,
    "access-preview",
    "Preview agent access · no agent starts",
    `<label>Role<select name="role"><option value="architect">Architect</option><option value="planner">Planner</option><option value="developer">Developer</option><option value="reviewer">Reviewer</option></select></label><label>Worktree (Developer/Reviewer)<select name="workId"><option value="">Not selected</option>${works.map((w) => `<option value="${esc(w.id)}">${esc(repository(w.repoId)?.name || w.repoId)}</option>`).join("")}</select></label><label>Assigned task (Developer)<select name="taskId"><option value="">Not selected</option>${tasks.map((t) => `<option value="${esc(t.id)}">${esc(t.title)}</option>`).join("")}</select></label><small>Checks configured roots and OS access. Actual runtime tool access remains unverified until launch. This preview grants no tools or permissions. Jira publishing remains a separate approval.</small>${preview ? `<div class="repository-preview"><strong>${esc(preview.role)} · ${preview.scope.readOnly ? "Read only" : "Assigned worktree edits"}</strong><p>Filesystem checks: ${esc(preview.preflight.status)}</p><ul>${preview.scope.repositories.map((repo) => `<li>${esc(repo.name)}<br><code>${esc(repo.path)}</code></li>`).join("")}</ul><p>Working directory: <code>${esc(preview.scope.cwd)}</code></p><p>Actual runtime tool access: not verified by this preview.</p><small>${esc(preview.note)}</small></div>` : ""}`,
    "Check access",
  );
}

function profileSettings(quest) {
  return `<details><summary>Agent guidance · ${quest.agentProfiles?.enabled ? "Versioned" : "Standard"}</summary><p>Guidance changes require finished sessions. Models, permissions and approval gates stay unchanged.</p>${button(quest.agentProfiles?.enabled ? "Refresh reviewed profile versions" : "Enable reviewed Agent Profiles", "SET_AGENT_PROFILES", { "quest-id": quest.id, enabled: "true" }, "small")}${quest.agentProfiles?.enabled ? button("Disable for future runs", "SET_AGENT_PROFILES", { "quest-id": quest.id, enabled: "false" }, "small") : ""}</details>`;
}
function focusedActions(html, preferred = "", runtime = "") {
  const controls = [...html.matchAll(/<(button|a)\b[^>]*>[\s\S]*?<\/\1>/g)].map(
    (match) => match[0],
  );
  const enabled = controls.filter((control) => !/\sdisabled(?:\s|>)/.test(control));
  const chosen =
    preferred ||
    enabled.find((control) => /class="[^"]*\bprimary\b/.test(control)) ||
    enabled[0] ||
    "";
  const primary = chosen.replace(
    /class="([^"]*)"/,
    (all, names) => `class="${names.replace(/\bsmall\b|\bprimary\b/g, "").trim()} primary"`,
  );
  const secondary = html
    .replace(chosen, "")
    .replace(
      /class="([^"]*)"/g,
      (all, names) => `class="${names.replace(/\bprimary\b/g, "").trim()}"`,
    );
  return `<div class="primary-next-action">${primary}</div>${secondary || runtime ? `<details class="more-actions" data-disclosure="more-actions"><summary>More actions</summary><div class="toolbar">${secondary}${runtime}</div></details>` : ""}`;
}
function overviewSummary(quest, tasks, runs) {
  const source =
    artifact(quest.id, quest.kind === "PRODUCT" ? "prd" : "spec") ||
    artifact(quest.id, "idea") ||
    artifact(quest.id, "technical-brief");
  const summary = String(
    source?.content || "Define the goal and constraints to start this project.",
  )
    .replace(/^#+\s*/gm, "")
    .slice(0, 320);
  const recent = latestAttempts(runs).slice(-3).reverse();
  return `<div class="overview-summary">${panel("Project brief", `<p>${esc(summary)}${source?.content?.length > 320 ? "…" : ""}</p><a class="subtle-link" href="#quest/${quest.id}/documents">Read documents →</a>`)}${panel("Current work", `<p>${tasks.filter((t) => t.state === "COMPLETED").length} of ${tasks.length} tasks completed · ${quest.repositoryIds.length} repositories</p><a class="subtle-link" href="#quest/${quest.id}/work">View tasks, changes and QA →</a>`)}${panel("Recent agent activity", recent.length ? recent.map((run) => `<p><strong>${esc(roleFor(run).label)}</strong> ${badge(run.state)}<br><span class="muted">${esc(String(run.error || responseText(run.summary) || "Working on the current stage").slice(0, 180))}</span></p><details><summary>Agent controls and technical details</summary>${runCard(run)}</details>`).join("") + `<a class="subtle-link" href="#quest/${quest.id}/room">Open room →</a>` : "<p>No agent runs yet.</p>")}</div>`;
}

function questView(id, tab = "overview", sectionOnly = false) {
  const requestedTab = tab;
  if (!sectionOnly)
    tab =
      {
        architect: "documents",
        artifacts: "documents",
        appendix: "documents",
        tasks: "work",
        repositories: "work",
        qa: "work",
        activity: "room",
        references: "overview",
        settings: "overview",
      }[tab] || (["overview", "documents", "work", "room"].includes(tab) ? tab : "overview");
  const quest = state.quests.find((q) => q.id === id);
  if (!quest && state.deletedQuests?.some((q) => q.id === id))
    return head("Project deleted", "Restore this project to review its documents or continue work.", '<a class="btn" href="#quests/deleted">Deleted projects</a>');
  if (!quest)
    return head(
      "Project not found",
      "Return to your Project list.",
      '<a class="btn" href="#quests">All Projects</a>',
    );
  const tasks = questTasks(id),
    works = state.works.filter((w) => w.questId === id),
    runs = state.runs.filter((r) => r.questId === id);
  const appendixJob = appendixAttempt(id);
  const appendixRunning = appendixJob?.generationActive === true;
  const appendixFailed = appendixJob && ["FAILED", "INTERRUPTED"].includes(appendixJob.state);
  const appendixReady =
    artifact(id, "appendix")?.planArtifactId === artifact(id, "plan")?.id &&
    Boolean(artifact(id, "appendix"));
  const appendixApproved = artifact(id, "appendix")?.approved === true;
  const tabs = ["overview", "documents", "work", "room"];
  let body = "";
  if (tab === "overview") {
    let next = "";
    const runtime =
      quest.workflowVersion === 2
        ? ""
        : `<select id="quest-runtime" aria-label="Architect runtime">${runtimeOptions()}</select>`;
    const active = runs.some((r) =>
      r.purpose === "jira_appendix_generation"
        ? r.generationActive === true
        : ["RUNNING", "PAUSED", "INTERRUPTED", "WAITING_INPUT"].includes(r.state),
    );
    if (!active) {
      if (quest.kind === "TECH" && quest.state === "BRAINSTORM_COMPLETED")
        next +=
          `<a class="btn small" href="#quest/${id}/architect">View Specification</a>` +
          button("Edit Specification", "edit-spec", { "quest-id": id }, "small");
      if (
        quest.kind === "TECH" &&
        !artifact(id, "technical-brief") &&
        artifact(id, "spec")?.sourceStage !== "brainstorm"
      )
        next += button("Start brainstorm", "START_BRAINSTORM", { "quest-id": id }, "primary");
      if (
        quest.kind === "TECH" &&
        artifact(id, "brainstorm") &&
        !artifact(id, "technical-brief") &&
        artifact(id, "spec")?.sourceStage !== "brainstorm"
      )
        next += button("Finish brainstorm", "FINISH_BRAINSTORM", { "quest-id": id }, "primary");
      if (
        !artifact(id, "analysis") &&
        (quest.kind === "PRODUCT" ||
          artifact(id, "technical-brief") ||
          artifact(id, "spec")?.sourceStage === "brainstorm")
      )
        next += button(
          "Analyze requirements & repositories",
          "ANALYZE_PRD",
          { "quest-id": id },
          "primary",
        );
      if (artifact(id, "analysis") && !artifact(id, "trd"))
        next += button("Generate TRD", "GENERATE_TRD", { "quest-id": id }, "primary");
      if (quest.state === "TRD_DRAFT")
        next += button("Approve TRD", "APPROVE_TRD", { "quest-id": id }, "primary");
      if (quest.state === "TRD_APPROVED")
        next +=
          button("Generate plan", "GENERATE_PLAN", { "quest-id": id }, "primary") +
          button("Write plan manually", "edit-plan", { "quest-id": id });
      if (quest.state === "PLAN_DRAFT")
        next += button("Approve plan", "APPROVE_PLAN", { "quest-id": id }, "primary");
      if (quest.state === "PLAN_APPROVED")
        next +=
          (appendixRunning
            ? '<button class="btn small" disabled>Generating Jira Appendix…</button>'
            : button(
                appendixFailed
                  ? "Retry Generation"
                  : artifact(id, "appendix")
                    ? "Regenerate Appendix"
                    : "Generate Jira appendix",
                "appendix-dialog",
                { "quest-id": id },
                "small",
              )) +
          button("Edit Jira Configuration", "jira-settings", { "quest-id": id }, "small") +
          (appendixReady && appendixApproved
            ? button(
                "Prepare Jira publication",
                "VERIFY_JIRA_PROJECT",
                { "quest-id": id, "artifact-id": artifact(id, "appendix").id },
                "small",
              )
            : "") +
          button("Import Jira appendix", "edit-appendix", { "quest-id": id }, "small") +
          (appendixReady && !appendixRunning && !appendixApproved
            ? `<a class="btn small" href="#quest/${id}/artifacts">Review Markdown</a>` +
              appendixApprovalButton(artifact(id, "appendix"), "primary")
            : "") +
          (appendixReady && appendixApproved && !appendixRunning
            ? artifact(id, "appendix")?.publicationReady === false
              ? `<button class="btn small" disabled title="${esc(artifact(id, "appendix").publicationError)}">Publish to Jira</button><small role="status">${esc(artifact(id, "appendix").publicationError)}</small>`
              : button(
                  tasks.some((t) => t.jira)
                    ? "Publish next Jira batch (up to 5)"
                    : "Publish to Jira (sample)",
                  "PUBLISH_JIRA",
                  { "quest-id": id },
                  "primary",
                )
            : "");
      if (quest.state === "PLAN_APPROVED" && !tasks.some((t) => t.jira))
        next += button("Use existing Jira task", "existing-jira-dialog", {
          "quest-id": id,
        });
    }
    if (
      quest.kind === "TECH" &&
      !artifact(id, "technical-brief") &&
      artifact(id, "spec")?.sourceStage !== "brainstorm" &&
      runs.some((r) => r.purpose === "brainstorm" && r.state === "WAITING_INPUT")
    )
      next += button("Finish brainstorm", "FINISH_BRAINSTORM", { "quest-id": id }, "primary");
    if (["TASKS_PUBLISHED", "EXECUTING"].includes(quest.state))
      next +=
        button("Start implementation", "EXECUTE_QUEST", { "quest-id": id }, "primary") +
        (quest.autoExecute ? button("Pause scheduling", "PAUSE_QUEST", { "quest-id": id }) : "");
    let preferred = "";
    const roomLink = (label) => `<a class="btn primary" href="#quest/${id}/room">${label}</a>`;
    if (active)
      preferred = roomLink(
        runs.some((run) => run.state === "WAITING_INPUT") ? "Answer agent" : "View agent progress",
      );
    else if (
      quest.state === "PLAN_APPROVED" &&
      quest.existingJiraKey &&
      !tasks.some((task) => task.jira)
    )
      preferred = button(
        "Link existing QA issue",
        "existing-jira-dialog",
        { "quest-id": id },
        "primary",
      );
    else if (quest.state === "TRD_DRAFT")
      preferred = `<a class="btn primary" href="#quest/${id}/documents/trd">Review TRD</a>`;
    else if (quest.state === "PLAN_DRAFT")
      preferred = `<a class="btn primary" href="#quest/${id}/documents/plan">Review plan</a>`;
    else if (quest.state === "PLAN_APPROVED" && appendixReady && !appendixApproved)
      preferred = `<a class="btn primary" href="#quest/${id}/documents/appendix">Review appendix</a>`;
    else if (
      quest.state === "PLAN_APPROVED" &&
      appendixApproved &&
      artifact(id, "appendix")?.publicationReady === false
    )
      preferred = button(
        "Check Jira publication",
        "VERIFY_JIRA_PROJECT",
        { "quest-id": id, "artifact-id": artifact(id, "appendix").id },
        "primary",
      );
    else if (
      quest.autoExecute ||
      ["READY_FOR_PR", "REVIEW_HANDOFF", "PRS_CREATED"].includes(quest.state)
    )
      preferred = `<a class="btn primary" href="#quest/${id}/work">${quest.state === "PRS_CREATED" ? "View pull requests" : "Review changes"}</a>`;
    body = `<section class="next-step focused-next-step"><div><div><h2>${quest.state === "PRS_CREATED" ? "Project complete" : quest.state === "BRAINSTORM_COMPLETED" ? "Brainstorm completed" : "Next action"}</h2><p>${quest.state === "PRS_CREATED" ? "Pull requests and configured review requests are complete." : quest.state === "BRAINSTORM_COMPLETED" ? "spec.md is saved. View or edit it, then choose Analyze when ready." : active ? "Open the room to review agent progress and requests." : "Review the current step and choose an action."}</p></div></div>${focusedActions(next, preferred, runtime)}${quest.warnings?.length ? `<div class="warning">${quest.warnings.map(esc).join("<br>")}<label class="checks"><input type="checkbox" id="accept-warnings">Continue with incomplete source context</label></div>` : ""}</section><!-- quest-notices -->${questBlockers(quest)}${overviewSummary(quest, tasks, runs)}`;
  }
  if (tab === "tasks")
    body = panel(
      "Execution queue",
      tasks.length
        ? tasks
            .map(
              (task) =>
                `<details class="task-card" data-disclosure="task-${esc(task.id)}"><summary class="row-head"><h3>${esc(task.key)} · ${esc(task.title)}</h3>${badge(task.state)}</summary><div class="task-details"><div class="row-meta"><span>${icon("repository")} ${esc(repository(task.repoId)?.name)}</span><span>${esc(task.jira?.key || "Not published")}</span><span>Validation: ${esc(task.validationProfile)}</span></div><p>Depends on: ${task.dependencies.length ? task.dependencies.map((key) => esc(state.tasks.find((t) => t.id === key)?.key)).join(", ") : "No dependencies"}</p>${task.validation ? `<pre class="run-output">${esc(task.validation.summary)}</pre>` : ""}<div class="task-actions">${quest.workflowVersion === 2 ? "" : `<select aria-label="Runtime for ${esc(task.key)}" data-task-runtime="${task.id}">${runtimeOptions()}</select>`}${task.state === "PUBLISHED" ? button("Start", "START_TASK", { "quest-id": id, "task-id": task.id }, "primary small") : ""}${["AWAITING_TEST", "TEST_FAILED", "COMPLETED"].includes(task.state) ? button("Run tests", "RUN_TEST", { "quest-id": id, "task-id": task.id }, "small") : ""}${quest.workflowVersion !== 2 && ["COMPLETED", "TEST_FAILED"].includes(task.state) ? button("Reopen task", "REOPEN_TASK", { "quest-id": id, "task-id": task.id }, "small") : ""}${quest.workflowVersion === 2 ? `${["FAILED", "INTERRUPTED", "CANCELLED", "NEEDS_HUMAN_ATTENTION"].includes(task.state) && !task.integratedCommit ? button("Retry preserved task", "RETRY_TASK", { "quest-id": id, "task-id": task.id }, "small") : ""}${["PREPARING", "RUNNING", "WAITING_INPUT"].includes(task.state) ? button("Cancel task", "CANCEL_TASK", { "quest-id": id, "task-id": task.id }, "danger small") : ""}<small>Model: ${esc(task.route?.resolvedModel || "Pending routing")} · Risk: ${esc(task.assessment?.risk || "NOT_AVAILABLE")} · Retries ${esc(task.retries || 0)} · Escalations ${esc(task.escalations || 0)}</small>${task.error ? `<pre class="document">${esc(task.error)}</pre>` : ""}` : ""}</div></div></details>`,
            )
            .join("")
        : empty("No tasks planned", "Approve the TRD, then generate or write a plan."),
    );
  if (tab === "repositories")
    body = works.length
      ? works
          .map((work) =>
            panel(
              esc(repository(work.repoId)?.name),
              `<div class="panel-body"><div class="row-head">${badge(work.state)}<span class="number">${icon("branch")} ${esc(work.branch)}</span></div><div class="code">${esc(work.path)}</div>${work.error ? `<div class="warning">${esc(work.error)}</div>` : ""}${work.baselineFailure ? `<div class="warning">Baseline check: ${esc(work.baselineFailure.profile)}${work.baselineFailure.changedFiles ? " · Tests changed worktree files" : ""}</div><pre class="document" tabindex="0" aria-label="Baseline test result">${esc(work.baselineFailure.summary)}</pre>` : ""}${work.review ? `<pre class="document">${esc(work.review.summary)}</pre>` : ""}${work.workflowVersion === 2 ? `<p>Integration: ${esc(work.integration?.state || work.state)} · Review/fix cycles ${esc(work.fixCycles || 0)}/3 · PR target ${esc(work.prTarget)}</p>${work.productionReview ? `<details><summary>Production review: ${esc(work.productionReview.verdict)}</summary><pre class="document">${esc(JSON.stringify(work.productionReview, null, 2))}</pre></details>` : ""}${!work.pr ? button("Change PR target", "pr-target", { "quest-id": id, "work-id": work.id }, "small") : ""}` : ""}<div class="toolbar">${!work.pr && work.workflowVersion !== 2 ? `<select aria-label="Reviewer runtime" data-work-runtime="${work.id}">${runtimeOptions()}</select>` : ""}${!work.pr ? button("Review repository", "REVIEW_REPOSITORY", { "quest-id": id, "work-id": work.id }, "small") : ""}${(work.review || work.productionReview?.verdict === "PASSED") && !work.pr ? button("Approve repository review", "APPROVE_REVIEW", { "quest-id": id, "work-id": work.id }, "small") : ""}${work.state === "READY_FOR_PR" ? (work.workflowVersion !== 2 ? button("Generate office commit message", "GENERATE_COMMIT_MESSAGE", { "quest-id": id, "work-id": work.id }, "small") : "") + button(`Create PR → ${work.prTarget || "development"}`, "create-pr-dialog", { "quest-id": id, "work-id": work.id }, "primary") : ""}${work.pr && !work.notifiedAt && !work.notification ? button("Request reviewers", "reviewers-dialog", { "quest-id": id, "work-id": work.id }, "small") : ""}${(work.reviewRequestedAt || (work.workflowVersion === 2 && work.pr && !work.reviewers?.length)) && !work.notifiedAt ? button("Notify Google Chat", "NOTIFY_REVIEW", { "quest-id": id, "work-id": work.id }, "small") : ""}${work.notifiedAt ? badge("TEAM_NOTIFIED") : work.reviewRequestedAt ? badge("REVIEW_REQUESTED") : ""}${work.pr ? `<a class="btn primary" target="_blank" rel="noreferrer" href="${safeUrl(work.pr.url)}">View pull request ↗</a>` : ""}</div></div>`,
            ),
          )
          .join('<div class="section-space"></div>')
      : panel(
          "Repository work",
          empty("Worktrees are prepared on first execution",
            "Each repository will have an integration branch and pull request. v1.1 tasks use separate worktrees.",
          ),
        );
  if (tab === "architect") {
    const editable =
      !runs.some((run) =>
        ["RUNNING", "WAITING_INPUT", "PAUSED", "INTERRUPTED"].includes(run.state),
      ) && !tasks.some((task) => task.jira);
    body =
      `<p class="muted">Saved design documents for this Project. Read the Markdown or download a copy. New revisions preserve earlier files.</p>` +
      [
        ["trd", "TRD"],
        ["spec", "Specification"],
        ["plan", "Implementation plan"],
        ["ticket", "Jira tickets"],
      ]
        .map(([kind, title]) => {
          const doc = artifact(id, kind) || (kind === "ticket" ? artifact(id, "appendix") : null);
          const stale =
            kind === "spec" &&
            doc &&
            doc.sourceStage !== "brainstorm" &&
            doc.trdArtifactId !== artifact(id, "trd")?.id;
          let controls =
            doc && !doc.error
              ? `<a class="btn small" href="/api/artifacts/${encodeURIComponent(doc.id)}" download>Download .md</a>`
              : "";
          if (doc && !doc.error) controls = documentViewSelect(`${id}-${kind}`, title) + controls;
          if (doc && !doc.error && doc.kind === "appendix")
            controls += doc.approved ? badge("APPROVED") : appendixApprovalButton(doc, "small");
          if (
            doc &&
            !doc.error &&
            ((kind === "trd" && quest.state === "TRD_DRAFT") ||
              (kind === "plan" && quest.state === "PLAN_DRAFT"))
          )
            controls += button(
              `Approve ${kind === "trd" ? "TRD" : "plan"}`,
              kind === "trd" ? "APPROVE_TRD" : "APPROVE_PLAN",
              { "quest-id": id, "artifact-id": doc.id },
              "primary small",
            );
          if (editable && ["trd", "plan"].includes(kind) && doc)
            controls += button("Edit", `edit-${kind}`, { "quest-id": id }, "small");
          if (
            editable &&
            kind === "spec" &&
            doc?.sourceStage === "brainstorm" &&
            quest.state === "BRAINSTORM_COMPLETED"
          )
            controls += button("Edit Specification", "edit-spec", { "quest-id": id }, "small");
          if (
            editable &&
            !(quest.kind === "TECH" && quest.designProtocol === 1) &&
            kind === "spec" &&
            ["TRD_APPROVED", "PLAN_DRAFT", "PLAN_APPROVED"].includes(quest.state)
          )
            controls +=
              button("Generate spec", "GENERATE_SPEC", { "quest-id": id }, "small") +
              button("Write / import spec", "edit-spec", { "quest-id": id }, "small") +
              (quest.workflowVersion === 2
                ? ""
                : `<select id="quest-runtime" aria-label="Specification runtime">${runtimeOptions()}</select>`);
          return architectDocument(
            `${id}-${kind}`,
            `${esc(title)}${doc ? `<span class="muted"> · revision ${doc.revision}</span>` : ""}`,
            doc
              ? `${stale ? '<div class="warning">The TRD changed. Regenerate or update this specification before using it.</div>' : ""}${doc.error ? `<pre class="document">${esc(doc.error)}</pre>` : documentPreview(`${id}-${kind}`, title, doc.content)}<details><summary>File details</summary><div class="code">${esc(doc.file || "")}</div></details>`
              : empty(
                  `${title} not saved yet`,
                  kind === "spec"
                    ? "Generate or import a specification after TRD approval. Saving a spec requires reviewing the plan again."
                    : kind === "ticket"
                      ? "Generate a Jira appendix, publish tickets, or link an existing QA issue."
                      : "Complete the corresponding design step to save this document.",
                ),
            controls,
          );
        })
        .join('<div class="section-space"></div>');
    const appendix = artifact(id, "appendix");
    if (appendix && artifact(id, "ticket"))
      body +=
        `<div class="section-space"></div>` +
        architectDocument(
          `${id}-appendix`,
          "Jira task appendix",
          appendix.error
            ? `<pre class="document">${esc(appendix.error)}</pre>`
            : documentPreview(`${id}-appendix`, "Jira appendix", appendix.content),
          !appendix.error
            ? documentViewSelect(`${id}-appendix`, "Jira appendix") +
                (appendix.approved
                  ? badge("APPROVED")
                  : appendixApprovalButton(appendix, "small")) +
                `<a class="btn small" href="/api/artifacts/${encodeURIComponent(appendix.id)}" download>Download .md</a>`
            : "",
        );
  }
  if (tab === "room") body = roomView(quest);
  if (tab === "activity")
    body = panel("Decisions & milestones", activity(state.events.filter((e) => e.questId === id)));
  if (tab === "activity" && quest.workflowVersion === 2)
    body += `<details class="panel section-space"><summary class="panel-head">Routing history</summary><pre class="document" tabindex="0">${esc(
      JSON.stringify(
        (state.routingDecisions || []).filter((decision) => decision.questId === id),
        null,
        2,
      ),
    )}</pre></details>`;

  if (sectionOnly) return body;
  if (tab === "documents") {
    body =
      ["prd", "idea", "technical-brief", "analysis"]
        .map((kind) => {
          const doc = artifact(id, kind);
          return doc
            ? architectDocument(
                `${id}-${kind}`,
                {
                  prd: "Product requirements",
                  idea: "Technical goal",
                  "technical-brief": "Technical brief",
                  analysis: "Repository analysis",
                }[kind],
                documentPreview(`${id}-${kind}`, kind, doc.content),
                documentViewSelect(`${id}-${kind}`, kind) +
                  `<a class="btn small" href="/api/artifacts/${encodeURIComponent(doc.id)}" download>Download .md</a>`,
              )
            : "";
        })
        .join("") + questView(id, "architect", true);
  }
  if (tab === "work")
    body =
      questView(id, "tasks", true) +
      `<details class="panel section-space" data-disclosure="repository-work" ${["READY_FOR_PR", "REVIEW_HANDOFF", "PRS_CREATED"].includes(quest.state) || works.some((work) => work.error) ? "open" : ""}><summary class="panel-head">Repository changes and reviews</summary>${questView(id, "repositories", true)}</details><details class="panel section-space" data-disclosure="qa" ${requestedTab === "qa" ? "open" : ""}><summary class="panel-head">Tests and QA</summary>${qaView(quest)}</details>`;
  if (tab === "room")
    body += `<details class="panel section-space" ${requestedTab === "activity" ? "open" : ""}><summary class="panel-head">Decisions and activity history</summary>${questView(id, "activity", true)}</details>`;
  const settings = `<details class="panel section-space project-settings" data-disclosure="project-settings" ${["settings", "references"].includes(requestedTab) ? "open" : ""}><summary class="panel-head">Project settings</summary><div class="panel-body">${readinessView(quest)}${skillAssignmentsView(quest)}${referencesView(quest)}${quest.state === "PLAN_APPROVED" ? `<details><summary>Jira configuration</summary>${jiraSummary(quest)}${button("Edit Jira configuration", "jira-settings", { "quest-id": id }, "small")}</details>` : ""}<details><summary>Technical details</summary><p>Project ID: ${esc(id)}</p>${profileSettings(quest)}${accessPreviewView(quest)}</details></div></details>`;
  const verification = (state.operations || []).find((op) => op.id === `jira-verify:${id}`);
  let notices = ["overview", "documents"].includes(tab) ? appendixStatus(quest) : "";
  if (verification && ["overview", "documents"].includes(tab)) {
    const stale = verification.capabilities && (verification.capabilities.appendixHash !== artifact(id, "appendix")?.hash || verification.capabilities.contextKey !== JSON.stringify(quest.jiraContext));
    notices += notice("Jira project verification", verification.error ? "Publication is blocked. Review the verification details before trying again." : stale ? "Jira settings or appendix changed. Verify again before publishing." : verification.capabilities ? `${verification.capabilities.project} verified using live read-only metadata. No issues created.` : "Verifying Jira project… No publication authorized.", verification.error || (verification.capabilities ? `${verification.capabilities.siteUrl} · Task · ${verification.capabilities.appendixField}` : ""), "", verification.error || stale ? "warning" : verification.capabilities ? "success" : "info");
  }
  body = tab === "overview" ? body.replace("<!-- quest-notices -->", notices) : notices + body;
  return `<section class="page-head quest-hero compact-hero"><div class="hero-copy"><div class="row-meta">${badge(quest.kind === "PRODUCT" ? "FEATURE" : "TECHNICAL")}${badge(quest.state)}</div><h1>${esc(quest.title)}</h1><p class="muted">${quest.sprint ? `${esc(quest.sprint)} · ` : ""}${quest.repositoryIds.length} ${quest.repositoryIds.length === 1 ? "repository" : "repositories"} · ${tasks.length ? `${tasks.filter((task) => task.state === "COMPLETED").length} of ${tasks.length} tasks complete` : "No tasks yet"}</p></div><div class="hero-aside"><a class="subtle-link" href="#quests">← All projects</a><a class="btn small" href="#quest/${id}/settings">Project settings</a></div></section><p class="stage-context">${icon("quest")}<span>Current step: <strong>${esc(stageLabel(quest))}</strong></span></p><div class="workflow-desktop">${questChain(quest)}</div><details class="workflow-full" data-disclosure="workflow-stages"><summary>All workflow stages</summary>${questChain(quest)}</details><nav class="tabs" aria-label="Project sections">${tabs.map((name) => `<a href="#quest/${id}/${name}" class="${tab === name ? "active" : ""}" ${tab === name ? 'aria-current="page"' : ""}>${name[0].toUpperCase() + name.slice(1)}</a>`).join("")}</nav>${["settings", "references"].includes(requestedTab) ? settings : ""}${body}${!["settings", "references"].includes(requestedTab) ? settings : ""}`;
}
function render(force = false) {
  if (!state) return;
  const focused = document.activeElement;
  const focusForm = focused?.closest?.("form");
  const focusField = focused?.name && focusForm ? { name: focused.name, form: focusForm.dataset.form, run: focusForm.dataset.run, draft: focusForm.dataset.draftKey } : null;
  const focusDisclosure = focused?.tagName === "SUMMARY" ? focused.parentElement?.dataset.disclosure : null;
  const editing = document.activeElement?.closest?.("form[data-collaboration]");
  if (!force && editing && editing.dataset.route === location.hash) return;
  const [route = "home", id, tab, focusDocument] = (location.hash.slice(1) || "home").split("/");
  if (workspaceJiraDirty && route === "settings") return;
  if (route !== "settings") workspaceJiraDirty = false;
  document.querySelectorAll("[data-nav]").forEach((el) => {
    const selected = el.dataset.nav === (route === "quest" ? "quests" : route);
    el.classList.toggle("active", selected);
    if (selected) el.setAttribute("aria-current", "page");
    else el.removeAttribute("aria-current");
  });
  $("#breadcrumb").textContent = route === "quest" ? state.quests.find((q) => q.id === id)?.title || labels.quest : labels[route] || "Overview";
  $("#quest-count").textContent = state.quests.length;
  $("#repository-count").textContent = state.repositories.length;
  const sprint = state.quests.find((q) => q.sprint)?.sprint;
  const sprintQuests = state.quests.filter((q) => sprint && q.sprint === sprint);
  const completed = sprintQuests.filter((q) => q.state === "PRS_CREATED").length;
  $("#sidebar-sprint").hidden = Boolean(dashboardUI) || !sprint;
  $("#sidebar-sprint").innerHTML = sprint
    ? `<small>Sprint</small><strong>${esc(sprint)}</strong><small>${completed} / ${sprintQuests.length} projects complete</small>`
    : "";
  // Preserve unsent agent instructions across live state updates.
  const selections = [...document.querySelectorAll("#main select")].map((el) => ({
    id: el.id,
    task: el.dataset.taskRuntime,
    work: el.dataset.workRuntime,
    value: el.value,
  }));
  const drafts = new Map(
    [...document.querySelectorAll('form[data-form="message"]')].map((form) => [
      form.dataset.run,
      form.elements.message.value,
    ]),
  );
  const changedRoute = lastRenderedProjectRoute !== location.hash;
  const openSections =
    lastRenderedProjectRoute === location.hash
      ? new Map(
          [...document.querySelectorAll("#main details[data-disclosure]")].map((el) => [
            el.dataset.disclosure,
            el.open,
          ]),
        )
      : new Map();
  const openedDocuments = new Set(
    [...document.querySelectorAll("#main details[data-document][open]")].map(
      (el) => el.dataset.document,
    ),
  );
  if (
    changedRoute &&
    route === "quest" &&
    ["documents", "architect", "artifacts", "appendix"].includes(tab) &&
    ["trd", "plan", "appendix"].includes(focusDocument)
  ) {
    openedDocuments.add(
      `${id}-${focusDocument === "appendix" && !artifact(id, "ticket") ? "ticket" : focusDocument}`,
    );
  }
  const isDashboard = route === "home" || route === "agents";
  if (!isDashboard || (changedRoute && lastRenderedProjectRoute)) dashboardUI?.unmountOverview();
  if (!isDashboard || !dashboardUI || changedRoute) $("#main").innerHTML =
    isDashboard && dashboardUI ? '<div id="dashboard-root"></div>' :
    route === "quest"
      ? questView(id, tab)
      : route === "quests"
        ? quests(id === "deleted")
        : route === "repositories"
          ? head(
              "Repositories",
              "Manage local Git repositories and branch policies.",
              button("+ Add repository", "add-repository", {}, "primary"),
            ) +
            panel(
              `${icon("repository")} <span>Repository registry<small>Manage the code repositories available to your Projects.</small></span>`,
              repoTable(),
              `<span class="panel-count">${state.repositories.length} ${state.repositories.length === 1 ? "repository" : "repositories"}</span>`,
            )
          : route === "agents"
            ? agents()
            : route === "jira"
              ? jira()
              : route === "skills"
                ? skillsView()
              : route === "settings"
                ? settings()
                : home();
  dashboardUI?.updateDashboard(state, { newProject: newQuest, addRepository, viewRun: showAgentRun, runProgress, checkRuntime: (runtime) => action("CHECK_READINESS", { runtime }), terminateRun: (runId) => { const run = state.runs.find(item => item.id === runId); if (!run || run.state !== "RUNNING") throw new Error("This session is no longer running. Refresh and review its saved logs."); return action(run.purpose === "jira_appendix_generation" ? "CANCEL_APPENDIX" : "INTERRUPT_AGENT", { runId }); }, jiraSettings: () => { location.hash = "#settings"; setTimeout(() => { const section = document.querySelector('[data-disclosure="settings-integrations"]'); if (section) { section.open = true; section.scrollIntoView({ block: "start" }); } }, 0); } }, { route, restartRequired: Boolean(serverSession?.restartRequired) });
  if (changedRoute) {
    const wasOpen = $("#primary-navigation").classList?.contains?.("is-open");
    $("#primary-navigation").classList?.toggle("is-open", false);
    $("#navigation-toggle").setAttribute?.("aria-expanded", "false");
    if (wasOpen) $("#main").focus?.({ preventScroll: true });
  }
  if (agentDialogRunId && $("#dialog").open) updateAgentRunDialog();
  lastRenderedProjectRoute = location.hash;
  for (const el of document.querySelectorAll("#main details[data-disclosure]"))
    if (openSections.has(el.dataset.disclosure)) el.open = openSections.get(el.dataset.disclosure);
  for (const el of document.querySelectorAll("#main details[data-document]"))
    el.open = openedDocuments.has(el.dataset.document);
  if (changedRoute && ["trd", "plan", "appendix"].includes(focusDocument)) {
    const key = `${id}-${focusDocument === "appendix" && !artifact(id, "ticket") ? "ticket" : focusDocument}`;
    [...document.querySelectorAll("#main details[data-document]")]
      .find((el) => el.dataset.document === key)
      ?.scrollIntoView?.({ block: "start" });
  }
  for (const [run, value] of drafts) {
    const form = document.querySelector(`form[data-run="${run}"]`);
    if (form) form.elements.message.value = value;
  }
  for (const selection of selections) {
    const el = selection.id
      ? document.getElementById(selection.id)
      : selection.task
        ? document.querySelector(`[data-task-runtime="${selection.task}"]`)
        : document.querySelector(`[data-work-runtime="${selection.work}"]`);
    if (el) el.value = selection.value;
  }
  if (!changedRoute && focusField) {
    const form = [...document.querySelectorAll("form")].find((el) => el.dataset.form === focusField.form && el.dataset.run === focusField.run && el.dataset.draftKey === focusField.draft);
    [...(form?.querySelectorAll("input, select, textarea") || [])].find((el) => el.name === focusField.name)?.focus?.({ preventScroll: true });
  }
  if (!changedRoute && focusDisclosure)
    [...document.querySelectorAll("details[data-disclosure]")].find((el) => el.dataset.disclosure === focusDisclosure)?.querySelector("summary")?.focus?.({ preventScroll: true });

}
let agentDialogRunId;
function showAgentRun(runId) {
  agentDialogRunId = runId;
  updateAgentRunDialog();
  $("#dialog").showModal();
}
function updateAgentRunDialog() {
  const run = state.runs.find(item => item.id === agentDialogRunId);
  if (!run) return;
  const content = $("#dialog-content");
  const form = content.querySelector?.('form[data-form="message"]');
  const draft = form?.elements?.message?.value;
  if (form && document.activeElement?.closest?.('form[data-form="message"]') === form) return;
  content.innerHTML = `<div class="dialog-head"><h2 id="dialog-title">Agent session logs</h2><button class="btn ghost" type="button" data-action="close-dialog" aria-label="Close dialog">×</button></div><div class="dialog-body">${runCard(run)}</div><div class="dialog-foot"><button class="btn" type="button" data-action="close-dialog">Close</button></div>`;
  const input = content.querySelector?.('form[data-form="message"] textarea');
  if (input && draft != null) input.value = draft;
}
function dialog(title, fields, form, submit = "Save") {
  agentDialogRunId = null;
  $("#dialog-content").innerHTML =
    `<form data-form="${form}" aria-describedby="dialog-error"><div class="dialog-head"><h2 id="dialog-title">${title}</h2><button class="btn ghost" type="button" data-action="close-dialog" aria-label="Close dialog">×</button></div><div class="dialog-body">${fields}<div id="dialog-error" class="form-error" role="alert"></div></div><div class="dialog-foot"><button class="btn" type="button" data-action="close-dialog">Cancel</button><button class="btn primary" type="submit"${["repository", "repository-path"].includes(form) ? " disabled" : ""}>${submit}</button></div></form>`;
  $("#dialog").showModal();
}
function executionFields() {
  const options = (state.modelRegistry || [])
    .filter((m) => m.available && m.verified)
    .map((m) => `<option value="${esc(m.id)}">${esc(m.runtime)} · ${esc(m.id)}</option>`)
    .join("");
  return `<details><summary>Agent execution and model routing</summary><div class="panel-body"><div class="form-row"><label>Project runtime<select name="executionRuntime"><option value="claude">Claude Code</option><option value="codex">Codex</option></select></label><label>Mode<select name="executionMode"><option value="guided">Guided — manual approvals</option><option value="autonomous">Autonomous after plan approval and Jira linking</option></select></label></div><label>Routing<select name="routingMode"><option value="dynamic">Dynamic — Opus orchestrator</option><option value="manual">Manual — configured model</option></select></label><label>Project model override<select name="executionModel"><option value="">Use role / workspace policy</option>${options}</select></label><label>Effort<select name="executionEffort"><option>high</option><option>medium</option><option>low</option></select></label>${["architect", "planner", "developer", "reviewer"].map((role) => `<div class="form-row"><label>${role} runtime<select name="${role}Runtime"><option value="inherit">Inherit Project / developer</option><option value="claude">Claude Code</option><option value="codex">Codex</option></select></label><label>${role} model<select name="${role}Model"><option value="">Inherit policy</option>${options}</select></label></div>`).join("")}<details><summary>Orchestrator and budgets</summary><div class="panel-body"><label>Orchestrator runtime<select name="orchestratorRuntime"><option value="claude">Claude Code</option><option value="codex">Codex</option></select></label><label>Requested orchestrator model<input name="orchestratorModel" value="claude-opus-5-5"></label><label>Orchestrator effort<select name="orchestratorEffort"><option>high</option></select></label><label>Parallel developers<input name="developerLimit" type="number" min="1" max="${esc(state.settings.maxDeveloperAgents || 5)}" value="${esc(state.settings.maxDeveloperAgents || 5)}"></label><label>Task runtime (minutes)<input name="taskMinutes" type="number" min="1" max="240" value="60"></label><label>Human PR reviewers<input name="humanReviewers" placeholder="backend-lead, payment-owner"></label><label class="checks"><input type="checkbox" name="allowAutoPr">Permit PR creation after validated independent review in Autonomous mode</label><small>Never merges, deploys or releases. Jira publication remains explicit. Model availability requires the administrator registry; no Fable or implicit fallback. Unknown token/cost data stays unavailable.</small></div></details></div></details>`;
}
async function createProject(values) {
  const data = {
    workflowVersion: 2,
    agentProfiles: { enabled: Boolean(values.get("agentProfilesEnabled")) },
    jira: values.get("jiraEnabled")
      ? (() => {
          const input = jiraInput(values),
            base = workspaceJira().projects[input.project] || {};
          return {
            enabled: true,
            ...Object.fromEntries(
              Object.entries(input).filter(
                ([k, v]) =>
                  k === "epic" ||
                  (k === "project"
                    ? v !== questJiraDefault(values.getAll("repositoryIds"))
                    : JSON.stringify(v) !==
                      JSON.stringify(Object.hasOwn(base, k) ? base[k] : "")),
              ),
            ),
          };
        })()
      : { enabled: false },
    epic: values.get("epic") || "",
    reviewers: String(values.get("humanReviewers") || "")
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean),
    execution: {
      runtime: values.get("executionRuntime") || "claude",
      mode: values.get("executionMode") || "guided",
      roles: Object.fromEntries(
        ["architect", "planner", "developer", "reviewer"].map((role) => [
          role,
          {
            runtime: values.get(`${role}Runtime`) || "inherit",
            ...(values.get(`${role}Model`) ? { model: values.get(`${role}Model`) } : {}),
            ...(values.get(`${role}Effort`) ? { effort: values.get(`${role}Effort`) } : {}),
          },
        ]),
      ),
      routing: {
        mode: values.get("routingMode") || "dynamic",
        ...(values.get("executionModel") ? { model: values.get("executionModel") } : {}),
        effort: values.get("executionEffort") || "high",
        orchestrator: {
          runtime: values.get("orchestratorRuntime") || "claude",
          model: values.get("orchestratorModel") || "claude-opus-5-5",
          effort: values.get("orchestratorEffort") || "high",
        },
      },
      limits: {
        developers: Number(values.get("developerLimit") || state.settings.maxDeveloperAgents || 5),
        taskMinutes: Number(values.get("taskMinutes") || 60),
      },
      permissions: {
        createPr: Boolean(values.get("allowAutoPr")),
        publishJira: false,
      },
    },
    kind: values.get("kind") === "BUG" ? "TECH" : values.get("kind"),
    ...(values.get("kind") === "BUG"
      ? {
          existingJiraKey: String(values.get("existingJiraKey") || "")
            .trim()
            .toUpperCase(),
        }
      : {}),
    title: values.get("title"),
    sprint: values.get("sprint"),
    sourceType: values.get("sourceType"),
    repositoryIds: values.getAll("repositoryIds"),
    content: values.get("content"),
    url: values.get("url"),
  };
  if (values.get("kind") === "BUG" && !/^[A-Z][A-Z0-9_]*-\d+$/.test(data.existingJiraKey))
    throw new Error("Enter the existing QA Jira issue key");
  if (data.sourceType === "file") {
    const file = values.get("file");
    if (!file?.size) throw new Error("Choose a file");
    if (file.size > 8 * 1024 * 1024) throw new Error("File exceeds 8 MB");
    const base64 = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result.split(",")[1]);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    data.file = { name: file.name, base64 };
  }
  const result = await action("CREATE_QUEST", data);
  location.hash = `quest/${result.id}/overview`;
  return result;
}
function newQuest() {
  if (!state.repositories.length) {
    toast("Register a repository first.");
    return addRepository();
  }
  if (dashboardUI?.openCreateProject) return dashboardUI.openCreateProject({ state, jiraDefault: questJiraDefault(), onCreate: async (values) => { const result = await createProject(values); toast("Project created. No agent started."); return result; } });
  dialog(
    "Create a Project",
    `<div class="form-row"><label>What are you working on?<select name="kind"><option value="PRODUCT">New feature (PRD)</option><option value="TECH">Technical improvement</option><option value="BUG">Fix an existing bug</option></select></label><label>Sprint (optional)<input name="sprint" maxlength="80" placeholder="Sprint 42"></label></div><label data-qa-intake hidden>Existing QA Jira issue<input name="existingJiraKey" maxlength="100" placeholder="PROJECT-123" disabled><small>Link this issue after plan approval; no new Jira issue is needed.</small></label><label>Title<input name="title" required maxlength="160" placeholder="What are we building?"></label><label>Source<select name="sourceType"><option value="text">Local text / technical idea</option><option value="file">Local file (.md, .txt, .pdf, .docx)</option><option value="confluence">Confluence page</option></select></label><label data-source="text">Requirements or technical idea<textarea name="content" rows="6" placeholder="Describe the problem, desired outcome and constraints…"></textarea></label><label data-source="file" hidden>Choose a file<input name="file" type="file" accept=".md,.txt,.pdf,.docx"><small>Maximum 8 MB. Text PDFs only.</small></label><label data-source="confluence" hidden>Confluence page URL<input name="url" type="url" placeholder="https://company.atlassian.net/wiki/spaces/…"><small>Main page plus direct linked Confluence pages only.</small></label><label>Affected repositories <small>Selected repositories bound the architect's impact analysis.</small></label><div class="checks">${state.repositories.map((repo) => `<label><input type="checkbox" name="repositoryIds" value="${repo.id}" checked>${esc(repo.name)}</label>`).join("")}</div><details><summary>Jira settings · optional now</summary>${questJiraFields()}</details><details><summary>Advanced agent settings</summary><label class="checks"><input type="checkbox" name="agentProfilesEnabled">Enable versioned Agent Profiles (existing routing and permissions)</label>${executionFields()}</details>`,
    "new-quest",
    "Create Project",
  );
  if (!questJiraDefault())
    document
      .querySelectorAll(
        "#dialog-content [data-jira-config] input, #dialog-content [data-jira-config] select, #dialog-content [data-jira-config] textarea",
      )
      .forEach((el) => (el.disabled = true));
}
function repositoryPathFields(value = "") {
  return `<label for="repository-folder-path">Local Git repository path</label><div class="repository-path-input"><input id="repository-folder-path" name="path" required value="${esc(value)}" placeholder="/Users/you/Workspace/repository"><button class="btn" type="button" data-action="browse-repository">${icon("folder")} Browse</button></div><div class="toolbar"><button class="btn small" type="button" data-action="inspect-repository">Check path</button><small>Browse or enter a path, then check it before saving.</small></div><div class="repository-preview" aria-live="polite" role="status">No folder checked.</div>`;
}
function addRepository() {
  dialog("Register repository", repositoryPathFields(), "repository", "Register repository");
}
async function checkRepositoryFolder(form, browse) {
  const input = form.elements.path;
  const preview = form.querySelector(".repository-preview");
  const submit = form.querySelector('[type="submit"]');
  const version = Number(form.dataset.folderCheck || 0) + 1;
  form.dataset.folderCheck = String(version);
  submit.disabled = true;
  preview.textContent = browse
    ? "Choose a folder in the macOS dialog…"
    : "Checking Git repository…";
  try {
    const result = await action(browse ? "PICK_REPOSITORY_FOLDER" : "INSPECT_REPOSITORY_FOLDER", {
      ...(!browse ? { path: input.value } : {}),
      ...(form.elements.repositoryId?.value
        ? { repositoryId: form.elements.repositoryId.value }
        : {}),
    });
    if (form.isConnected === false || form.dataset.folderCheck !== String(version)) return;
    if (result.cancelled || result.unavailable) {
      preview.textContent = result.cancelled
        ? "Selection cancelled. The path is unchanged."
        : result.message;
      return;
    }
    input.value = result.path;
    form.dataset.validatedPath = result.valid ? result.path : "";
    preview.innerHTML = `${badge(result.valid ? "VALID" : "BLOCKED")} ${result.name ? `<strong>${esc(result.name)}</strong><small>Git root: ${esc(result.gitRoot)}<br>Current branch: ${esc(result.currentBranch || "Detached HEAD")} · Default branch: ${esc(result.defaultBranch || "Not reliably detected")}${result.referencedQuests ? `<br>Referenced by ${esc(result.referencedQuests)} Project(s)` : ""}</small>` : ""}${result.error ? `<p class="form-error">${esc(result.error)}</p>` : ""}`;
  } catch (error) {
    if (form.dataset.folderCheck === String(version)) {
      form.dataset.validatedPath = "";
      preview.textContent = `${error.message}. You can enter the path manually and check it.`;
    }
  } finally {
    if (form.dataset.folderCheck === String(version))
      submit.disabled = !input.value || form.dataset.validatedPath !== input.value;
  }
}
function editArtifact(kind, questId) {
  const current = artifact(questId, kind);
  const tasks = questTasks(questId).map((t) => ({
    id: t.key,
    title: t.title,
    repoId: t.repoId,
    dependencies: t.dependencies.map((key) => state.tasks.find((task) => task.id === key)?.key),
    validation: t.validationProfile,
  }));
  const template = [
    {
      id: "T1",
      title: "Implement and validate the first change",
      repoId: state.quests.find((q) => q.id === questId).repositoryIds[0],
      dependencies: [],
      validation: "node-test",
    },
  ];
  dialog(
    `Edit ${kind === "trd" ? "TRD" : kind === "spec" ? "specification" : "implementation plan"}`,
    `<input type="hidden" name="questId" value="${esc(questId)}">${kind === "spec" && current?.sourceStage !== "brainstorm" ? `<input type="hidden" name="trdArtifactId" value="${esc(artifact(questId, "trd")?.id)}">` : ""}<label>Markdown document<textarea name="content" rows="14" required>${esc((current?.content || "").split("<!-- devquest-tasks")[0])}</textarea><small>${current?.sourceStage === "brainstorm" ? "This is the canonical brainstorming specification. Edit it before starting Analyze." : "Saving a revision requires reviewing the document and downstream plan again."}</small></label>${kind === "plan" ? `<label>Tasks (JSON)<textarea name="tasks" rows="10" required>${esc(JSON.stringify(tasks.length ? tasks : template, null, 2))}</textarea><small>Use repository IDs below. Profiles: node-test, npm-test, go-test, pytest. Dependencies reference task IDs.</small></label><div class="code">${state.repositories.map((r) => `${esc(r.name)}: ${r.id}`).join("\n")}</div>` : ""}`,
    `edit-${kind}`,
    "Save draft",
  );
}
document.addEventListener("input", (event) => {
  rememberCollaboration(event.target.closest?.("form[data-collaboration]"));
  if (event.target.closest("form")?.dataset?.form === "workspace-jira") workspaceJiraDirty = true;
  if (event.target.name !== "path") return;
  const form = event.target.closest("form");
  if (!["repository", "repository-path"].includes(form?.dataset.form)) return;
  form.dataset.folderCheck = String(Number(form.dataset.folderCheck || 0) + 1);
  form.dataset.validatedPath = "";
  form.querySelector('[type="submit"]').disabled = true;
  form.querySelector(".repository-preview").textContent = "Path changed. Check it before saving.";
});
document.addEventListener("change", (event) => {
  if (event.target.closest("form")?.dataset?.form === "react-create-project") return;
  if (event.target.name === "kind") {
    const form = event.target.closest("form");
    if (form?.dataset.form === "new-quest") {
      const bug = event.target.value === "BUG",
        section = form.querySelector("[data-qa-intake]");
      section.hidden = !bug;
      section.querySelector("input").disabled = !bug;
      section.querySelector("input").required = bug;
      form.querySelector('[name="content"]').placeholder = bug
        ? "Describe the actual behavior, expected behavior, reproduction steps and constraints."
        : "Describe the problem, desired outcome and constraints…";
    }
  }
  rememberCollaboration(event.target.closest?.("form[data-collaboration]"));
  if (event.target.closest("form")?.dataset?.form === "workspace-jira") workspaceJiraDirty = true;
  if (event.target.dataset.documentView) {
    const mode = event.target.value;
    if (!["viewer", "source"].includes(mode)) return;
    documentModes.set(event.target.dataset.documentView, mode);
    event.target.closest(".architect-document").querySelector(".document-views").dataset.view =
      mode;
  }
  if (event.target.name === "jiraEnabled") {
    const section = event.target.closest("form").querySelector("[data-jira-config]");
    section.hidden = !event.target.checked;
    section
      .querySelectorAll("input, select, textarea")
      .forEach((el) => (el.disabled = !event.target.checked));
  }
  if (event.target.name === "project") {
    const form = event.target.closest("form"),
      project = event.target.value.trim(),
      previous = form.elements.epic?.value || "";
    const p = workspaceJira().projects[project] || { project };
    if (form.dataset.form === "new-quest") form.dataset.jiraProjectOverride = "true";
    if (form.elements.makeDefault)
      form.elements.makeDefault.checked = workspaceJira().defaultProject === project;
    form.querySelector("[data-jira-fields]").outerHTML = jiraFields(
      { ...p, epic: previous.startsWith(project + "-") ? previous : "" },
      form.dataset.form === "workspace-jira",
    );
    if (form.dataset.form === "workspace-jira")
      form
        .querySelectorAll('[name="jiraRepositoryIds"]')
        .forEach((el) => (el.checked = Boolean(p.repositoryIds?.includes(el.value))));
  }
  if (event.target.name === "repositoryIds") {
    const form = event.target.closest("form");
    if (form?.dataset.form === "new-quest" && !form.dataset.jiraProjectOverride) {
      const ids = [...form.querySelectorAll('[name="repositoryIds"]:checked')].map(
        (el) => el.value,
      );
      const project = questJiraDefault(ids),
        p = workspaceJira().projects[project] || {};
      form.querySelector("[data-jira-fields]").outerHTML = jiraFields(p);
      if (!form.elements.jiraEnabled.checked)
        form
          .querySelector("[data-jira-fields]")
          .querySelectorAll("input, select, textarea")
          .forEach((el) => (el.disabled = true));
      if (!project && form.elements.jiraEnabled.checked)
        toast("Selected repositories have different Jira projects. Choose a project explicitly.");
    }
  }
  if (event.target.name === "sourceType")
    document
      .querySelectorAll("[data-source]")
      .forEach((el) => (el.hidden = el.dataset.source !== event.target.value));
});
document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape" || $("#dialog").open) return;
  const navigation = $("#primary-navigation");
  if (!navigation.classList?.contains?.("is-open")) return;
  navigation.classList.toggle("is-open", false);
  $("#navigation-toggle").setAttribute("aria-expanded", "false");
  $("#navigation-toggle").focus();
  event.preventDefault();
});
document.addEventListener("click", async (event) => {
  if (event.target.closest(".skip-link")) {
    event.preventDefault();
    $("#main").focus();
    return;
  }
  const target = event.target.closest("[data-action]");
  if (target?.dataset.action === "toggle-navigation") {
    const open = target.getAttribute("aria-expanded") !== "true";
    $("#primary-navigation").classList.toggle("is-open", open);
    target.setAttribute("aria-expanded", String(open));
    return;
  }

  if (!target) return;
  const type = target.dataset.action;
  if (type === "delete-project") {
    const quest = state.quests.find((item) => item.id === target.dataset.questId);
    return dialog("Delete project", `<input type="hidden" name="questId" value="${esc(quest.id)}"><input type="hidden" name="expectedUpdatedAt" value="${esc(quest.updatedAt || quest.createdAt)}"><p>Move <strong>${esc(quest.title)}</strong> to Deleted projects? You can restore it later.</p><p>Documents, history, repository files and worktrees are preserved. Jira issues and PRs remain unchanged. Stop active agents and pause project automation first.</p><label>Type the project title to confirm<input name="confirmTitle" required autocomplete="off" placeholder="${esc(quest.title)}"></label><label>Reason (optional)<textarea name="reason" rows="2" maxlength="500" placeholder="Incorrect PRD, canceled work, or another reason…"></textarea></label>`, "delete-project", "Delete project");
  }
  if (type === "restore-project") {
    const quest = state.deletedQuests.find((item) => item.id === target.dataset.questId);
    return dialog("Restore project", `<input type="hidden" name="questId" value="${esc(quest.id)}"><input type="hidden" name="deletedAt" value="${esc(quest.deletedAt)}"><p>Restore <strong>${esc(quest.title)}</strong> to the active list? Its saved documents and work will be available again. Agents and automation will remain stopped until you explicitly continue.</p>`, "restore-project", "Restore project");
  }
  if (type === "register-skill") return editSkill();
  if (type === "edit-skill") return editSkill(state.skills.find((skill) => skill.id === target.dataset.skillId));
  if (type === "archive-skill") {
    const skill = state.skills.find((item) => item.id === target.dataset.skillId);
    return dialog("Remove skill registration", `<input type="hidden" name="skillId" value="${esc(skill.id)}"><input type="hidden" name="revision" value="${skill.revision}"><p>Remove ${esc(skill.name)} from this library? The installed skill and existing workflow configuration are preserved.</p>`, "archive-skill", "Remove registration");
  }
  if (type === "inspect-skill") {
    const form = target.closest("form");
    target.disabled = true;
    try {
      const skill = await action("INSPECT_SKILL", { path: form.elements.path.value });
      form.elements.path.value = skill.path;
      form.elements.sourceHash.value = skill.sourceHash;
      if (!form.elements.name.value) form.elements.name.value = skill.name;
      if (!form.elements.description.value) form.elements.description.value = skill.description;
      if (!form.elements.mcp.value && skill.detectedMcp?.length)
        form.elements.mcp.value = skill.detectedMcp.join(", ");
      form.elements.declarationConfirmed.checked = false;
      form.querySelector("[data-skill-preview]").textContent = `Source inspected. ${skill.sourceHints.length ? "Review: " + skill.sourceHints.join("; ") + "." : "No dependency references detected; review the complete skill yourself."} Compatibility and connections remain untested.`;
      form.querySelector(".form-error").textContent = "";
    } catch (error) { form.querySelector(".form-error").textContent = error.message; }
    finally { target.disabled = false; }
    return;
  }
  if (type === "new-quest") return newQuest();
  if (type === "room-answer") {
    const run = eligibleRoomRuns(target.dataset.questId).find(
      (run) => run.id === target.dataset.runId,
    );
    if (!run) return toast("This turn changed. Reload the room and choose a current question.");
    const key = `${run.questId}:room-reply`,
      draft = collaborationDrafts.get(key);
    collaborationDrafts.set(key, {
      ...draft,
      runToken: `${run.id}|${run.updatedAt || ""}`,
      requestId: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      message: draft?.message || "",
    });
    location.hash = `#quest/${run.questId}/room`;
    render(true);
    document.querySelector('[data-form="room-reply"] [name="message"]')?.focus();
    return;
  }
  if (type === "SET_AGENT_PROFILES") {
    target.disabled = true;
    try {
      await action(type, {
        questId: target.dataset.questId,
        enabled: target.dataset.enabled === "true",
      });
      toast("Agent Profile settings updated for future runs.");
    } catch (error) {
      toast(error.message);
    } finally {
      target.disabled = false;
    }
    return;
  }
  if (type === "add-repository") return addRepository();
  if (["browse-repository", "inspect-repository"].includes(type)) {
    target.disabled = true;
    try {
      await checkRepositoryFolder(target.closest("form"), type === "browse-repository");
    } finally {
      target.disabled = false;
    }
    return;
  }
  if (type === "repository-config") {
    const repo = repository(target.dataset.repositoryId);
    return dialog(
      "Repository branch policy",
      `<input type="hidden" name="repositoryId" value="${esc(repo.id)}">${["defaultBranch", "baseBranch", "prTarget"].map((name) => `<label>${name}<input name="${name}" required value="${esc(repo[name] || "")}"></label>`).join("")}<label>Protected branch patterns<input name="protectedBranches" value="${esc((repo.protectedBranches || ["main", "master"]).join(", "))}"></label><label>Default human reviewers<input name="reviewers" value="${esc((repo.reviewers || []).join(", "))}"></label><small>Configure before creating workspaces. Existing workspaces retain their reviewed target.</small>`,
      "repository-config",
      "Save policy",
    );
  }
  if (type === "pr-target") {
    const work = state.works.find((w) => w.id === target.dataset.workId);
    return dialog(
      "Change PR target",
      `<input type="hidden" name="questId" value="${esc(work.questId)}"><input type="hidden" name="workId" value="${esc(work.id)}"><label>Target branch<input name="target" required value="${esc(work.prTarget)}"></label><small>Changing the target invalidates repository validation and production review.</small>`,
      "pr-target",
      "Validate target",
    );
  }
  if (type === "repository-path") {
    const repo = repository(target.dataset.repositoryId);
    return dialog(
      "Repair repository path",
      `<input type="hidden" name="repositoryId" value="${esc(repo.id)}">${repositoryPathFields(repo.path)}<small>The new folder must have the same Git remote. Saved Projects and compatible worktrees are preserved.</small>`,
      "repository-path",
      "Update path",
    );
  }
  if (type === "close-dialog") return $("#dialog").close();
  if (type === "edit-trd" || type === "edit-plan" || type === "edit-spec")
    return editArtifact(type.slice(5), target.dataset.questId);
  if (type === "existing-jira-dialog") {
    const questId = target.dataset.questId;
    return dialog(
      "Use existing QA / Jira task",
      `<input type="hidden" name="questId" value="${esc(questId)}"><input type="hidden" name="planArtifactId" value="${esc(artifact(questId, "plan")?.id)}"><label>Existing Jira issue key<input name="key" value="${esc(state.quests.find((q) => q.id === questId)?.existingJiraKey || "")}" required placeholder="DEV-123" maxlength="100" pattern="[A-Za-z][A-Za-z0-9_]*-[0-9]+"></label><label>Jira issue URL (optional)<input name="url" type="url" placeholder="https://your-team.atlassian.net/browse/DEV-123"></label><small>This issue will track every implementation task in the approved plan. Confirm the issue exists and covers this work. Appendix generation and Jira upload will be skipped.</small>`,
      "existing-jira",
      "Link issue and continue",
    );
  }
  if (type === "REFRESH_QUEST_JIRA") {
    target.disabled = true;
    try {
      await action(type, { questId: target.dataset.questId });
      editJira(state.quests.find((q) => q.id === target.dataset.questId));
      toast("Inherited Jira defaults refreshed; explicit overrides and Epic preserved.");
    } catch (error) {
      toast(error.message);
    } finally {
      target.disabled = false;
    }
    return;
  }
  if (type === "jira-settings")
    return editJira(state.quests.find((q) => q.id === target.dataset.questId));
  if (type === "appendix-dialog") {
    const quest = state.quests.find((q) => q.id === target.dataset.questId),
      context = savedJiraContext(quest);
    if (
      !context.project ||
      !context.siteUrl ||
      !context.projectUrl ||
      quest.jiraConfig?.explicitlyDisabled
    )
      return editJira(quest);
    target.disabled = true;
    toast("Checking Jira configuration…");
    try {
      await action("GENERATE_APPENDIX", {
        questId: quest.id,
        planArtifactId: artifact(quest.id, "plan")?.id,
        requestId: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`,
      });
      toast("Generating Jira Appendix… Review the Markdown before publishing.");
    } catch (error) {
      toast(error.message);
    } finally {
      target.disabled = false;
    }
    return;
  }
  if (type === "edit-appendix") {
    const questId = target.dataset.questId;
    return dialog(
      "Jira task appendix",
      `<input type="hidden" name="questId" value="${esc(questId)}"><input type="hidden" name="planArtifactId" value="${esc(artifact(questId, "plan")?.id)}"><label>Paste output from /create-appendix-task-list<textarea name="content" rows="14" required>${esc(artifact(questId, "appendix")?.content || "")}</textarea></label><small>Generate from the approved plan using your live Jira appendix. Review the document before publication.</small>`,
      "appendix",
      "Save appendix",
    );
  }
  if (type === "create-pr-dialog" || type === "reviewers-dialog") {
    const work = state.works.find((w) => w.id === target.dataset.workId);
    const fields = `<input type="hidden" name="questId" value="${esc(work.questId)}"><input type="hidden" name="workId" value="${esc(work.id)}">`;
    if (type === "create-pr-dialog" && work.workflowVersion === 2)
      return dialog(
        "Create reviewed pull request",
        fields +
          `<p>Source: ${esc(work.branch)} → ${esc(work.prTarget)}</p><label>Human reviewers<input name="reviewers" value="${esc((work.reviewers || state.quests.find((q) => q.id === work.questId)?.reviewers || repository(work.repoId)?.reviewers || state.settings.reviewers || []).join(", "))}"></label><small>Requires integrated tasks, clean exact-commit review and validation. Human merge remains required.</small>`,
        "v11-pr",
        "Create PR",
      );
    if (type === "create-pr-dialog")
      return dialog(
        "Commit, push and create PR",
        `${fields}<label>Office commit message<input name="commitMessage" required maxlength="500" value="${esc(work.commitMessage?.text || `feat : ${state.quests.find((q) => q.id === work.questId).title} (${work.branch})`)}"></label><small>Review the message and diff. This action commits, pushes and creates a PR to development.</small>`,
        "create-pr",
        "Commit, push and create PR",
      );
    return dialog(
      "Request PR reviewers",
      `${fields}<label>GitHub usernames, separated by commas<input name="reviewers" required value="${esc((work.reviewers || state.settings.reviewers || []).join(", "))}"></label>`,
      "reviewers",
      "Request reviewers",
    );
  }
  if (type === "checkpoint") {
    const run = state.runs.find((r) => r.id === target.dataset.runId);
    return dialog(
      "Save point",
      `<input type="hidden" name="runId" value="${run.id}"><label>Completed work, decisions, remaining work and blockers<textarea name="summary" maxlength="4000" required rows="8">${esc(run.summary)}</textarea></label>`,
      "checkpoint",
      "Save checkpoint",
    );
  }
  if (type === "PUBLISH_JIRA") {
    target.disabled = true;
    try {
      const preview = await action("PREVIEW_JIRA_PUBLICATION", {
        questId: target.dataset.questId,
        appendixArtifactId: artifact(target.dataset.questId, "appendix")?.id,
      });
      dialog(
        "Confirm Jira publication",
        `<input type="hidden" name="questId" value="${esc(preview.questId)}"><input type="hidden" name="appendixArtifactId" value="${esc(preview.artifactId || "")}"><input type="hidden" name="appendixHash" value="${esc(preview.hash || "")}"><p>This will publish up to <strong>${preview.maxIssues} real Jira issue${preview.maxIssues === 1 ? "" : "s"}</strong> to <strong>${esc(preview.project)}</strong>${preview.epic ? ` under Epic ${esc(preview.epic)}` : ""}.</p><p>Approved appendix revision ${preview.revision}. “Sample” is the first real issue, not sample data. No issues are created until you confirm.</p><small>Artifact: ${esc(preview.artifactId)} · SHA-256: ${esc(preview.hash)}</small>`,
        "publish-jira",
        "Confirm publication",
      );
    } catch (error) {
      toast(error.message);
    } finally {
      target.disabled = false;
    }
    return;
  }
  target.disabled = true;
  try {
    const data = {};
    for (const key of ["questId", "taskId", "workId", "runId", "artifactId"])
      if (target.dataset[key]) data[key] = target.dataset[key];
    data.runtime =
      (data.taskId
        ? document.querySelector(`[data-task-runtime="${data.taskId}"]`)
        : data.workId
          ? document.querySelector(`[data-work-runtime="${data.workId}"]`)
          : $("#quest-runtime")
      )?.value ||
      Object.entries(state.runtimes).find(([, runtime]) => runtime.available)?.[0] ||
      "codex";
    data.acceptWarnings = $("#accept-warnings")?.checked || false;
    if (["APPROVE_TRD", "APPROVE_PLAN", "APPROVE_APPENDIX"].includes(type))
      data.artifactId ||= artifact(
        data.questId,
        type === "APPROVE_TRD" ? "trd" : type === "APPROVE_PLAN" ? "plan" : "appendix",
      )?.id;
    await action(type, data);
    toast(
      type === "VERIFY_JIRA_PROJECT"
        ? "Verifying Jira project… No issues will be created."
        : type === "EXECUTE_QUEST"
          ? "Eligible tasks scheduled."
          : type === "CREATE_PR"
            ? "Pull request created."
            : "Action saved.",
    );
  } catch (error) {
    toast(error.message);
  } finally {
    target.disabled = false;
  }
});
document.addEventListener("submit", async (event) => {
  const form = event.target.closest("form[data-form]");
  if (!form || form.dataset.form === "react-create-project") return;
  event.preventDefault();
  const submit = form.querySelector('[type="submit"]');
  submit.disabled = true;
  const values = new FormData(form);
  const errorBox = form.querySelector(".form-error");
  errorBox.textContent = "";
  try {
    let result;
    if (form.dataset.form === "delete-project") {
      await action("DELETE_QUEST", {
        questId: values.get("questId"), confirmTitle: values.get("confirmTitle"),
        expectedUpdatedAt: values.get("expectedUpdatedAt"), reason: values.get("reason") || "",
      });
      location.hash = "#quests";
      render(true);
    }
    if (form.dataset.form === "restore-project") {
      await action("RESTORE_QUEST", { questId: values.get("questId"), deletedAt: values.get("deletedAt") });
      location.hash = "#quests";
      render(true);
    }
    if (form.dataset.collaboration) {
      rememberCollaboration(form);
      const questId = values.get("questId"),
        kind = form.dataset.form;
      if (kind === "readiness") readinessResults.set(questId || "workspace", await action("CHECK_READINESS", { ...(questId ? { questId, role: values.get("role") } : {}), runtime: values.get("runtime") }));
      if (kind === "quest-skills") await action("SET_QUEST_SKILLS", { questId, role: values.get("role"), expectedRevision: Number(values.get("expectedRevision")), skills: values.getAll("skillPins").map((value) => { const [id, revision, hash] = value.split("|"); return { id, revision: Number(revision), hash }; }) });
      if (kind === "room-note")
        await action("POST_ROOM_NOTE", { questId, message: values.get("message") });
      if (kind === "room-reply") {
        const [runId, expectedUpdatedAt] = String(values.get("runToken")).split("|");
        await action("SEND_ROOM_REPLY", {
          questId,
          runId,
          expectedUpdatedAt,
          requestId: values.get("requestId"),
          message: values.get("message"),
          confirmAgentRun: Boolean(values.get("confirmAgentRun")),
        });
      }
      if (kind === "qa-case")
        await action("ADD_QA_CASE", {
          questId,
          repositoryId: values.get("repositoryId"),
          title: values.get("title"),
          expected: values.get("expected"),
          jiraKey: values.get("jiraKey"),
        });
      if (kind === "qa-result") {
        const [caseId, revision] = String(values.get("caseId")).split("|");
        await action("RECORD_QA_RESULT", {
          questId,
          caseId,
          revision: Number(revision),
          status: values.get("status"),
          actual: values.get("actual"),
        });
      }
      if (kind === "qa-verify") await action("VERIFY_QA_RESULTS", { questId });
      if (kind === "project-reference")
        await action("SAVE_PROJECT_REFERENCE", {
          questId,
          repositoryId: values.get("repositoryId"),
          referenceId: values.get("referenceId") || undefined,
          expectedRevision: Number(values.get("expectedRevision")),
          name: values.get("name"),
          content: values.get("content"),
        });
      if (kind === "quest-references")
        await action("SET_QUEST_REFERENCES", {
          questId,
          references: values.getAll("referenceIds").map((value) => {
            const [id, revision, hash] = value.split("|");
            return { id, revision: Number(revision), hash };
          }),
        });
      if (kind === "access-preview")
        accessPreviews.set(
          questId,
          await action("PREVIEW_QUEST_ACCESS", {
            questId,
            role: values.get("role"),
            workId: values.get("workId") || undefined,
            taskId: values.get("taskId") || undefined,
          }),
        );
      collaborationDrafts.delete(`${questId}:${form.dataset.draftKey}`);
      form.reset();
      render(true);
      toast(
        kind === "readiness"
          ? "Readiness checks complete. No agent started."
          : kind === "room-reply"
          ? "Instruction sent through the existing agent workflow."
          : kind === "room-note"
            ? "Note saved. No agent started."
            : kind === "qa-verify"
              ? "Evidence checked against current source."
              : kind === "access-preview"
                ? "Access preview complete. No agent started."
                : "Saved.",
      );
      return;
    }
    if (form.dataset.form === "skill-registration") {
      const split = (value) => String(value || "").split(",").map((item) => item.trim()).filter(Boolean);
      result = await action(values.get("skillId") ? "UPDATE_SKILL" : "REGISTER_SKILL", {
        skillId: values.get("skillId"), revision: Number(values.get("revision")),
        path: values.get("path"), sourceHash: values.get("sourceHash"), name: values.get("name"),
        description: values.get("description"), runtimes: values.getAll("runtimes"),
        requirements: { mode: values.get("requirementMode"), mcp: split(values.get("mcp")), tools: split(values.get("tools")), other: values.get("other") || "" },
        declarationConfirmed: Boolean(values.get("declarationConfirmed")),
      });
    }
    if (form.dataset.form === "archive-skill")
      await action("ARCHIVE_SKILL", { skillId: values.get("skillId"), revision: Number(values.get("revision")) });
    if (form.dataset.form === "publish-jira")
      await action("PUBLISH_JIRA", {
        questId: values.get("questId"),
        appendixArtifactId: values.get("appendixArtifactId"),
        appendixHash: values.get("appendixHash"),
      });
    if (form.dataset.form === "repository-config")
      await action("CONFIGURE_REPOSITORY", {
        repositoryId: values.get("repositoryId"),
        defaultBranch: values.get("defaultBranch"),
        baseBranch: values.get("baseBranch"),
        prTarget: values.get("prTarget"),
        protectedBranches: String(values.get("protectedBranches") || "")
          .split(",")
          .map((v) => v.trim())
          .filter(Boolean),
        reviewers: String(values.get("reviewers") || "")
          .split(",")
          .map((v) => v.trim())
          .filter(Boolean),
      });
    if (form.dataset.form === "pr-target")
      await action("SET_PR_TARGET", {
        questId: values.get("questId"),
        workId: values.get("workId"),
        target: values.get("target"),
      });
    if (form.dataset.form === "v11-pr")
      await action("CREATE_PR", {
        questId: values.get("questId"),
        workId: values.get("workId"),
        reviewers: String(values.get("reviewers") || "")
          .split(",")
          .map((v) => v.trim())
          .filter(Boolean),
      });
    if (form.dataset.form === "repository-path")
      result = await action("UPDATE_REPOSITORY", {
        repositoryId: values.get("repositoryId"),
        path: values.get("path"),
      });
    if (form.dataset.form === "repository")
      result = await action("REGISTER_REPOSITORY", {
        path: values.get("path"),
      });
    if (form.dataset.form === "new-quest") result = await createProject(values);
    if (form.dataset.form === "existing-jira")
      await action("USE_EXISTING_JIRA", {
        questId: values.get("questId"),
        planArtifactId: values.get("planArtifactId"),
        key: values.get("key"),
        url: values.get("url"),
      });
    if (form.dataset.form === "workspace-jira") {
      await action("SAVE_WORKSPACE_JIRA", {
        ...jiraInput(values),
        expectedVersion: Number(values.get("expectedVersion")),
        makeDefault: Boolean(values.get("makeDefault")),
        repositoryIds: values.getAll("jiraRepositoryIds"),
      });
      workspaceJiraDirty = false;
      render();
    }
    if (form.dataset.form === "jira-settings")
      await action("SAVE_JIRA_CONTEXT", { questId: values.get("questId"), ...jiraInput(values) });
    if (form.dataset.form === "generate-appendix")
      result = await action("GENERATE_APPENDIX", {
        questId: values.get("questId"),
        planArtifactId: values.get("planArtifactId"),
        requestId: values.get("requestId"),
        project: values.get("project"),
        siteUrl: values.get("siteUrl"),
        projectUrl: values.get("projectUrl"),
        epic: values.get("epic"),
        assignee: values.get("assignee"),
        weightReference: values.get("weightReference"),
      });
    if (form.dataset.form === "appendix")
      await action("SAVE_APPENDIX", {
        questId: values.get("questId"),
        planArtifactId: values.get("planArtifactId"),
        content: values.get("content"),
      });
    if (form.dataset.form === "create-pr")
      await action("CREATE_PR", {
        questId: values.get("questId"),
        workId: values.get("workId"),
        commitMessage: values.get("commitMessage"),
      });
    if (form.dataset.form === "reviewers")
      await action("REQUEST_REVIEW", {
        questId: values.get("questId"),
        workId: values.get("workId"),
        reviewers: values
          .get("reviewers")
          .split(",")
          .map((name) => name.trim())
          .filter(Boolean),
      });
    if (form.dataset.form === "edit-trd")
      await action("SAVE_TRD", {
        questId: values.get("questId"),
        content: values.get("content"),
      });
    if (form.dataset.form === "edit-spec")
      await action("SAVE_SPEC", {
        questId: values.get("questId"),
        trdArtifactId: values.get("trdArtifactId"),
        content: values.get("content"),
      });
    if (form.dataset.form === "edit-plan")
      await action("SAVE_PLAN", {
        questId: values.get("questId"),
        content: values.get("content"),
        tasks: JSON.parse(values.get("tasks")),
      });
    if (form.dataset.form === "checkpoint")
      await action("SAVE_CHECKPOINT", {
        runId: values.get("runId"),
        summary: values.get("summary"),
      });
    if (form.dataset.form === "message") {
      await action("SEND_MESSAGE", {
        runId: form.dataset.run,
        message: values.get("message"),
      });
      form.reset();
    } else $("#dialog").close();
    toast(
      form.dataset.form === "generate-appendix"
        ? result?.state === "COMPLETED"
          ? "Jira Appendix generated successfully. Review generated tasks before publishing."
          : "Generating Jira Appendix…"
        : form.dataset.form === "delete-project"
          ? "Project moved to Deleted projects. You can restore it later."
        : form.dataset.form === "restore-project"
          ? "Project restored. Agents and automation remain stopped."
        : form.dataset.form === "skill-registration"
          ? "Skill registered. Compatibility is declared; no agent started."
        : form.dataset.form === "jira-settings"
          ? "Jira settings saved. Review and approve the appendix again."
          : "Saved.",
    );
  } catch (error) {
    errorBox.textContent = error.message;
  } finally {
    submit.disabled = false;
  }
});
window.addEventListener("hashchange", render);
document.querySelectorAll("[data-icon]").forEach((el) => {
  el.innerHTML = icon(el.dataset.icon);
});
try {
  try { dashboardUI = await import("/dashboard.js"); }
  catch { toast("Dashboard components unavailable. Showing the basic workspace; reload after rebuilding the UI."); }
  const session = await (await fetch("/api/session")).json();
  serverSession = session;
  token = session.token;
  await refresh();
  const events = new EventSource("/api/events");
  let disconnected = false;
  events.onopen = () => {
    dashboardUI?.setConnection?.(true);
    if (disconnected) {
      disconnected = false;
      void refresh();
    }
  };
  events.onmessage = (event) => {
    const data = JSON.parse(event.data);
    if (data.type === "output") {
      const output = ((liveOutput.get(data.runId) || "") + data.text).slice(-16000);
      liveOutput.set(data.runId, output);
      const el = document.querySelector(`[data-output="${data.runId}"]`);
      if (el) el.textContent = responseText(output);
    } else if (data.type === "run-progress") {
      const run = state.runs.find((item) => item.id === data.runId);
      if (run && run.state === "RUNNING") {
        run.lastProgressAt = data.lastProgressAt;
        if (data.runtimeActivity) run.runtimeActivity = data.runtimeActivity;
        document.querySelectorAll(`[data-run-progress="${run.id}"]`).forEach((el) => {
          el.textContent = runProgress(run);
        });
      }
    } else {
      clearTimeout(refresh.timer);
      refresh.timer = setTimeout(refresh, 100);
    }
  };
  events.onerror = () => {
    dashboardUI?.setConnection?.(false);
    if (!disconnected) toast("Connection interrupted. Reconnecting to your local server…");
    disconnected = true;
  };
} catch (error) {
  $("#main").textContent = `Unable to connect: ${error.message}`;
}

setTimeout(function updateAgentElapsed() {
  document.querySelectorAll("[data-run-progress]").forEach((el) => {
    const run = state?.runs.find((item) => item.id === el.dataset.runProgress);
    if (run) el.textContent = runProgress(run);
  });
  document.querySelectorAll("[data-agent-elapsed]").forEach((el) => {
    const end = el.dataset.end ? Date.parse(el.dataset.end) : Date.now();
    el.textContent = `${Math.max(0, Math.floor((end - Date.parse(el.dataset.start)) / 1000))}s`;
  });
  setTimeout(updateAgentElapsed, 1000);
}, 1000);

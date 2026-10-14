import { Marked } from "/vendor/marked.js";

const $ = (selector) => document.querySelector(selector);
const esc = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ],
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
  loading = false;
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
      return url === "#"
        ? label
        : `<a href="${url}" target="_blank" rel="noreferrer">${label}</a>`;
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
  sword: '<path d="m14 4 6-1-1 6-9 9-4-4Z M5 13l6 6 M7 17l-4 4 M2 19l3 3"/>',
  home: '<path d="m3 10 9-7 9 7 M5 9v12h5v-7h4v7h5V9"/>',
  quest: '<path d="M6 21V3m0 1c5-4 7 4 13 0v10c-6 4-8-4-13 0"/>',
  repository:
    '<path d="M5 3h13v18H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Zm0 14h13 M8 3v7l3-2 3 2V3"/>',
  party:
    '<circle cx="12" cy="7" r="3"/><path d="M7 20v-3a5 5 0 0 1 10 0v3 M5 9a3 3 0 0 0-2 5m16-5a3 3 0 0 1 2 5 M2 21v-2a4 4 0 0 1 3-4m17 6v-2a4 4 0 0 0-3-4"/>',
  jira: '<path d="m12 2 10 10-10 10L2 12Z m0 6 4 4-4 4-4-4Z"/>',
  settings:
    '<path d="m9 3-1 3-3 1 1 4-2 2 2 3 3-1 2 3 4-1 1-3 3-1-1-4 2-2-2-3-3 1-2-3Z"/><circle cx="12" cy="11" r="3"/>',
  layers: '<path d="m12 3 10 5-10 5L2 8Zm-9 9 9 5 9-5M3 17l9 5 9-5"/>',
  branch:
    '<circle cx="6" cy="5" r="2"/><circle cx="18" cy="5" r="2"/><circle cx="6" cy="19" r="2"/><path d="M6 7v10m12-10a8 8 0 0 1-8 8H6"/>',
  architect: '<path d="m12 2 9 6v12H3V8Zm0 0v20M3 8l9 6 9-6M7 5l10 7"/>',
  planner:
    '<rect x="4" y="4" width="16" height="17" rx="2"/><path d="M8 2v4m8-4v4M8 11h8m-8 5h5"/>',
  developer: '<path d="m8 7-5 5 5 5m8-10 5 5-5 5m-3-13-2 20"/>',
  reviewer: '<path d="m12 2 8 4v6c0 5-8 10-8 10S4 17 4 12V6Z m-5 10 3 3 5-6"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 2"/>',
  document: '<path d="M5 3h10l4 4v14H5Zm10 0v5h4M8 12h8m-8 4h6"/>',
  spark: '<path d="m12 2 3 7 7 3-7 3-3 7-3-7-7-3 7-3Z"/>',
  arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  alert: '<path d="m12 3 10 18H2Zm0 6v5m0 3v1"/>',
};
const icon = (name) =>
  `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || icons.quest}</svg>`;
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
const roleFor = (run) =>
  roles.find((r) => r.purposes.includes(run.purpose)) || roles[2];
const runtimeName = (key) => (key === "codex" ? "Codex" : "Claude Code");
const labels = {
  home: "Overview",
  quests: "Quests",
  repositories: "Repositories",
  agents: "Agent party",
  jira: "Jira tasks",
  settings: "Settings & integrations",
  quest: "Quest detail",
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
function badge(status) {
  const warn = /WAITING|PAUSED|INTERRUPTED|REVIEW|DRAFT|AWAITING/.test(status);
  const bad = /FAIL|RECOVERY|BLOCK/.test(status);
  const tone = bad
    ? "bad"
    : warn
      ? "warn"
      : /RUNNING|EXECUTING/.test(status)
        ? "running"
        : /UNAVAILABLE|NOT_CONFIGURED|IDLE|PLANNED|PUBLISHED/.test(status)
          ? "neutral"
          : /TECH|PRODUCT/.test(status)
            ? "special"
            : "";
  return `<span class="badge ${tone}"><span class="status-dot" aria-hidden="true"></span>${esc(status.replaceAll("_", " "))}</span>`;
}
const repository = (id) => state.repositories.find((r) => r.id === id);
const questTasks = (id) => state.tasks.filter((t) => t.questId === id);
const artifact = (id, kind) =>
  state.artifacts.find((a) => a.questId === id && a.kind === kind);
const pct = (quest) => {
  const tasks = questTasks(quest.id);
  return tasks.length
    ? Math.round(
        (tasks.filter((t) => t.state === "COMPLETED").length / tasks.length) *
          100,
      )
    : 0;
};
const bar = (value) =>
  `<progress class="native-progress" max="100" value="${value}" aria-label="Progress ${value}%">${value}%</progress>`;
const empty = (symbol, title, copy, action = "") =>
  `<div class="empty"><span class="empty-icon">${symbol.startsWith("<svg") ? symbol : icon({ "▱": "repository", "✳": "party", "◇": "jira", "◷": "clock", "☷": "document" }[symbol] || "quest")}</span><h3>${title}</h3><p>${copy}</p>${action}</div>`;
const head = (
  title,
  subtitle,
  action = "",
  eyebrow = "YOUR ENGINEERING WORKSPACE",
) =>
  `<div class="page-head"><div class="hero-copy"><div class="eyebrow">${eyebrow}</div><h1>${esc(title)}</h1><p>${esc(subtitle)}</p></div><div class="hero-aside"><p class="hero-quote">${title === "Repositories" ? "Small repositories<br>build greater adventures." : "Small commits.<br>A greater world."}</p>${action}</div></div>`;
const panel = (title, body, link = "") =>
  `<section class="panel"><div class="panel-head"><h2>${title}</h2>${link}</div>${body}</section>`;
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
    latest.set(
      JSON.stringify([
        run.questId,
        run.purpose,
        run.taskId || run.workId || null,
      ]),
      run,
    );
  return [...latest.values()];
}
function partyCards(runs = state.runs) {
  return `<div class="party-grid">${roles
    .map((role) => {
      const matching = latestAttempts(runs).filter(
        (r) => roleFor(r).key === role.key,
      );
      const run =
        matching.find((r) =>
          [
            "RUNNING",
            "WAITING_INPUT",
            "PAUSED",
            "INTERRUPTED",
            "FAILED",
          ].includes(r.state),
        ) || matching.at(-1);
      const active =
        run &&
        [
          "RUNNING",
          "WAITING_INPUT",
          "PAUSED",
          "INTERRUPTED",
          "FAILED",
        ].includes(run.state);
      return `<article class="party-member ${role.key}"><span class="role-avatar">${icon(role.key)}</span><h3>${role.label}</h3><small>${run ? runtimeName(run.runtime) : "Choose on start"}</small>${badge(active ? run.state : "IDLE")}${run ? `<a class="party-context" href="#quest/${esc(run.questId)}/overview">${esc(state.quests.find((q) => q.id === run.questId)?.title || "View Quest")}</a>` : ""}</article>`;
    })
    .join("")}</div>`;
}
function questChain(quest) {
  const id = quest.id;
  const stage = ["PRS_CREATED", "REVIEW_HANDOFF"].includes(quest.state)
    ? 7
    : quest.state === "READY_FOR_PR"
      ? 6
      : ["EXECUTING", "TASKS_PUBLISHED"].includes(quest.state)
        ? 5
        : quest.state === "PLAN_APPROVED"
          ? 4
          : quest.state === "PLAN_DRAFT" || quest.state === "TRD_APPROVED"
            ? 3
            : artifact(id, "analysis") || quest.state.startsWith("TRD")
              ? 2
              : quest.kind === "PRODUCT" || artifact(id, "technical-brief")
                ? 1
                : 0;
  const blocked =
    latestAttempts(state.runs).some(
      (r) =>
        r.questId === id &&
        /FAILED|WAITING_INPUT|INTERRUPTED|PAUSED/.test(r.state),
    ) ||
    state.works.some(
      (w) => w.questId === id && w.state === "RECOVERY_REQUIRED",
    );
  return `<ol class="pipeline" aria-label="Quest workflow">${[quest.kind === "TECH" ? "Brief" : "PRD", "Analysis", "TRD", "Plan", "Jira", "Execute", "PR", quest.state === "REVIEW_HANDOFF" ? "Team review" : "Done"].map((name, i) => `<li class="${i < stage || (i === 7 && quest.state === "PRS_CREATED") ? "done" : i === stage ? `current${blocked ? " blocked" : ""}` : "future"}" ${i === stage ? 'aria-current="step"' : ""}><span class="step-number">${i < stage || (i === 7 && quest.state === "PRS_CREATED") ? icon("check") : i + 1}</span><span>${name}<small>${i === stage && blocked ? "Needs attention" : i < stage ? "Complete" : i === stage ? (quest.state === "PRS_CREATED" ? "Complete" : "Current stage") : "Upcoming"}</small></span></li>`).join("")}</ol>`;
}
function repositoryCards(quest) {
  return `<div class="repository-cards">${quest.repositoryIds
    .map((id) => {
      const repo = repository(id),
        work = state.works.find(
          (w) => w.questId === quest.id && w.repoId === id,
        );
      const tasks = questTasks(quest.id).filter((t) => t.repoId === id),
        done = tasks.filter((t) => t.state === "COMPLETED").length;
      return `<article class="repository-card"><div class="repository-identity"><span class="repo-emblem">${icon("repository")}</span><div><h3 title="${esc(repo?.name)}">${esc(repo?.name)}</h3><small class="truncate" title="${esc(repo?.path)}">${esc(repo?.path)}</small></div></div><div class="progress-row">${bar(tasks.length ? Math.round((done / tasks.length) * 100) : 0)}<span>${done}/${tasks.length} tasks</span></div><div class="branch-label">${icon("branch")}<span title="${esc(work?.branch)}">${esc(work?.branch || "Prepared on first execution")}</span></div><div class="row-head">${badge(work?.state || "PLANNED")}<a class="subtle-link" href="#quest/${quest.id}/repositories">View details ${icon("arrow")}</a></div></article>`;
    })
    .join("")}</div>`;
}
function questTaskTable(quest) {
  const tasks = questTasks(quest.id);
  return tasks.length
    ? `<div class="table-scroll" tabindex="0" role="region" aria-label="Quest tasks"><table><thead><tr><th>Objective</th><th>Repository</th><th>Status</th><th>Dependencies</th></tr></thead><tbody>${tasks.map((t) => `<tr><td><a class="table-title" href="#quest/${quest.id}/tasks">${esc(t.jira?.key || t.key)}</a><small>${esc(t.title)}</small></td><td>${esc(repository(t.repoId)?.name)}</td><td>${badge(t.state)}</td><td class="number">${t.dependencies.map((id) => esc(state.tasks.find((other) => other.id === id)?.key)).join(", ") || "—"}</td></tr>`).join("")}</tbody></table></div>`
    : empty(
        icon("jira"),
        "No objectives planned yet",
        "Your approved plan will become the task queue for this Quest.",
      );
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
  const tasks = questTasks(quest.id),
    progress = pct(quest);
  return `<a href="#quest/${quest.id}/overview" class="quest-row"><div class="row-head"><div class="quest-title"><span class="quest-icon">${icon(quest.kind === "PRODUCT" ? "quest" : "architect")}</span><div><h3>${esc(quest.title)}</h3><small>${quest.kind === "PRODUCT" ? "Product Quest" : "Tech Quest"} · ${quest.id.slice(0, 8).toUpperCase()}</small></div></div>${badge(quest.state)}</div><div class="row-meta"><span>▱ ${quest.repositoryIds.length} repositories</span><span>✓ ${tasks.filter((t) => t.state === "COMPLETED").length} / ${tasks.length} tasks</span><span>${esc(quest.sprint || "No sprint assigned")}</span></div><div class="progress-row">${bar(progress)}<span>${progress}%</span></div></a>`;
}
function agentsPanel() {
  return (
    Object.entries(state.runtimes)
      .map(([key, runtime]) => {
        const runs = state.runs.filter(
          (r) => r.runtime === key && r.state === "RUNNING",
        );
        return `<div class="agent-row"><span class="agent-avatar ${key}">${icon(key === "codex" ? "developer" : "spark")}</span><div><strong>${key === "codex" ? "Codex" : "Claude Code"}</strong><small>${runs.length ? `${runs.length} active session${runs.length > 1 ? "s" : ""}` : "Ready when you are"}</small></div>${badge(!runtime.available ? "UNAVAILABLE" : runs.length ? "RUNNING" : "IDLE")}</div>`;
      })
      .join("") +
    '<div class="hint">Your agents, one shared workflow.<br>Sessions start only when you choose.</div>'
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
    : empty(
        "◷",
        "A clean slate",
        "Your decisions, milestones and save points will appear here.",
      );
}
function repoTable(repos = state.repositories) {
  if (!repos.length)
    return empty(
      "▱",
      "Connect your first repository",
      "Register a local Git repository to give your Quests a place to work.",
      button("+ Add repository", "add-repository", {}, "small"),
    );
  return `<div class="table-scroll" tabindex="0" role="region" aria-label="Repository registry"><table class="registry-table"><thead><tr><th>Repository</th><th>Base branch</th><th>Activity</th><th>Works</th></tr></thead><tbody>${repos
    .map((repo) => {
      const works = state.works.filter((w) => w.repoId === repo.id);
      return `<tr><td class="repo-name"><div class="repository-identity"><span class="repo-emblem">${icon("repository")}</span><div><strong title="${esc(repo.name)}">${esc(repo.name)}</strong><small class="truncate" title="${esc(repo.path)}">${esc(repo.path)}</small></div></div></td><td><span class="branch-label">${icon("branch")}development</span></td><td>${badge(repo.error ? "RECOVERY_REQUIRED" : works.find((w) => w.state === "EXECUTING") ? "EXECUTING" : "READY")}${repo.error ? `<small>${esc(repo.error)}</small>` : ""}${button("Update path", "repository-path", { "repository-id": repo.id }, "small")}</td><td><span class="work-count">${works.length}</span></td></tr>`;
    })
    .join("")}</tbody></table></div>`;
}
function home() {
  const active = state.quests.filter((q) => q.state !== "PRS_CREATED");
  const running = state.runs.filter((r) => r.state === "RUNNING").length;
  const attention = state.runs.filter((r) =>
    ["WAITING_INPUT", "FAILED", "INTERRUPTED", "PAUSED"].includes(r.state),
  ).length;
  const sprint = state.quests.find((q) => q.sprint)?.sprint;
  const sprintQuests = state.quests.filter(
    (q) => q.sprint === sprint && sprint,
  );
  const finished = sprintQuests.filter((q) => q.state === "PRS_CREATED").length;
  return `${head("A good day to build.", "From the first idea to the pull request. Keep your engineering work in motion.", button("+ New Quest", "new-quest", {}, "primary"))}
    <div class="stats">${[
      ["Active Quests", active.length, "Across your workspace", "⚑"],
      [
        "Agents at work",
        running,
        `${Object.values(state.runtimes).filter((r) => r.available).length} runtimes available`,
        "✳",
      ],
      [
        "Connected repositories",
        state.repositories.length,
        "Isolated worktrees, shared context",
        "▱",
      ],
      [
        "Needs your attention",
        attention,
        attention
          ? "Open the agent party to continue"
          : "All clear. Room to focus.",
        "◉",
      ],
    ]
      .map(
        ([label, number, copy, glyph]) =>
          `<div class="stat"><div class="stat-label">${label}<span aria-hidden="true">${icon({ "⚑": "quest", "✳": "party", "▱": "repository", "◉": "alert" }[glyph])}</span></div><div class="stat-number">${number.toString().padStart(2, "0")}</div><small>${copy}</small></div>`,
      )
      .join("")}</div>
    <section class="sprint"><div><div class="eyebrow">CURRENT SPRINT</div><h3>${esc(sprint || "Make room for your next milestone.")}</h3><p>${sprint ? `${sprintQuests.length} Quests in this sprint` : "Assign a sprint when you create a Quest."}</p></div><div><div class="row-meta"><span>${finished} / ${sprintQuests.length} complete</span></div>${bar(sprintQuests.length ? (finished / sprintQuests.length) * 100 : 0)}</div></section>
    <div class="grid-main"><div class="stack">${panel("Active Quests", active.length ? active.slice(0, 5).map(questRow).join("") : empty("⚑", "Your next great idea starts here", "Turn a product requirement or technical improvement into an approved, actionable Quest.", button("+ Create a Quest", "new-quest", {}, "primary small")), '<a href="#quests" class="subtle-link">View all ↗</a>')}${panel("Repository activity", repoTable(), '<a href="#repositories" class="subtle-link">Manage ↗</a>')}</div><div class="stack">${panel("Agent party", agentsPanel(), '<a href="#agents" class="subtle-link">Open ↗</a>')}${panel("Recent activity", activity())}</div></div>`;
}
function quests() {
  return (
    head(
      "Your Quests",
      "Ideas become plans. Plans become progress.",
      button("+ New Quest", "new-quest", {}, "primary"),
    ) +
    panel(
      "All Quests",
      state.quests.length
        ? state.quests.map(questRow).join("")
        : empty(
            "⚑",
            "No Quests yet",
            "Create your first Product or Tech Quest to begin.",
          ),
    )
  );
}
function agents() {
  return (
    head(
      "Agent party",
      "Interact with your agents and pick up from a saved checkpoint.",
    ) +
    panel(`${icon("party")} Your party`, partyCards()) +
    `<div class="setting-grid section-space">${Object.entries(state.runtimes)
      .map(([key, r]) =>
        panel(
          key === "codex" ? "Codex" : "Claude Code",
          `<div class="panel-body">${badge(r.available ? "AVAILABLE" : "UNAVAILABLE")}<p>${esc(r.reason || "Authenticated CLI access is checked when a session starts.")}</p><small>Resume: ${r.nativeResume ? "native when available" : "logical from checkpoints"}</small></div>`,
        ),
      )
      .join(
        "",
      )}</div><div class="section-space">${state.runs.length ? state.runs.slice().reverse().map(runCard).join("") : panel("Sessions", empty("✳", "No active sessions", "Start an architect from a Quest, or execute a published task."))}</div>`
  );
}
const responseText = (value) =>
  String(value || "").replace(
    /^\s*DEVQUEST_WAITING_INPUT\b[ \t]*(?:\r?\n)?/,
    "",
  );
function runCard(run) {
  const task = state.tasks.find((t) => t.id === run.taskId);
  const waiting = [
    "PAUSED",
    "INTERRUPTED",
    "WAITING_INPUT",
    "FAILED",
    "COMPLETED",
  ].includes(run.state);
  const role = roleFor(run);
  const output =
    (run.state === "FAILED"
      ? run.summary
      : liveOutput.get(run.id) || run.summary) ||
    (run.state === "RUNNING"
      ? "The session is running. Live output is temporary; save points preserve essential context."
      : "No summary is available yet. Inspect the preserved worktree and save points before continuing.");
  return `<section class="panel run-card ${role.key}"><div class="row-head"><div class="run-identity"><span class="role-avatar">${icon(role.key)}</span><div><small>${role.label} · ${runtimeName(run.runtime)}</small><h3>${esc(task?.title || run.purpose)}</h3></div></div>${badge(run.state)}</div>${run.pid ? `<small class="truncate" title="${esc(run.cwd)}">Process ${run.pid} · ${esc(run.cwd)}</small>` : ""}${["PAUSED", "INTERRUPTED"].includes(run.state) ? `<div class="savepoint-note">${icon("clock")}<div><strong>Progress preserved</strong><small>Last Save Point${run.updatedAt ? ` · ${time(run.updatedAt)}` : ""}. Continue when you are ready.</small></div></div>` : ""}<pre class="run-output" data-output="${run.id}" tabindex="0" aria-label="Agent response">${esc(responseText(output))}</pre><div class="task-actions">${run.state === "RUNNING" ? button("Pause", "PAUSE_AGENT", { "run-id": run.id }) + button("Interrupt", "INTERRUPT_AGENT", { "run-id": run.id }, "danger") : ""}${waiting && task?.state !== "COMPLETED" ? button("Continue", "CONTINUE_AGENT", { "run-id": run.id }, "primary small") : ""}${button("Save checkpoint", "checkpoint", { "run-id": run.id }, "small")}</div>${waiting ? `<form data-form="message" data-run="${run.id}"><label>Instruction for this agent<textarea name="message" rows="2" required placeholder="Clarify a decision or give the next instruction…"></textarea></label><button class="btn small" type="submit">Send instruction ↗</button><div class="form-error" role="alert"></div></form>` : "<small>Pause the current turn to send a new instruction.</small>"}</section>`;
}
function jira() {
  const tasks = state.tasks.filter((t) => t.jira);
  return (
    head(
      "Jira tasks",
      "Your approved plans, published with an explicit action.",
    ) +
    panel(
      "Published tasks",
      tasks.length
        ? `<div class="table-scroll" tabindex="0" role="region" aria-label="Published Jira tasks"><table><thead><tr><th>Issue</th><th>Task</th><th>Repository</th><th>State</th></tr></thead><tbody>${tasks.map((t) => `<tr><td>${(t.jira.issues || [t.jira]).map((issue) => `<a class="table-title" href="${safeUrl(issue.url)}" target="_blank" rel="noreferrer">${esc(issue.key)} ↗</a>`).join("<br>")}</td><td>${esc(t.title)}</td><td>${esc(repository(t.repoId)?.name)}</td><td>${badge(t.state)}</td></tr>`).join("")}</tbody></table></div>`
        : empty(
            "◇",
            "Nothing published yet",
            "Approve a plan, then use Publish Tasks to Jira in its Quest.",
          ),
    )
  );
}
function settings() {
  return (
    head(
      "Settings & integrations",
      "Local tools power your workspace. Credentials stay with their providers.",
    ) +
    `<div class="setting-grid">${panel("Workspace", `<div class="panel-body"><p>Data directory</p><div class="code">${esc(state.settings.dataDir)}</div><p>Base branch <strong>development</strong> · Maximum active sessions <strong>${state.settings.concurrency}</strong></p>${button("Reconcile saved state", "RECONCILE", {}, "small")}</div>`)}${panel("Agent runtimes", agentsPanel())}${panel("Jira publishing skill", `<div class="panel-body">${badge(state.settings.jiraConfigured ? "CONFIGURED" : "NOT_CONFIGURED")}<p>Uses your local /upload-task-to-jira skill and Claude Code’s Atlassian connection. Review each sample or batch before publishing more.</p><small>See docs/integrations.md for the bridge contract.</small></div>`)}${panel("Confluence", `<div class="panel-body">${badge(state.settings.confluenceConfigured ? "CONFIGURED" : "NOT_CONFIGURED")}<p>Import a main page and one level of directly linked pages. Credentials come from the configured environment or authentication provider.</p><small>Review the imported page list before generating a TRD.</small></div>`)}${panel("GitHub", `<div class="panel-body"><h3>Uses your existing GitHub CLI login</h3><p>Each repository work produces one PR to development. Generate an office commit message, create the PR, request reviewers, then notify Google Chat. Each publication has its own action.</p><div class="code">gh auth login</div></div>`)}${panel("Google Chat", `<div class="panel-body">${badge(state.settings.chatConfigured ? "CONFIGURED" : "NOT_CONFIGURED")}<p>Set googleChat.webhookEnv to the environment variable holding your webhook. Requests retain a receipt and a stable retry ID.</p></div>`)}${panel("Local skills", `<div class="panel-body"><p>${esc((state.settings.localSkills || []).join(", ") || "Configure workflow.skills with local SKILL.md paths.")}</p></div>`)}${panel("Local configuration", `<div class="panel-body"><p>Machine-level integration settings are read at startup. Configure executables in your local config, then restart DevQuest.</p><div class="code">~/.devquest/config.json</div><small>Keep tokens out of this file. See README.md for setup.</small></div>`)}</div>`
  );
}
function questView(id, tab = "overview") {
  const quest = state.quests.find((q) => q.id === id);
  if (!quest)
    return head(
      "Quest not found",
      "Return to your Quest list.",
      '<a class="btn" href="#quests">All Quests</a>',
    );
  const tasks = questTasks(id),
    works = state.works.filter((w) => w.questId === id),
    runs = state.runs.filter((r) => r.questId === id);
  const tabs = [
    "overview",
    "architect",
    "tasks",
    "repositories",
    "artifacts",
    "activity",
  ];
  let body = "";
  if (tab === "overview") {
    let next = "";
    const runtime = `<select id="quest-runtime" aria-label="Architect runtime">${runtimeOptions()}</select>`;
    const active = runs.some((r) =>
      ["RUNNING", "PAUSED", "INTERRUPTED", "WAITING_INPUT"].includes(r.state),
    );
    if (!active) {
      if (quest.kind === "TECH" && !artifact(id, "technical-brief"))
        next += button(
          "Start brainstorm",
          "START_BRAINSTORM",
          { "quest-id": id },
          "primary",
        );
      if (
        quest.kind === "TECH" &&
        artifact(id, "brainstorm") &&
        !artifact(id, "technical-brief")
      )
        next += button(
          "Finish brainstorm",
          "FINISH_BRAINSTORM",
          { "quest-id": id },
          "primary",
        );
      if (
        !artifact(id, "analysis") &&
        (quest.kind === "PRODUCT" || artifact(id, "technical-brief"))
      )
        next += button(
          "Analyze requirements & repositories",
          "ANALYZE_PRD",
          { "quest-id": id },
          "primary",
        );
      if (artifact(id, "analysis") && !artifact(id, "trd"))
        next += button(
          "Generate TRD",
          "GENERATE_TRD",
          { "quest-id": id },
          "primary",
        );
      if (quest.state === "TRD_DRAFT")
        next += button(
          "Approve TRD",
          "APPROVE_TRD",
          { "quest-id": id },
          "primary",
        );
      if (quest.state === "TRD_APPROVED")
        next +=
          button(
            "Generate plan",
            "GENERATE_PLAN",
            { "quest-id": id },
            "primary",
          ) + button("Write plan manually", "edit-plan", { "quest-id": id });
      if (quest.state === "PLAN_DRAFT")
        next += button(
          "Approve plan",
          "APPROVE_PLAN",
          { "quest-id": id },
          "primary",
        );
      if (quest.state === "PLAN_APPROVED")
        next +=
          button(
            "Generate Jira appendix",
            "appendix-dialog",
            { "quest-id": id },
            "small",
          ) +
          button(
            "Import Jira appendix",
            "edit-appendix",
            { "quest-id": id },
            "small",
          ) +
          button(
            tasks.some((t) => t.jira)
              ? "Publish next Jira batch (up to 5)"
              : "Publish Jira sample",
            "PUBLISH_JIRA",
            { "quest-id": id },
            "primary",
          );
      if (quest.state === "PLAN_APPROVED" && !tasks.some((t) => t.jira))
        next += button("Use existing Jira task", "existing-jira-dialog", {
          "quest-id": id,
        });
    }
    if (
      quest.kind === "TECH" &&
      !artifact(id, "technical-brief") &&
      runs.some(
        (r) => r.purpose === "brainstorm" && r.state === "WAITING_INPUT",
      )
    )
      next += button(
        "Finish brainstorm",
        "FINISH_BRAINSTORM",
        { "quest-id": id },
        "primary",
      );
    if (["TASKS_PUBLISHED", "EXECUTING"].includes(quest.state))
      next +=
        button(
          "⚑ Execute Quest",
          "EXECUTE_QUEST",
          { "quest-id": id },
          "primary",
        ) +
        (quest.autoExecute
          ? button("Pause scheduling", "PAUSE_QUEST", { "quest-id": id })
          : "");
    body = `<section class="next-step"><div>${icon("spark")}<div><h2>${quest.state === "PRS_CREATED" ? "Quest complete" : "Next step"}</h2><p>${quest.state === "PRS_CREATED" ? "All pull requests and configured review requests are complete." : quest.state === "REVIEW_HANDOFF" ? "Open Repositories to request reviewers and notify Google Chat." : active ? "An agent session needs to finish or continue." : "Review your artifacts and choose the next action."}</p></div></div><div class="toolbar">${next}${next ? runtime : ""}</div>${quest.warnings?.length ? `<div class="warning">${quest.warnings.map(esc).join("<br>")}<label class="checks"><input type="checkbox" id="accept-warnings">Continue with incomplete source context</label></div>` : ""}</section><div class="grid-main quest-overview"><div class="stack">${panel(`${icon("document")} Quest summary`, `<pre class="document brief-document">${esc(artifact(id, quest.kind === "PRODUCT" ? "prd" : "technical-brief")?.content || artifact(id, "idea")?.content || "")}</pre>`, `<a class="subtle-link" href="#quest/${id}/architect">Design documents ${icon("arrow")}</a>`)}${panel(`${icon("repository")} Affected repositories`, repositoryCards(quest), `<span class="panel-count">${quest.repositoryIds.length} repositories</span>`)}${panel(`${icon("jira")} Jira tasks & objectives`, questTaskTable(quest), `<a class="subtle-link" href="#quest/${id}/tasks">Execution queue ${icon("arrow")}</a>`)}</div><div class="stack">${panel(`${icon("party")} Agent party`, partyCards(runs))}${runs.length ? runs.slice(-2).reverse().map(runCard).join("") : panel(`${icon("developer")} Active agent`, empty(icon("developer"), "Your party is standing by", "Start the next step to bring an agent into this Quest."))}${panel(`${icon("clock")} Recent activity`, activity(state.events.filter((e) => e.questId === id)), `<a class="subtle-link" href="#quest/${id}/activity">View all ${icon("arrow")}</a>`)}${quest.sources?.length ? panel("Context loaded", `<div class="source-list">${quest.sources.map((source) => `<p><a href="${safeUrl(source.url)}" target="_blank" rel="noreferrer">${esc(source.title)} ↗</a><small>Version ${esc(source.version)}</small></p>`).join("")}</div>`) : ""}</div></div>`;
  }
  if (tab === "tasks")
    body = panel(
      "Execution queue",
      tasks.length
        ? tasks
            .map(
              (task) =>
                `<article class="task-card"><div class="row-head"><h3>${esc(task.key)} · ${esc(task.title)}</h3>${badge(task.state)}</div><div class="row-meta"><span>▱ ${esc(repository(task.repoId)?.name)}</span><span>${esc(task.jira?.key || "Not published")}</span><span>Validation: ${esc(task.validationProfile)}</span></div><p>Depends on: ${task.dependencies.length ? task.dependencies.map((key) => esc(state.tasks.find((t) => t.id === key)?.key)).join(", ") : "No dependencies"}</p>${task.validation ? `<pre class="run-output">${esc(task.validation.summary)}</pre>` : ""}<div class="task-actions"><select aria-label="Runtime for ${esc(task.key)}" data-task-runtime="${task.id}">${runtimeOptions()}</select>${task.state === "PUBLISHED" ? button("▶ Start", "START_TASK", { "quest-id": id, "task-id": task.id }, "primary small") : ""}${["AWAITING_TEST", "TEST_FAILED", "COMPLETED"].includes(task.state) ? button("Run tests", "RUN_TEST", { "quest-id": id, "task-id": task.id }, "small") : ""}${["COMPLETED", "TEST_FAILED"].includes(task.state) ? button("Reopen task", "REOPEN_TASK", { "quest-id": id, "task-id": task.id }, "small") : ""}</div></article>`,
            )
            .join("")
        : empty(
            "☷",
            "No tasks planned",
            "Approve the TRD, then generate or write a plan.",
          ),
    );
  if (tab === "repositories")
    body = works.length
      ? works
          .map((work) =>
            panel(
              esc(repository(work.repoId)?.name),
              `<div class="panel-body"><div class="row-head">${badge(work.state)}<span class="number">⑂ ${esc(work.branch)}</span></div><div class="code">${esc(work.path)}</div>${work.error ? `<div class="warning">${esc(work.error)}</div>` : ""}${work.review ? `<pre class="document">${esc(work.review.summary)}</pre>` : ""}<div class="toolbar">${!work.pr ? `<select aria-label="Reviewer runtime" data-work-runtime="${work.id}">${runtimeOptions()}</select>` : ""}${!work.pr ? button("Review repository", "REVIEW_REPOSITORY", { "quest-id": id, "work-id": work.id }, "small") : ""}${work.review && !work.pr ? button("Approve repository review", "APPROVE_REVIEW", { "quest-id": id, "work-id": work.id }, "small") : ""}${work.state === "READY_FOR_PR" ? button("Generate office commit message", "GENERATE_COMMIT_MESSAGE", { "quest-id": id, "work-id": work.id }, "small") + button("Create PR → development", "create-pr-dialog", { "quest-id": id, "work-id": work.id }, "primary") : ""}${work.pr && !work.notifiedAt && !work.notification ? button("Request reviewers", "reviewers-dialog", { "quest-id": id, "work-id": work.id }, "small") : ""}${work.reviewRequestedAt && !work.notifiedAt ? button("Notify Google Chat", "NOTIFY_REVIEW", { "quest-id": id, "work-id": work.id }, "small") : ""}${work.notifiedAt ? badge("TEAM_NOTIFIED") : work.reviewRequestedAt ? badge("REVIEW_REQUESTED") : ""}${work.pr ? `<a class="btn primary" target="_blank" rel="noreferrer" href="${safeUrl(work.pr.url)}">View pull request ↗</a>` : ""}</div></div>`,
            ),
          )
          .join('<div class="section-space"></div>')
      : panel(
          "Repository work",
          empty(
            "▱",
            "Worktrees are prepared on first execution",
            "Each repository will have its own branch, worktree and pull request.",
          ),
        );
  if (tab === "architect") {
    const editable =
      !runs.some((run) =>
        ["RUNNING", "WAITING_INPUT", "PAUSED", "INTERRUPTED"].includes(
          run.state,
        ),
      ) && !tasks.some((task) => task.jira);
    body =
      `<p class="muted">Saved design documents for this Quest. Read the Markdown or download a copy. New revisions preserve earlier files.</p>` +
      [
        ["trd", "TRD"],
        ["spec", "Specification"],
        ["plan", "Implementation plan"],
        ["ticket", "Jira tickets"],
      ]
        .map(([kind, title]) => {
          const doc =
            artifact(id, kind) ||
            (kind === "ticket" ? artifact(id, "appendix") : null);
          const stale =
            kind === "spec" &&
            doc &&
            doc.trdArtifactId !== artifact(id, "trd")?.id;
          let controls =
            doc && !doc.error
              ? `<a class="btn small" href="/api/artifacts/${encodeURIComponent(doc.id)}" download>Download .md</a>`
              : "";
          if (doc && !doc.error)
            controls = documentViewSelect(`${id}-${kind}`, title) + controls;
          if (editable && ["trd", "plan"].includes(kind) && doc)
            controls += button(
              "Edit",
              `edit-${kind}`,
              { "quest-id": id },
              "small",
            );
          if (
            editable &&
            kind === "spec" &&
            ["TRD_APPROVED", "PLAN_DRAFT", "PLAN_APPROVED"].includes(
              quest.state,
            )
          )
            controls +=
              button(
                "Generate spec",
                "GENERATE_SPEC",
                { "quest-id": id },
                "small",
              ) +
              button(
                "Write / import spec",
                "edit-spec",
                { "quest-id": id },
                "small",
              ) +
              `<select id="quest-runtime" aria-label="Specification runtime">${runtimeOptions()}</select>`;
          return architectDocument(
            `${id}-${kind}`,
            `${esc(title)}${doc ? `<span class="muted"> · revision ${doc.revision}</span>` : ""}`,
            doc
              ? `${stale ? '<div class="warning">The TRD changed. Regenerate or update this specification before using it.</div>' : ""}${doc.error ? `<pre class="document">${esc(doc.error)}</pre>` : documentPreview(`${id}-${kind}`, title, doc.content)}<div class="code">${esc(doc.file || "")}</div>`
              : empty(
                  icon("document"),
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
            : documentPreview(
                `${id}-appendix`,
                "Jira appendix",
                appendix.content,
              ),
          !appendix.error
            ? documentViewSelect(`${id}-appendix`, "Jira appendix") +
                `<a class="btn small" href="/api/artifacts/${encodeURIComponent(appendix.id)}" download>Download .md</a>`
            : "",
        );
  }
  if (tab === "artifacts")
    body = state.artifacts
      .filter((a) => a.questId === id)
      .map((a) =>
        panel(
          `${esc(a.kind)} <span class="muted">· revision ${a.revision}</span>`,
          `<pre class="document">${esc(a.error || a.content)}</pre>`,
          ["trd", "plan"].includes(a.kind)
            ? button("Edit", `edit-${a.kind}`, { "quest-id": id }, "small")
            : "",
        ),
      )
      .join('<div class="section-space"></div>');
  if (tab === "activity")
    body = panel(
      "Decisions & milestones",
      activity(state.events.filter((e) => e.questId === id)),
    );
  return `<section class="page-head quest-hero"><div class="hero-copy"><div class="row-meta">${badge(`${quest.kind} QUEST`)}<span class="number">${quest.id.slice(0, 8).toUpperCase()}</span></div><h1>${esc(quest.title)}</h1><div class="quest-facts"><div><small>Status</small>${badge(quest.state)}</div><div><small>Sprint</small><strong>${esc(quest.sprint || "Unassigned")}</strong></div><div><small>Repositories</small><strong>${quest.repositoryIds.length} connected</strong></div><div><small>Repository works</small><strong>${works.length} isolated</strong></div></div></div><div class="hero-aside"><a class="subtle-link" href="#quests">← All Quests</a><div class="quest-progress"><div class="row-head"><strong>Quest progress</strong><span class="number">${pct(quest)}%</span></div>${bar(pct(quest))}<small>${tasks.filter((t) => t.state === "COMPLETED").length} / ${tasks.length} tasks completed</small></div></div></section>${questChain(quest)}<nav class="tabs" aria-label="Quest sections">${tabs.map((name) => `<a href="#quest/${id}/${name}" class="${tab === name ? "active" : ""}" ${tab === name ? 'aria-current="page"' : ""}>${name[0].toUpperCase() + name.slice(1)}</a>`).join("")}</nav>${body}`;
}
function render() {
  if (!state) return;
  const [route = "home", id, tab] = (location.hash.slice(1) || "home").split(
    "/",
  );
  document.querySelectorAll("[data-nav]").forEach((el) => {
    const selected = el.dataset.nav === (route === "quest" ? "quests" : route);
    el.classList.toggle("active", selected);
    if (selected) el.setAttribute("aria-current", "page");
    else el.removeAttribute("aria-current");
  });
  $("#breadcrumb").textContent = labels[route] || "Overview";
  $("#quest-count").textContent = state.quests.length;
  const sprint = state.quests.find((q) => q.sprint)?.sprint;
  const sprintQuests = state.quests.filter(
    (q) => sprint && q.sprint === sprint,
  );
  const completed = sprintQuests.filter(
    (q) => q.state === "PRS_CREATED",
  ).length;
  $("#sidebar-sprint").innerHTML =
    `<div class="eyebrow">${icon("sword")} CURRENT SPRINT</div><strong>${esc(sprint || "No sprint assigned")}</strong>${bar(sprintQuests.length ? Math.round((completed / sprintQuests.length) * 100) : 0)}<small>${completed} / ${sprintQuests.length} Quests complete</small>`;
  // Preserve unsent agent instructions across live state updates.
  const selections = [...document.querySelectorAll("#main select")].map(
    (el) => ({
      id: el.id,
      task: el.dataset.taskRuntime,
      work: el.dataset.workRuntime,
      value: el.value,
    }),
  );
  const drafts = new Map(
    [...document.querySelectorAll('form[data-form="message"]')].map((form) => [
      form.dataset.run,
      form.elements.message.value,
    ]),
  );
  const openedDocuments = new Set(
    [...document.querySelectorAll("#main details[data-document][open]")].map(
      (el) => el.dataset.document,
    ),
  );
  $("#main").innerHTML =
    route === "quest"
      ? questView(id, tab)
      : route === "quests"
        ? quests()
        : route === "repositories"
          ? head(
              "Repositories",
              "Give each Quest an isolated place to build.",
              button("+ Add repository", "add-repository", {}, "primary"),
            ) +
            panel(
              `${icon("repository")} <span>Repository registry<small>Manage the code repositories available to your Quests.</small></span>`,
              repoTable(),
              `<span class="panel-count">${state.repositories.length} ${state.repositories.length === 1 ? "repository" : "repositories"}</span>`,
            )
          : route === "agents"
            ? agents()
            : route === "jira"
              ? jira()
              : route === "settings"
                ? settings()
                : home();
  for (const el of document.querySelectorAll("#main details[data-document]"))
    el.open = openedDocuments.has(el.dataset.document);
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
}
function dialog(title, fields, form, submit = "Save") {
  $("#dialog-content").innerHTML =
    `<form data-form="${form}"><div class="dialog-head"><h2>${title}</h2><button class="btn ghost" type="button" data-action="close-dialog" aria-label="Close dialog">×</button></div><div class="dialog-body">${fields}<div class="form-error" role="alert"></div></div><div class="dialog-foot"><button class="btn" type="button" data-action="close-dialog">Cancel</button><button class="btn primary" type="submit">${submit}</button></div></form>`;
  $("#dialog").showModal();
}
function newQuest() {
  if (!state.repositories.length) {
    toast("Register a repository first.");
    return addRepository();
  }
  dialog(
    "Create a Quest",
    `<div class="form-row"><label>Quest type<select name="kind"><option value="PRODUCT">⚑ Product Quest</option><option value="TECH">⌘ Tech Quest</option></select></label><label>Sprint (optional)<input name="sprint" maxlength="80" placeholder="Sprint 42"></label></div><label>Title<input name="title" required maxlength="160" placeholder="What are we building?"></label><label>Source<select name="sourceType"><option value="text">Local text / technical idea</option><option value="file">Local file (.md, .txt, .pdf, .docx)</option><option value="confluence">Confluence page</option></select></label><label data-source="text">Requirements or technical idea<textarea name="content" rows="6" placeholder="Describe the problem, desired outcome and constraints…"></textarea></label><label data-source="file" hidden>Choose a file<input name="file" type="file" accept=".md,.txt,.pdf,.docx"><small>Maximum 8 MB. Text PDFs only.</small></label><label data-source="confluence" hidden>Confluence page URL<input name="url" type="url" placeholder="https://company.atlassian.net/wiki/spaces/…"><small>Main page plus direct linked Confluence pages only.</small></label><label>Affected repositories <small>Selected repositories bound the architect's impact analysis.</small></label><div class="checks">${state.repositories.map((repo) => `<label><input type="checkbox" name="repositoryIds" value="${repo.id}" checked>${esc(repo.name)}</label>`).join("")}</div>`,
    "new-quest",
    "Create Quest",
  );
}
function addRepository() {
  dialog(
    "Register repository",
    '<label>Local Git repository path<input name="path" required placeholder="E:\\Workspace\\payment-service"><small>Select the repository root. A development branch must exist before execution.</small></label>',
    "repository",
    "Register repository",
  );
}
function editArtifact(kind, questId) {
  const current = artifact(questId, kind);
  const tasks = questTasks(questId).map((t) => ({
    id: t.key,
    title: t.title,
    repoId: t.repoId,
    dependencies: t.dependencies.map(
      (key) => state.tasks.find((task) => task.id === key)?.key,
    ),
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
    `<input type="hidden" name="questId" value="${esc(questId)}">${kind === "spec" ? `<input type="hidden" name="trdArtifactId" value="${esc(artifact(questId, "trd")?.id)}">` : ""}<label>Markdown document<textarea name="content" rows="14" required>${esc((current?.content || "").split("<!-- devquest-tasks")[0])}</textarea><small>Saving a revision requires reviewing the document and downstream plan again.</small></label>${kind === "plan" ? `<label>Tasks (JSON)<textarea name="tasks" rows="10" required>${esc(JSON.stringify(tasks.length ? tasks : template, null, 2))}</textarea><small>Use repository IDs below. Profiles: node-test, npm-test, go-test, pytest. Dependencies reference task IDs.</small></label><div class="code">${state.repositories.map((r) => `${esc(r.name)}: ${r.id}`).join("\n")}</div>` : ""}`,
    `edit-${kind}`,
    "Save draft",
  );
}
document.addEventListener("change", (event) => {
  if (event.target.dataset.documentView) {
    const mode = event.target.value;
    if (!["viewer", "source"].includes(mode)) return;
    documentModes.set(event.target.dataset.documentView, mode);
    event.target
      .closest(".architect-document")
      .querySelector(".document-views").dataset.view = mode;
  }
  if (event.target.name === "sourceType")
    document
      .querySelectorAll("[data-source]")
      .forEach((el) => (el.hidden = el.dataset.source !== event.target.value));
});
document.addEventListener("click", async (event) => {
  if (event.target.closest(".skip-link")) {
    event.preventDefault();
    $("#main").focus();
    return;
  }
  const target = event.target.closest("[data-action]");
  if (!target) return;
  const type = target.dataset.action;
  if (type === "new-quest") return newQuest();
  if (type === "add-repository") return addRepository();
  if (type === "repository-path") {
    const repo = repository(target.dataset.repositoryId);
    return dialog(
      "Repair repository path",
      `<input type="hidden" name="repositoryId" value="${esc(repo.id)}"><label>Current local Git repository root<input name="path" required value="${esc(repo.path)}"></label><small>The new folder must have the same Git remote. Saved Quests and compatible worktrees are preserved.</small>`,
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
      `<input type="hidden" name="questId" value="${esc(questId)}"><input type="hidden" name="planArtifactId" value="${esc(artifact(questId, "plan")?.id)}"><label>Existing Jira issue key<input name="key" required placeholder="DEV-123" maxlength="100" pattern="[A-Za-z][A-Za-z0-9_]*-[0-9]+"></label><label>Jira issue URL (optional)<input name="url" type="url" placeholder="https://your-team.atlassian.net/browse/DEV-123"></label><small>This issue will track every implementation task in the approved plan. Confirm the issue exists and covers this work. Appendix generation and Jira upload will be skipped.</small>`,
      "existing-jira",
      "Link issue and continue",
    );
  }
  if (type === "appendix-dialog") {
    const questId = target.dataset.questId;
    const context =
      state.quests.find((q) => q.id === questId).jiraContext || {};
    return dialog(
      "Generate Jira task appendix",
      `<input type="hidden" name="questId" value="${esc(questId)}"><input type="hidden" name="planArtifactId" value="${esc(artifact(questId, "plan")?.id)}"><label>Jira project key<input name="project" required value="${esc(context.project || "")}"></label><label>Epic key<input name="epic" required value="${esc(context.epic || "")}"></label><label>Assignee<input name="assignee" required value="${esc(context.assignee || "")}"></label><label>Weight reference, if your board needs it<textarea name="weightReference" rows="4">${esc(context.weightReference || "")}</textarea></label><small>The local skill bridge fetches live Appendix options and generates from the approved plan.</small>`,
      "generate-appendix",
      "Generate appendix",
    );
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
  target.disabled = true;
  try {
    const data = {};
    for (const key of ["questId", "taskId", "workId", "runId"])
      if (target.dataset[key]) data[key] = target.dataset[key];
    data.runtime =
      (data.taskId
        ? document.querySelector(`[data-task-runtime="${data.taskId}"]`)
        : data.workId
          ? document.querySelector(`[data-work-runtime="${data.workId}"]`)
          : $("#quest-runtime")
      )?.value ||
      Object.entries(state.runtimes).find(
        ([, runtime]) => runtime.available,
      )?.[0] ||
      "codex";
    data.acceptWarnings = $("#accept-warnings")?.checked || false;
    if (type === "PUBLISH_JIRA")
      data.appendixArtifactId = artifact(data.questId, "appendix")?.id;
    if (type === "APPROVE_TRD" || type === "APPROVE_PLAN")
      data.artifactId = artifact(
        data.questId,
        type === "APPROVE_TRD" ? "trd" : "plan",
      )?.id;
    await action(type, data);
    toast(
      type === "EXECUTE_QUEST"
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
  if (!form) return;
  event.preventDefault();
  const submit = form.querySelector('[type="submit"]');
  submit.disabled = true;
  const values = new FormData(form);
  const errorBox = form.querySelector(".form-error");
  errorBox.textContent = "";
  try {
    let result;
    if (form.dataset.form === "repository-path")
      result = await action("UPDATE_REPOSITORY", {
        repositoryId: values.get("repositoryId"),
        path: values.get("path"),
      });
    if (form.dataset.form === "repository")
      result = await action("REGISTER_REPOSITORY", {
        path: values.get("path"),
      });
    if (form.dataset.form === "new-quest") {
      const data = {
        kind: values.get("kind"),
        title: values.get("title"),
        sprint: values.get("sprint"),
        sourceType: values.get("sourceType"),
        repositoryIds: values.getAll("repositoryIds"),
        content: values.get("content"),
        url: values.get("url"),
      };
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
      result = await action("CREATE_QUEST", data);
      location.hash = `quest/${result.id}/overview`;
    }
    if (form.dataset.form === "existing-jira")
      await action("USE_EXISTING_JIRA", {
        questId: values.get("questId"),
        planArtifactId: values.get("planArtifactId"),
        key: values.get("key"),
        url: values.get("url"),
      });
    if (form.dataset.form === "generate-appendix")
      await action("GENERATE_APPENDIX", {
        questId: values.get("questId"),
        planArtifactId: values.get("planArtifactId"),
        project: values.get("project"),
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
    toast("Saved.");
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
$("#today").textContent = new Date().toLocaleDateString("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
});
try {
  const session = await (await fetch("/api/session")).json();
  token = session.token;
  await refresh();
  const events = new EventSource("/api/events");
  events.onmessage = (event) => {
    const data = JSON.parse(event.data);
    if (data.type === "output") {
      const output = ((liveOutput.get(data.runId) || "") + data.text).slice(
        -16000,
      );
      liveOutput.set(data.runId, output);
      const el = document.querySelector(`[data-output="${data.runId}"]`);
      if (el) el.textContent = responseText(output);
    } else {
      clearTimeout(refresh.timer);
      refresh.timer = setTimeout(refresh, 100);
    }
  };
  events.onerror = () =>
    toast("Connection interrupted. Reconnecting to your local server…");
} catch (error) {
  $("#main").textContent = `Unable to connect: ${error.message}`;
}

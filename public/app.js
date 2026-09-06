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
  return `<span class="badge ${bad ? "bad" : warn ? "warn" : /PLANNED|PUBLISHED|READY/.test(status) ? "neutral" : ""}">${esc(status.replaceAll("_", " "))}</span>`;
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
const empty = (icon, title, copy, action = "") =>
  `<div class="empty"><span class="empty-icon">${icon}</span><h3>${title}</h3><p>${copy}</p>${action}</div>`;
const head = (
  title,
  subtitle,
  action = "",
  eyebrow = "YOUR ENGINEERING WORKSPACE",
) =>
  `<div class="page-head"><div><div class="eyebrow">${eyebrow}</div><h1>${esc(title)}</h1><p>${esc(subtitle)}</p></div>${action}</div>`;
const panel = (title, body, link = "") =>
  `<section class="panel"><div class="panel-head"><h2>${title}</h2>${link}</div>${body}</section>`;
const time = (value) =>
  new Date(value).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });

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
  return `<a href="#quest/${quest.id}/overview" class="quest-row"><div class="row-head"><div class="quest-title"><span class="quest-icon">${quest.kind === "PRODUCT" ? "⚑" : "⌘"}</span><div><h3>${esc(quest.title)}</h3><small>${quest.kind === "PRODUCT" ? "Product Quest" : "Tech Quest"} · ${quest.id.slice(0, 8).toUpperCase()}</small></div></div>${badge(quest.state)}</div><div class="row-meta"><span>▱ ${quest.repositoryIds.length} repositories</span><span>✓ ${tasks.filter((t) => t.state === "COMPLETED").length} / ${tasks.length} tasks</span><span>${esc(quest.sprint || "No sprint assigned")}</span></div><div class="progress-row">${bar(progress)}<span>${progress}%</span></div></a>`;
}
function agentsPanel() {
  return (
    Object.entries(state.runtimes)
      .map(([key, runtime]) => {
        const runs = state.runs.filter(
          (r) => r.runtime === key && r.state === "RUNNING",
        );
        return `<div class="agent-row"><span class="agent-avatar ${key}">${key === "codex" ? "✳" : "✴"}</span><div><strong>${key === "codex" ? "Codex" : "Claude Code"}</strong><small>${runs.length ? `${runs.length} active session${runs.length > 1 ? "s" : ""}` : "Ready when you are"}</small></div>${badge(!runtime.available ? "UNAVAILABLE" : runs.length ? "RUNNING" : "IDLE")}</div>`;
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
  return `<table><thead><tr><th>Repository</th><th>Base branch</th><th>Activity</th><th>Works</th></tr></thead><tbody>${repos
    .map((repo) => {
      const works = state.works.filter((w) => w.repoId === repo.id);
      return `<tr><td class="repo-name"><span>▱</span>${esc(repo.name)}<small>${esc(repo.path)}</small></td><td><span class="number">⑂ development</span></td><td>${badge(works.find((w) => w.state === "EXECUTING") ? "EXECUTING" : "READY")}</td><td>${works.length}</td></tr>`;
    })
    .join("")}</tbody></table>`;
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
        ([label, number, copy, icon]) =>
          `<div class="stat"><div class="stat-label">${label}<span>${icon}</span></div><div class="stat-number">${number.toString().padStart(2, "0")}</div><small>${copy}</small></div>`,
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
    `<div class="setting-grid">${Object.entries(state.runtimes)
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
function runCard(run) {
  const task = state.tasks.find((t) => t.id === run.taskId);
  const waiting = [
    "PAUSED",
    "INTERRUPTED",
    "WAITING_INPUT",
    "FAILED",
    "COMPLETED",
  ].includes(run.state);
  return `<section class="panel run-card"><div class="row-head"><h3>${run.runtime === "codex" ? "✳ Codex" : "✴ Claude Code"} · ${esc(task?.title || run.purpose)}</h3>${badge(run.state)}</div>${run.pid ? `<small>Process ${run.pid} · ${esc(run.cwd)}</small>` : ""}<p>${esc(run.summary || "The session is running. Live output is temporary; save points preserve essential context.")}</p><pre class="run-output" data-output="${run.id}">${esc(liveOutput.get(run.id) || "")}</pre><div class="task-actions">${run.state === "RUNNING" ? button("Pause", "PAUSE_AGENT", { "run-id": run.id }) + button("Interrupt", "INTERRUPT_AGENT", { "run-id": run.id }, "ghost") : ""}${waiting && task?.state !== "COMPLETED" ? button("Continue", "CONTINUE_AGENT", { "run-id": run.id }, "primary small") : ""}${button("Save checkpoint", "checkpoint", { "run-id": run.id }, "small")}</div>${waiting ? `<form data-form="message" data-run="${run.id}"><label>Instruction for this agent<textarea name="message" rows="2" required placeholder="Clarify a decision or give the next instruction…"></textarea></label><button class="btn small" type="submit">Send instruction ↗</button><div class="form-error" role="alert"></div></form>` : "<small>Pause the current turn to send a new instruction.</small>"}</section>`;
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
        ? `<table><thead><tr><th>Issue</th><th>Task</th><th>Repository</th><th>State</th></tr></thead><tbody>${tasks.map((t) => `<tr><td><a href="${safeUrl(t.jira.url)}" target="_blank" rel="noreferrer">${esc(t.jira.key)} ↗</a></td><td>${esc(t.title)}</td><td>${esc(repository(t.repoId)?.name)}</td><td>${badge(t.state)}</td></tr>`).join("")}</tbody></table>`
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
    `<div class="setting-grid">${panel("Workspace", `<div class="panel-body"><p>Data directory</p><div class="code">${esc(state.settings.dataDir)}</div><p>Base branch <strong>development</strong> · Maximum active sessions <strong>${state.settings.concurrency}</strong></p>${button("Reconcile saved state", "RECONCILE", {}, "small")}</div>`)}${panel("Agent runtimes", agentsPanel())}${panel("Jira publishing skill", `<div class="panel-body">${badge(state.settings.jiraConfigured ? "CONFIGURED" : "NOT_CONFIGURED")}<p>Configure your existing Jira skill bridge in the local config file. It receives the approved plan and stable task IDs.</p><small>See docs/integrations.md for the bridge contract.</small></div>`)}${panel("Confluence", `<div class="panel-body">${badge(state.settings.confluenceConfigured ? "CONFIGURED" : "NOT_CONFIGURED")}<p>Import a main page and one level of directly linked pages. Credentials come from the configured environment or authentication provider.</p><small>Review the imported page list before generating a TRD.</small></div>`)}${panel("GitHub", `<div class="panel-body"><h3>Uses your existing GitHub CLI login</h3><p>Each repository work produces one PR to development. Branch push and PR creation occur only on the Create PR action.</p><div class="code">gh auth login</div></div>`)}${panel("Local configuration", `<div class="panel-body"><p>Machine-level integration settings are read at startup. Configure executables in your local config, then restart DevQuest.</p><div class="code">~/.devquest/config.json</div><small>Keep tokens out of this file. See README.md for setup.</small></div>`)}</div>`
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
  const stages = ["Intake", "TRD", "Plan", "Jira", "Execute", "PR"];
  const stage =
    quest.state === "PRS_CREATED"
      ? 6
      : quest.state === "READY_FOR_PR"
        ? 5
        : quest.state === "EXECUTING"
          ? 4
          : quest.state === "TASKS_PUBLISHED"
            ? 3
            : quest.state.startsWith("PLAN")
              ? 2
              : quest.state.startsWith("TRD")
                ? 1
                : 0;
  const tabs = ["overview", "tasks", "repositories", "artifacts", "activity"];
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
        next += button(
          "Publish Tasks to Jira",
          "PUBLISH_JIRA",
          { "quest-id": id },
          "primary",
        );
    }
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
    body = `<div class="grid-main"><div class="stack">${panel("Next step", `<div class="panel-body"><p>${quest.state === "PRS_CREATED" ? "All pull requests have been created. This Quest is complete." : active ? "An agent session needs to finish or continue." : "Review your artifacts and choose the next action."}</p><div class="toolbar">${next}${next ? runtime : ""}</div>${quest.warnings?.length ? `<div class="warning">${quest.warnings.map(esc).join("<br>")}<label class="checks"><input type="checkbox" id="accept-warnings">Continue with incomplete source context</label></div>` : ""}</div>`)}${panel("Quest brief", `<pre class="document">${esc(artifact(id, quest.kind === "PRODUCT" ? "prd" : "technical-brief")?.content || artifact(id, "idea")?.content || "")}</pre>`)}${runs.slice(-2).reverse().map(runCard).join("")}</div><div class="stack">${panel("At a glance", `<div class="panel-body"><div class="row-meta">${badge(quest.state)}</div><div class="progress-row">${bar(pct(quest))}<span>${pct(quest)}%</span></div><p class="section-space">${tasks.length} tasks · ${works.length} repository works</p><small>${esc(quest.sprint || "No sprint assigned")}</small></div>`)}${panel("Affected repositories", `<div class="source-list">${quest.repositoryIds.map((key) => `<p>▱ ${esc(repository(key)?.name)}</p>`).join("")}</div>`)}${quest.sources?.length ? panel("Context loaded", `<div class="source-list">${quest.sources.map((source) => `<p><a href="${safeUrl(source.url)}" target="_blank" rel="noreferrer">${esc(source.title)} ↗</a><small>Version ${esc(source.version)}</small></p>`).join("")}</div>`) : ""}</div></div>`;
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
              `<div class="panel-body"><div class="row-head">${badge(work.state)}<span class="number">⑂ ${esc(work.branch)}</span></div><div class="code">${esc(work.path)}</div>${work.error ? `<div class="warning">${esc(work.error)}</div>` : ""}${work.review ? `<pre class="document">${esc(work.review.summary)}</pre>` : ""}<div class="toolbar">${!work.pr ? `<select aria-label="Reviewer runtime" data-work-runtime="${work.id}">${runtimeOptions()}</select>` : ""}${!work.pr ? button("Review repository", "REVIEW_REPOSITORY", { "quest-id": id, "work-id": work.id }, "small") : ""}${work.review && !work.pr ? button("Approve repository review", "APPROVE_REVIEW", { "quest-id": id, "work-id": work.id }, "small") : ""}${work.state === "READY_FOR_PR" ? button("Create PR → development", "CREATE_PR", { "quest-id": id, "work-id": work.id }, "primary") : ""}${work.pr ? `<a class="btn primary" target="_blank" rel="noreferrer" href="${safeUrl(work.pr.url)}">View pull request ↗</a>` : ""}</div></div>`,
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
  return `${head(quest.title, `${quest.kind === "PRODUCT" ? "Product" : "Tech"} Quest · ${quest.id.slice(0, 8).toUpperCase()}`, '<a class="btn ghost" href="#quests">← All Quests</a>', "QUEST CONTROL CENTER")}<div class="pipeline">${stages.map((name, index) => `<span class="${index < stage ? "done" : index === stage ? "current" : ""}">${index < stage ? "✓" : index + 1} ${name}</span>${index < 5 ? "<span>→</span>" : ""}`).join("")}</div><div class="tabs">${tabs.map((name) => `<a href="#quest/${id}/${name}" class="${tab === name ? "active" : ""}">${name[0].toUpperCase() + name.slice(1)}</a>`).join("")}</div>${body}`;
}
function render() {
  if (!state) return;
  const [route = "home", id, tab] = (location.hash.slice(1) || "home").split(
    "/",
  );
  document
    .querySelectorAll("[data-nav]")
    .forEach((el) =>
      el.classList.toggle(
        "active",
        el.dataset.nav === (route === "quest" ? "quests" : route),
      ),
    );
  $("#breadcrumb").textContent = labels[route] || "Overview";
  $("#quest-count").textContent = state.quests.length;
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
            ) + panel("Repository registry", repoTable())
          : route === "agents"
            ? agents()
            : route === "jira"
              ? jira()
              : route === "settings"
                ? settings()
                : home();
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
    `Edit ${kind === "trd" ? "TRD" : "implementation plan"}`,
    `<input type="hidden" name="questId" value="${questId}"><label>Markdown document<textarea name="content" rows="14" required>${esc((current?.content || "").split("<!-- devquest-tasks")[0])}</textarea><small>Saving a revision invalidates its previous approval.</small></label>${kind === "plan" ? `<label>Tasks (JSON)<textarea name="tasks" rows="10" required>${esc(JSON.stringify(tasks.length ? tasks : template, null, 2))}</textarea><small>Use repository IDs below. Profiles: node-test, npm-test, go-test, pytest. Dependencies reference task IDs.</small></label><div class="code">${state.repositories.map((r) => `${esc(r.name)}: ${r.id}`).join("\n")}</div>` : ""}`,
    `edit-${kind}`,
    "Save draft",
  );
}
document.addEventListener("change", (event) => {
  if (event.target.name === "sourceType")
    document
      .querySelectorAll("[data-source]")
      .forEach((el) => (el.hidden = el.dataset.source !== event.target.value));
});
document.addEventListener("click", async (event) => {
  const target = event.target.closest("[data-action]");
  if (!target) return;
  const type = target.dataset.action;
  if (type === "new-quest") return newQuest();
  if (type === "add-repository") return addRepository();
  if (type === "close-dialog") return $("#dialog").close();
  if (type === "edit-trd" || type === "edit-plan")
    return editArtifact(type.slice(5), target.dataset.questId);
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
    if (form.dataset.form === "edit-trd")
      await action("SAVE_TRD", {
        questId: values.get("questId"),
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
      if (el) el.textContent = output;
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

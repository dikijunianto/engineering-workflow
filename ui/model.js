export function dashboardData(state, filter = "all") {
  const projects = state.quests || [];
  const deleted = state.deletedQuests || [];
  return {
    active: projects.filter((q) => q.state !== "PRS_CREATED").length,
    running: (state.runs || []).filter((r) => r.state === "RUNNING").length,
    repositories: (state.repositories || []).length,
    projects:
      filter === "archived"
        ? deleted
        : filter === "active"
          ? projects.filter((q) => q.state !== "PRS_CREATED")
          : projects,
  };
}
export function projectStatus(project) {
  if (project.deletedAt) return "Archived";
  if (project.state === "PRS_CREATED") return "PRs created · merge unverified";
  if (project.state === "EXECUTING") return "In Progress";
  return String(project.state || "Draft")
    .toLowerCase()
    .replaceAll("_", " ");
}
export function workspaceSearch(state, query) {
  const term = query.trim().toLowerCase();
  if (!term) return [];
  return [
    ...(state.quests || []).map((q) => ({
      label: q.title,
      type: "Project",
      href: `#quest/${q.id}/overview`,
    })),
    ...(state.repositories || []).map((r) => ({
      label: r.name,
      type: "Repository",
      href: "#repositories",
    })),
  ]
    .filter((item) => item.label.toLowerCase().includes(term))
    .slice(0, 8);
}
export const sampleProjects = [
  {
    id: "sample-api",
    title: "Payment API improvements",
    repositoryIds: ["sample-repo"],
    state: "EXECUTING",
    sampleAgents: 2,
  },
  {
    id: "sample-auth",
    title: "Authentication cleanup",
    repositoryIds: ["sample-repo"],
    state: "PRS_CREATED",
    sampleAgents: 0,
  },
];

// Summarize only saved text; never infer success from a completed agent process.
export function roomSummary(body) {
  const text = typeof body === "string" ? body : JSON.stringify(body ?? "");
  let readable = text;
  try {
    const parsed = JSON.parse(text);
    readable = [parsed.summary, parsed.result, parsed.message, parsed.error]
      .find(value => typeof value === "string") || "Structured agent output — expand for details.";
  } catch {
    // Saved tails can start midway through JSON; do not show that as a prose summary.
    if (/"[\w-]+"\s*:\s*["{[\d]|^\s*[{[]/.test(text))
      readable = "Saved structured output — expand for details.";
  }
  return readable.replace(/[#*`]/g, "").replace(/\s+/g, " ").trim().slice(0, 280) +
    (readable.replace(/[#*`]/g, "").replace(/\s+/g, " ").trim().length > 280 ? "…" : "");
}

export function roomGroups(timeline = []) {
  const groups = new Map();
  for (const entry of timeline) {
    const key = entry.runId || entry.resultRunId || entry.successorRunId || entry.id;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(entry);
  }
  return [...groups.entries()].map(([id, entries]) => ({ id, entries }))
    .sort((a, b) => String(b.entries.at(-1)?.createdAt || "").localeCompare(String(a.entries.at(-1)?.createdAt || "")));
}

export function currentAttentionRuns(state, questId) {
  const latest = new Map();
  for (const run of [...(state.runs || [])].sort((a,b) => String(a.createdAt).localeCompare(String(b.createdAt))))
    latest.set(`${run.questId}:${run.role}:${run.purpose || run.stage}:${run.taskId || run.workId || ""}`,run);
  return [...latest.values()].filter(run => {
    if (questId && run.questId !== questId) return false;
    if (run.replacedBy || !["FAILED","WAITING_INPUT","INTERRUPTED","PAUSED"].includes(run.state)) return false;
    const quest = state.quests.find(q => q.id === run.questId);
    const task = state.tasks?.find(t => t.id === run.taskId);
    const work = state.works?.find(w => w.id === run.workId);
    if (!quest || task?.integratedCommit || ["COMPLETED","PASSED"].includes(task?.state)) return false;
    return run.state === "WAITING_INPUT" || (quest.state !== "PRS_CREATED" && work?.state !== "PR_CREATED");
  });
}

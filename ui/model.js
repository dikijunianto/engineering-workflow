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
  if (project.state === "PRS_CREATED") return "Completed";
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

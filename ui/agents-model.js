export const agentRoles = [
  {
    key: "orchestrator",
    name: "Orchestrator",
    description: "Coordinates project pipelines and complexity-aware routing.",
  },
  {
    key: "architect",
    name: "Architect",
    description: "System architecture, repository analysis and technical design.",
  },
  {
    key: "planner",
    name: "Planner",
    description: "Turns approved designs into implementation tasks and dependencies.",
  },
  {
    key: "developer",
    name: "Developer",
    description: "Implements and refactors code in assigned task worktrees.",
  },
  {
    key: "reviewer",
    name: "Reviewer",
    description: "Independent security, correctness and production readiness review.",
  },
  {
    key: "jira-specialist",
    name: "Jira Specialist",
    description: "Generates reviewable appendices; publishing requires separate approval.",
  },
];
export function agentRole(run) {
  if (
    run.purpose === "jira_appendix_generation" ||
    ["jira_appendix", "jira-specialist"].includes(run.role)
  )
    return "jira-specialist";
  if (agentRoles.some((role) => role.key === run.role)) return run.role;
  return (
    {
      brainstorm: "architect",
      analysis: "architect",
      trd: "architect",
      plan: "planner",
      review: "reviewer",
      "v11-review": "reviewer",
      "v11-route": "orchestrator",
    }[run.purpose] || "developer"
  );
}
export function sessionGroups(runs) {
  const latest = new Map();
  for (const run of runs)
    latest.set(JSON.stringify([run.questId, run.purpose, run.taskId || run.workId || null]), run);
  const active = runs.filter((run) => run.state === "RUNNING");
  const attention = [...latest.values()].filter((run) =>
    ["WAITING_INPUT", "FAILED", "BLOCKED", "PAUSED", "INTERRUPTED"].includes(run.state),
  );
  return {
    active,
    attention,
    history: runs
      .filter((run) => !active.includes(run) && !attention.includes(run))
      .slice()
      .reverse(),
  };
}
export function roleMapping(state, role) {
  const models = [
    ...new Set(
      state.quests
        .map((quest) =>
          role === "orchestrator"
            ? quest.execution?.routing?.orchestrator?.model
            : quest.execution?.roles?.[role]?.model,
        )
        .filter(Boolean),
    ),
  ];
  return models.length
    ? models.join(" / ")
    : role === "jira-specialist"
      ? "Native skill · Atlassian MCP"
      : "Inherited model policy";
}
export function duration(run, now = Date.now()) {
  const start = Date.parse(run.startedAt || run.createdAt);
  if (!Number.isFinite(start)) return "Not recorded";
  const end = run.state === "RUNNING" ? now : Date.parse(run.finishedAt || run.updatedAt);
  if (!Number.isFinite(end)) return "Not recorded";
  const seconds = Math.max(0, Math.floor((end - start) / 1000));
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

export const COMPLEXITIES = [
  "TRIVIAL",
  "SIMPLE",
  "MODERATE",
  "COMPLEX",
  "VERY_COMPLEX",
  "CRITICAL",
];
export const RISKS = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];
export const ROLES = ["architect", "planner", "developer", "reviewer"];
export const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};
export const runtimeName = (name) => (name === "claude-code" ? "claude" : name);
export function modelId(value) {
  assert(
    typeof value === "string" &&
      /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,159}$/.test(value),
    "Invalid model identifier",
  );
  assert(!/fable/i.test(value), "Fable is forbidden by workspace policy");
  assert(
    !/^(best|default|inherit|opusplan)$/i.test(value),
    "Use an explicit verified model ID; automatic model aliases are forbidden",
  );
  return value;
}
export function runtimeId(value) {
  const name = runtimeName(value);
  assert(["claude", "codex"].includes(name), "Unsupported agent runtime");
  return name;
}
const integer = (value, fallback, min, max, label) => {
  const result = value ?? fallback;
  assert(
    Number.isInteger(result) && result >= min && result <= max,
    `Invalid ${label}: expected ${min}–${max}`,
  );
  return result;
};
export function epicInput(value) {
  if (!value) return { epicKey: "", epicUrl: "" };
  assert(
    typeof value === "string" && value.length <= 2048,
    "Invalid Jira Epic",
  );
  let key = value.trim().toUpperCase(),
    url = "";
  if (/^https:\/\//i.test(value)) {
    const parsed = new URL(value);
    assert(
      !parsed.username && !parsed.password && !parsed.search && !parsed.hash,
      "Use a Jira Epic URL without credentials, query or fragment",
    );
    key = parsed.pathname
      .match(/^\/browse\/([A-Za-z][A-Za-z0-9_]*-\d+)\/?$/)?.[1]
      ?.toUpperCase();
    url = parsed.href;
  }
  assert(
    typeof key === "string" && /^[A-Z][A-Z0-9_]*-\d+$/.test(key),
    "Use a Jira Epic key or HTTPS /browse/ URL",
  );
  return { epicKey: key, epicUrl: url };
}
export function executionConfig(input = {}, workspace = {}) {
  assert(
    input && typeof input === "object" && !Array.isArray(input),
    "Invalid execution configuration",
  );
  const runtime = runtimeId(input.runtime || "claude");
  assert(
    !input.mode || ["guided", "autonomous"].includes(input.mode),
    "Invalid execution mode",
  );
  const routing = input.routing || {};
  assert(
    ["manual", "dynamic"].includes(routing.mode || "manual"),
    "Invalid routing mode",
  );
  const roleConfig = {};
  for (const role of ROLES) {
    const value = input.roles?.[role] || {};
    roleConfig[role] = {
      runtime:
        value.runtime && value.runtime !== "inherit"
          ? runtimeId(value.runtime)
          : "inherit",
      ...(value.model ? { model: modelId(value.model) } : {}),
      ...(value.effort ? { effort: value.effort } : {}),
    };
    if (value.effort)
      assert(
        ["low", "medium", "high", "xhigh", "max"].includes(value.effort),
        "Invalid role effort",
      );
  }
  const orchestrator = routing.orchestrator || {};
  for (const effort of [routing.effort, orchestrator.effort].filter(Boolean))
    assert(
      ["low", "medium", "high", "xhigh", "max"].includes(effort),
      "Invalid effort",
    );
  const limits = input.limits || {};
  return {
    runtime,
    roles: roleConfig,
    mode: input.mode === "autonomous" ? "autonomous" : "guided",
    permissions: {
      publishJira: input.permissions?.publishJira === true,
      createPr: input.permissions?.createPr === true,
    },
    routing: {
      mode: routing.mode || "manual",
      ...(routing.model ? { model: modelId(routing.model) } : {}),
      effort: routing.effort || "high",
      orchestrator: {
        runtime: runtimeId(orchestrator.runtime || "claude"),
        model: modelId(orchestrator.model || "claude-opus-5-5"),
        effort: orchestrator.effort || "high",
      },
    },
    limits: {
      developers: integer(
        limits.developers,
        Math.min(5, workspace.maxConcurrentDeveloperAgents || 5),
        1,
        Math.min(5, workspace.maxConcurrentDeveloperAgents || 5),
        "developer limit",
      ),
      taskMinutes: integer(limits.taskMinutes, 60, 1, 240, "task duration"),
      retries: integer(limits.retries, 2, 0, 10, "retry limit"),
      escalations: integer(limits.escalations, 2, 0, 2, "escalation limit"),
      reviewCycles: integer(limits.reviewCycles, 3, 0, 3, "review cycle limit"),
      ...(limits.tokens != null
        ? { tokens: integer(limits.tokens, 0, 1, 100000000, "token budget") }
        : {}),
    },
    nestedSpawning: false,
  };
}
export function assessment(value, taskId) {
  assert(
    value &&
      value.taskId === taskId &&
      COMPLEXITIES.includes(value.complexity) &&
      RISKS.includes(value.risk),
    "Invalid task complexity/risk assessment",
  );
  assert(
    typeof value.reason === "string" &&
      value.reason.trim() &&
      value.reason.length <= 4000,
    "Routing reason is required",
  );
  assert(
    Number.isFinite(value.confidence) &&
      value.confidence >= 0 &&
      value.confidence <= 1,
    "Invalid routing confidence",
  );
  if (value.recommendedModel) modelId(value.recommendedModel);
  assert(
    ["haiku", "sonnet", "opus", "gpt"].includes(value.recommendedModelFamily),
    "Forbidden or unknown model family",
  );
  if (value.recommendedRuntime) runtimeId(value.recommendedRuntime);
  assert(
    ["low", "medium", "high", "xhigh", "max"].includes(value.recommendedEffort),
    "Invalid recommended effort",
  );
  return value;
}
const defaults = {
  TRIVIAL: ["haiku", "low"],
  SIMPLE: ["haiku", "medium"],
  MODERATE: ["sonnet", "medium"],
  COMPLEX: ["sonnet", "high"],
  VERY_COMPLEX: ["opus", "high"],
  CRITICAL: ["opus", "high"],
};
const rank = { haiku: 0, sonnet: 1, opus: 2, gpt: 2 };
export function resolveRoute(
  config,
  role,
  decision,
  registry = [],
  policy = {},
) {
  for (const fallbacks of Object.values(policy.fallbacks || {})) {
    assert(Array.isArray(fallbacks), "Invalid permitted model fallbacks");
    for (const fallback of fallbacks) modelId(fallback);
  }
  const override = config.roles?.[role] || {};
  const runtime = runtimeId(
    role === "orchestrator"
      ? config.routing.orchestrator.runtime
      : override.runtime && override.runtime !== "inherit"
        ? override.runtime
        : role === "reviewer" && config.roles.developer.runtime !== "inherit"
          ? config.roles.developer.runtime
          : config.runtime,
  );
  let [family, effort] = defaults[decision?.complexity || "MODERATE"];
  if (["HIGH", "CRITICAL"].includes(decision?.risk))
    [family, effort] = ["opus", "high"];
  if (role === "reviewer")
    [family, effort] = [
      ["HIGH", "CRITICAL"].includes(decision?.risk) ? "opus" : "sonnet",
      "high",
    ];
  const recommended = policy.routes?.[role] || decision;
  if (recommended?.recommendedModelFamily && role !== "reviewer")
    family = recommended.recommendedModelFamily;
  effort =
    (config.routing.model ? config.routing.effort : undefined) ||
    override.effort ||
    policy.routes?.[role]?.effort ||
    (config.routing.mode === "manual" ? config.routing.effort : undefined) ||
    (role === "reviewer" ? "high" : recommended?.recommendedEffort) ||
    effort;
  let requested =
    config.routing.model ||
    override.model ||
    policy.routes?.[role]?.model ||
    recommended?.recommendedModel;
  if (role === "orchestrator") {
    requested = config.routing.orchestrator.model;
    effort = config.routing.orchestrator.effort;
    family = "opus";
  } else if (config.routing.mode === "manual" && !requested)
    requested = registry.find(
      (m) =>
        m.runtime === runtime &&
        m.family === (role === "reviewer" ? family : "sonnet") &&
        m.available,
    )?.id;
  if (requested) modelId(requested);
  const allowed = registry.filter((m) => {
    modelId(m.id);
    return (
      m.runtime === runtime &&
      m.available === true &&
      m.verified === true &&
      (policy.allowedFamilies || ["haiku", "sonnet", "opus", "gpt"]).includes(
        m.family,
      ) &&
      !(policy.deniedFamilies || []).includes(m.family) &&
      m.family !== "fable"
    );
  });
  let selected = requested
    ? allowed.find((m) => m.id === requested)
    : allowed.find((m) => m.family === family);
  let fallbackReason = "";
  if (
    !selected &&
    role !== "orchestrator" &&
    !config.routing.model &&
    !override.model
  ) {
    selected = allowed.find(
      (m) =>
        (policy.fallbacks?.[family] || []).includes(m.id) &&
        rank[m.family] >= rank[family],
    );
    if (selected)
      fallbackReason = `${family} unavailable; explicitly permitted compatible fallback`;
  }
  assert(
    selected,
    `No verified permitted ${requested || family} model for ${runtime}/${role}. Configure the workspace model registry; no implicit fallback is allowed.`,
  );
  assert(
    Array.isArray(selected.efforts) && selected.efforts.includes(effort),
    `Model ${selected.id} does not support verified effort ${effort}`,
  );
  assert(
    !["HIGH", "CRITICAL"].includes(decision?.risk) ||
      rank[selected.family] >= 2,
    "High-risk work cannot be downgraded",
  );
  return {
    runtime,
    requestedModel: requested || family,
    resolvedModel: modelId(selected.id),
    requestedEffort: effort,
    resolvedEffort: effort,
    family: selected.family,
    reason: fallbackReason || decision?.reason || `Configured ${role} model`,
    fallbackReason,
    complexity: decision?.complexity || "MODERATE",
    risk: decision?.risk || "MEDIUM",
  };
}

export const REVIEW_CATEGORIES = [
  "CORRECTNESS",
  "ARCHITECTURE",
  "SECURITY",
  "RELIABILITY",
  "PERFORMANCE",
  "COMPATIBILITY",
  "TESTING",
  "OPERATIONS",
];
export function productionReview(value, commit) {
  assert(
    value &&
      value.reviewedCommit === commit &&
      /^[a-f0-9]{40,64}$/.test(commit),
    "Review must reference the exact integrated commit",
  );
  assert(
    ["PASSED", "CHANGES_REQUIRED", "BLOCKED", "NEEDS_HUMAN_ATTENTION"].includes(
      value.verdict,
    ),
    "Invalid production review verdict",
  );
  assert(
    Array.isArray(value.findings) && value.findings.length <= 200,
    "Invalid review findings",
  );
  for (const f of value.findings) {
    assert(
      ["CRITICAL", "HIGH", "MEDIUM", "LOW"].includes(f.severity) &&
        REVIEW_CATEGORIES.includes(f.category) &&
        typeof f.blocking === "boolean",
      "Invalid review finding severity/category",
    );
    assert(
      typeof f.description === "string" &&
        f.description.trim() &&
        f.description.length <= 8000 &&
        typeof f.file === "string" &&
        !f.file.includes("\0"),
      "Invalid review finding detail",
    );
  }
  assert(
    value.validation &&
      Object.keys(value.validation).length > 0 &&
      Object.values(value.validation).every((v) =>
        ["PASSED", "FAILED", "NOT_VERIFIED"].includes(v),
      ),
    "Review must include validation evidence or NOT_VERIFIED",
  );
  assert(
    REVIEW_CATEGORIES.every((category) =>
      ["PASSED", "FAILED", "NOT_VERIFIED"].includes(
        value.categories?.[category],
      ),
    ),
    "Review must assess every production-readiness category",
  );
  if (value.verdict === "PASSED")
    assert(
      !value.findings.some(
        (f) => f.blocking || ["HIGH", "CRITICAL"].includes(f.severity),
      ) &&
        !Object.values(value.validation).includes("FAILED") &&
        !Object.values(value.categories).includes("FAILED"),
      "Blocking findings cannot pass production review",
    );
  return value;
}

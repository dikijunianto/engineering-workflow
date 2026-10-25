import { isDeepStrictEqual } from "node:util";
import { jiraContext } from "./jira-project.js";
import { modelId, resolveRoute } from "./routing.js";

const check = (value, message) => {
  if (!value) throw new Error(message);
};
const own = (value, key) => Object.hasOwn(value, key);
const families = ["BE", "MOB", "ALL"];
const tiers = { "Very Low": "V", Low: "L", Medium: "M", High: "H" };
const fields = [
  "siteUrl",
  "projectUrl",
  "assignee",
  "weightReference",
  "categoryFamily",
  "mcpServer",
  "backendWeights",
  "metadataPreferences",
];

export function approvalBasisMatches(recorded, current) {
  try {
    const normalize = value => {
      const basis = JSON.parse(value);
      if (basis.jiraConfig) {
        delete basis.jiraConfig.origins;
        delete basis.jiraConfig.createdAt;
      }
      return basis;
    };
    return isDeepStrictEqual(normalize(recorded), normalize(current));
  } catch {
    return false;
  }
}

export function projectSettings(input) {
  const context = jiraContext(input);
  const categoryFamily = input.categoryFamily || "ALL";
  check(families.includes(categoryFamily), "Select BE, MOB or ALL Appendix categories");
  const mcpServer = input.mcpServer || "atlassian";
  check(/^[A-Za-z0-9_-]{1,80}$/.test(mcpServer), "Invalid Atlassian MCP server name");
  let backendWeights = null;
  if (input.backendWeights) {
    const w = input.backendWeights;
    check(
      w.project === context.project && w.source === "User Confirmed",
      "Backend weights require the selected project and User Confirmed source",
    );
    check(
      /^[0-9]+\.[0-9]+\.[0-9]+$/.test(w.version || ""),
      "Weight reference needs a semantic version",
    );
    check(
      ["V", "L", "M", "H"].every((k) => [1, 2, 4, 8, 16].includes(w.levels?.[k])),
      "Complete numeric Backend V/L/M/H weights before generation",
    );
    backendWeights = {
      project: context.project,
      name: `${context.project} Backend Appendix Weights`,
      version: w.version,
      source: "User Confirmed",
      scale: w.scale || "User Confirmed",
      family: "BE",
      levels: Object.fromEntries(["V", "L", "M", "H"].map((k) => [k, w.levels[k]])),
    };
  }
  const seconds = input.metadataPreferences?.timeoutSeconds ?? 60;
  check(
    Number.isInteger(seconds) && seconds >= 10 && seconds <= 120,
    "Metadata timeout must be 10–120 seconds",
  );
  return {
    ...context,
    categoryFamily,
    mcpServer,
    backendWeights,
    metadataPreferences: { mode: "live", timeoutSeconds: seconds },
  };
}

export function selectAppendixOptions(proof, settings = {}) {
  const family = settings.categoryFamily || "ALL";
  const selected = proof.options.filter(
    (o) => family === "ALL" || o.value.startsWith(family + "-"),
  );
  check(
    selected.length,
    `No applicable ${family} Appendix categories in ${proof.project} Task metadata`,
  );
  return selected.map((option) => {
    if (family === "BE" || (settings.enabled === true && option.value.startsWith("BE-"))) {
      const w = settings.backendWeights;
      check(
        w?.project === proof.project && w.source === "User Confirmed",
        "Configure the project-specific Backend numeric weight reference",
      );
      const tier = option.value.match(/-(Very Low|Low|Medium|High)$/)?.[1];
      const level = tiers[tier] || option.value.match(/^BE-([VLMH])(?:\d|\s|-)/)?.[1];
      check(
        level && w.levels[level],
        `Unmapped Backend category ${option.id}: ${option.value}. Update the weight reference; no generation started`,
      );
      return { ...option, points: w.levels[level], level };
    }
    const level = option.value.match(/^MOB-([VLMH])/)?.[1];
    check(
      level ||
        settings.weightReference ||
        (family === "ALL" &&
          settings.enabled !== true &&
          proof.options.some((o) => /^MOB-[VLMH]/.test(o.value))),
      `Configure the matching weight reference for ${option.id}: ${option.value}`,
    );
    return { ...option, ...(level ? { points: { V: 1, L: 2, M: 4, H: 8 }[level] } : {}) };
  });
}

export class JiraSettings {
  constructor(engine) {
    this.e = engine;
  }
  workspace() {
    return (
      this.e.store.get("settings", "jira-workspace") || {
        id: "jira-workspace",
        version: 0,
        defaultProject: "",
        projects: {},
      }
    );
  }
  save(input) {
    const previous = this.workspace();
    check(
      input.expectedVersion === previous.version,
      "Workspace Jira settings changed; reload before saving",
    );
    const project = projectSettings(input);
    check(
      project.siteUrl && project.projectUrl,
      "Workspace Jira settings require a site URL and project URL",
    );
    const repositoryIds = input.repositoryIds || [];
    check(
      Array.isArray(repositoryIds) &&
        repositoryIds.every((id) => this.e.store.get("repositories", id)),
      "Invalid Jira project repository association",
    );
    const record = {
      ...previous,
      version: previous.version + 1,
      defaultProject: input.makeDefault === false ? previous.defaultProject : project.project,
      projects: {
        ...previous.projects,
        [project.project]: { ...project, epic: "", repositoryIds: [...new Set(repositoryIds)] },
      },
      updatedAt: new Date().toISOString(),
    };
    this.e.store.put("settings", record);
    this.e.log(
      null,
      `Workspace Jira project ${project.project} saved (version ${record.version}); existing Quests unchanged`,
    );
    return record;
  }
  resolve(input = {}, repositories = [], previous) {
    const workspace = this.workspace();
    if (input.enabled === false)
      return {
        jiraConfig: {
          schemaVersion: 1,
          enabled: false,
          explicitlyDisabled: true,
          createdAt: new Date().toISOString(),
        },
      };
    const matches = Object.values(workspace.projects).filter((p) =>
      p.repositoryIds?.some((id) => repositories.includes(id)),
    );
    const projects = [...new Set(matches.map((p) => p.project))];
    check(
      input.project || projects.length <= 1,
      "Selected repositories use different Jira projects; select an explicit Quest project",
    );
    const project = String(input.project || projects[0] || workspace.defaultProject).trim();
    if (!project && input.enabled !== true)
      return {
        jiraConfig: { schemaVersion: 1, enabled: false, createdAt: new Date().toISOString() },
      };
    const same = previous?.jiraContext?.project === project;
    const base = workspace.projects[project] || { project };
    const values = {
      ...base,
      ...(same ? { ...previous.jiraConfig, ...previous.jiraContext } : {}),
      ...input,
      project,
    };
    const settings = projectSettings(values);
    if (input.enabled === true && !previous)
      check(
        settings.siteUrl && settings.projectUrl,
        "Jira integration requires a site URL and project URL",
      );
    const origins = Object.fromEntries(
      fields.map((key) => [
        key,
        own(input, key)
          ? "quest"
          : same && previous.jiraConfig?.origins?.[key] === "quest"
            ? "quest"
            : base[key] !== undefined
              ? `project:${project}`
              : "application",
      ]),
    );
    const policy = this.e.adapters.config?.orchestration?.routes?.["jira-specialist"] || {};
    const configured =
      policy.model ||
      this.e.adapters.config?.orchestration?.models?.find(
        (m) => m.runtime === "claude" && m.family === "sonnet" && m.available && m.verified,
      )?.id;
    const generationPolicy = (same && previous.jiraConfig?.generationPolicy) || {
      runtime: "claude",
      ...(configured ? { model: modelId(configured) } : {}),
      effort: policy.effort || "medium",
    };
    return {
      jiraContext: jiraContext({
        ...settings,
        epic: own(input, "epic") ? input.epic : same ? previous.jiraContext.epic : "",
      }),
      jiraConfig: {
        schemaVersion: 1,
        enabled: true,
        workspaceVersion: workspace.version,
        project,
        categoryFamily: settings.categoryFamily,
        mcpServer: settings.mcpServer,
        backendWeights: settings.backendWeights,
        metadataPreferences: settings.metadataPreferences,
        generationPolicy,
        origins: {
          ...origins,
          project: input.project ? "quest" : projects.length ? "repository-project" : "workspace",
          generationPolicy: "workspace-agent-policy",
          epic: "quest",
        },
        weightReferenceVersion: settings.backendWeights?.version || null,
        createdAt: new Date().toISOString(),
      },
    };
  }
  editable(quest) {
    const ignored = this.e.store
      .all("runs")
      .filter(
        (r) =>
          r.questId === quest.id &&
          r.purpose === "jira_appendix_generation" &&
          !this.e.jobs.has(r.id) &&
          !this.e.appendixAgent.status(r).recoveryBlocked,
      )
      .map((r) => r.id);
    this.e.editable(quest.id, ignored);
  }
  saveQuest(quest, input, refresh = false) {
    this.editable(quest);
    const overrides = refresh
      ? Object.fromEntries(
          fields
            .filter(
              (k) =>
                quest.jiraConfig?.origins?.[k] === "quest" ||
                (!quest.jiraConfig?.enabled && quest.jiraContext?.[k]),
            )
            .map((k) => [k, quest.jiraContext?.[k] ?? quest.jiraConfig?.[k]]),
        )
      : Object.fromEntries(
          Object.entries(input).filter(
            ([key, value]) =>
              !fields.includes(key) ||
              JSON.stringify(value) !==
                JSON.stringify(quest.jiraContext?.[key] ?? quest.jiraConfig?.[key]),
          ),
        );
    const result = this.resolve(
      {
        ...overrides,
        project: input.project || quest.jiraContext?.project,
        epic: input.epic ?? quest.jiraContext?.epic ?? "",
        enabled: true,
      },
      quest.repositoryIds,
      refresh ? { jiraContext: { project: input.project || quest.jiraContext?.project } } : quest,
    );
    const unchanged = approvalBasisMatches(
      JSON.stringify({ jiraContext: quest.jiraContext, jiraConfig: quest.jiraConfig }),
      JSON.stringify(result),
    );
    return this.e.put("quests", quest, {
      ...result, jiraMetadata: unchanged ? quest.jiraMetadata : null,
      autoExecute: false,
    });
  }
  route(quest) {
    const base = quest.execution || this.e.v11.config();
    const chosen = quest.jiraConfig?.generationPolicy;
    check(
      !chosen || chosen.model || base.roles?.planner?.model || base.routing?.model,
      "No verified permitted Sonnet model for Jira Specialist. Configure its agent model policy; no automatic upgrade is allowed",
    );
    return resolveRoute(
      {
        ...base,
        runtime: "claude",
        routing: base.routing,
        roles: {
          ...base.roles,
          planner: {
            ...(chosen?.model ? { model: chosen.model } : {}),
            ...(chosen
              ? {
                  effort:
                    quest.execution && base.routing.mode === "manual"
                      ? base.routing.effort
                      : chosen.effort,
                }
              : {}),
            ...base.roles?.planner,
            runtime: "claude",
          },
        },
      },
      "planner",
      undefined,
      this.e.adapters.config?.orchestration?.models || [],
      this.e.adapters.config?.orchestration || {},
    );
  }
  validationOptions(quest) {
    if (!quest.jiraConfig?.enabled || quest.jiraConfig.categoryFamily === "ALL") return undefined;
    const artifact = this.e.store.latest(quest.id, "appendix");
    // Older settings saves cleared this pointer even when only provenance changed.
    const metadata = quest.jiraMetadata ||
      (artifact && this.e.hasApproval(quest.id, "appendix", artifact) ? artifact.jiraMetadata : null);
    check(metadata, "Generate with verified project metadata before saving or approving this Appendix");
    return this.e.store.metadataContent(metadata).selectedOptions;
  }
}

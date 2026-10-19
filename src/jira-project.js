import { validateAppendix } from "./appendix-markdown.js";

const check = (condition, message) => {
  if (!condition) throw new Error(message);
};
export function jiraContext(input = {}) {
  const context = Object.fromEntries(
    ["project", "siteUrl", "projectUrl", "epic", "assignee", "weightReference"].map((k) => [
      k,
      String(input[k] || "").trim(),
    ]),
  );
  if (!context.siteUrl) delete context.siteUrl;
  if (!context.projectUrl) delete context.projectUrl;
  check(
    context.project.length <= 80 && /^[A-Z][A-Z0-9_]*$/.test(context.project),
    "Use a valid Jira project key",
  );
  check(
    !context.epic || new RegExp(`^${context.project}-\\d+$`).test(context.epic),
    "Jira Epic must belong to the selected project",
  );
  for (const key of ["siteUrl", "projectUrl"]) {
    if (!context[key]) continue;
    check(context[key].length <= 2048, "Jira URL exceeds the supported size");
    let url;
    try {
      url = new URL(context[key]);
    } catch {}
    check(
      url && url.protocol === "https:" && !url.username && !url.password && !url.hash,
      "Jira URLs must be HTTPS URLs without credentials or fragments",
    );
    check(!url.search || key === "projectUrl", "Jira site URL cannot contain a query");
    if (key === "siteUrl")
      check(url.pathname === "/" && !url.search, "Jira site URL must be a site origin");
    if (key === "projectUrl") {
      const project = url.pathname.match(
        /\/(?:projects|project-config)\/([A-Z][A-Z0-9_]*)(?:\/|$)/,
      )?.[1];
      check(project === context.project, "Jira project URL must identify the selected project");
    }
  }
  if (context.siteUrl && context.projectUrl)
    check(
      new URL(context.siteUrl).origin === new URL(context.projectUrl).origin,
      "Jira site and project URLs must use the same site",
    );
  check(
    context.assignee.length <= 200 && context.weightReference.length <= 100000,
    "Jira options exceed the supported size",
  );
  return context;
}

// MCP wraps Jira JSON in text/content blocks. Only actual successful tool results reach this parser.
export function jiraObjects(value, depth = 0) {
  if (!value || depth > 14) return [];
  if (typeof value === "string") {
    try {
      return jiraObjects(JSON.parse(value), depth + 1);
    } catch {
      return [];
    }
  }
  if (typeof value !== "object") return [];
  return [
    ...(Array.isArray(value) ? [] : [value]),
    ...Object.values(value).flatMap((v) => jiraObjects(v, depth + 1)),
  ];
}
export function jiraIssuePage(content) {
  const objects = jiraObjects(content);
  const rest = objects.find(o => Array.isArray(o.issues));
  if (rest) return rest;
  const connection = objects.find(o => Array.isArray(o.nodes) && typeof o.pageInfo?.hasNextPage === "boolean");
  return connection ? { issues: connection.nodes.map(n => n.issue || n), isLast: !connection.pageInfo.hasNextPage, nextPageToken: connection.pageInfo.endCursor } : null;
}

export function verifyJiraProject(context, markdown, evidence) {
  const denial = evidence.find((e) => e.error);
  check(
    !denial,
    `Jira read-only verification failed (${denial?.method}): ${typeof denial?.content === "string" ? denial.content.slice(0, 600) : JSON.stringify(denial?.content)?.slice(0, 600)}. Check Atlassian authentication/permissions; no publication attempted.`,
  );
  const records = (method, predicate = () => true) =>
    evidence
      .filter((e) => !e.error && e.method === method && predicate(e.input || {}))
      .flatMap((e) => jiraObjects(e.content));
  const projects = records("getVisibleJiraProjects");
  const project = projects.find((p) => p.key === context.project && p.id);
  check(
    project,
    `Jira project ${context.project} was not verified. Check Atlassian authentication and project visibility; no publication attempted.`,
  );
  const projectCall = evidence.find(
    (e) =>
      !e.error &&
      e.method === "getVisibleJiraProjects" &&
      jiraObjects(e.content).some((p) => p.key === context.project && p.id === project.id),
  );
  const cloudId = projectCall.input?.cloudId;
  check(cloudId, "Jira tenant was not verified; reconnect Atlassian before publication");
  const resources = records("getAccessibleAtlassianResources");
  const resource = resources.find((r) => r.id === cloudId && typeof r.url === "string");
  check(resource, "Jira site URL was not verified against the selected tenant");
  let site;
  try {
    site = new URL(resource.url);
  } catch {}
  check(site?.protocol === "https:", "Jira returned an invalid site URL");
  for (const key of ["siteUrl", "projectUrl"])
    if (context[key])
      check(
        new URL(context[key]).origin === site.origin,
        "Saved Jira URL does not match the authenticated target site",
      );
  const scoped = (args) =>
    args.cloudId === cloudId &&
    [context.project, String(project.id)].includes(String(args.projectIdOrKey));
  const type = records("getJiraProjectIssueTypesMetadata", scoped).find(
    (t) => t.name === "Task" && t.id && !t.subtask,
  );
  check(
    type,
    `Jira Task create metadata unavailable for ${context.project}; verify Create issues permission and issue types`,
  );
  const fields = records(
    "getJiraIssueTypeMetaWithFields",
    (args) => scoped(args) && String(args.issueTypeId) === String(type.id),
  );
  const pages = fields.filter(
    (f) => Array.isArray(f.values) && Number.isInteger(f.startAt) && Number.isInteger(f.total),
  );
  if (pages.length) {
    let covered = 0;
    for (const page of pages.sort((a, b) => a.startAt - b.startAt)) {
      check(
        page.startAt <= covered,
        "Jira field metadata pagination is incomplete; fetch every page before publishing",
      );
      covered = Math.max(covered, page.startAt + page.values.length);
    }
    check(
      covered >= Math.max(...pages.map((p) => p.total)),
      "Jira field metadata pagination is incomplete; fetch every page before publishing",
    );
  }
  const fieldMap = new Map();
  for (const object of fields) {
    if (object.fieldId || object.key) fieldMap.set(object.fieldId || object.key, object);
    for (const [id, field] of Object.entries(object))
      if (
        field &&
        typeof field === "object" &&
        !Array.isArray(field) &&
        (field.schema || typeof field.required === "boolean")
      )
        fieldMap.set(id, field);
  }
  const appendix = fieldMap.get("customfield_11543");
  check(
    appendix?.schema?.type === "array" && appendix.schema.items === "option",
    "Choose Appendix (v3) customfield_11543 must be an available multiselect field for this project",
  );
  const options = appendix.allowedValues?.filter((o) => !o.disabled);
  check(
    options?.length,
    "Live Jira Appendix categories are missing or inaccessible; no categories inferred",
  );
  validateAppendix(markdown, options);
  const weight = [...fieldMap].find(
    ([, f]) => /^weight points?$/i.test(f.name || "") && f.schema?.type === "number",
  );
  const storyFields = [...fieldMap].filter(
    ([, f]) => /^story point type(?: \(v2\))?$/i.test(f.name || "") && ["option", "option-with-child"].includes(f.schema?.type),
  );
  const story = storyFields.find(([, f]) => /\(v2\)$/i.test(f.name)) || storyFields[0];
  const technical = story?.[1].allowedValues?.find((o) => o.value === "Technical" && !o.disabled);
  check(
    weight && technical?.id,
    "Target Jira Task metadata must expose Weight Points and a valid Technical Story Point Type option",
  );
  const parent = fieldMap.has("parent") ? ["parent", fieldMap.get("parent")]
    : [...fieldMap].find(([, f]) => /epic link/i.test(f.name || ""));
  check(parent, "Target Jira Task metadata does not expose a verified Epic parent/link field");
  // Optional configuration stays optional; the unchanged upload skill requires these before creation.
  check(
    context.epic && context.assignee,
    "Installed upload skill requires an Epic and assignee before publishing; save these Jira settings first",
  );
  const epic = records(
    "getJiraIssue",
    (args) => args.cloudId === cloudId && args.issueIdOrKey === context.epic,
  ).find((i) => i.key === context.epic);
  check(
    epic?.fields?.project?.key === context.project && epic.fields.issuetype?.name === "Epic",
    "Selected Epic was not verified as an Epic in the intended Jira project",
  );
  for (const [id, field] of [["customfield_11543", appendix], weight, story, parent]) {
    check(
      !Array.isArray(field.operations) || field.operations.includes("set"),
      `Jira field ${field.name || id} cannot be set for the selected project`,
    );
  }
  const supplied = new Set([
    "project",
    "issuetype",
    "summary",
    "description",
    "assignee",
    "customfield_11543",
    weight[0],
    story[0],
    parent[0],
  ]);
  const missing = [...fieldMap]
    .filter(([id, f]) => f.required && !f.hasDefaultValue && !supplied.has(id))
    .map(([id, f]) => f.name || id);
  check(
    !missing.length,
    `Additional required Jira fields need values before publishing: ${missing.join(", ")}`,
  );
  const verifiedProjectUrl =
    typeof project.projectUrl === "string"
      ? project.projectUrl
      : typeof project.url === "string"
        ? project.url
        : "";
  let projectUrl = context.projectUrl;
  if (!projectUrl && verifiedProjectUrl) {
    try {
      projectUrl = jiraContext({
        ...context,
        siteUrl: site.origin,
        projectUrl: verifiedProjectUrl,
      }).projectUrl;
    } catch {}
  }
  return {
    project: context.project,
    projectId: String(project.id),
    cloudId,
    siteUrl: site.origin,
    ...(projectUrl ? { projectUrl } : {}),
    issueTypeId: String(type.id),
    appendixField: "customfield_11543",
    weightField: weight[0],
    storyTypeField: story[0],
    technicalOptionId: String(technical.id),
    parentField: parent[0],
    requiredFields: [...fieldMap].filter(([, f]) => f.required).map(([id]) => id),
    permissionEvidence:
      "Successful target-project Task create-metadata responses (Create issues permission required)",
    verifiedAt: new Date().toISOString(),
  };
}

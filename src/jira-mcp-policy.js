import { fileURLToPath } from "node:url";
import { writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
export const jiraMetadataReads = [
  "getAccessibleAtlassianResources",
  "getVisibleJiraProjects",
  "getJiraProjectIssueTypesMetadata",
  "getJiraIssueTypeMetaWithFields",
];
export const jiraPublishReads = [
  ...jiraMetadataReads,
  "getJiraIssue",
  "lookupJiraAccountId",
  "searchJiraIssuesUsingJql",
];
export function mcpDecision(policy, tool, input = {}) {
  const prefix = `mcp__${policy.server}__`;
  if (!tool.startsWith(prefix)) return false;
  const method = tool.slice(prefix.length);
  const cloudMatches = !policy.cloudId || input.cloudId === policy.cloudId || [policy.siteUrl, policy.siteUrl ? policy.siteUrl + "/" : null].filter(Boolean).includes(input.cloudId);
  if (method !== "getAccessibleAtlassianResources" && !cloudMatches) return false;
  const reads = policy.stage === "appendix" ? jiraMetadataReads : jiraPublishReads;
  if (reads.includes(method)) {
    if (policy.stage === "appendix" && method === "getVisibleJiraProjects") return input.searchString === policy.project && input.expandIssueTypes === false;
    if (method === "getJiraIssueTypeMetaWithFields" && input.requiredFieldsOnly !== false) return false;
    if (["getJiraProjectIssueTypesMetadata", "getJiraIssueTypeMetaWithFields"].includes(method))
      return [policy.project, policy.projectId]
        .filter(Boolean)
        .includes(String(input.projectIdOrKey));
    return true;
  }
  return (
    policy.stage === "publish" &&
    !!policy.cloudId &&
    method === "createJiraIssue" &&
    input.projectKey === policy.project &&
    policy.taskIds?.includes(String(input.summary || "").match(/^(T[\w-]+\.\d+) — /)?.[1]) &&
    (!policy.issueMarkers || Object.entries(policy.issueMarkers).some(([id, marker]) =>
      input.summary.startsWith(id + " — ") && new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "(?![\\w.-])").test(String(input.description || ""))))
  );
}
const quote = (s) => "'" + s.replaceAll("'", "'\\''") + "'";
export function mcpGuardSettings(policy) {
  if (
    !/^[\w-]+$/.test(policy.server) ||
    !/^[A-Z][A-Z0-9_]*$/.test(policy.project) ||
    !["appendix", "verify", "publish"].includes(policy.stage)
  )
    throw new Error("Invalid managed Jira MCP policy");
  const command = [
    process.execPath,
    fileURLToPath(import.meta.url),
    "--check",
    Buffer.from(JSON.stringify(policy)).toString("base64"),
  ]
    .map(quote)
    .join(" ");
  return {
    PreToolUse: [{ matcher: "mcp__.*", hooks: [{ type: "command", command, timeout: 10 }] }],
  };
}
// Fixed app-owned hook: denies before Claude dispatches the remote MCP call, including unknown tools.
if (process.argv[1] === fileURLToPath(import.meta.url) && process.argv[2] === "--check") {
  try {
    let text = "";
    for await (const part of process.stdin) {
      text += part;
      if (text.length > 100000) throw new Error("oversize");
    }
    const event = JSON.parse(text),
      policy = JSON.parse(Buffer.from(process.argv[3], "base64").toString());
    let allowed = mcpDecision(policy, event.tool_name || "", event.tool_input);
    if (allowed && event.tool_name === `mcp__${policy.server}__createJiraIssue` && policy.reservationDirectory) {
      const card = event.tool_input.summary.match(/^(T[\w-]+\.\d+) — /)[1];
      try {
        writeFileSync(path.join(policy.reservationDirectory, createHash("sha256").update(card).digest("hex")), policy.issueMarkers[card], { flag: "wx", mode: 0o600 });
      } catch { allowed = false; }
    }
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: allowed ? "allow" : "deny",
          permissionDecisionReason: allowed
            ? "Managed Jira stage allowlist"
            : "DevQuest blocked this MCP operation before dispatch: outside the approved Jira stage/task scope",
        },
      }),
    );
  } catch {
    process.stderr.write("DevQuest MCP policy could not verify this operation");
    process.exitCode = 2;
  }
}

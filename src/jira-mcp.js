import { readFile, realpath, lstat } from "node:fs/promises";
import path from "node:path";
import { homedir } from "node:os";
import http from "node:http";
import { randomUUID } from "node:crypto";
import { jiraObjects } from "./jira-project.js";
import { appendixOptions } from "./appendix-markdown.js";
import { jiraMetadataReads } from "./jira-mcp-policy.js";

// Claude retains its own OAuth store. A loopback-only deterministic API drives MCP, not a paid model.
export async function preflightJiraMcp({
  start,
  prepared,
  context,
  route,
  signal,
  timeoutMs = 60000,
  requireSkillProof = false,
  afterMetadata,
  configDirectory = path.join(homedir(), ".claude"),
}) {
  const evidence = [],
    seen = new Set();
  let inventory,
    status,
    initializationErrors = [],
    sessionId,
    pending,
    failure,
    result,
    requests = 0,
    requestedModel = route?.resolvedModel,
    skillRegistered = false,
    skillInvoked = false;
  const full = (method) => `mcp__${prepared.mcpGuard.server}__${method}`;
  const objects = (method) =>
    evidence.filter((e) => e.method === method).flatMap((e) => jiraObjects(e.content));
  const lastPage = (method) => evidence.filter((e) => e.method === method).at(-1);
  const nextPage = (method) => {
    const page = jiraObjects(lastPage(method)?.content).find(
      (o) =>
        Number.isInteger(o.startAt) &&
        Number.isInteger(o.total) &&
        (Array.isArray(o.values) || Array.isArray(o.issueTypes) || Array.isArray(o.fields)),
    );
    if (!page) return null;
    const end = page.startAt + (page.values || page.issueTypes || page.fields).length;
    if (end < page.total) {
      if (end <= page.startAt) throw new Error("Jira metadata pagination did not advance");
      return end;
    }
    return null;
  };
  const next = () => {
    if (!inventory) throw new Error("Atlassian MCP tool inventory unavailable");
    for (const method of jiraMetadataReads)
      if (!inventory.some((t) => t.name === full(method)))
        throw new Error(`Required Atlassian read tool unavailable: ${method}`);
    if (!objects("getAccessibleAtlassianResources").length)
      return ["getAccessibleAtlassianResources", {}];
    const resources = [
      ...new Map(
        objects("getAccessibleAtlassianResources")
          .filter((o) => o.id && o.url)
          .map((r) => [r.id + ":" + r.url, r]),
      ).values(),
    ];
    const targetUrl = context.siteUrl || context.projectUrl;
    const matches = resources.filter(
      (r) => !targetUrl || new URL(r.url).origin === new URL(targetUrl).origin,
    );
    if (matches.length !== 1)
      throw new Error(
        "Select a verified Jira site URL; the authenticated tenant is missing or ambiguous",
      );
    const resource = matches[0],
      base = { cloudId: resource.id };
    if (!lastPage("getVisibleJiraProjects"))
      return [
        "getVisibleJiraProjects",
        {
          ...base,
          action: "create",
          searchString: context.project,
          expandIssueTypes: false,
          startAt: 0,
          maxResults: 50,
        },
      ];
    const project = objects("getVisibleJiraProjects").find(
      (p) => p.key === context.project && p.id,
    );
    const projectNext = nextPage("getVisibleJiraProjects");
    if (!project && projectNext !== null)
      return [
        "getVisibleJiraProjects",
        {
          ...base,
          action: "create",
          searchString: context.project,
          expandIssueTypes: false,
          startAt: projectNext,
          maxResults: 50,
        },
      ];
    if (!project)
      throw new Error(
        `Jira project ${context.project} is not available for issue creation to this authenticated user`,
      );
    const scope = { ...base, projectIdOrKey: context.project };
    if (!lastPage("getJiraProjectIssueTypesMetadata"))
      return ["getJiraProjectIssueTypesMetadata", { ...scope, startAt: 0, maxResults: 50 }];
    const task = objects("getJiraProjectIssueTypesMetadata").find(
      (t) => t.name === "Task" && t.id && !t.subtask,
    );
    const typeNext = nextPage("getJiraProjectIssueTypesMetadata");
    if (!task && typeNext !== null)
      return ["getJiraProjectIssueTypesMetadata", { ...scope, startAt: typeNext, maxResults: 50 }];
    if (!task) throw new Error("Jira Task issue type is unavailable for the selected project");
    const fieldArgs = {
      ...scope,
      issueTypeId: String(task.id),
      requiredFieldsOnly: false,
      maxResults: 10,
    };
    if (!lastPage("getJiraIssueTypeMetaWithFields"))
      return ["getJiraIssueTypeMetaWithFields", { ...fieldArgs, startAt: 0 }];
    const fieldNext = nextPage("getJiraIssueTypeMetaWithFields");
    if (fieldNext !== null)
      return ["getJiraIssueTypeMetaWithFields", { ...fieldArgs, startAt: fieldNext }];
    const fieldRows = objects("getJiraIssueTypeMetaWithFields");
    const field =
      fieldRows.find(
        (f) =>
          f.fieldId === "customfield_11543" ||
          f.key === "customfield_11543" ||
          f.id === "customfield_11543",
      ) || fieldRows.find((f) => f.customfield_11543)?.customfield_11543;
    if (!field)
      throw new Error(
        `customfield_11543 is absent from complete ${context.project} Task create metadata (including optional fields)`,
      );
    if (field.schema?.type !== "array" || field.schema.items !== "option")
      throw new Error("Choose Appendix (v3) is not a compatible multiselect field");
    const options = [
      ...new Map(
        evidence
          .flatMap((e) =>
            e.method === "getJiraIssueTypeMetaWithFields" ? appendixOptions(e.content) || [] : [],
          )
          .map((o) => [String(o.id), { id: String(o.id), value: o.value }]),
      ).values(),
    ];
    if (!options.length)
      throw new Error(
        "Choose Appendix (v3) has no enabled options in the selected project/Task context",
      );
    result = {
      status: "READY",
      registered: true,
      connected: true,
      project: context.project,
      projectId: String(project.id),
      cloudId: resource.id,
      siteUrl: resource.url,
      issueTypeId: String(task.id),
      fieldId: "customfield_11543",
      fieldContext: field.context || {
        projectId: String(project.id),
        issueTypeId: String(task.id),
        schema: field.schema,
      },
      options,
      toolNames: inventory
        .filter((t) => t.name.startsWith(`mcp__${prepared.mcpGuard.server}__`))
        .map((t) => t.name),
      permittedTools: prepared.mcpTools,
      writeGuard: "App-owned PreToolUse hook; writes denied before MCP dispatch",
      checkedAt: new Date().toISOString(),
    };
    if (requireSkillProof && !skillInvoked) {
      if (!skillRegistered || !inventory.some((t) => t.name === "Skill"))
        throw new Error(
          "Approved native skill is not registered/invocable in this managed Claude session",
        );
      return ["Skill", { skill: prepared.nativeSkill }];
    }
    result.skillVerified = requireSkillProof ? skillRegistered && skillInvoked : false;
    if (afterMetadata) {
      const request = afterMetadata({ result, evidence, inventory });
      if (request) {
        if (!prepared.mcpTools.includes(full(request[0]))) throw new Error("Publication preflight requested an unapproved read tool");
        return request;
      }
      result.evidence = evidence;
    }
    return null;
  };
  const readOutput = async (content, toolId) => {
    const text = typeof content === "string" ? content : JSON.stringify(content);
    if (!text.includes("<persisted-output>")) return content;
    const rawText = Array.isArray(content)
      ? content
          .filter((c) => c.type === "text")
          .map((c) => c.text)
          .join("\n")
      : content;
    const file = String(rawText).match(/Full output saved to: ([^\r\n]+)/)?.[1];
    if (!file || !/^[0-9a-f-]{36}$/.test(sessionId || ""))
      throw new Error("Cannot verify the native MCP output artifact scope");
    const cwd = await realpath(prepared.artifactDirectory);
    const root = path.join(
      configDirectory,
      "projects",
      cwd.replace(/[^a-zA-Z0-9]/g, "-"),
      sessionId,
      "tool-results",
    );
    const canonicalRoot = await realpath(root),
      target = await realpath(file);
    if (path.dirname(target) !== canonicalRoot ||
        ![toolId + ".json", toolId + ".txt"].includes(path.basename(target)))
      throw new Error("MCP output artifact is outside this preflight's owned session or has an unexpected tool filename");
    const info = await lstat(target);
    if (!info.isFile()) throw new Error("MCP output artifact is not a regular file");
    if (info.size > 2000000)
      throw new Error("MCP output artifact exceeds the 2 MB preflight size limit; narrow or paginate the Jira response");
    return JSON.parse(await readFile(target, "utf8"));
  };
  const secretPath = "/" + randomUUID();
  const api = http.createServer(async (req, res) => {
    try {
      if (req.method !== "POST" || !req.url.startsWith(secretPath + "/v1/")) {
        res.writeHead(404);
        return res.end();
      }
      let raw = "";
      for await (const chunk of req) {
        raw += chunk;
        if (raw.length > 4000000) throw new Error("Local MCP preflight request exceeds limit");
      }
      if (req.url.includes("count_tokens")) return res.end('{"input_tokens":1}');
      if (!req.url.startsWith(secretPath + "/v1/messages")) {
        res.writeHead(404);
        return res.end();
      }
      const body = JSON.parse(raw);
      requestedModel = body.model;
      let blocks = [{ type: "text", text: "Deterministic local MCP preflight complete." }],
        stop = "end_turn";
      // Ancillary CLI requests must not advance the MCP workflow.
      if (body.tools?.some((t) => t.name?.startsWith("mcp__"))) {
        inventory = body.tools;
        for (const message of body.messages || [])
          for (const block of Array.isArray(message.content) ? message.content : []) {
            if (
              block.type !== "tool_result" ||
              block.tool_use_id !== pending?.id ||
              seen.has(block.tool_use_id)
            )
              continue;
            seen.add(block.tool_use_id);
            if (block.is_error)
              throw new Error(
                `Atlassian ${pending.method} failed: ${sanitizeMcpError(block.content)}`,
              );
            if (
              /exceeds maximum allowed tokens|Output has been saved to/.test(
                JSON.stringify(block.content),
              )
            )
              throw new Error(
                "Jira MCP metadata response was truncated; narrow the project/field request before retrying. No paid generation started.",
              );
            if (pending.method === "Skill") {
              skillInvoked = true;
              pending = undefined;
              continue;
            }
            evidence.push({
              method: pending.method,
              input: pending.input,
              content: await readOutput(block.content, pending.id),
            });
            pending = undefined;
          }
        if (pending) throw new Error("Native MCP call did not produce an observable tool result");
        if (++requests > 30)
          throw new Error("Jira metadata preflight exceeded its bounded request limit");
        const job = next();
        if (job) {
          pending = { id: "preflight_" + requests, method: job[0], input: job[1] };
          blocks = [
            {
              type: "tool_use",
              id: pending.id,
              name: pending.method === "Skill" ? "Skill" : full(pending.method),
              input: pending.input,
            },
          ];
          stop = "tool_use";
        }
      } else if (!inventory && body.tools) {
        inventory = body.tools;
        const connected = status?.find((s) => s.name === prepared.mcpGuard.server);
        if (connected?.status !== "connected")
          throw new Error(
            `Atlassian MCP ${connected?.status || "missing"}; use claude mcp get ${prepared.mcpGuard.server} and authenticate the selected connection. ${initializationErrors.join("; ")}`,
          );
        throw new Error("Atlassian MCP connected but required read tools are unavailable");
      }
      reply(res, body.model, blocks, stop);
    } catch (error) {
      failure ||= new Error(sanitizeMcpError(error.message));
      reply(
        res,
        requestedModel,
        [{ type: "text", text: "Preflight blocked. No generation authorized." }],
        "end_turn",
      );
    }
  });
  await new Promise((resolve) => api.listen(0, "127.0.0.1", resolve));
  try {
    await start({
      ...prepared,
      cwd: prepared.artifactDirectory,
      readOnly: true,
      executionPolicy: { nestedSpawning: false },
      route,
      signal,
      timeoutMs,
      localApiUrl: `http://127.0.0.1:${api.address().port}${secretPath}`,
      prompt:
        "Deterministic read-only MCP preflight. No model reasoning, skill generation, repository inspection or issue mutation.",
      onEvent: (event) => {
        if (event.type === "skill-registry") skillRegistered = event.registered === true;
        if (event.type === "mcp-status") {
          status = event.servers;
          initializationErrors = event.errors || [];
          sessionId = event.sessionId;
        }
      },
    });
    if (failure) { failure.jiraReadEvidence = evidence; throw failure; }
    if (!result)
      throw new Error(
        "MCP preflight did not verify actual tools and Jira metadata; paid generation was not started",
      );
    return result;
  } finally {
    api.closeAllConnections();
    await new Promise((resolve) => api.close(resolve));
  }
}
export function sanitizeMcpError(value) {
  return String(typeof value === "string" ? value : JSON.stringify(value))
    .replace(/(https?:\/\/[^\s?"<>]+)\?[^\s"<>]+/g, "$1?[query redacted]")
    .replace(
      /(?:Bearer\s+|(?:access_token|refresh_token|authorization)["\s:=]+)[^\s",}]+/gi,
      "[credential redacted]",
    )
    .slice(0, 800);
}

function reply(res, model, blocks, stop) {
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
  const send = (type, data) =>
    res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
  send("message_start", {
    message: {
      id: "local_mcp",
      type: "message",
      role: "assistant",
      model,
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: 1, output_tokens: 0 },
    },
  });
  blocks.forEach((block, index) => {
    send("content_block_start", {
      index,
      content_block:
        block.type === "tool_use" ? { ...block, input: {} } : { type: "text", text: "" },
    });
    send("content_block_delta", {
      index,
      delta:
        block.type === "tool_use"
          ? { type: "input_json_delta", partial_json: JSON.stringify(block.input) }
          : { type: "text_delta", text: block.text },
    });
    send("content_block_stop", { index });
  });
  send("message_delta", {
    delta: { stop_reason: stop, stop_sequence: null },
    usage: { output_tokens: 1 },
  });
  send("message_stop", {});
  res.end();
}

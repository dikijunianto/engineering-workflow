# User Atlassian MCP access: investigation and fix

## Verified root cause

The failing Appendix AgentRun is `4a8b1292-fe2c-4bde-a4e3-8a689884fccb` (JIRA / JIRA_APPENDIX). Its restricted invocation already supplied a private Atlassian-only `--mcp-config`. The missing-MCP hypothesis is **not supported** by the evidence.

In the failing run's working-directory cache and execution time window, Claude saved a **141,307-byte** `getJiraIssueTypeMetaWithFields` result. Reading that saved JSON confirms `customfield_11543`, **441 enabled options**, and backend option `12915`. The connection had actually retrieved the relevant metadata.

DevQuest's metadata collector inspected the streamed tool-result content, which can be a spill-file notice rather than the full Jira response. It never imported that result and left `jiraAppendixOptions` unset. The run's progress also contains a genuine request for the missing backend weight reference, preceded by explanatory text and then `DEVQUEST_WAITING_INPUT` plus JSON. The decoder only accepted an initial marker, so it could misclassify that question as document output and report missing metadata instead.

A second verified schema detail: `getJiraIssueTypeMetaWithFields.requiredFieldsOnly` defaults to **true**. Optional Appendix fields must be requested explicitly with **false**. This is corrected, but the old cache proves that field discovery itself did succeed in the observed failure.

## Actual runtime comparison

- Claude Code **2.1.300**.
- User configuration: `~/.claude.json`; registered names include atlassian, bitbucket and codegraph. Only atlassian was health-checked or included in managed configuration.
- `claude mcp get atlassian`: **User scope, Connected**, HTTP transport.
- Restricted + strict empty MCP config: **zero MCP servers/tools** in an actual native CLI inventory probe.
- Restricted + explicit Atlassian-only config: **atlassian connected**, source dynamic, **41 actual Atlassian tools**.
- Native authentication remained available when loading the selected connection explicitly. No token was read/exported, printed, or copied into logs. The unrelated browser session's earlier login failure is not evidence of Claude MCP authentication failure.

`--restricted` does not itself prove User MCP is excluded. DevQuest's `--strict-mcp-config` deliberately excludes other sources; the selected connection must be supplied explicitly. See the official [CLI reference](https://code.claude.com/docs/en/cli-reference) and [MCP configuration documentation](https://code.claude.com/docs/en/mcp).

## Managed configuration and enforcement

A private temporary file (0600, within a private temporary directory) contains only:

```json
{"mcpServers":{"atlassian":{"type":"http","url":"https://mcp.atlassian.com/v1/mcp/authv2"}}}
```

The selected existing connection is preserved, including its supported connection options; the entire user config and credential store are never copied. Claude keeps ownership of its existing OAuth storage. The installed skills remain unchanged in their private session-only plugin asset.

Relevant native arguments remain:

```text
--restricted
--strict-mcp-config --mcp-config <private selected-connection file>
--plugin-dir <private unchanged-skill plugin>
--permission-mode dontAsk
--tools Read,Skill
--disallowedTools Agent,Task,TeamCreate,TeamDelete,Bash,NotebookEdit,Edit,Write
--settings <permitted model, denied local writes, app-owned MCP PreToolUse guard>
--allowedTools <Read, exact native Skill, stage-specific named MCP operations>
```

The model still discovers 41 Atlassian tools; discovery is not authorization. The app-owned fixed `PreToolUse` hook enforces the stage allowlist **before remote MCP dispatch**. The agent cannot edit that policy. This does not rely on `--tools`, tool annotations, or prompt compliance.

Generation permits exactly:

1. `mcp__atlassian__getAccessibleAtlassianResources`
2. `mcp__atlassian__getVisibleJiraProjects`
3. `mcp__atlassian__getJiraProjectIssueTypesMetadata`
4. `mcp__atlassian__getJiraIssueTypeMetaWithFields`

Project listing is scoped by selected project search and disables issue-type expansion. Field reads require complete optional-field metadata. Tenant/project checks apply after the tenant is verified.

All other MCP operations are denied for generation, including create/edit/transition issues, comments, worklogs, issue links, Confluence/Compass writes, and unknown future operations. A delete operation is also denied by default (no delete tool was observed in the current 41-tool inventory). Bitbucket and Codegraph are never loaded into this managed session.

Publishing retains the existing exact-artifact approval/hash and uncertain-publication guards. Its MCP policy permits the necessary read methods plus only `createJiraIssue`; creation must target the verified tenant/project and an approved document task ID. General edit/delete/transition operations remain denied. No real publication was tested.

## Preflight before paid generation

The backend now checks registration, connection, actual tool inventory and live project/Task Appendix metadata **before launching a paid Appendix AgentRun**.

It uses the same restricted Claude CLI as the authenticated MCP client. A private loopback Messages-protocol driver emits a bounded, fixed sequence of read calls; no model chooses tools or generates an appendix. Model-provider requests are directed only to that loopback service with dummy model credentials, other provider modes disabled, and no provider fallback. The original MCP OAuth connection remains under Claude's control. This avoids copying or reverse-engineering its credential store.

Preflight narrows project queries, explicitly requests `requiredFieldsOnly=false`, and follows field pagination. If Claude spills a large tool result, the backend imports only the exact JSON output for that tool-call ID under the canonical **current preflight session's** tool-results directory, with file/type/size/containment checks. No agent receives access to `~/.claude`, and arbitrary file references are rejected. Unrecoverable truncation is reported as truncation, not a project permission failure.

Missing/disconnected/unauthenticated servers, unavailable tools, absent/incompatible Appendix fields, empty options and ambiguous tenants stop before paid generation with distinct remediation. Verified options are carried into the new AgentRun rather than discarded when a later streamed result is just a spill notice.

The actual installed skill still generates the Markdown. Existing document validation, revision approval, exact upload input, task IDs and weight preservation remain intact.

## Live FCAD result

The model-free native preflight successfully verified:

- Authenticated site: `https://amarbank.atlassian.net`.
- Project **FCAD**, ID **11337**.
- Task issue type **3**.
- `customfield_11543`: compatible multiselect, applicable in FCAD Task create metadata, **441 enabled options**.
- Example exact option: **12915**, `BE-1. Adding 1 function to existing usecase.-Very Low`.

No real Jira issue was created, edited or transitioned. There were **zero paid Claude/Codex calls**.

The current saved weight reference is empty. The previous agent explicitly requested the backend weight-point reference for BE categories. MCP access does not establish those numeric weights. No backend weights were invented. Supply the matching reference or exact tier-point mapping in Jira settings before generating that backend appendix. Mixed inventories containing MOB categories are not globally forced into a backend reference; the installed skill must use the applicable categories/reference.

## Tests and limitations

Automated localhost MCP/API stubs cover successful preflight, authentication failure, connection failure, missing tools, optional-field requests, invalid/missing Appendix fields, safe spill import, escape/truncation rejection, tenant/project/task write scope and existing Quest recovery. Waiting-input regression reproduces the observed explanatory-text prefix.

An additional **actual Claude 2.1.300** localhost-only test deliberately offered and allowed a fake `createJiraIssue` tool at the CLI permission layer. The app-owned generation hook denied it, and the fake remote server received **zero write calls**. This proves enforcement beyond `--tools`/`--allowedTools`. Script: `scripts/verify-jira-mcp-policy.mjs`.

Paid native skill reasoning and real issue publishing were intentionally not run. The live checks prove MCP connectivity and field context, not a completed appendix or publication. The model-free preflight mechanism is verified on the installed CLI; other runtime versions still require compatibility testing.

Changed implementation: `src/jira-mcp.js`, `src/jira-mcp-policy.js`, `src/adapters.js`, `src/jira-appendix-agent.js`, `src/appendix-markdown.js`, `src/engine.js`; focused tests and the native local-policy verification script. Neither installed user skill changed. No commit, push or PR.

Final validation: **176 tests; 175 passed, one platform skip, zero failures**. Syntax checks and `git diff --check` passed. The native localhost-only write-denial test also passed independently.

The updated app is running at localhost:4310. No active operations or automatic scheduling were present at startup. The existing Quest remains PLAN_APPROVED; **91 artifact files/records and their hashes**, approvals, tasks, work records, operations, events and failed AgentRuns matched before/after (normal Quest updatedAt ignored). The observed failed run remains FAILED with generationActive=false and recoveryBlocked=false. Historical failure was retained; no generation was automatically restarted.

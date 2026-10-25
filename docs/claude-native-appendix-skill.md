> Capture, validation, revision approval and native upload now follow the [Markdown-first contract](jira-appendix-markdown-contract.md). Earlier JSON-only capture details below describe the prior implementation.

# Claude native appendix skill invocation — 2026-10-17

## Verified cause

Existing Quest `12c8b15e-fb7b-436d-a8cf-a277989288af`, failed AgentRun `4f01d822-fc3d-4d7b-a108-12ab09800f31`, returned `Unknown skill: create-appendix-task-list`. Its recorded working directory was the Quest's `versions` directory. The adapter matched that exact Skill-tool name when handling the failed tool result; additional tool arguments were not retained in the old record.

The installed executable is `/opt/homebrew/bin/claude`, resolving to `/opt/homebrew/Caskroom/claude-code@latest/2.1.300/claude`; version 2.1.300. Current DevQuest environment: HOME `/Users/dikijunianto`; CLAUDE_CONFIG_DIR, CLAUDE_CODE_SIMPLE and CLAUDE_CODE_SAFE_MODE unset. Claude auth status names `/Users/dikijunianto/.claude` as its configuration directory and reports claude.ai login. The old run did not retain a historical environment snapshot, so current values are not claimed as historical measurements.

A controlled local `/skills` comparison used the same executable, HOME, empty temporary working directory and Read/Skill tool set:

| Session | Actual registry |
| --- | --- |
| Ordinary session with user settings | 63 skills; `create-appendix-task-list` enabled, source USER |
| `--restricted` session | **No skills found** |
| `--restricted --plugin-dir <approved-plugin>` | **Exactly one skill**, `devquest-jira:create-appendix-task-list` |

Thus **restricted execution suppressing USER-skill discovery caused this mismatch**. Read-only tool permissions alone did not prevent registration: the ordinary session used Read/Skill too. The user skill name and frontmatter matched. There was no missing file or unqualified-name typo in the old run. Filesystem discovery in the previous implementation was insufficient evidence of registration.

These probes used only the local `/skills` and `/exit` builtins. Their three saved transcripts contain zero assistant model messages and zero usage records. No paid generation occurred.

## Actual failed invocation flags

The persisted run contained:

```text
--print --output-format stream-json --verbose
--model claude-sonnet-5-5 --effort medium
--restricted
--disallowedTools Agent,Task,TeamCreate,TeamDelete,Bash,NotebookEdit,Edit,Write
--settings {availableModels:[claude-sonnet-5-5], permissions:{deny:[Agent,Task,TeamCreate,Bash,Edit(//**/.git/**),Write(//**/.git/**),Edit(//**/.claude/**),Write(//**/.claude/**)]}}
--no-session-persistence --permission-mode dontAsk
--tools Read,Skill
--strict-mcp-config --mcp-config [private configuration omitted]
--allowedTools Read,Skill(create-appendix-task-list),[seven read-only Atlassian methods]
```

The displayed settings above are a readable rendering of the recorded JSON. `--bare`, `--safe-mode`, `--disable-slash-commands`, `--setting-sources`, `--plugin-dir` and `--resume` were absent. Explicit settings constrained models/permissions but did not register the personal skill. The failure occurred during a fresh session, so merely starting another fresh session with the old flags would not fix discovery.

## Secure fix

SkillRunner now reads the approved configured SKILL.md completely, validates its frontmatter and freezes its bytes into a private per-run plugin:

```text
approved-skill/
  .claude-plugin/plugin.json        # name: devquest-jira
  skills/create-appendix-task-list/SKILL.md
```

Only those two files are created. No hooks, scripts, MCP definitions, other skills or symlinks are copied. The user file remains untouched. SHA-256 was `3c2e9506f53c3241fd2d5d8cbcf91cd2600fb6ff22e1b24debcfb9d2f8e5c49a` throughout verification; the copied file matched its original byte-for-byte.

The session explicitly loads this asset with `--plugin-dir <per-run>/approved-skill`, retains `--restricted`, and permits exactly:

```text
Skill(devquest-jira:create-appendix-task-list)
```

Native tool payload:

```json
{"skill":"devquest-jira:create-appendix-task-list"}
```

The namespaced name is required by the plugin registry; it invokes the original installed skill content. The prompt does not embed a replacement generator or copy the skill body as an instruction substitute. Anthropic documents [session-only plugin loading](https://code.claude.com/docs/en/cli-reference#cli-flags) and [plugin namespaces](https://code.claude.com/docs/en/plugins).

The adapter records runtime registry reports, attempted skill names and successful native tool results. AgentRun metadata retains source/hash provenance. If safe-mode environment configuration disables skills, or the CLI lacks explicit plugin loading, the run fails with an actionable error. Required native invocation is still a completion gate.

The original restricted file roots, Read/Skill-only builtins, model/effort policy, dontAsk permissions and explicit read-only Jira MCP methods remain. No grant to `~/.claude`, no extra repository roots, no Bash/Write/Edit/Agent/Task/WebFetch, no bypassPermissions and no publishing tool was added. The backend removes the temporary asset with the existing managed-run cleanup.

Direct `/create-appendix-task-list` is a native interactive invocation for the USER skill, but cannot repair its absence in a restricted registry. The application intentionally uses the verified Skill-tool mechanism with the explicitly loaded namespaced asset. It does not switch to a slash prompt or resume stale sessions.

## Actual skill contract and FCAD

The installed 384-line skill was read completely. The approved plan remains the sole source of deliverables; TRD is rationale only. Live Task metadata must provide `customfield_11543` (Choose Appendix v3), enabled option IDs/labels and exact mappings. MOB-V/L/M/H prefixes encode 1/2/4/8; other labels require the matching weight reference. IDs must remain stable, duplicate categories must be split across tasks, totals and the seven numbered Markdown sections must retain the skill's format.

The managed context now also includes the previous appendix for ID comparison only. It does not become an additional source of new work. The runtime instructions explicitly require stopping with a specific missing-input/configuration question if field/options or the conditional weight reference are unavailable; no other board or fabricated category fallback is authorized.

**FCAD compatibility remains UNVERIFIED.** A direct read-only request to the FCAD create-metadata endpoint in the available browser returned: “You are not authorized to perform this operation. Please log in.” Its additional “cannot create issues” message does not establish field absence; the session was unauthenticated. There was no authenticated Jira connector among the callable tools, and native browser sessions were unavailable while the Mac was locked. No credentials were exported and no authentication/security boundary was weakened.

Production retains the existing controlled read-only Atlassian MCP connection for the live metadata fetch. Whether FCAD actually exposes this field/options and whether the saved weight reference is sufficient must be checked through that authenticated connection on an explicitly authorized generation. No compatibility or category mapping is fabricated in this report.

## A–F verification

| Check | Evidence/result |
| --- | --- |
| A. Skill file exists | PASS: actual source read; unchanged hash and byte-for-byte asset comparison |
| B. Registered in managed-equivalent restricted session | PASS: actual CLI `/skills` listed exactly the one explicitly loaded namespaced skill; stream init also reported it registered |
| C. Invocation accepted | PASS: actual installed Claude CLI accepted a native Skill call against a localhost synthetic Messages API; successful native tool result observed |
| D. Instructions executed | Native instruction loading/delivery PASS: next API request contained the actual skill's plan-traceability and duplicate-category rules. Actual model reasoning through the business workflow is **not verified** |
| E. Valid real FCAD appendix generated | NOT RUN: no paid Claude generation authorized, no authenticated FCAD metadata available |
| F. Backend persistence | Existing fake-runtime regression tests PASS for versioned appendix persistence and plan/TRD/run lineage; no new production artifact was generated |

The local native probe is `scripts/verify-native-skill-local.mjs`. It uses an isolated temporary config directory, dummy API key and loopback-only synthetic Messages API. It does not use `--bare` or change production auth. Exactly two local protocol requests simulate a Skill call and a structured missing-metadata response. Actual available builtins were **Read and Skill only**. No paid provider, Jira, company plan or repository content is involved. This is stronger evidence of native registration/tool execution than a Codex test, but it is not evidence of actual Jira generation or live model behavior.

Evidence files: `/tmp/devquest-native-skill-local.txt`, `/tmp/devquest-native-skill-registry-proof.json`, `/tmp/devquest-native-skill-before.json`.

## Existing Quest and tests

DevQuest was started with the updated code. The Quest remains PLAN_APPROVED at Jira. The old failed run and error remain unchanged, PID null, `generationActive:false`, `recoveryBlocked:false`. Retry Generation is enabled. A normal Retry creates a new AgentRun. Continue from this specific Unknown-skill failure also creates a fresh AgentRun with recoveryFrom pointing at the historical failure instead of overwriting it. No retry was clicked automatically.

All existing Quest parameters, approved artifacts, revisions, approvals, tasks/Jira mappings, work records and failed AgentRun history were preserved. No Jira issues were created. No commit, push or PR was made.

Final complete suite: **150 tests; 149 passed, 1 platform-specific skip, 0 failures**. Syntax and diff checks passed. An earlier full run had one unrelated PR-workflow failure after an unusually long 616-second duration; that test passed separately in 13.6 seconds and the full rerun passed in 37 seconds. No unrelated workflow code was changed to address that timing failure.

Files changed for this request: `src/adapters.js`, `src/engine.js`, `src/jira-appendix-agent.js`, `test/adapters.test.js`, `test/appendix.test.js`, the new local probe script and this report. The optional Codex test was skipped; it cannot prove Claude skill invocation. Real FCAD generation and field/weight compatibility remain the explicit limits.

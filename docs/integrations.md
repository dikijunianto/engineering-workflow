# DevQuest integrations

DevQuest calls local tools through typed adapters. Configuration is trusted local JSON read by the server; the browser cannot supply executables, arguments, test commands, credentials, or arbitrary shell input.

## Git

Register the exact root of each repository before use. Filesystem roots, the user home directory, nested repository paths, and non-Git directories are rejected. A Quest worktree must use the recorded repository's common Git directory and expected branch. Repository path repair preserves the repository ID, requires the same remote (SSH and HTTPS forms are matched), verifies existing worktree identities against the replacement root, and blocks while an associated agent process is alive. Missing working directories are reported before spawning a CLI, so they no longer appear as an ambiguous `spawn claude ENOENT`. Existing worktrees are verified and reused; existing branch conflicts fail. DevQuest never resets or deletes a worktree.

Repository inspection returns the current commit, branch, dirty state, a bounded diff against `development`, and fingerprints covering HEAD, the resolved `development` commit, index entries, tracked working files, all untracked files including new directories, and Git status. Base changes invalidate previous reviews. This fingerprint upgrade also invalidates reviews saved by older app versions; rerun and approve repository review before PR creation. Known zero-test Node output fails both Node and npm validation profiles. A separate content fingerprint verifies commit hooks did not alter the reviewed files. Test execution accepts only `node-test`, `npm-test`, `go-test`, or `pytest`. Commits stage all changes only as part of explicit PR creation and retain the repository's hooks. A commit with no pending changes is safely reused on PR retry.

## Codex and Claude Code

The runtime executables default to `codex` and `claude`. Command lookup preserves the existing PATH and adds the current Node installation, `~/.local/bin`, and standard macOS Homebrew folders so desktop launches can find installed CLIs. Exact configured executable paths still take precedence. Capability detection invokes only `--version` and `--help`, with short timeouts; it does not start a model run. DevQuest checks required flags in the installed CLI help before starting a turn.

Codex turns use JSON streaming plus `--sandbox read-only` for analysis/review or `--sandbox workspace-write` for implementation. Claude Code brainstorming/analysis/review uses `dontAsk` with only explicitly allowed Read/Glob/Grep tools; implementation uses acceptEdits with Read/Glob/Grep/Edit/Write. Claude turns do not have a Bash tool; validation runs through the application's typed test action. DevQuest never uses the vendors' bypass-permission or unrestricted-sandbox flags.

Session persistence is disabled by default (`codex --ephemeral` and Claude Code `--no-session-persistence`). With trusted local configuration setting a runtime's `persistence` to `true`, native resume is exposed only when the installed CLI advertises resume support. Otherwise `sendMessage` and `resume` begin a new turn with context supplied by the workflow.

Runtime output events are transient. The returned final artifact is capped at 100,000 characters and its checkpoint summary at 4,000; raw streams are not stored by the adapter.

These controls are application and CLI boundaries, not an operating-system sandbox. Setting `cwd` limits where a turn starts, but does not by itself prevent a local process from reading other paths. Effective isolation depends on the runtime's own sandbox/permission implementation and the user's local OS account. DevQuest prevalidates worktree paths and does not weaken runtime approvals.

## Local workflow skills

DevQuest discovers `/create-appendix-task-list`, `/upload-task-to-jira`, and `/commit-message-creator` under `~/.claude/skills/<name>/SKILL.md`, plus installed Superpowers brainstorming, writing-plans, and executing-plans skills under Claude's plugin cache. Explicit `workflow.skills` paths override discovery:

```json
{
  "workflow": {
    "skills": {
      "brainstorming": "/absolute/path/to/brainstorming/SKILL.md",
      "planning": "/absolute/path/to/writing-plans/SKILL.md",
      "implementation": "/absolute/path/to/executing-plans/SKILL.md",
      "appendix": "/absolute/path/to/create-appendix-task-list/SKILL.md",
      "upload": "/absolute/path/to/upload-task-to-jira/SKILL.md",
      "commit": "/absolute/path/to/commit-message-creator/SKILL.md"
    },
    "jiraMcpConfig": "/absolute/path/to/.claude.json",
    "jiraMcpServer": "atlassian"
  }
}
```

For design and implementation, the selected skill's instructions are supplied to the agent. App constraints keep publication and commits behind the app's explicit actions. These are bounded task turns, not unrestricted execution of every script a skill mentions. Claude implementation still excludes Bash; the application's validation action runs tests.

Jira uses Claude Code directly by default. It reads only the named MCP server from `~/.claude.json`, writes a temporary owner-readable configuration containing that server, and removes it when the action finishes. It enables only the named Jira metadata/search tools and, during upload, `createJiraIssue`. Other requests are denied with `dontAsk`; Bash, file editing, and unrelated MCP servers are unavailable. Use an authenticated Atlassian connection whose tool names match the skill contract. Missing authentication or unavailable tools produce a setup/input error; no issues are invented. Actions are bounded to two minutes and aborted on normal application shutdown.

The appendix action asks for project key, Epic key, assignee, and an optional weight reference. The local skill must fetch live field options and generate solely from the approved plan. The saved appendix is bound to that plan revision and displayed for review before publication.

Publication creates one sample, then at most five actual Jira issues per explicitly selected batch. Inspect the sample/batch in Jira before selecting the next batch. A weighted appendix can split one execution task into several Jira issues: every returned key is retained, and that task cannot execute until all its issues are verified complete. Stable execution-task keys and prior mappings are supplied to the skill for search-before-create recovery. This is agent-mediated recovery, not an atomic transaction with Jira; verify external issues after an interrupted or malformed response.

## Optional Jira skill bridge

An existing executable bridge remains supported and takes precedence over direct Claude invocation. Configure it with an exact executable and fixed argument list, for example:

```json
{
  "skill": {
    "bridge": {
      "executable": "C:\\Tools\\jira-skill-bridge.exe",
      "args": ["publish"]
    }
  }
}
```

DevQuest sends one JSON document on standard input. `operation` is `generate-appendix` or `publish`. Appendix generation receives the approved `planPath`, execution tasks, `quest.jiraContext`, and local `skillPaths`; return `{ "content": "weighted Markdown" }` or `{ "waitingInput": true, "question": "missing input" }`. Publication also receives `appendixPath`, `publicationPhase` (`sample` or `batch`), and `maxIssues`; the bridge must obey the issue limit and preserve the skill's verification checkpoints. Each task includes its stable task ID and `devquest:<quest-id>:<task-id>` idempotency key. The bridge must return a JSON array, or `{ "results": [...] }`, containing `{ "taskId", "key", "url"?, "complete"? }`. Return each verified issue key, with `complete: false` until every appendix issue for its execution task is verified. Legacy bridge results without `complete` are treated as complete; direct Claude results without it remain partial. Successful entries are retained if a batch partially fails; DevQuest never invents Jira keys for unresolved tasks. Explicit skill paths are trusted configuration; default discovery uses the installed local skill folders. The direct Jira runtime is restricted to the approved publication action.

## Confluence

Use the existing authenticated Atlassian MCP connection in Claude Code:

```json
{
  "confluence": {
    "provider": "atlassian-mcp",
    "host": "https://acme.atlassian.net",
    "mcpServer": "atlassian",
    "maxPages": 10,
    "maxBodyBytes": 1000000,
    "timeoutMs": 120000
  }
}
```

The host must be one HTTPS site origin. DevQuest loads only the selected server from `~/.claude.json` (override with `confluence.mcpConfigPath`, or inherit `workflow.jiraMcpConfig`). Claude retains its own OAuth store. A deterministic loopback API drives the MCP reads; no paid model generation or skill runs. First, authenticated resource discovery confirms the configured tenant. A second session is restricted to that verified cloud ID. The app-owned pre-dispatch hook permits only resource discovery, Confluence page reads, bounded exact-title searches, and a bounded descendant search scoped to the selected root; unknown tools and all writes are denied. Markdown is preferred when the live tool schema supports it, reducing HTML overhead while preserving source text. HTML/storage remains a compatibility fallback. Markdown and HTML page links remain restricted to the configured site. Temporary connection files are private and removed after import. `timeoutMs` bounds the whole import, including discovery and page reads. A timed-out read may reconnect once within that same budget; authentication/permission failures are not retried. Errors identify the stalled tool or connection phase. Settings → Integrations → Confluence shows the configured site and provider; configuration changes require a restart.

MCP import follows nested same-origin page links and checks descendants when the live search schema supports the scoped CQL query. The limit is 10 pages, including the root, with up to 1 MB per page response. Imports retain source IDs, titles, and versions. Skipped pages, external sites, and incomplete descendant discovery are reported for review. Main-page, tenant, or transport verification failures stop creation. Verified linked-page read failures become warnings.

The Create Project dialog shows import progress. Retrying the same URL in the open dialog can reuse completed page reads for 15 minutes in the same DevQuest process. The saved PRD retains all imported text. When it exceeds 100,000 characters, the agent receives an excerpt and analysis requires explicit confirmation of incomplete context. Native full-output files are recovered only from the active session’s owned tool-results directory, with matching tool names and a 2 MB file cap. The REST importer remains available with `provider: "rest"` (or no provider), `host`, `emailEnv`, and `tokenEnv`. MCP mode uses the existing OAuth connection.

## GitHub

GitHub uses the locally authenticated `gh` CLI. The explicit PR action first looks for an open PR with the same head and base. If found, it verifies the PR head matches local HEAD. A stale head triggers a normal non-force push and another head check; the existing PR is reused only after verification. Otherwise it pushes the named branch, runs `gh pr create`, and looks up the matching PR again when creation output is uncertain. Office commit messages use `<type> : <description> (branch)` with `feat`, `fix`, `refactor`, `test`, or `chore`. Generated messages are bound to the reviewed fingerprint and shown in an editable publication dialog. Commit hooks remain enabled. The app does not merge, deploy, or delete branches.

Reviewer requests use GitHub usernames, `gh pr edit --add-reviewer`, and a readback of `reviewRequests` before saving success. Defaults can be set with `sourceControl.reviewers`. Reviewer assignment and notification are separate actions, so their failures do not recreate the PR.

## Google Chat and authenticated testing

Set `googleChat.webhookEnv` to the name of an environment variable holding your incoming webhook URL. Only HTTPS `chat.googleapis.com/v1/spaces/<space>/messages` endpoints are accepted; redirects are rejected and credentials never appear in saved delivery records. The user selects Notify Google Chat after reviewers were successfully requested. The request contains the Quest title, PR link, reviewer usernames, and `development` target.

The same saved UUID and message are reused after an ambiguous failure. [Google Chat documents request ID deduplication](https://developers.google.com/workspace/chat/api/reference/rest/v1/spaces.messages/create); keep the destination and authentication unchanged while retrying. A message receipt is required before marking notification successful. With Google Chat configured, all repositories must complete reviewer assignment and notification before the Quest ends.

`testing.credentialEnv` lists required environment variable names, never values. Startup rejects a missing value. Test and agent child processes receive them through their environment, and exact configured values are redacted from test summaries, agent text, and model error results. Trusted child processes still inherit the server environment. This redaction does not cover arbitrary transformations of a secret; do not instruct agents or tests to print credentials. Existing vendor persistence settings still apply.

## Test boundary

Automated tests use temporary local Git repositories and injected process/fetch functions. They do not invoke paid runtimes, Jira, Confluence, GitHub, or any external network service.

## Existing QA issues

After plan approval, **Use existing Jira task** links one existing issue to all implementation tasks without running `/create-appendix-task-list` or `/upload-task-to-jira`. Supply a Jira issue key (for example `QA-123`), with an optional HTTPS URL. No Jira connection is required; existence and permissions are confirmed by the engineer. Plan revision checks, approvals, dependencies, tests, commit policy and PR review still apply. Link before publishing any new Jira issues; partial publication cannot be replaced.

# DevQuest integrations

DevQuest calls local tools through typed adapters. Configuration is trusted local JSON read by the server; the browser cannot supply executables, arguments, test commands, credentials, or arbitrary shell input.

## Git

Register the exact root of each repository before use. Filesystem roots, the user home directory, nested repository paths, and non-Git directories are rejected. A Quest worktree must use the recorded repository's common Git directory and expected branch. Existing worktrees are verified and reused; existing branch conflicts fail. DevQuest never resets or deletes a worktree.

Repository inspection returns the current commit, branch, dirty state, a bounded diff against `development`, and fingerprints covering HEAD, index entries, tracked working files, untracked files, and Git status. A separate content fingerprint verifies commit hooks did not alter the reviewed files. Test execution accepts only `node-test`, `npm-test`, `go-test`, or `pytest`. Commits stage all changes only as part of explicit PR creation and retain the repository's hooks. A commit with no pending changes is safely reused on PR retry.

## Codex and Claude Code

The runtime executables default to `codex` and `claude`. Capability detection invokes only `--version` and `--help`, with short timeouts; it does not start a model run. DevQuest checks required flags in the installed CLI help before starting a turn.

Codex turns use JSON streaming plus `--sandbox read-only` for analysis/review or `--sandbox workspace-write` for implementation. Claude Code analysis/review uses plan mode with Read/Glob/Grep tools; implementation uses acceptEdits with Read/Glob/Grep/Edit/Write. Claude turns do not have a Bash tool; validation runs through the application's typed test action. DevQuest never uses the vendors' bypass-permission or unrestricted-sandbox flags.

Session persistence is disabled by default (`codex --ephemeral` and Claude Code `--no-session-persistence`). With trusted local configuration setting a runtime's `persistence` to `true`, native resume is exposed only when the installed CLI advertises resume support. Otherwise `sendMessage` and `resume` begin a new turn with context supplied by the workflow.

Runtime output events are transient. The returned final artifact is capped at 100,000 characters and its checkpoint summary at 4,000; raw streams are not stored by the adapter.

These controls are application and CLI boundaries, not an operating-system sandbox. Setting `cwd` limits where a turn starts, but does not by itself prevent a local process from reading other paths. Effective isolation depends on the runtime's own sandbox/permission implementation and the user's local OS account. DevQuest prevalidates worktree paths and does not weaken runtime approvals.

## Jira skill bridge

Jira publication requires an already-installed bridge configured with an exact executable and fixed argument list, for example:

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

DevQuest sends one JSON document on standard input. Each task includes its stable task ID and `devquest:<quest-id>:<task-id>` idempotency key. The bridge must return a JSON array, or `{ "results": [...] }`, containing `{ "taskId", "key", "url"? }`. Successful entries are retained if a batch partially fails; DevQuest never invents Jira keys for unresolved tasks. No Jira skill location is guessed, and no model runtime publishes Jira issues.

## Confluence

Configure one HTTPS origin plus either environment-variable names or an existing local authentication provider:

```json
{
  "confluence": {
    "host": "https://acme.atlassian.net",
    "emailEnv": "DEVQUEST_CONFLUENCE_EMAIL",
    "tokenEnv": "DEVQUEST_CONFLUENCE_TOKEN",
    "maxPages": 10,
    "maxBodyBytes": 1000000,
    "timeoutMs": 15000
  }
}
```

Credentials are read at request time and are not persisted. Imports use the Confluence Cloud REST v2 page endpoint with storage bodies. Only the selected page and direct same-origin page links in that main body are fetched. Supporting pages are not crawled, external links are ignored, response bodies/page counts are capped, and redirects outside the configured origin are rejected. A main-page failure aborts the import; supporting-page failures become warnings.

## GitHub

GitHub uses the locally authenticated `gh` CLI. The explicit PR action first looks for an open PR with the same head and base. If found, it returns that PR without pushing or creating another. Otherwise it pushes the named branch, runs `gh pr create`, and looks up the matching PR again when creation output is uncertain. Version 1 implements only `GitHubProvider`; it does not merge, deploy, or delete branches.

## Test boundary

Automated tests use temporary local Git repositories and injected process/fetch functions. They do not invoke paid runtimes, Jira, Confluence, GitHub, or any external network service.

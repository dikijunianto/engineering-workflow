# Developer cross-repository references

T1's waiting Developer had only its assigned funding-transaction-svc task worktree in the runtime filesystem scope. The agent explicitly declined to attempt personal-finance-svc/pin/constant.go; this was a missing backend capability, not evidence of a failed native file-tool call.

Task Developers now receive a separate read-only reference scope for other registered repositories selected in the Quest. Analysis snapshots are preferred when recorded; legacy Quests use their selected registered roots. The original writable scope remains exactly the assigned task worktree. Parent directories, unselected repositories and additional writable CLI directory grants are not added.

Claude and Codex reuse DevQuest's loopback repository reader. Its only operation is ReadRepositoryFile(repoId, relativePath), with canonical containment, size, symlink/traversal and selected-ID checks. It provides no shell or write API. Claude receives a strict MCP configuration with only this reader, while restricted file tools retain task-worktree writes. Codex keeps workspace-write sandboxing for the task and isolated MCP configuration for the reader, with no external add-dir grant. Nested agents and shell remain disabled.

AgentRuns persist the effective reference scope and repository-tool call evidence. Managed profiles record readOnlyReferences separately from writable repositories. Legacy Developer snapshots can derive a fresh attempt with SELECTED_REPOSITORY_READ_ONLY_REFERENCES_V1 only when the sole scope extension is this backend-selected read-only reference capability; prior run snapshots remain immutable. Soul, model/effort, input artifacts, standards and existing writable scope checks remain enforced.

Validation: fake Claude/Codex CLI tests actually call the local reader and verify selected-file reads, unselected/parent rejection, unavailable write operations, no add-dir, and retained task edit tools/sandbox. Profile-enabled and legacy waiting-session tests verify continuation with this scope and unchanged retry/integration guards. Full suite: 387 passed, 2 skipped; additional upgrade tests passed; syntax checks passed. A real local read of selected PFS pin/constant.go succeeded (2,379 tool-result characters) through the same reader, without paid AI or source changes. No live paid provider invocation was run. App restarted with no active agents; the existing waiting task was not resumed automatically.

Selected-repository coverage also applies to Developer production-fix runs that have a repository work ID but no task ID. Task and conflict runs retain the same controlled reader. Each launch/continuation rebuilds references from the Quest's selected registered repositories, preferring pinned analysis snapshots. Native write access remains restricted to the assigned execution worktree.

Independent Reviewer scopes include every selected repository: integrated worktrees where present, otherwise the pinned analysis snapshot or registered root. Jira artifact-only sessions remain limited to approved documents. Unselected repositories and common parent discovery are not granted.

### Native tool routing recovery

Observed run `94014900-dc32-43ad-9c95-2c82522debbf` already had both selected cross-repository references and successful audited reader calls. Its native Grep of PFS `pin/service.go` was denied by Claude restricted mode. The adapter previously latched any native denial as a terminal failure, even if the agent subsequently recovered through the authorized reader.

The Claude prompt now explicitly directs cross-repository searches to read the target file through the managed reader and inspect the returned text. A native read/search denial inside a selected reference is recoverable only if that exact file has a successful MCP reader result in the same run. Unresolved references fail with `REFERENCE_TOOL_REQUIRED`. Parent, unselected-repository, and write denials retain the existing terminal behavior. No additional directory write grants, unrestricted shell, or automatic paid retry is introduced.

### Go dependency cache references

Developer runs with an assigned Go worktree (`go.mod` present) discover the local module cache using fixed `go env GOMODCACHE`, with automatic toolchain download and module proxy access disabled. The existing canonical cache is exposed as `go-module-cache` through the read-only reader. This grants the installed cache, not the entire home directory or GOPATH. Vendor files inside the assigned worktree already use normal workspace file tools. The reader supports bounded immediate directory listings, retaining canonical-path and symlink escape checks. Existing managed Developer continuations can add this dependency-only scope while retaining all prior capabilities; historical snapshots are preserved.

The separate observed compiler failure in `policy_test.go:61` is an incomplete project `timehelpermock.MockTimeDelegate`, missing `NowWithTimeZoneServer()` from the project's `TimeDelegate` interface. It requires a task-code/mock correction, not broader filesystem permissions. This change does not modify company source or restart a paid agent.

Directory-search recovery accepts successful reader calls beneath the denied directory for native Glob/Grep attempts. Exact-file Read denials still require an exact reader-path match. This corrects T11 run `3774113d-472f-4820-a9a1-c0a7dc72763b`: Grep targeted the chi module directory, while audited reader calls successfully inspected `chi.go` and `mux.go`. A successful child-file read is evidence of permitted inspection, not proof of complete grep coverage. Unresolved search attempts, parent access and unselected paths remain failures; prior failed history is retained.

### Assigned worktree Git history

T12 run `c40082a1-20d8-48f0-8bc9-aa8de520d642` attempted native Read on the assigned task's external `.git/worktrees/<task>/logs/HEAD`. Linked-worktree metadata is outside its source directory. Developer scope now derives the assigned Git directory through a fixed read-only `git rev-parse --absolute-git-dir` call and exposes only its HEAD reflog as `assigned-worktree-history`, path `HEAD`. The reader enforces an exact file allowlist. It does not grant the original `.git` directory, config, hooks, sibling worktrees, or metadata writes. Capabilities record the file restriction, and controlled continuation upgrades preserve the previous snapshot. Original failed runs stay historical; no paid retry is automatic.

### Integration repair assignment

T12 attempt `2b55235e-d3db-4bbb-aad5-9a9282b0d31b` ran the model, passed task validation and recorded task commit `f4008ff2dc774699567d3c2e4dda2a5bad8eed3e`. Its subsequent integration repair failed profile preparation: task workspace selection took precedence over `v11-conflict`, whose backend-assigned cwd is the integration worktree. Purpose-specific conflict/fix assignment now precedes ordinary task workspace selection. Conflict runs require the exact pending task/commit and matching Quest/repository. Ordinary task runs cannot substitute the integration worktree. No existing task state, commit or validation is auto-approved or discarded.

### Post-merge validation repair

Run `57f93158-c55f-4f9e-92bf-8173424c3eed` edited `.gitignore` and added the PIN Pub/Sub registry files after T12 was already merged. The previous integration helper accepted dirty files only while MERGE_HEAD existed, so it rejected the resolver's post-merge validation repair.

New post-merge repair launches require a clean integration worktree and record the exact integration HEAD/task commit before reasoning. On completion all repository validation profiles must pass without changing the tested fingerprint. Only that matching baseline and validation proof permit a backend repair commit; normal dirty worktrees remain blocked. Existing edits predating this baseline mechanism are not silently adopted or discarded. T12's current three-file patch is preserved at `~/.devquest/diagnostics/T12-integration-repair.patch` for explicit review before recovery.

### Bitbucket PR publication

Local configuration selects `sourceControl.provider: bitbucket-mcp`, the `bitbucket` User MCP from `~/.claude.json`, and its existing environment-based authentication. No tokens are copied to DevQuest or sent to a model. DevQuest starts the already installed stdio package offline, verifies MCP initialization/tools, and dispatches deterministic requests directly without a Claude generation.

Git remains responsible for reconciliation and pushing the exact reviewed SHA. Bitbucket MCP handles scoped open-PR search, explicitly approved PR creation and read-back. The adapter permits only repository/PR GETs, requested reviewer-identity GETs, and POST to that repository's pullrequests collection. No merge, issue, comment, delete or generic write path is exposed. Reviewers are resolved before creation and verified afterward; an existing PR with missing reviewers requires manual correction rather than an unrestricted update.

The shared publication checks retain ownership, protected-branch restrictions, pinned reviewed head and duplicate reconciliation. A private durable reservation is written before POST; unknown results cannot issue a second POST automatically. No Jira publishing skill is used. GitHub repositories retain their existing adapter when automatic routing is selected; the explicit local Bitbucket setting prevents a GitHub fallback.

Read-only live checks confirmed both tunaiku personal-finance-svc and funding-transaction-svc connections and zero matching open PRs for the Quest source branches into development. Automated publishing uses mocks only; no real PR was created in implementation validation.

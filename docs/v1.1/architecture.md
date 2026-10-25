# DevQuest v1.1 implementation

## Investigation and conflicts

Baseline on 2026-10-15: 83 tests passed, one Windows-only skip; syntax checks passed. Existing JSON-backed SQLite tables, artifact revision/hash approvals, Confluence intake, Jira skills/batching, review fingerprints, notifications and CLI adapters are reused.

The v1 engine serializes repository workers through one worktree and a unique work-index. Its exclusive queue also awaits validation/CLI actions. Branches and PR targets assume development. Production review is unstructured prose, with manual approval. CLI adapters do not select explicit models/efforts. These conflict with task parallelism, short claims and exact-commit review.

New task-isolated execution is versioned per Quest. Existing records continue through the existing Guided implementation; new UI Quests select v1.1. No records, branches or worktrees are reset automatically. New orchestration code lives outside engine.js. Configuration/routing validation, Git integration and scheduling are separate modules. SQLite continues to persist JSON records; task workspaces are attached to task records, integration workspaces to repository works. Index changes allow task-specific runs while retaining legacy repository exclusion.

Long v1.1 operations run in tracked background jobs after short serialized dispatch/claim operations. Per-integration locks serialize Git merges. Completion requires validated integration, then structured independent review of an exact commit. Restart pauses automatic execution and reconciles interrupted operations without discarding changes.

Runtime model IDs require an explicitly verified administrator registry; help probes establish CLI flag support, not model entitlement. The requested orchestrator is Opus 5.5/high. Missing verified availability blocks dynamic orchestration. Never infer entitlement from a family alias or invent a canonical ID.

## Runtime and model policy

New UI Quests use `workflowVersion: 2`; stored v1 Guided Quests keep their original lane semantics. `routing.js` validates configuration, assessments, model IDs/efforts and production reports. `orchestration.js` owns background operations and recovery; `scheduler.js` owns atomic claims, fair scheduling, worker slots and integration queues; `repositories.js` owns scoped branches/worktrees and serialized merge operations; `agent-results.js` handles validated worker results; `production-review.js` owns exact-commit reviews and bounded fixes. Existing `engine.js` still owns intake, document approvals, Jira skills and notifications.

Configure `orchestration.models` in the trusted machine configuration. Entries must identify a canonical model, runtime, family, supported efforts, and administrator-verified availability (`available: true`, `verified: true`). The example entries are deliberately disabled. Help output cannot prove organization entitlement. Actual runtime model IDs and token usage are recorded when emitted; a different/forbidden model invalidates the result. Fable identifiers are rejected in config, assessments, routing and runtime-reported usage. Only explicitly listed compatible fallbacks are permitted; high-risk work cannot downgrade. Opus orchestration never silently falls back.

`claude --help` on Claude Code 2.1.287 advertises `--model`, `--effort`, `--permission-mode auto`, `--restricted`, `--tools`, `--disallowedTools`, `--settings` and strict MCP isolation. v1.1 requires restricted mode, denies Agent/Task/Team and Bash tools, and permits only file-reading/editing tools for each role. Auto is requested for developer roles; only an explicitly configured acceptEdits fallback is accepted when its CLI capability is absent. An organization may still deny Auto at execution; that failure is surfaced rather than bypassed. There is no dangerous-permission fallback. Reviewers are read-only and always start independent sessions.

Codex is optional. Its model/effort flags are runtime-specific. Policy-bound Codex continuation uses a fresh logical session with the checkpoint so model and tool restrictions are always reapplied; legacy unconfigured sessions can still resume natively. v1.1 probes `codex features list` and disables multi_agent, multi_agent_v2, shell_tool and unified_exec before executing scoped workers, with sandbox and approval_policy=never. Unknown capability support blocks execution. File-edit-only workers rely on DevQuest for validation, commits and integration. Ordinary local processes and configured test commands inherit the host environment; this is not an absolute OS sandbox or remote branch protection substitute.

Installed Ponytail and Caveman Ultra skill instructions are discovered and loaded once per new supported Claude session. Runs distinguish instruction loading from independently verified plugin activation. No token saving or price is claimed. Model usage, duration, retry/escalation counts and review cycles are persisted; unavailable usage/cost is NOT_AVAILABLE.

## Git and execution

Repository registration detects origin's default branch, otherwise its checked-out branch. Base branch, PR target, protection patterns and human reviewers are configurable before workspaces exist. Main/master/default branch are always protected. A missing local base may resolve through an already fetched origin ref; DevQuest does not silently choose an unrelated branch. Targets must have common history and moving targets invalidate readiness through the review fingerprint.

Integration branches are `epic/<Epic>/<Quest>-<Repo>` or `quest/<Quest>-<Repo>`; task branches use the Jira key and a stable task identity hash. Ownership records are persisted before creation, and existing unowned branches are refused. Task and integration paths are scoped under `worktrees-v11`. Branch/worktree creation and integration serialize per Quest/repository; developer writes use independent worktrees. No branch/worktree is deleted automatically and no destructive reset is used. Dependencies unlock only after tests and integration validation pass. A maximum of five developer slots applies across the workspace, with lower Quest budgets; fix workers and live orphan processes count toward those slots.

Scheduling and Git/test operations use persisted background operations outside the engine action lock. Atomic short claims plus SQLite uniqueness prevent duplicate workers. Fair rounds alternate active Quests; blocked dependency graphs pause visibly. Task cancellation preserves files, retry resumes context, and committed interrupted tasks resume integration instead of repeating implementation. Restart pauses automatic execution, marks disappeared runs interrupted and preserves interrupted merge metadata. A missing owned worktree is blocked for manual restoration rather than recreated over potentially lost work.

Production review requires all tasks integrated and mandatory configured validation profiles to pass without changing files. The reviewer reports an exact SHA, structured findings, category evidence and NOT_VERIFIED where appropriate. Reviews include integrated evidence from every Quest repository and are bound to a shared scope fingerprint. Changes in another repository invalidate a passing review too. Every repository must have a current passing review before any Quest PR is published. Review attempts have a separate finite budget for cross-repository revalidation. New commits and target changes invalidate approval. Autonomous Quests can perform up to three developer-fix/re-review cycles; reasoning escalation requires structured complexity evidence, is bounded to two, and never treats dependency/permission/environment failures as reasoning failures. Exhausted budgets require human attention. Integrated task history is immutable; new scope needs a new fix task/Quest.

Task and review-fix commits use the existing office message format; the legacy manual commit-message skill remains on the v1 Guided flow. Jira publishing stays an explicit reviewed sample/batch action. Autonomous PR creation is separately opt-in; otherwise execution stops at readiness. Backend source-control pushes require owned generated branches and reject protection patterns. One PR is reused per integration branch, and reviewer assignment can retry without duplicating the PR. Human merge, deployment, tags and release remain outside automation.

## Data and reset

SQLite's existing JSON record layout is retained. New `branches`, `operations` and `decisions` tables are additive. The legacy active-run index remains for v1 repository lanes; a task-level active index enforces one worker per task and allows v1.1 same-repository workers. Repository registration and all artifact files are preserved.

Typed RESET_DEVELOPMENT_DATA requires the exact confirmation `RESET DEVQUEST TEST DATA`, refuses active sessions and existing owned workspaces/branches, and removes only development Quest/task/run/artifact-metadata/approval/event/decision/operation records. It preserves repository configuration and files. For testing an installation with owned Git work, use a fresh DEVQUEST_HOME; no destructive cleanup is performed.

## Trusted validation commands

The browser selects named profiles, never arbitrary shell commands. Defaults remain node-test, npm-test, go-test and pytest. Administrators may override a profile per registered canonical repository with `testing.repositoryCommands["/absolute/repo"]["npm-test"] = ["npm", "run", "test:ci"]`. Execution uses argv without a shell, scoped to the worktree and bounded by a timeout. Dependencies must be installed in each fresh task worktree when required; the app never silently runs dependency installation scripts.

## Verification boundaries and references

Model ID/effort/CLI version references were checked against [Claude Code model configuration](https://code.claude.com/docs/en/model-config), [permissions](https://code.claude.com/docs/en/permissions) and [CLI reference](https://code.claude.com/docs/en/cli-reference). A later local verification found Claude Code 2.1.300, which reports all three 5.5 models and their effort levels in its authenticated initialization catalog; see claude-runtime-verification.json. A named ID in the example does not assert entitlement.

All real adapters require a verified permitted default model, including legacy turns and Jira/commit skills; untrusted runtime defaults cannot implicitly choose Fable. Registry defaults prefer configured compatible models and obey the family policy. Read-only CLI capability probes remain available without model entitlement.

Token budgets are checked between turns using reported usage. They are not a guaranteed in-turn token cap when the vendor does not stream/enforce one. Unknown costs are not estimated. A worker may need explicit dependency preparation before baseline validation; environment problems pause execution and do not escalate the model. A new PR target with unintegrated target commits is blocked until those updates are incorporated and validation/review rerun. Missing owned worktrees and user-modified integration workspaces require restoration/inspection; no destructive recovery is attempted.

Review/PR and integration operations serialize independently. Automatic publication pins the reviewed SHA in the push refspec, and Guided publication additionally requires human approval of that SHA. Google Chat stays a separate explicit action with the existing retry receipt contract; configured notification handoff prevents premature Quest completion.


## Local runtime verification — 2026-10-15

The authenticated first-party Team runtime at `/opt/homebrew/bin/claude` now reports version 2.1.300. Its initialization catalog resolves `haiku`, `sonnet` and `opus` to `claude-haiku-5-5`, `claude-sonnet-5-5` and `claude-opus-5-5`, respectively. Each reports low, medium, high, xhigh and max effort plus Auto Mode support. No local managed-settings file was found; this is effective runtime catalog evidence, not a claim that remote policy or quota cannot change.

`~/.devquest/config.json` permits those canonical IDs, rejects Fable and keeps dynamic routing. Default non-orchestrator integration calls use Sonnet/high; the requested orchestrator remains Opus 5.5/high. Explicit compatible fallbacks permit Haiku to Sonnet/Opus and Sonnet to Opus, with no Opus fallback. Manual model selections do not fall back. Claude invocations add a per-run named-model allowlist; automatic aliases such as best/default/opusplan are rejected. Managed policy still takes precedence, and an unexpected runtime-reported model causes failure rather than accepted substitution.

A no-inference initialization using DevQuest's generated arguments accepted Opus/high, Auto Mode and the single named-model allowlist. No user prompt was submitted. The user explicitly declined paid inference, so an actual generation smoke test was skipped. Sanitized evidence: [runtime verification](claude-runtime-verification.json). Local authentication secrets are not copied into DevQuest configuration or this repository.

Verification after this change: `npm test` completed 105 tests, 104 passed, zero failed, one Windows-only skip (36.61 seconds). Syntax checks, formatting and diff whitespace checks passed. The running app loaded all three verified Claude models with no active agent runs.


## Multi-repository access correction

Design runs previously placed all registered paths in the prompt but launched the runtime with only the first repository as cwd. Restricted Claude file tools could not reach sibling repositories. Initial and continued runs now rebuild an access scope from current registry IDs, canonicalize and probe every required root before inference, and pass the other selected roots as `--add-dir` argv entries. Architect, Planner and orchestrator scopes are read-only. Reviewers receive the Quest's integration worktrees only; developers receive their assigned workspace alone and cannot add repository grants or write in registered original roots.

Each run saves scope IDs, canonical paths, OS probe results and redacted CLI arguments; the session card exposes these in a collapsed access panel. Preflight errors name the failing repository and actual filesystem code. Streamed file-tool permission denials fail the run with the actual tool path/error even if a later final response claims success. Native and logical continuation rebuild grants instead of trusting old saved paths. The configured base branch is retained in design scope; work creation resolves/pins that explicit ref independently of the current checkout. No checkout is switched during access repair.

Preflight proves root traversal/listing and a sample file read, not readability of every descendant or a paid Claude tool invocation. Those boundaries are marked NOT_VERIFIED. Restricted mode, read-only tool lists, strict MCP isolation and branch protections remain enabled. Multi-repository Codex reads fail closed because its additional-directory flag grants write access; use Claude Code for that case until a read-only Codex boundary is verified.

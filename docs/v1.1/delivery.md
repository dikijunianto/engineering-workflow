# DevQuest v1.1 engineering delivery

Implemented against the existing application on 2026-10-15. No rewrite, cloud service, destructive reset, remote publication or paid model test was performed. Existing uncommitted baseline-diagnostic fixes remain included.

| Area | Status | Evidence / behavior |
| --- | --- | --- |
| Architecture | IMPLEMENTED | Deterministic engine plus separate configuration/routing, scheduler, Git ownership/integration, worker-result and production-review modules. Working intake, artifact approval, Jira, PR and notification adapters are reused. |
| Runtime / Quest configuration | IMPLEMENTED, TESTED | Claude-only execution, optional Codex, per-role inheritance/override, Guided/Autonomous modes, optional Epic, explicit autonomous PR consent, configurable limits. |
| Data | IMPLEMENTED, TESTED | Additive branches/operations/decisions tables and task-specific active-run uniqueness. Existing records and files preserved. Explicit test-data reset refuses active/owned Git work. SQLite integrity and persistent engine reload checked. |
| Routing | IMPLEMENTED, TESTED | Structured Quest/task assessments; complexity/risk policy; administrator model registry; per-Quest/role overrides; effort validation; explicit compatible fallback; requested/resolved identifiers and reasons persisted. |
| Orchestrator | IMPLEMENTED, MOCK-TESTED | Scoped optional Claude Opus 5.5/high assessment sessions in Dynamic mode. Deterministic transitions never call the orchestrator. Invalid/unavailable/duplicate routing is blocked. |
| Model availability | CONFIGURED; runtime metadata verified, inference NOT VERIFIED | The example catalog deliberately sets verified/available false. The local registry was subsequently configured from the authenticated Claude 2.1.300 initialization catalog; see claude-runtime-verification.json. CLI help alone does not establish entitlement. No unrelated orchestrator fallback. All real agent/integration turns require a permitted default model; Fable is denied before requested selection and in runtime reports. |
| Scheduling | IMPLEMENTED, TESTED | Five developer slots globally, lower Quest limits, atomic claims, fair rounds, dependency gates, same-repository isolated worktrees, cancellation and bounded retry/escalation. Fixes and live orphan processes count toward the budget. |
| Git | IMPLEMENTED, TESTED | Optional Epic integration branch, no-Epic Quest branch, task branches, persisted ownership, per-repository creation/integration locks, conflict preservation/fix/revalidation, no destructive reset. Main/master/default/pattern protection, reviewed-SHA pushes and configurable compatible PR targets. |
| Claude Auto Mode | CLI-VERIFIED, NOT LIVE-VERIFIED | Installed 2.1.287 advertises Auto, restricted mode, tools/deny rules, model/effort flags. Scoped file-only developer and read-only reviewer args checked. Organization policy may still reject Auto. Explicit acceptEdits fallback only; no permission bypass. |
| Codex | CLI-VERIFIED, NOT LIVE-VERIFIED | Installed 0.153.4 advertises model/config/sandbox flags and the probed nested-agent/shell feature controls. Codex remains optional. |
| Ponytail / Caveman | INSTRUCTIONS LOADED; activation NOT VERIFIED | Actual installed skill content discovered and bootstrapped once per new supported Claude session at requested Ultra level. Plugin hook activation and savings are not asserted. |
| Production readiness | IMPLEMENTED, MOCK-TESTED | Independent read-only session, full integrated diffs across Quest repositories, exact commit and shared scope fingerprint, structured findings/categories/validation evidence, stale-review detection and objective test gates. Up to three isolated developer-fix/re-review cycles; no automatic dismissal of findings. Guided approval binds to the reviewed SHA. |
| PR / humans | IMPLEMENTED, MOCK-TESTED | One reusable PR per integration workspace; selected target, reviewer defaults/overrides, reviewer retry without duplicate PR; configured Chat handoff remains explicit. Never auto-merges, deploys, releases or creates tags. |
| Recovery | IMPLEMENTED, TESTED | Persisted operations/claims/ownership/checkpoints; paused automatic scheduling after restart; interrupted workers/merges/reviews preserved; committed task recovery resumes integration, not a new implementation. |
| Observability | IMPLEMENTED, TESTED | Requested/resolved/reported model, effort, complexity/risk, route reason, usage when emitted, duration, retries, escalations, integration and review state. Routing history is expandable. Missing usage/cost remains NOT_AVAILABLE. |
| UI | IMPLEMENTED, SMOKE-TESTED | Existing RPG theme and document views preserved. New advanced Create Quest controls, Epic input, repository policy/PR target dialogs, worker actions, routing/usage details. Temporary browser preview checked; no live Quest was executed. |

## Validation

- `npm test`: 103 tests, 102 passed, zero failed, one Windows-only skip; 31.99 seconds. Tests use fake runtimes/providers and isolated real temporary Git repositories.
- `npm run check`: all application modules parse, including the new modules and browser code.
- `git diff --check`: clean.
- `npx prettier --no-config --print-width 80 --check src public/app.js public/index.html test/*.js devquest.config.example.json package.json`: clean.
- Startup against the existing installation preserved counts: one repository, two Quests, three tasks, one repository work and eleven runs; no live agent was active. The final code is running on port 4310.
- No separate build or type-check command is configured; this application uses Node.js and browser-native JavaScript modules.
- Real non-paid CLI probes: Claude Code 2.1.287, Codex 0.153.4; supported safe argument construction and installed skill discovery checked.
- Fake-runtime end-to-end: two repositories, same-repository parallel tasks, dynamic routing, dependency after integration, independent review, developer fixes/re-review and one mocked PR per repository. Failure coverage includes unavailable/forbidden models, invalid assessments, sixth-worker waiting, merge conflicts, protected/unowned pushes, cycle limits, stale commits, master/tags without development, schema reset and persistent restart.

## Final self-review

Corrected shared Git metadata races by serializing task-worktree creation as well as merges. Counted review-fix and orphan-process slots. Added interruption handling for fix workers and idempotent committed-task recovery. Preserved unresolved merges and unrelated edits. Bound Guided approval to the exact reviewed commit, pinned the automatic push refspec, serialized PR publication, preserved reviewer assignment for retries, and kept notification handoff incomplete until delivered. Revalidated document approvals at publication. Runtime model defaults now fail closed without a verified permitted registry. Cross-repository fixes invalidate other passing reviews, and PR publication waits for all current reviews. Restricted Codex continuation reapplies policy in a fresh logical session. Interrupted fix resumption obeys worker limits.

This was a code self-review; no separate paid AI or external production sign-off is claimed.

## Not live-verified / limitations

Jira, Confluence, GitHub, Google Chat and paid model execution were not exercised against live accounts. In particular model entitlement, actual Auto organization approval, provider behavior and optimization hook activation remain unverified. The subsequent runtime investigation found Claude 2.1.300 with all three 5.5 models and low/medium/high/xhigh/max effort in its authenticated initialization catalog. A restricted Opus/high initialization passed without inference. The user declined a paid invocation; generation and quota availability remain unverified.

Task/fix commits follow the office message format deterministically; the commit-message skill remains in the legacy Guided flow. Guided v1.1 findings pause for human action; automatic fix cycles run in Autonomous mode.

Configured test commands and ordinary trusted local processes inherit host credentials; backend Git policy and runtime tool restrictions are not an absolute OS security boundary. Use remote branch protection too. Dependencies may need installing in each fresh task worktree. Token budgets are checked between turns from reported usage, not guaranteed mid-turn caps. Divergent PR targets, missing owned worktrees and user-modified integration states block for safe restoration/integration instead of destructive repair. Test-data reset preserves files and refuses owned workspaces; use a fresh data directory for clean tests with existing worktrees.

## Run

1. `npm ci`.
2. Copy/merge `devquest.config.example.json` into the machine config, then populate canonical permitted model IDs, efforts and verified availability from your actual organization configuration. Keep secrets in environment variables. The default orchestrator request remains Claude Opus 5.5/high.
3. `npm start`; open http://127.0.0.1:4310. Set DEVQUEST_HOME for a separate test installation.
4. Register/configure repositories and create a new v1.1 Quest. Approve its design/plan, publish or link Jira tasks, then Execute. Guided mode retains explicit gates; Autonomous PR creation requires its separate consent.

Configuration and safety details: [architecture](architecture.md). Changes are left uncommitted for inspection.

> Superseded by [Managed Jira Appendix Agent](jira-appendix-agent.md). This document records the earlier background-operation implementation.

# Jira Appendix generation investigation — 2026-10-16

## Verified original behavior

`public/app.js` opens `appendix-dialog` and submits `GENERATE_APPENDIX`. For v2 Quests, `src/orchestration.js` queues a background operation. `src/engine.js` calls `adapters.skill.appendix`; `src/adapters.js` loads the configured `create-appendix-task-list/SKILL.md` and invokes the direct Claude Code runtime, or uses an explicitly configured external skill bridge. This is the existing integration, not a replacement generator.

The installed skill was discovered at `~/.claude/skills/create-appendix-task-list/SKILL.md`. An isolated local mock verified that the complete installed text reaches the runtime prompt and that generation exposes only read-only Jira metadata methods. No model or Jira service was contacted by that check.

An AgentRun is not expected: SkillRunner calls its runtime independently. V2 generation is asynchronous from the UI, while SkillRunner awaits the CLI response. Successful content becomes a versioned `appendix` Markdown artifact bound to the approved plan.

The actual recorded operation `appendix:12c8b15e-fb7b-436d-a8cf-a277989288af` started at `2026-10-16T07:46:35.965Z` and ended `INTERRUPTED`: `/opt/homebrew/bin/claude timed out after 120000ms`. It produced no appendix artifact. The old frontend unconditionally displayed “Saved” after the background request was accepted and did not render the operation. The error was persisted and logged, but was not shown as a prominent generation failure. There is no retained transcript proving how far Claude got through the skill; the reason for the timeout itself remains unverified.

## Focused changes

- `src/orchestration.js`: return generation operation status, deduplicate concurrent requests and repeated request IDs, validate generation inputs before queueing, record completion artifact and generation-specific errors.
- `src/engine.js`: pass the full approved plan, approved TRD context, task IDs/dependencies and all Jira options. Assignee is optional. Record skill invocation/provenance and completion. Reject stale results if the plan changed. Keep prior artifact revisions. Disable automatic execution during generation.
- `src/adapters.js`: preserve the existing skill loader and runtime/bridge selection; expose skill path/hash, runtime, process and returned usage/model metadata. Explicitly limit TRD context to rationale and preserve plan task lineage/dependencies. Generation never grants issue-creation methods.
- `public/app.js`: show running, success and error states across Quest sections; disable generation while running; provide View Appendix, Regenerate Appendix and the existing explicit Publish to Jira sample action. Add Markdown/source review with download. Generation has its own toast instead of “Saved”.
- `test/appendix.test.js`, `test/ui.test.js`: cover approved inputs, options, dependencies, duplicate requests, errors, revision preservation, stale plans, skill loading, progress and review controls, and no implicit publishing/execution.
- `scripts/verify-appendix-ui.mjs`: opt-in, one-call synthetic live/UI verification. Requires `--allow-paid-codex`; never runs in the regression suite.

No workflow stage or publishing policy was replaced. Publishing remains a separate explicit user action with the existing approval/sample checkpoints. Generation does not create issues or start Execute.

## Validation

- `npm test`: 139 tests; 138 passed, 1 platform-specific skip, 0 failures.
- `npm run check` and `git diff --check`: passed.
- Actual browser Generate action against an isolated local database: progress visible, duplicate generation disabled, successful appendix persisted, View Appendix opened rendered Markdown with the task breakdown and dependency.
- One authorized live Codex invocation, requested `gpt-5.6-luna` / `low`, verified compatible with the installed CLI catalog. No automatic fallback. The CLI did not report an actual model ID or monetary charge, so these are unknown.
- A non-company synthetic skill fixture went through the same SkillRunner, using a synthetic approved plan/TRD and a synthetic Jira metadata snapshot. Real scoped-reader tool calls read `SKILL.md`, `approved-plan.md`, `approved-trd.md`, `jira-metadata.json` and `README.md` successfully. No private repository or office skill content was sent to Codex.
- Two tasks retained plan/execution IDs, dependency T2.1 → T1.1, category weights 1 + 2 = 3, and an empty optional assignee. Artifact `21943e90-69c4-45ee-b3c7-7cadc738ca2c` was saved and rendered.
- Synthetic Quest remained `PLAN_APPROVED`; AgentRuns 0, worktrees 0, publisher calls 0. Real Jira publishing was replaced by a rejecting fake adapter.
- Live report: `/var/folders/8v/scjtzstj5vxfw2q59nx0dzrh0000gn/T/devquest-appendix-ui-wGegtD/report.json`. Browser proof: `/tmp/devquest-appendix-generated.png`.
- The user database's Quests, runs, artifacts, repositories, worktrees, tasks, operations and approvals matched the pre-test snapshot exactly before the local server restart.

## Limits

The live test proves the integration path with synthetic inputs, not successful execution of the office skill through production Claude/Atlassian. No paid Claude invocation or real Jira request/publication was made. Production authentication/metadata latency and the original Claude timeout remain to be checked during a separately authorized retry. No commit, push or PR was created.

> Native skill discovery is corrected in [Claude native appendix skill invocation](claude-native-appendix-skill.md). The sections below record the earlier lifecycle implementation.

# Managed Jira Appendix Agent — 2026-10-16

## Investigation and timeout evidence

The previous path was frontend `GENERATE_APPENDIX` → v2 background operation → Engine → SkillRunner → Claude Code. SkillRunner read the full local SKILL.md into its prompt; it did not expose the native Skill tool. It awaited a streamed CLI response with a fixed `120000ms` deadline. It did not create an AgentRun. Success persisted a versioned appendix; asynchronous failure was saved as an interrupted operation.

The actual existing operation `appendix:12c8b15e-fb7b-436d-a8cf-a277989288af` recorded `/opt/homebrew/bin/claude timed out after 120000ms`. No retained transcript separates skill initialization, model reasoning, Jira MCP latency, permissions, missing input or authentication. The root cause beyond the enforced deadline is **undetermined**. Moving to an AgentRun does not prove that timeout is resolved.

Read-only local checks found Claude Code **2.1.300**, registered personal skill `create-appendix-task-list`, and current authentication `loggedIn:true`, `authMethod:claude.ai`, `apiProvider:firstParty`. Current login is not proof of successful Jira authentication or of the earlier session's state. No paid Claude call was made.

The installed CLI help advertises native skills and `--restricted`. Anthropic documents the [native Skill tool in programmatic sessions](https://code.claude.com/docs/en/agent-sdk/slash-commands) and [skill discovery and invocation](https://code.claude.com/docs/en/skills). Production now requests that exact native tool; it does not rely on copying the skill body or guessing slash-command behavior. Actual successful invocation under this installed restricted runtime remains unverified without an authorized Claude call.

## Implementation

`GENERATE_APPENDIX` now creates a managed run with purpose `jira_appendix_generation`, role `JIRA_APPENDIX`, stage `JIRA`, and display name **Jira Appendix Agent**. `src/jira-appendix-agent.js` coordinates the existing Engine lifecycle and Claude adapter. It contains no category/weight generator: those rules remain in the installed skill.

The applicable Planner model/effort policy is resolved through the existing permitted-model registry, with Claude as the required runtime. No Opus override or provider fallback is introduced. An incompatible explicit Quest model produces an error instead of silently changing providers/models. Fable and unsupported effort remain rejected.

SkillRunner's `prepareAppendix` validates the registered personal skill and frontmatter, prepares only the configured Atlassian connection, and returns native runtime options without starting a nested/unmanaged process. Missing skill/configuration is an actionable pre-launch error. Skill overrides that could inject commands, fork agents, change models/tools or install hooks are rejected.

Claude receives `--restricted`, `dontAsk`, `--tools Read,Skill`, the exact `Skill(create-appendix-task-list)` allow rule, and only existing read-only Jira metadata methods. Write/Edit/Bash/Agent/Task/Team tools are denied/absent. Other MCP connections are excluded. Generation does not expose issue creation and does not invoke the upload skill. Only saved Quest document versions are granted locally; selected original repositories are metadata, not writable workspaces.

The adapter records successful native Skill tool results. Backend completion requires that evidence; a generic success message or unverified invocation cannot create an accepted artifact. Activity records run creation, successful skill invocation, missing input, completion and failures.

## Saved inputs and artifacts

The form preloads `quest.jiraContext`: project, optional Epic, optional assignee and optional weight reference. Backend also loads these saved values when omitted. It validates parameters before launch and retrieves the approved plan/TRD through existing approval and integrity checks. Context includes full approved content, exact artifact IDs/paths, Quest title, task IDs/dependencies/validation requirements, and selected repository metadata. Continue includes the user's specific answer and rebuilds this context.

Output remains the installed skill's Markdown inside JSON `{ "content": "..." }`. The backend requires task cards, task weight totals, acceptance criteria, dependencies, repository references, scope and testing information. This is a completeness gate, not a substitute for reviewing the skill's weighting or Jira metadata.

The backend saves a new versioned `appendix` artifact with plan/TRD/run lineage, keeps earlier revisions and materializes `jira-appendix.md` in the Quest document directory. It refuses stale results if approved documents changed. No completion publishes issues or enters Execute. Publishing remains a separate explicit action against the reviewed revision and is blocked while an appendix run is active.

## Lifecycle, recovery and UI

Existing states are reused: `RUNNING`, `WAITING_INPUT`, `COMPLETED`, `FAILED`, `PAUSED`, `INTERRUPTED`, and `CANCELLED`. Skill/process milestones are metadata and Activity events, not new state enums.

- Engine owns the process, cancellation signal, streamed output, progress timestamps and cleanup of the temporary MCP configuration.
- Execution is bounded by Quest task minutes, capped at 30 minutes; there is no removed/unlimited timeout. This is a ceiling, not a cure for authentication or missing input.
- Structured missing-input output becomes `WAITING_INPUT` with a specific question.
- Failed/interrupted runs support explicit Continue with current approved documents and fresh tool policy. Native resume is deliberately not reused: stale instructions and grants must not return. There is no automatic paid retry.
- Cancel generation is an authenticated typed `CANCEL_APPENDIX` action, restricted to this purpose. It aborts the process, preserves drafts and allows a new generation after cleanup. Pause/Interrupt remain available through the ordinary lifecycle.
- Concurrent/repeated submissions are deduplicated. Regeneration creates a new revision/run; a completed run is not silently continued.

Existing Agent Party and execution cards show the Jira agent, runtime, state, skill, milestone, model/effort, elapsed time, last progress, streamed response/errors, access details and recovery controls. The Quest retains View Appendix, Regenerate and explicit Publish actions. No Jira-stage redesign was made.

## Verification and exact limits

Automated regression suite: **144 tests, 143 passed, 1 platform-specific skip, 0 failures**. Focused post-change checks: **26 passed**. `npm run check` and `git diff --check` passed.

Regression coverage includes managed run creation, persisted options and approved documents, task dependency context, Planner model/effort policy, native Skill allowlisting/result evidence, missing skill/configuration, WAITING_INPUT, explicit continuation, timeout, cancellation/regeneration, duplicate protection, stale output rejection, versioned artifact and `jira-appendix.md` persistence, UI visibility, and no publishing/Developer/worktree/Git operations.

One authorized live Codex invocation used requested **gpt-5.6-luna / low**, checked against the installed CLI catalog. A test-only provider replacement exercised the managed Engine lifecycle with synthetic documents and Jira metadata. Native skill milestones were simulated; this was **not** a Claude skill test. No office skill body or private repository content was sent to Codex.

**Live result: FAILED, fail-closed.** Managed run `799a9689-4f20-4b47-a3fa-23e64b19a517` launched and streamed progress. The test reader exposed `synthetic-documents` as its ID, while the plan supplied the registered UUID. The first README read using the UUID was denied. Later reads of the synthetic skill, plan, TRD and Jira metadata succeeded, and the model returned a two-task weighted draft with dependencies, acceptance criteria and repository/test context. The runtime correctly retained the prior tool denial and rejected completion; no appendix artifact was accepted from that run. The harness now uses the actual registered repository ID consistently and checks that mapping before starting. It was **not rerun with paid execution**, because the single-call allowance was consumed. Live successful artifact persistence therefore remains unverified; deterministic tests pass for that path.

The failed live check is not reclassified as a successful end-to-end test. Its report is `/var/folders/8v/scjtzstj5vxfw2q59nx0dzrh0000gn/T/devquest-appendix-ui-xSevqz/report.json`. It records exactly one model call, **publisher calls 0**, **worktrees 0**, **Developer runs 0**, and Quest state **PLAN_APPROVED**. The sole MCP connection was the local scoped reader; production Jira publishing was replaced by a rejecting fake. No real Jira issue could be created by the test adapter.

Remaining limits: production Claude native skill discovery/invocation under restricted execution, actual Atlassian metadata authentication/latency, and a successful corrected live Codex run are unverified. The CLI did not report an actual model ID or monetary charge. No automatic model fallback, paid Claude call, real Jira publication, commit, push or PR was performed.

## Files changed for this request

- `src/jira-appendix-agent.js`: managed coordinator and completion validation.
- `src/engine.js`: managed run metadata/events/completion, scoped document access, cancellation, publishing guard and resource cleanup.
- `src/orchestration.js`: dispatch appendix generation into the managed lifecycle.
- `src/adapters.js`: native skill preparation/allowlisting and invocation evidence.
- `public/app.js`: Jira role/card, lifecycle status, elapsed time and recovery controls.
- `test/appendix.test.js`, `test/adapters.test.js`, `test/ui.test.js`: focused regressions.
- `scripts/verify-appendix-ui.mjs`: opt-in managed synthetic live harness.
- `package.json`: syntax check for the new coordinator.
- This report and the superseded investigation link.

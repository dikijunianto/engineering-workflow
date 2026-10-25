# Legacy Jira Quest recovery and appendix validation

Final recovery status verified locally on 2026-10-19. No paid model calls, Jira calls, publishing,
commits, pushes or PRs were performed during this task.

## Existing Quest migration

Quest `12c8b15e-fb7b-436d-a8cf-a277989288af` was explicitly updated through the
authenticated `REFRESH_QUEST_JIRA` action, using the existing inheritance mechanism.
No automatic migration of other Quests was introduced.

Effective configuration:

| Setting | Result |
| --- | --- |
| Project / Epic | FCAD / FCAD-6205 |
| Category family | BE |
| Reference | FCAD Backend Appendix Weights, version 1.0.0 |
| Source / scale | User Confirmed / Mobile-equivalent |
| V / L / M / H | 1 / 2 / 4 / 8 points |
| Metadata | Live preflight required; old Quest metadata reference cleared |
| MCP server | atlassian |
| Generation policy | Claude, claude-sonnet-5-5, medium |
| State / automatic execution | PLAN_APPROVED / disabled |

The generation policy is inherited from saved workspace settings, not an automatic
escalation in response to Haiku's failure. Resolution selected the same requested
model and effort without fallback; availability was not retested through a paid call.
The existing Epic, assignee, URLs and textual weight reference remain unchanged.
Numeric Backend weights now also have a structured, versioned representation.

Only the target Quest's `jiraConfig`, `jiraMetadata` and `updatedAt` changed.
After the local server restart, every original record in runs (25), artifacts (206),
approvals (4), tasks (17) and works (1) still matched the pre-update backup.
Approved plan `be164d93-b630-4ee6-ad8b-cc6c3923d829` and TRD
`30f86d94-c651-47c8-a9ee-e03e8fe3beae` retained their IDs and file hashes.
Both original installed Jira skills retained their original hashes.

## Exact failure in the saved Claude response

Failed AgentRun: `0ee5f0d8-5934-4761-9250-716b2d536970`, Haiku / LOW.
The native skill was `devquest-jira:create-appendix-task-list`.

The saved Markdown is 24,835 bytes, SHA-256
`37fde1c0c2b02880ad774025f581830c0bc488bc8412fee2dc462c493f45e20f`.
Decoding the original Claude transport envelope reproduces these exact bytes.
The native result ended with `end_turn`, with success status and no error.
All seven sections and required section 6 subsections exist. There is no evidence
of response truncation or a transport-decoding failure.

The first strict parser failure is the section 1 weight cell `**1 pt** (V)`.
The parser accepts `**1 pt**`; the appended tier annotation prevents numeric
weight recognition. Four annotated matrix weight cells produce no usable matrix.
The error now names the offending cell and supported syntax instead of reporting
only a generic missing matrix.

Additional forensic checks of the same unmodified document found:

- All 22 Backend matrix labels, option IDs and numeric weights match the recorded
  live metadata and User Confirmed mapping; zero unmapped categories.
- All 32 fourth-level headings violate the required `T<group>.<n>` form, using
  execution IDs such as `T1` and `T2-2` instead. Three grouping headings reuse
  `T2`, `T7` and `T11` and have no task table of their own.
- The 29 actual task tables contain 46 lines. Every Category cell appends an
  `(id ...)` suffix, incompatible with the exact-label task table contract.
  The underlying labels, IDs and numeric weights match the recorded options.
- No duplicate categories occur inside individual task tables.
- Task totals and the grand total agree: 29 tasks, 56 points. The saved
  distribution table also agrees; no arithmetic failure was established.

The original skill format was therefore not preserved. A single failed Haiku LOW
response does not establish insufficient model capability. No automatic repair,
relaxed acceptance, replacement generator or installed skill edits were introduced.

## Metadata delivery versus verified consumption

The historical audit proves native skill invocation and reads of the approved
plan and Backend weights file. It does not prove a read of the supplied fresh
metadata file. The weights file itself included category data, so correct category
matches cannot independently prove consumption of the fresh metadata snapshot.
The archived tool-result preview is truncated; it cannot establish a complete read.

New generations still obtain fresh read-only MCP metadata before paid execution.
The backend supplies a private, canonical `appendix-options.json` containing every
selected option's exact ID, label, resolved numeric points and metadata hash.
The complete project/Task metadata remains in `jira-metadata.json`.
The option count is derived from the response, not hardcoded to 22.

Acceptance now requires both:

1. Successful native Read-tool results covering every line of the selected-options
   file. Returned lines must match the immutable file bytes, supporting actual
   Claude numbered TAB or arrow output and multiple partial reads. Model claims,
   other paths, stale contents and incomplete reads do not count.
2. A valid original-format section 1 matrix containing every verified selected
   option's exact ID, label and points, followed by the existing strict task-table,
   total and stable-ID validation.

AgentRuns record file/snapshot hashes, native tool-use IDs, merged verified line
ranges and consumption status. Successful artifacts retain this evidence; Activity
records the completed read. These checks establish delivery and output consistency,
not access to the model's internal reasoning.

Failed candidates and diagnostics are stored privately with hashes and
`publishable: false`; they are not accepted artifacts or approved revisions.
Existing approved revisions remain intact after failed regeneration.

## Changed components

- `src/adapters.js`: controlled metadata inputs, explicit format guidance and native
  Read-result evidence. Canonical input paths support spaces and symlinks.
- `src/engine.js`: persist metadata contracts/evidence and record the read milestone.
- `src/jira-appendix-agent.js`: merge verified reads, require complete consumption,
  validate against the immutable selected snapshot, retain failure diagnostics.
- `src/appendix-markdown.js`: actionable weight-cell error and complete matrix check.
- `src/store.js`: private, immutable diagnostic files outside accepted artifacts.
- `test/appendix-consumption.test.js`, `test/appendix-failure.test.js`,
  `test/fixtures/jira-appendix-failed-format.md`, `test/adapters.test.js`,
  `test/jira-settings.test.js`: deterministic migration, format, consumption,
  revision-preservation and recovery coverage.
- `scripts/verify-jira-workspace-browser.mjs`: fake-only verification runtime emits
  the new consumption event. The browser script was not executed in this task.

The existing settings refresh, restricted runtime, Skill registration, read-only
MCP allowlist, write-denial boundary and explicit publication approval are reused.
No new model fallback or agent permissions were introduced.

## Regression and recovery results

Full regression: **201 tests, 200 passed, one Windows-only skip, zero failures**.
Syntax checks and `git diff --check` pass. Tests use fake runtime/Jira adapters.
The exact failed response was exercised through an opt-in private fixture, keeping
company plan contents outside the repository. The repository fixture
is synthetic; no commit was made.

To include the private historical response when testing locally, set
`DEVQUEST_FAILED_APPENDIX_FIXTURE` to the original `jira-appendix.md` path before
running `npm test`. Without it, the private-response test is intentionally skipped.
This task's full test run included it.

The updated local server is running on port 4310. Its state reports the original
failed run as FAILED, `generationActive: false`, `recoveryBlocked: false`.
The existing Retry Generation action is available. Explicit generation creates a
fresh AgentRun, preserving the historical failure. No retry was started.

Private verification evidence is under
`~/.devquest/verification/legacy-appendix-fix-20261018/`: pre-update backup,
migration receipt, exact-response diagnostics and final preservation checks.
The original failed response remains in its original private verification folder.

## Remaining verification limits

No current Jira metadata refresh or paid Claude generation was performed. The 22
historical categories were checked against the original recorded live snapshot;
the next explicitly authorized attempt must obtain current metadata again.
Actual Claude emission of complete new Read evidence and compliant Markdown remains
unverified live. The new checks fail closed if either is absent. Downstream format
compatibility was checked locally; the publishing skill and real Jira writes were
not executed. Wait for explicit authorization before a live retry.

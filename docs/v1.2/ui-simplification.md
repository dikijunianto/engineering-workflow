# Project workspace simplification

The user-approved layout reuses existing workflow actions and permissions.
Navigation is now Overview, Documents, Work and Room. Existing architect,
artifacts, appendix, tasks, repositories, QA, activity and references links remain
compatible. They open the corresponding section, not a new workflow.

Overview shows a compact header, five display stages (Define, Plan, Build,
Review, Done), one promoted next action, a collapsed More actions disclosure,
current attention items and short project/work/agent summaries. Agent controls
remain available under their disclosure, including interruption/cancellation.
Settings, reference assignment and access preview live under Project settings.

Documents includes requirements, analysis, TRD, specification, plan and Jira
records. Files remain collapsed by default. Review links open the selected
TRD/plan/appendix; approvals bind exact artifact IDs using existing actions and
backend validators. The original Markdown viewer/source choices and downloads
remain available. File paths are under File details.

Work groups existing task controls, repository changes/reviews, pull request and
team handoff actions, validation results and the optional manual QA checklist.
Room adds an Answer/Reply button to eligible turns. It preselects the exact
stopped AgentRun; opening the form makes no agent call. Explicit send confirmation,
stale-version validation, same-stage continuation and paid-run notice remain.

New project intake offers New feature (PRD), Technical improvement and Fix an
existing bug. The latter is still the existing TECH workflow. A validated
existingJiraKey is stored as optional intake metadata and prefills the existing
link dialog after plan approval. It does not fetch, link, publish or start agents
on creation. Existing records and runtime/model policies are unchanged.

The initial pass retained the RPG appearance. Visible navigation uses Projects and Agents. Hash
routes, database identity, action names and external integration contracts retain
their original names. No data migration, dependency, paid inference, Jira write,
commit, push or production restart is included.

Regression coverage exercises populated/empty routes, four tabs/five stages,
legacy links, one promoted action, unchanged revision-bound approvals, existing
publication confirmation, Answer without inference, safe bug-intake metadata and
plan-gated issue linking. Browser verification uses synthetic read-only fixtures.

Verification: full regression 305 tests, 303 passed, 2 expected skips, zero
failures. Final focused UI/room checks passed all 46 tests, including document
focus/collapse behavior; syntax and whitespace checks passed. Browser walkthroughs
verified Review TRD opens the exact document and the bug-fix link dialog prefills
QA-123 without submitting. Screenshots use synthetic data only. Production app
was not restarted; live providers and phone-sized browser viewports were not tested.

## Workspace presentation update

The later visual refactor keeps the DevQuest identity with a quieter engineering
workspace: neutral dark surfaces, a restrained accent, smaller headings and flat
controls. Illustrated hero banners, motivational quotes, neon/glow effects,
placeholder profile/presence, promotional footer and decorative statistic cards
were removed. No fonts, dependencies or external assets were added.

Overview uses linked counts followed by projects, agents and recent activity.
It no longer duplicates the repository management table or displays an empty
sprint card. Project lists omit internal IDs, unassigned-sprint text and empty
progress bars. Delete/restore controls remain available. Sprint information is
shown only when assigned. Empty states use direct text and preserve their actions.

Shared headers, panels, tabs, buttons, typography and spacing apply across
Projects, Documents, Work, Room, Skills, Repositories and Settings. Runtime
diagnostics and source-review hints use disclosures. Compatibility declarations,
permission warnings, model/runtime evidence and publication approvals remain
available. Workflow actions, routes, request payloads, stored state and backend
policies are unchanged.

Before and after focused UI/server tests pass. Added presentation checks verify
operational links/counts, conditional sprint display, state preservation and
project rows without empty progress. Browser walkthroughs use synthetic data;
no providers or external integrations are invoked.

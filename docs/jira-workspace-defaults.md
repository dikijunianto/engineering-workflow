# Jira workspace defaults and seamless generation

Implemented 18 October 2026. No paid generation, real Jira dispatch, commit, push or PR was performed for this change.

## 1. Existing architecture

DevQuest already had Quest-level Jira parameters, native skill loading through a private session plugin, a read-only Atlassian metadata preflight, managed `JIRA_APPENDIX` AgentRuns, immutable Markdown revisions, revision-bound approvals, and a separately confirmed publishing flow. Workspace Settings exposed machine configuration but had no editable Jira defaults. Generate opened another parameter dialog and reused Planner routing.

These components remain in use. There is no replacement generator, additional orchestrator, agent framework, or change to the installed skills.

## 2. Workspace Settings

The Jira Configuration form saves project-scoped settings in the existing SQLite JSON-record store's additive `settings` table. Each save increments the Workspace version and checks the submitted version to reject stale concurrent edits.

Saved fields include site/project URLs, project key, selected Atlassian MCP server, category family, assignee, supporting weight reference, versioned numeric Backend reference, live metadata timeout, and optional repository associations. Model overrides remain in execution settings; Jira data does not grant publishing permissions.

The user's local Workspace now has FCAD as its default project, the saved Amar Bank Jira URLs, `atlassian`, Backend categories, and **V=1, L=2, M=4, H=8**. The reference is **FCAD Backend Appendix Weights**, **User Confirmed**, **Mobile-equivalent**, version **1.0.0**. It is not described as official Jira numeric weights. No default Epic was stored. Application source contains no global FCAD weight configuration.

## 3. Quest creation

New Quests show editable, prefilled Jira settings. They can opt out of Jira, select a different project, supply an optional Epic, or override the reference. Repository associations inform the initial project selection. Ambiguous repository associations require an explicit project rather than guessing.

A Quest stores its resolved parameters, configuration schema/Workspace versions, field origins, weight-reference version, creation timestamp and generation-policy snapshot. Changing projects clears foreign defaults, weights and mismatched Epics. Disabled Jira fields do not block non-Jira Quest creation, including after repository selection changes.

## 4. Precedence

Explicit Quest field overrides win over the selected project's configuration. Repository/project associations select the applicable project before the Workspace default project. Safe application defaults apply last: Jira may remain disabled/unconfigured, metadata verification is always live, and the default connection name is `atlassian`.

Epic is Quest-specific. An explicitly empty Epic stays empty; an older execution Epic cannot silently repopulate it.

## 5. Existing Quests and migration

Workspace saves do not migrate existing Quests. Edit Jira Configuration exposes **Refresh inherited defaults**, an explicit, logged action that preserves Quest overrides, project and Epic while refreshing inherited values. Legacy explicitly saved parameters take precedence when adopting defaults. Active design/generation ownership still blocks unsafe edits.

The local preservation check found the same 3 Quests and unchanged workflow/configuration/content. Existing startup reconciliation refreshed only their `updatedAt` timestamps. All **206 artifact records, 25 AgentRuns, 4 approvals, 17 tasks and 1 work record** remained byte-for-byte unchanged. A database backup and before/after evidence are retained outside the repository.

Existing Quests retain their legacy routing/parameter behavior until explicitly adopting the new snapshot. Use Edit Jira Configuration → Refresh inherited defaults to adopt the new project-family and weight configuration. Approved revisions and failure history are retained; a changed approval basis requires fresh approval.

## 6. Generation UI

With complete saved URLs/project settings, Generate immediately submits a typed `GENERATE_APPENDIX` request using the approved plan ID and an idempotent request ID. It opens no parameter confirmation modal. Missing core configuration opens the configuration editor instead.

The Jira stage shows project, optional Epic, family, reference scale and metadata status. Preflight and managed-run progress show phase, runtime, resolved model/effort and actionable failures. Editing remains separate. Successful output offers Markdown review/download and explicit revision approval; generation does not approve, publish or execute implementation.

## 7. Preflight

Before paid reasoning, the flow checks the current approved plan/TRD, selected plan revision, saved project/URLs, permitted model/effort, conflicting runs, installed skill contract, isolated connection, actual read-tool inventory, authentication, complete project/Task field metadata, compatible `customfield_11543`, selected enabled categories and complete applicable weights.

The existing model-free loopback API driver now also verifies native skill registration and an accepted `Skill` invocation in the managed session. It stops after skill expansion; it does not run generation reasoning. An unknown/uninvocable skill prevents paid generation. This addition was tested with local stubs, not a fresh live Claude session.

Failures retain previous artifacts, record a failed preflight operation and schedule no paid retry. Interrupted preflights recover to an explicit retry state after restart.

## 8. Skill inputs and metadata

The unchanged installed skill is exposed as `devquest-jira:create-appendix-task-list`. Exact approved document copies and previous Markdown for stable-ID comparison are placed in a private per-run input directory. The prompt points to these files rather than duplicating document bodies.

Preflight persists a hashed metadata snapshot with project/Task identity, field context, exact enabled labels/IDs, timestamp, provenance and selected options with resolved points. Private read-only `jira-metadata.json` and `appendix-options.json` expose this snapshot to the agent. The prompt treats external metadata as data, never instructions, and does not inline the full category inventory.

All 22 Backend options in the previously verified local FCAD reference matched the new resolver, with no unmapped categories. That is a check against the saved reference dated 17 October, **not a fresh live Jira verification in this task**. Every future generation fetches live metadata again; option counts are not hardcoded.

The reference's actual labels use `BE-<item number>. <description>-Very Low|Low|Medium|High`. Numeric V/L/M/H levels come from the trailing tier, never the item number. Backend labels/IDs remain Backend; Mobile labels are not substituted.

## 9. Model and permissions

New snapshots use the Jira Specialist policy in existing `orchestration.routes["jira-specialist"]`, or a verified permitted Sonnet at medium effort. Explicit Quest model/effort overrides remain authoritative. Unavailable or incompatible routes fail without a silent upgrade. Fable exclusion and existing routing enforcement remain intact. No Opus orchestration, nested spawning or automatic paid retry was added.

The current local registry lists `claude-sonnet-5-5` and medium effort as verified/available. This change made no paid provider call to independently reverify that registration.

Generation retains `--restricted`, isolated skill/MCP configuration, `--strict-mcp-config`, `dontAsk`, built-in Read/Skill only, and existing write/shell/subagent denials. The file scope contains approved input copies, not application/source repositories. Only the four existing metadata reads are permitted through the selected Atlassian connection. The app-owned hook rejects unlisted MCP calls before dispatch; tools enumeration alone is not the boundary. Publishing capabilities were not enabled or exercised.

## 10. Markdown and publishing

Markdown remains authoritative and is persisted without rewriting. Validation checks the original seven sections, matrix labels/IDs, project source, numeric project-reference weights, task IDs, duplicate categories, task/grand totals, stable IDs across revisions, and declared dependency targets/cycles. Backend references also apply when a new configuration explicitly selects ALL categories containing BE options.

Declared dependency validation is structural; no deterministic parser can prove all semantic deliverables/dependencies in arbitrary plan prose were faithfully reproduced. The approved plan is supplied as the sole task source, and human review remains required.

Publishing still requires approval of the exact current artifact revision and a separate explicit publish confirmation. Existing live publication verification and duplicate-protection paths remain. Neither installed skill was edited; both original SHA-256 hashes match the prior values.

## 11. Automated validation

- Full regression suite: **188 tests; 187 passed, 1 Windows-only skip, 0 failed**.
- Syntax checks passed, including the new settings, MCP and Markdown modules.
- `git diff --check` passed.
- Focused tests cover settings versioning, precedence, repository mapping, immutable snapshots, explicit refresh/overrides, optional Epic handling, project switching, BE mapping, missing configuration, unavailable models, effort overrides, one-click UI submission, native skill preflight, controlled metadata files, Markdown persistence, exact approval invalidation, dependency errors and zero publication.
- Existing runtime permissions, source/worktree isolation, model routing, independent review, project compatibility and publishing regression tests still pass.

## 12. Real browser E2E

A real in-app browser operated an isolated localhost server with synthetic data and fake runtime/Jira adapters:

1. Saved SYN Workspace defaults, repository association and V/L/M/H reference.
2. Opened a new Quest and verified prefilled settings and an empty optional Epic.
3. Saved a Quest with SYN-12; safe fixture actions supplied approved synthetic design documents.
4. Clicked Generate with no parameter modal; observed the managed Jira Specialist running at synthetic Sonnet/medium.
5. Verified a valid Markdown artifact, revision 2 after explicit regeneration, with stable T1.1, correct SYN source, exact synthetic BE IDs/labels and total 4.
6. Observed the Markdown viewer, download and Approve Revision controls. Appendix approvals remained zero; Quest remained PLAN_APPROVED and work records remained empty.

Both browser generation clicks were explicit fake invocations during validation iterations. The final fixture audit covers one fresh fake invocation after restarting the fixture server; the earlier fake run/revision remains in the fixture database. No automatic retry occurred.

Screenshot: `~/.devquest/verification/workspace-defaults-20261018/browser-appendix.png`.

## 13. Paid testing and Jira safety

**No real Claude or Codex generation was executed.** The earlier bounded paid authorization had already been consumed by a separate failed Markdown-validation attempt; it was not reused.

**Real Jira dispatches in this task: zero. Real Jira write dispatches: zero. Publishing skill invocations: zero.** Browser adapters had no external connection/credentials. Automated metadata/permission checks used localhost stubs and exercised denied writes only against those stubs. No alternative shell/HTTP publishing path was enabled.

These are task-scoped dispatch claims, not an account-wide Jira audit or a claim that fake tests prove a successful live native skill generation. Fresh live MCP/skill initialization and accepted real Claude Markdown output remain unverified for this version.

## 14. Files and remaining limitations

Changed for this task: `src/jira-settings.js`, `src/engine.js`, `src/store.js`, `src/jira-appendix-agent.js`, `src/adapters.js`, `src/jira-mcp.js`, `src/appendix-markdown.js`, `public/app.js`, `package.json`, `test/jira-settings.test.js`, `test/appendix.test.js`, `test/jira-mcp.test.js`, `test/ui.test.js`, this report, and the isolated `scripts/verify-jira-workspace-browser.mjs` fixture. Pre-existing unrelated working-tree changes were retained.

Evidence, backup, local-settings preservation results and browser audit are in `~/.devquest/verification/workspace-defaults-20261018/`. The browser fixture uses temporary data, has no real integrations, and must not be mistaken for the normal application.

Live model output may still fail the unchanged skill format; stricter inputs/validation do not guarantee model compliance. A newly authorized live test is required to verify that behavior. No production appendix was regenerated, no existing Quest was automatically migrated, and no Jira publishing or Git publication was performed.

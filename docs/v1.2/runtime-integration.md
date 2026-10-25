# DevQuest v1.2.1 — Agent Soul runtime integration

Implemented for review; no live Quest was adopted or migrated. Implementation
scope and compatibility decisions were written first in
[runtime-integration-plan.md](runtime-integration-plan.md).

## Architecture and reuse

Two components extend the existing execution system:

- **AgentProfileRegistry** (`src/agent-profiles.js`): six fixed registered Markdown
  paths under `agents/`, exact role/ID mapping, the existing five scalar YAML
  fields and nineteen required sections, semantic versions (supported major 1),
  unique IDs, content hashes and version/hash pins. It rejects unsafe profile
  symlinks, unknown references, malformed/unsupported metadata, missing sections,
  and changes observed at the same version. Existing run snapshots seed observed
  version hashes after restart. Markdown is canonical; no JSON definition copy,
  YAML package, profile editor, remote registry or executable template was added.
- **AgentContextComposer** (`src/agent-context.js`): resolves role/stage at launch,
  loads bounded authorized standards, records immutable configuration, and wraps
  the existing purpose-specific prompt. It selects behavioral Soul sections;
  proposed model recommendations and capability descriptions are not executable
  policies. Existing stage builders retain their exact output protocols.

Reused: Engine/Orchestration launch, routing allowlist and risk floors, typed
session-authenticated actions, scheduler/dependency/concurrency controls, task/fix
worktrees, stage/result validators, existing Claude/Codex adapters, independent
production review, Store JSON records, and native Jira session plugins/MCP hooks.
There is no additional orchestrator, scheduler, agent framework or database.

## Composition and authority

The logical precedence is backend security/stage contracts, explicit approved
Quest configuration, applicable profile behavior, scoped repository standards,
approved artifacts/task scope, then external data. Prompt order does not grant
permissions: the executable backend and runtime controls remain authoritative.

Sections are identity/Soul, stage contract, repository standards, effective
permission summary, the existing stage-specific task/skill/runtime/output request,
and a current-stage stop rule. Only relevant upstream artifact references are
recorded; isolated design stages retain existing filtered input builders.
Profile-enabled general execution excludes broad downstream summary replay.
Continuations reuse the original base request and one bounded checkpoint/current
instruction, rather than accumulating conversation history. Jira rebuilds its
native prompt against fresh authorized temporary inputs instead of reviving
cleaned-up paths.

The original six files retain `status: proposed`: that is their validated
published definition schema, not a security or execution toggle. Their model
recommendations remain inactive. Explicit Quest adoption is the execution toggle.

## Role and stage integration

| Profile | Existing purposes | Effective boundary |
| --- | --- | --- |
| Orchestrator | `v11-route` | Existing assessment/advice only; read-only selected roots |
| Architect | brainstorm, analysis, TRD, legacy spec | Existing design contracts; read-only selected roots |
| Planner | plan | Existing plan/task DAG output; read-only selected roots |
| Developer | legacy task, `v11-task`, `v11-fix`, `v11-conflict`; read-only commit-message overlay | Backend-assigned task/fix workspace; existing conflict workspace assignment; never original checkouts |
| Reviewer | review, `v11-review` | Fresh independent session, integrated read-only scope, existing exact commit/fingerprint review gates |
| Jira Specialist | `jira_appendix_generation`, native explicit publication operation | Approved-document reads; existing generation/read-only and separately authorized publish MCP scopes |

Jira publishing is an existing operation, not an Engine AgentRun. When opted in,
its existing receipt records the profile snapshot, and SkillRunner prepends that
resolved context to the unchanged native upload contract. The snapshot includes
approved artifact binding and bounded pending card scope. The existing visibility,
manifest, exact-revision approval, explicit batch authorization and uncertain-write
checks still run before publication. Legacy external executable bridges retain
legacy behavior; they do not become native profile-managed AgentRuns.

The installed generation/upload skills are neither edited nor replaced. Native
session plugin loading, Markdown validation and metadata-consumption proof remain
in their existing components. Generation cannot publish or start execution.

## Immutable AgentRun configuration and attempts

New opted-in runs record `profileSnapshot`, its SHA-256, `logicalRunId`,
`previousAttemptId`, `attemptNumber`, `attemptContextHash`, and per-attempt
`standardsProvenance`. The snapshot includes:

- Profile ID/name/version/source/full-definition hash and resolved Soul/hash.
- Role, purpose, backend contract version and exact request hash/reference.
- Runtime, requested/resolved route, model/effort policy references.
- Authorized filesystem/tool/MCP scope; shell/nested-spawn ceilings.
- Repository standards provenance, relevant skill source/content hashes, and
  stage-relevant input artifact IDs/revisions/hashes.
- Original configuration creation time.

Private base requests are bounded, hash-checked files in
`<dataDir>/agent-contexts/`, directory mode 0700 and file mode 0600. Snapshots hold
references and hashes rather than repository source copies or environment dumps.
Soul text is application-owned guidance; no OAuth configuration, API key or
credential environment is captured. Private request files can contain required
local technical context and must be treated as private artifacts, not exported
with a public report.

Store rejects in-place changes to an existing profile snapshot, hash, stage,
role, runtime, routing settings and attempt lineage. Continuation creates a new
`runs` row linked to the same logical run; previous summaries, outputs, tool
traces and reported usage remain in their original rows. Active ownership is
released transactionally before inserting the successor. Legacy runs retain their existing identity/continuation semantics. Before a legacy in-place continuation, the previous turn record is archived into append-only `attemptHistory`; Store rejects alteration of prior archived evidence. Historical profile provenance remains unknown and is never invented.

Resumes pin the original Soul and model/effort even if Quest overrides or files
change. The current permitted-model registry is checked again; revocation blocks
instead of silently substituting or escalating. Current grants, standards,
artifact references and skill hashes are rebuilt and compared. Changed inputs,
unsafe roots, corrupt/missing snapshots or incompatible settings fail with a
blocker. Ordinary roots must remain the same. Jira's temporary document directory
may relocate for a fresh attempt only within the same approved artifact/role/MCP
scope; the current run's access records retain the actual fresh paths.

The existing explicitly authorized `ESCALATE_TASK` action is a separate policy-changing attempt: existing evidence/budget/routing checks still apply, its new immutable snapshot is linked to the previous attempt, and the old configuration remains unchanged. Ordinary retries retain their original policy and current recovery instruction; failure alone never triggers escalation.

All profile-managed attempts use fresh runtime sessions, including same-stage
continuations. This conservative policy avoids contaminated history while
preserving original configuration. Reviewers never reuse Developer sessions.
No automatic retries are introduced on restart.

## Repository standards provenance

Only root `AGENTS.md` and `CLAUDE.md` are supported in this release. Other docs,
nested files and arbitrary registered guidance are not implicitly promoted to
standards. Each entry records repository ID, canonical root/source, source type,
HEAD at load (where Git is available), content hash, timestamp, applicable attempt
ID and LOADED/MISSING status. The content hash identifies working-tree bytes;
HEAD is provenance, not a claim that dirty/untracked guidance was committed.

Loads are limited to 32 KiB per file. Escaping symlinks and invalid/oversize files
block; missing optional root files are visible as MISSING. Each selected repository
has separate provenance. Developers load from assigned worktrees; reviewers from
integrated workspaces. Common parents, global personal configuration and
unselected sibling repositories are not discovery roots. Standards remain
untrusted scoped guidance and cannot grant tools or introduce work outside scope.

## Runtime integration and policy preservation

Both Claude and Codex consume the same resolved prompt and snapshot. The shared
adapter boundary validates snapshot integrity, role/stage/runtime/read-only
compatibility, model/effort consistency and nested-spawn restrictions. Existing
provider-specific capability detection, restricted flags, scoped Codex reader,
Claude read/edit tool lists and MCP pre-dispatch guards remain responsible for
actual execution. Unsupported mandatory runtime flags/capabilities still fail
before inference; no unrestricted fallback was added.

No routing v2 changes were made: explicit Quest/role overrides, dynamic routing,
Jira's existing Planner inheritance, effort inheritance, Reviewer policy, model
allowlist, Fable exclusion, risk floors and bounded budgets remain authoritative.
Profile text does not trigger Opus, change effort or treat FAILED as an escalation
instruction. Requested/resolved configuration is not claimed as runtime-reported
actual model or effort evidence.

## Compatibility, opt-in and migration

There is **no SQL table rewrite or historical backfill**. Existing JSON rows and
workflow versions remain intact. Absent/disabled `agentProfiles` means legacy
behavior. Profile schema version is independent of workflow version.

New Quests have an unchecked opt-in checkbox. Existing idle Quests expose explicit
Enable/Refresh/Disable controls in the overview, through authenticated typed
`SET_AGENT_PROFILES`. Adoption pins all six definitions without changing execution
routing or starting work. Active sessions/operations block adoption; existing lifecycle classification excludes genuinely obsolete Jira attempts without rewriting their history. Finish or
interrupt/recover them through existing controls first. Updating definitions needs
a version bump and explicit reviewed refresh. Disabling affects future new runs;
existing profile-managed continuations stay pinned. Historical records display
LEGACY / UNKNOWN and are never assigned a made-up Soul.

No existing production Quest was enabled. Restart the local application to load
this working-tree implementation before testing its opt-in controls. An old binary
without snapshot support must not resume profile-managed work; disabling new
adoption is not proof of safe rollback to such a binary.

## Observability

The existing AgentRun card now has a collapsed **Agent Profile** disclosure:
identity/version/hash, runtime, requested/resolved model and effort, stage,
repository, standards/hash/commit, relevant skill hashes, permission summary and
attempt lineage. It does not render Soul contents, private standards, credentials
or base-request documents. Existing routing/usage and runtime evidence remain
separate. Synthetic browser verification confirmed expansion and readable layout;
its screenshot uses labelled fixtures and placeholder hashes, not live-run proof.

## Files changed for this implementation

| Files | Change |
| --- | --- |
| `src/agent-profiles.js`, `src/agent-context.js` | Registry, composer, provenance, snapshots, compatibility validation |
| `src/store.js` | Immutable profile configuration and private context persistence |
| `src/engine.js` | Explicit opt-in, composition at launch, linked attempts, publication operation context |
| `src/orchestration.js`, `src/scheduler.js`, `src/design-stages.js` | Pinned continuation routing/lineage and existing-stage recovery inputs |
| `src/adapters.js` | Shared invocation checks and native publishing context translation |
| `public/app.js` | Opt-in controls and compact profile observability |
| `package.json` | Syntax-check the two new modules |
| `test/agent-profiles.test.js` | Registry, context, permissions, legacy/restart/continuation and synthetic E2E |
| `test/ui.test.js`, `test/jira-publication-contract.test.js` | Profile rendering/adoption and unchanged publication safety checks |
| `agents/README.md`, this report and implementation plan | Rollout and implementation documentation |

The working tree already contained previous uncommitted work; it was preserved.
The six canonical Soul definitions and the original installed Jira skills were not
modified. No dependencies were added.

## Verification and limitations

The full suite covers legacy behavior plus profile-specific registry, versions,
path/symlink handling, scoped standards, configuration immutability, profile-file
changes, model revocation, stage/permission mismatches, explicit adoption, legacy
resume, restart, fresh Jira document scopes, both providers and compact UI.

A full synthetic Tech Quest uses temporary Git repositories and fake runtimes:
Brainstorm/spec → Analyze → TRD → approval → Plan → approval → Orchestrator
assessment → fake native appendix → existing-issue mapping → parallel isolated
Developer work → backend tests/integration → fresh exact-commit Reviewer sessions.
All six Souls are observed; dynamic routes remain unchanged, snapshots validate,
and no PR is created. A separate fake-publication test proves visibility still
blocks opted-in publishing, and only synthetic readiness can reach a recorded
Jira Specialist publishing operation.

**Final validation:** `npm test`: 289 tests, 287 passed, 2 expected skips, 0 failures.
`npm run check` and `git diff --check` passed.
No paid Claude/Codex verification or real Jira requests/mutations are part of this
implementation. No real PR, commit, push, merge, skill edit or production opt-in
was performed. Production Jira visibility/readiness blockers from the prior audit
remain unchanged.

Remaining real-runtime verification needs separately authorized bounded synthetic
Claude and Codex inference, including observed model/effort, profile prompt handling,
native skill invocation and OS/runtime enforcement. Fake success does not establish
account entitlement or live behavior. The previously audited Claude help-output
capture limitation is outside this feature and remains unchanged.

Recommended v1.2.2: separately reviewed deterministic risk classification and
cost/accepted-task accounting, then bounded evidence-based escalation. Do not
activate the Markdown model preferences or upgrade models merely because review
failed.

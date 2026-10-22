# Quest room delivery

Implemented with the existing Engine, AgentRuns, runtime adapters and typed,
session-authenticated actions. No new dependency or external code was copied.

- Room: bounded timeline derived from saved AgentRuns (including legacy attempt
  archives), persisted owner notes, explicitly confirmed directed instructions.
  Notes are never injected into prompts. Replies use existing SEND_MESSAGE and
  backend continuation gates; exact run versions, Quest identity, current stage,
  downstream-document checks and durable request receipts prevent stale/duplicate
  delivery. Interrupted/uncertain receipts are not automatically replayed.
- Attention: current session/task failures and design/appendix approval needs,
  derived from existing lifecycle state. This view never clears references or
  bypasses actual approval/publication checks.
- QA: optional per-Quest scenarios and existing Jira keys, append-only human
  observations with clean integrated commit/fingerprint and scenario revision,
  and explicit read-only source rechecks. Prior evidence survives changes; stale
  evidence requires retesting. Results are not new automatic release approvals.
- References: bounded repository Markdown library with preserved revisions.
  Attachment requires reviewed exact revision/hash pins and idle pre-execution
  state. Every explicit reassignment gets a new approval-basis identity, including
  clearing/reselecting the same references. Assigned Developer scope filters
  unrelated repository references. Existing runs retain original pins; profile
  snapshots record them. Jira generation/publishing receive none of this optional
  context, preserving approved-plan and live-metadata contracts.
- Preview: shared launch access-scope resolver, OS read/traverse preflight, precise
  selected roots and assigned task/fix worktree selection. Preview changes no
  permissions and invokes no model. Runtime tool enforcement remains NOT_VERIFIED.

Storage is additive: room_messages, qa_cases, project_references JSON-record tables.
Existing records are not backfilled or enabled. Development reset clears Quest
messages and QA cases but retains the repository reference library. No production
Quest or installed user skill was changed during implementation.

UI: Room/QA/References tabs, existing RPG panels/disclosures, escaped content,
inline action errors, explicit paid-run checkbox, and preserved in-memory drafts.
QA and references are optional. Existing workflow presets, autonomous discussions,
general rooms, scheduling, a workflow canvas, containers and tutorials are outside
this slice.

Validation: fake-runtime and synthetic Git tests cover persistence, cross-Quest
rejection, explicit reply confirmation, stale versions, duplicate/blocked delivery,
stage isolation, reference pins/scope, approval invalidation, QA fingerprints,
read-only previews, profile snapshots and actual frontend action payloads. Browser
inspection uses a read-only synthetic fixture server, not production state.
No paid inference, Jira mutation, source-repository edits, commit or push.

Final validation: 300 regression tests: 298 passed, 2 expected skips, 0 failures.
Syntax checks and diff whitespace checks passed. Final frontend-only checks also
passed after the access-preview presentation update. Production server was not
restarted; restart the local application to load the implementation. Native live
agent behavior remains untested; no provider credits were consumed.

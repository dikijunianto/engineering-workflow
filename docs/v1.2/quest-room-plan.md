# Quest room and engineering visibility

Scope: shared per-Quest timeline, persisted owner notes, explicit directed replies
through existing SEND_MESSAGE; actionable blockers; optional QA evidence; versioned
repository references explicitly attached to a Quest; read-only access preview.

Reuse AgentRuns, their attempt history, artifacts, approvals, stage contracts,
access-scope resolution, runtime adapters and authenticated typed actions. No new
agent orchestration, paid tests, autonomous discussions or permission expansion.
Notes never become agent instructions automatically. Sending a reply requires a
separate explicit action and current run version. Backend continuation guards apply.

References remain scoped data, separate from Souls. Assignment is explicit and
version-pinned, changes invalidate applicable design approvals, and continuations
retain their original reference context. Jira generation retains approved-document
scope and live metadata authority. Original installed skills remain unchanged.

QA records manual evidence against a backend-inspected integrated worktree commit
and fingerprint. Recheck source before reporting current evidence. No new test
commands or credentials. This checklist supplements existing release gates.

Acceptance: persistence/restart, cross-Quest denial, duplicate reply prevention,
stale run rejection, no inference for notes/preview, exact reference revisions,
QA invalidation after edits, escaped UI, actual form actions, existing regressions.
No code is copied from Odwyn. No commit or push is included in this change.

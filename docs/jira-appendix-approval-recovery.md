# Jira Appendix approval recovery

Verified 2026-10-19 for Quest `12c8b15e-fb7b-436d-a8cf-a277989288af`.

## Verified cause

The Quest has no `activeDesignSession` reference. Every Architect and Planner
attempt is completed, failed or superseded; no design AgentRun is active.

Jira run `739752de-b864-43f1-8690-73a5231ac63c` remains historically
`WAITING_INPUT`. It finished on 2026-10-17, has a cleared PID, no owned execution
job and no recorded live process (`generationActive: false`,
`recoveryBlocked: false`). Newer run `090d0ef4-2982-4a0b-aa4b-09260e9b3a18`
completed successfully on 2026-10-19 and produced appendix revision 1,
`a8f785a8-f3b1-4d5a-b8e8-d21219475102`.

`APPROVE_APPENDIX` previously called the generic `Engine.editable` guard. That
guard blocks any Quest run in RUNNING, WAITING_INPUT, PAUSED or INTERRUPTED,
regardless of its role, age or relationship to the selected artifact. Thus the
historical Jira question produced a misleading “active design session” error.
The frontend showed the approval button but had no artifact-specific readiness
check. The error came from the backend action, not a frontend design-session lock.

## Focused fix

`src/engine.js` introduces `appendixApprovalInput`, shared by the approval action
and artifact readiness in `/api/state`:

- Require the exact current appendix ID, approved Plan and approved TRD.
- Require matching source artifact IDs; verify immutable source and appendix
  bytes through the existing SHA-256 checks and approval records.
- Ignore a historical Jira attempt only when it precedes the completed producer,
  finished before this appendix was saved, and has neither an owned job nor a
  live recorded process. An old row resumed after generation still blocks approval.
- Keep current generation, metadata preflight and live older processes blocking.
- Keep source-document design sessions, publication and frozen-plan protections.
- Allow unrelated read-only review or another Quest's session.
- Preserve existing strict Markdown and verified Jira-option validation.
- Record exact Plan/TRD IDs and hashes alongside the appendix approval.

No historical status or session reference was cleared blindly. The obsolete Jira
attempt remains unchanged as diagnostic history; only its relevance to approval
of the newer artifact is corrected. Other editing guards are unchanged.

`public/app.js` uses the backend readiness result in both approval locations.
Blocked approval displays its reason; refreshed state enables the exact displayed
revision when safe. Approval continues to be a separate explicit typed action.

## Verification

- Full regression: **224 tests; 222 passed, two skipped, zero failures**. Skips are
  Windows-only coverage and the opt-in private historical Markdown fixture.
- Focused approval/appendix/UI tests: 65 passed before the final full run.
- Syntax checks and `git diff --check` pass.
- New `test/appendix-approval.test.js` covers obsolete sessions, independent
  review, another Quest, active source changes, new generation, live/owned older
  processes, resumed old attempts, preflight, publication, frozen plans,
  mismatched source/revision IDs and tampered file hashes.
- `test/ui.test.js` verifies blocked-to-ready refresh and submission of the exact
  displayed revision without generation or publication.
- An isolated copy of the actual saved Quest successfully approved the existing
  appendix through authenticated `POST /api/action`: HTTP 200. Its run history
  remained unchanged. Runtime and publishing adapters were disabled; zero runtime
  or Jira publishing calls occurred.
- The real browser was refreshed. “Approve appendix revision” is enabled; it was
  not clicked. The real API reports `approvalReady: true`, `approved: false`.

## Existing Quest status

The real appendix SHA-256 remains
`8b4d731d2689d15f795eb78179c3f3daa171f1610265e6fb229dbe25fdc8ae0c`.
Approved Plan/TRD bytes and IDs, FCAD configuration and Epic FCAD-6205 are intact.
All target Quest records in runs (15), artifacts (104), approvals (2), tasks (14),
works (0) and operations (2) match the pre-fix backup. Only normal startup's Quest
`updatedAt` timestamp changed. No appendix approval was added to the real Quest.

Private backup, clone result, preservation checks and screenshot:
`~/.devquest/verification/appendix-approval-20261019/`.

Files changed for this fix: `src/engine.js`, `public/app.js`,
`test/appendix-approval.test.js`, `test/ui.test.js`, and this report.

No appendix regeneration, paid model call, Jira mutation, source-repository
modification, commit, push or PR occurred. The real approval is deliberately left
to the user. Publishing was not executed; it retains its separate guards and
explicit authorization requirement.

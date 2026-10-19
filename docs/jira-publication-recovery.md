# Jira publication blocked by historical AgentRun — recovery

Verified 2026-10-19. Quest: `12c8b15e-fb7b-436d-a8cf-a277989288af`.
No paid model call, real Jira publishing, Jira mutation, commit, push or PR occurred.

## Actual cause and preserved state

The exact blocker was `Engine.publicationInput` in `src/engine.js` (now line 204).
Its original first check rejected **any** Jira Appendix run whose persisted state
was RUNNING, WAITING_INPUT, PAUSED or INTERRUPTED. It did not check ownership,
process liveness or whether a newer successful run superseded it.

Historical run `739752de-b864-43f1-8690-73a5231ac63c` remains WAITING_INPUT. Its
finished timestamp is 2026-10-17, PID is cleared, and neither an owned job nor a
live recorded process exists. Newer successful generation
`090d0ef4-2982-4a0b-aa4b-09260e9b3a18` is COMPLETED, also without a live process.
Other historical Jira failures are terminal. No Architect/Planner session is
active, and the Quest has no `activeDesignSession` reference.

The current Quest is PLAN_APPROVED, project FCAD, Epic FCAD-6205. Appendix revision
1 is `a8f785a8-f3b1-4d5a-b8e8-d21219475102`, SHA-256
`8b4d731d2689d15f795eb78179c3f3daa171f1610265e6fb229dbe25fdc8ae0c`.
Its actual persisted approval is
`6d95e598-b94a-4ecb-9931-4ca3d69de999`, with matching artifact ID/hash, source
Plan hash and current approval basis. The button alone was not used as proof.

There were no published task mappings, active publication or unresolved
`jira-publish:<questId>` receipt. The old legacy appendix operation was FAILED;
the most recent metadata preflight was COMPLETED. Neither was a live generator.

## Shared lifecycle and artifact validation

`JiraAppendixAgent.lifecycle` and `assertIdle` in `src/jira-appendix-agent.js`
now provide the common generation-state definitions:

- An owned job or live recorded process always blocks, even if its stored status
  looks terminal. Current waiting-input and paused attempts also block review or
  publication.
- COMPLETED, FAILED, CANCELLED, process-free INTERRUPTED and SUPERSEDED attempts
  are terminal.
- An idle historical attempt is obsolete only if it precedes the completed
  producer and finished before the current appendix was saved. A resumed older
  row with a newer finish timestamp remains relevant and blocks.
- Active native preflight or legacy generation operations also block.

Generate/retry uses this shared classification and retains its existing ownership
checks. Resuming an obsolete waiting attempt is rejected with a specific message;
an explicitly requested new generation remains separate. No generation was started
in this task. No historical rows were deleted or rewritten.

`Engine.appendixArtifactInput` shares exact artifact/source validation between
approval and publishing. It verifies approved current Plan/TRD, matching source
IDs, immutable file hashes, valid Markdown, configured project/option compatibility,
no source-document modification session, and no conflicting generation.
The separate approval editing/frozen-plan guard is retained, so later publication
batches can use the unchanged approved document after some tasks are published.

`publicationInput` additionally requires the exact current appendix approval,
rejects stale requested IDs/hashes, blocks an active publication and preserves the
uncertain-publication receipt check. Missing approval reports:
“Approve the current Jira Appendix revision before publishing.”
The coordinated background publisher can validate its own owned operation;
concurrent external publication requests remain blocked.

## Publish button and confirmation

“Publish to Jira (sample)” is **real publishing**, not a mock or a sample document.
With the configured upload skill, the first publication selects the first eligible
execution task and permits at most **one real Jira issue**. Later batches permit
at most five. The publisher passes the exact approved Markdown and stable appendix
IDs to the native `devquest-jira:upload-task-to-jira` integration. Existing issue
mappings, pre-create idempotency search and uncertain-result protection remain.

Previously, clicking the button directly dispatched PUBLISH_JIRA, which could
start paid read-only preparation and then real publication. There was no separate
confirmation dialog on that frontend path.

The existing button label is preserved. It now invokes the authenticated typed
`PREVIEW_JIRA_PUBLICATION` action, which performs local eligibility checks and
returns project, Epic, revision, hash and issue limit. It does not invoke the
upload skill, a runtime or Jira APIs. The existing dialog component then shows
“Confirm Jira publication” and explains that the sample creates a real issue.
Only submitting confirmation dispatches PUBLISH_JIRA, bound to the captured
artifact ID/hash; the backend validates eligibility again.

API state exposes `publicationReady` and `publicationError` from the same backend
guard. The frontend disables publishing and shows the actual blocker when needed.
Refresh restores eligibility from backend state, rather than inferring approval
from an old run status or a visible button.

## Tests and browser E2E

- Full regression: **247 tests; 245 passed, two expected skips, zero failures**.
  Skips: Windows-only coverage and the opt-in private historical Markdown fixture.
- Final focused publication/UI suite: 50 passed. Syntax checks and
  `git diff --check` passed.
- `test/jira-publication.test.js` covers approved completed generation with obsolete
  WAITING_INPUT, terminal failures/interruption, live processes, relevant waiting,
  resumed old attempts, stale revisions/hashes, regenerated-artifact approval
  invalidation, source changes, project changes, publication concurrency,
  uncertainty and no duplicate mock task publication.
- `test/ui.test.js` covers read-only preview, captured revision/hash confirmation,
  readiness after refresh, and disabled publication on an active blocker.
- The isolated browser used a private copy of the actual saved Quest, retaining
  its valid approved Markdown, completed generation and historical WAITING_INPUT.
  Publishing and runtime adapters were disabled. Clicking its Publish button
  reached confirmation for FCAD / FCAD-6205 / revision 1 / maximum one real issue.
  The dialog was cancelled. Refresh restored the enabled button.
- The isolated audit records exactly one action: PREVIEW_JIRA_PUBLICATION.
  Runtime calls: 0. Publisher calls: 0. Real Jira writes: 0.
- The real application was restarted and its browser refreshed. Its actual Publish
  button is enabled, with `approved: true`, `publicationReady: true`, no error.
  Neither Publish nor Confirm was clicked on the real Quest.

## Recovery and limits

No Quest migration or artifact change was necessary. All target Quest records in
runs (15), artifacts (104), approvals (3), tasks (14), works (0) and operations (2)
match the pre-fix backup. Specification, TRD, Plan and appendix hashes were checked.
The exact appendix approval, FCAD configuration and Epic are preserved. Normal
server startup updated only the Quest timestamp. No Jira task mapping was added.

Changed files: `src/jira-appendix-agent.js`, `src/engine.js`, `public/app.js`,
`test/jira-publication.test.js`, `test/ui.test.js`, `test/appendix.test.js`
(expected approval error), and this report. Installed skills were not edited.

Private evidence: `~/.devquest/verification/jira-publish-recovery-20261019/`
contains the backup, isolated browser fixture/audit, recovery verification and
screenshots. The isolated browser and server were closed after testing.

The actual upload skill, paid publisher and Jira write API were deliberately not
tested live. No production publishing integration was dispatched during this task;
all publication-transition tests used mocks. A later user confirmation can start
paid execution and create a real issue, as the dialog states.

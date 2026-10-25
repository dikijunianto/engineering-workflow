# Existing Jira Appendix recovery — 2026-10-16

## Actual incident

Quest: `12c8b15e-fb7b-436d-a8cf-a277989288af`. Workflow state remained `PLAN_APPROVED`, with Jira as the current stage.

There was **no Jira Appendix AgentRun** for this Quest. The affected attempt was the legacy operation `appendix:12c8b15e-fb7b-436d-a8cf-a277989288af`, started `2026-10-16T08:08:12.084Z`. Its persisted state was `INTERRUPTED`, phase `GENERATING`, PID `20248`, and error `/opt/homebrew/bin/claude timed out after 120000ms`. The legacy bridge did not retain a heartbeat. There was no separate active-generation pointer on the Quest.

Before changing state, the backend API returned that same record. The served frontend exactly matched the checkout. A direct existence check for PID 20248 returned **ESRCH**; no process was killed. No AgentRun or operation was RUNNING when the application was restarted. The old operation was historical, not an active generation lock.

The disabled button came from `public/app.js`: `appendixRunning` included `INTERRUPTED` alongside RUNNING, WAITING_INPUT and PAUSED. Thus the error banner and disabled “Generating” button contradicted each other. The previous lifecycle upgrade had not normalized this legacy timeout/PID record. This was an existing-state/UI activity bug, not proof of another live Claude timeout or an older served build.

## Recovery performed

The targeted reconciler changed only the legacy appendix operation: state/phase `FAILED`, `pid:null`, historical `previousPid:20248`, reconciliation metadata and an Activity event. The original timeout error and attempt ID remain intact. No Quest was recreated, no database reset occurred and no unrelated AgentRun was modified.

Runtime ownership is now exposed by the backend as `generationActive`, rather than inferred from a persisted state label. A live recorded PID without current execution ownership is retained, flagged `recoveryBlocked`, and blocks new execution until verified; it is never killed or blindly marked failed. Reconciliation is idempotent and limited to appendix runs/operations.

Reconciliation runs on startup, snapshots/Quest loading, before a new generation, and after managed process cleanup. Existing runtime exit/timeout/cancel handling releases owned jobs. Legacy appendix operations use the same targeted ownership checks during orchestration recovery. An explicit retry can start a new managed attempt after an inactive interrupted attempt without changing other design-session rules.

The UI shows **Jira Appendix Generation**, **Status: FAILED**, **View Error**, “Claude execution timed out after 120 seconds,” and an enabled **Retry Generation** button. Historical errors remain accessible while a new owned generation is active. Failed/interrupted history no longer disables retry; a verified owned generation still prevents duplicate starts.

## Verification of the existing user Quest

- Restarted DevQuest with the corrected code at localhost:4310.
- Loaded the existing Quest and reloaded the page. Jira remained the current stage.
- Actual browser assertion: Retry Generation `isEnabled() === true`, including after reload.
- Backend: operation FAILED, PID null, `generationActive:false`, `recoveryBlocked:false`.
- All existing AgentRuns, tasks/Jira mappings, work records and approvals matched the before snapshot. Quest data matched apart from the startup's existing updatedAt refresh behavior.
- All **162 existing artifact files** retained their recorded hashes, including approved plan/TRD and any prior appendix revisions. Artifact database records were preserved.
- Saved project **FCAD**, Epic **FCAD-6205**, assignee and weight reference remained unchanged.
- Original timeout history remained present; only the recovery Activity event was added.
- No new Jira Appendix AgentRun was created, no Claude invocation/retry was started, and no Jira issue was published.
- Local evidence: `/tmp/devquest-recovery-before.json`, `/tmp/devquest-recovery-result.json`, `/tmp/devquest-existing-quest-retry.png`.

The Retry button was deliberately **not clicked**. The Quest is ready for the user to retry; this recovery does not claim a future Claude/Jira execution will succeed.

## Code and tests

Changed `src/jira-appendix-agent.js`, `src/engine.js`, `src/orchestration.js` and `public/app.js`; added regression coverage in `test/appendix.test.js` and `test/ui.test.js`.

Tests cover orphaned legacy RUNNING/timeout state, stale PID/lock recovery, owned jobs and live unowned PID preservation, idempotence, startup reconciliation, backend FAILED with stale frontend phase, enabled retry after reload, error history during a new attempt, preserved parameters/artifacts, duplicate prevention and no automatic execution/publication.

Complete regression suite: **147 tests; 146 passed, 1 platform-specific skip, 0 failures**. Syntax checks and `git diff --check` passed. No commit, push, paid model execution or real Jira publishing was performed.

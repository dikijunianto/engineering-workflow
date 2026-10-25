# Waiting-agent replies versus task retries

For Refactor Modul PIN task T1, run `1f28ec3e-5f2c-408e-912c-3b740937c1a1` was WAITING_INPUT, not integrated, with two historical task retries already consumed. The Room instruction was blocked by the profile continuation path's combined “Integrated task or retry budget exhausted” condition. That path incorrectly treated answering a waiting agent as a failed-task retry.

WAITING_INPUT continuations now preserve the retry count and use the existing continuation workflow. This applies to profile-managed and legacy v1.1 runs. Failed/paused/interrupted managed attempts retain existing retry-budget checks; integrated tasks remain blocked and require a fix task. Developer concurrency, exact profile/model/effort, worktree, approval and token-budget checks remain in the underlying launch path. Error messages distinguish integrated history from exhausted failure retries.

The historical blocked Room message was preserved and never resent. The real task/run remain WAITING_INPUT with retries=2 and no integrated commit; after restart the user can refresh the Room and explicitly send a fresh reply. No paid invocation, source-repository write, retry-counter reset or automatic delivery occurred.

Synthetic regression covers explicit Room reply at an exhausted retry budget, successful delivery of the instruction without incrementing retries, integrated-history rejection and genuine failed-task retry rejection, with profiles both enabled and disabled. Full suite: 384 passed, 2 skipped; additional profile-mode tests all passed. Syntax checks passed; app restarted with no active agents.

A stopped failed task that exhausted retries now exposes **Allow one more retry** beside its Room reply. Confirmation raises only that task's effective retry limit by one (maximum 10); it does not reset used retries, change models, approve work, or launch an agent. The user then submits a separate paid-execution-confirmed reply. The backend rejects stale confirmations, integrated tasks, active processes, and allowances that are not exhausted. History and the original Quest-wide retry limit remain intact.

# Recoverable project deletion

Each project row has a Delete action. The confirmation names the project,
requires its exact title and accepts an optional cancellation reason. Deletion
moves the project to **Projects → Deleted projects**, where Restore is available.

This clears active project views without destroying work. Project identity,
requirements, document revisions, approvals, AgentRuns, room history, tasks,
publication manifests, Jira mappings, repositories and local worktrees remain
stored. No Git operation, filesystem deletion or external Jira/PR mutation runs.
This is recoverable removal, not a disk-space cleanup feature.

The backend blocks deletion while project automation is enabled, an agent
process/job is active, Jira preflight or background work is active, or task
preparation/integration is in progress. Stop or interrupt those activities first.
Historical stopped sessions do not by themselves prevent deletion. Confirmation
also checks the displayed project version to reject a stale request.

Deleted projects and their dependent records are excluded from active UI state.
The backend rejects stale edit, publication and execution actions, including
actions referencing a deleted project's run/task/work/artifact. The scheduler
excludes deleted projects and does not reserve developer slots for their stopped
tasks. Recovery does not resume their workflow.

Restore returns the saved project to the active list with automation disabled.
It does not start agents, publish tasks, reset approvals or delete history.
Review the existing state and explicitly continue when appropriate.

Typed delete/restore actions use the existing localhost, Host, Origin and
session-token checks. Existing records need no migration; a missing `deletedAt`
means the project is active. The new fields are additive, and delete/restore
events remain in the preserved project history.

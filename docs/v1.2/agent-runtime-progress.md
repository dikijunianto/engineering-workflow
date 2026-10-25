# Agent runtime progress and recovery

DevQuest keeps the Node.js server and existing Claude/Codex CLI adapters.
Runtime JSON events produce progress timestamps and fixed activity labels:
process started, connected, tool running, tool finished and responding. Progress
does not include tool arguments, file contents or credentials. It is evidence of
runtime output, not proof that reasoning or a tool operation succeeded.

Agent cards show the latest activity and seconds since the last recorded event.
After 60 seconds without an event, the UI explains that the agent may still be
working and offers the existing interruption controls. Silence does not change
run state, trigger a retry, escalate a model or start a paid turn.

The engine persists general progress at most once per second, except activity
changes, and sends small progress events without refreshing the entire page.
Existing Jira skill milestones and audit evidence remain unchanged. Events
received after a run stops are ignored. Browser reconnection refreshes persisted
state, including completions and failures missed during a disconnect.

Existing restart reconciliation clears detached process IDs on interrupted runs
and records why review is needed. It preserves the existing checkpoint and
explicit continuation path; it does not restart inference automatically.

No runtime dependency or permission policy changes are introduced. An SDK
evaluation remains a separate follow-up: prove native skill loading, restricted
multi-repository access, MCP write denial, independent reviews, cancellation and
resume behavior using synthetic inputs before considering a runtime replacement.

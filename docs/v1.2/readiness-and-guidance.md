# Readiness, assigned guidance and Room receipts

Settings → Check readiness runs fixed local CLI capability/login probes, checks
configured model policy and compares loaded backend files with files on disk.
Project settings adds selected repository scope and role-assigned skill checks.
No inference, MCP dispatch, Jira changes or automatic repair occurs. Actual
runtime tool access, MCP connectivity and current model entitlement remain
unverified here; existing stage launch preflights remain authoritative. An
unavailable second provider does not block a check of the chosen provider.

The session endpoint advertises supported typed actions and backend build status.
Changed backend files require restart before mutations; stale frontends receive
an actionable error instead of submitting an unsupported action.

## Registered guidance

Register and inspect an instructions-only skill in Skills, confirm its requirements
and runtime declarations, then explicitly assign its revision/hash to a role in
Project settings. Up to five skills per role are supported. Sources are rechecked
before every launch and continuation, copied into private immutable context
snapshots and included as supplemental prompt guidance. AgentRuns record exact
pins and `GUIDANCE_IN_PROMPT` receipts. Managed profile snapshots include those
receipts. A changed source, registration or runtime compatibility blocks launch;
it never selects an alternative skill automatically.

This does not prove native skill invocation or semantic consumption. External
MCP/tool-dependent skills remain catalog entries requiring a managed integration.
The Jira Specialist's existing native skill integration is unchanged. No skill
assignment grants filesystem, shell, network, nested-agent or MCP permissions.
Changing assignments requires finished agent sessions. Resume requires the
original pins; use a fresh reviewed run after intentionally changing guidance.

## Room receipts

Directed replies retain the durable request ID and existing workflow dispatch.
The timeline shows acceptance and the exact linked AgentRun attempt's state.
Legacy replies without an unambiguous attempt link remain unverified. Sending
records without conclusive dispatch evidence show UNCERTAIN and cannot be
silently replayed. A completed turn does not prove that an instruction was
semantically followed. Notes remain local and start no agent.

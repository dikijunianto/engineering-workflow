# Local skill registry

The Skills page registers existing local `SKILL.md` files without changing the
installed skills. Select a skill folder or file, inspect it, review its requirements
and save the registration. Paths with spaces and symbolic-link folders resolve
to a canonical file path, so registering the same source twice is rejected.

Each entry displays:

- Name, description, registration revision and source hash.
- Declared Claude Code and Codex support, separately from runtime availability.
- Required MCP server names, tool names and other setup such as scripts,
  supporting assets or environment variable names. Never enter credential values.
- Source references that need review, including named MCP tools where detected.
- Whether the user has reviewed the declarations.

## Compatibility states

| State | Meaning |
| --- | --- |
| Compatible instructions (declared) | User reviewed an instructions-only skill and declared support for this runtime; no dependency hints were found. Not a live runtime certification. |
| Requires setup | Support is declared, but the skill needs tools, MCP or other setup whose availability and authorization have not been verified. |
| Needs review | Requirements are unknown, not confirmed, or source hints conflict with an instructions-only declaration. |
| Not assessed | Support for this runtime has not been declared. |

Source scanning is deliberately conservative and incomplete. It does not prove
the absence of dependencies, understand arbitrary scripts, or verify MCP
connections. Inspection never invokes a model, command, MCP tool, hook or skill.
Only the selected regular `SKILL.md` file is read, with a 128 KB limit.

Registration and updates require the inspected source hash. If the file changes
before saving, the user must inspect it again. Updates preserve earlier metadata
revisions. Removing an entry archives the registration and preserves the installed
file. Displayed metadata is captured at inspection time; reinspect after source
changes. Source bodies and credentials are not returned by the registry API.

Records reuse DevQuest's existing local settings store. Typed actions use the
existing localhost, Host, Origin and session-token protections. No new execution
endpoint, filesystem grant or MCP permission is introduced.

## Execution boundary

This first slice is the compatibility catalog. Registration does not activate or
assign a skill to an agent. Existing workflow skill configuration, native Jira
skills, permission enforcement and AgentRun snapshots remain unchanged.

Runtime assignment and execution need a separate integration with profile
versioning and capability preflight. That integration must verify required tools,
supporting assets, native invocation, MCP read/write policies and stage contracts
before making any registered skill executable. A declaration must never be used
as authorization or silently converted into a grant.

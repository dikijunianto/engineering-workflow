# Multi-repository parent discovery denial

## Evidence and root cause

Inspected run: `d26c6fc1-b604-457f-9d8e-b5a19b06884d`.
Stage/purpose: `brainstorm`; role: `architect`; read-only: true;
contract version: 1; native session ID: absent; state: FAILED.
It was a fresh correction of run `df5a3a60-72d3-4aed-9254-e544f3ae72c2`,
not a resumed native Developer session.

Effective working directory and first allowed root:
`/Users/dikijunianto/Workspace/senyumku/personal-finance-svc`.
Second selected root/additional directory:
`/Users/dikijunianto/Workspace/senyumku/funding-transaction-svc`.
Denied target: `/Users/dikijunianto/Workspace/senyumku`.
Both repository OS preflights passed, with a `go.mod` or `README.md` sample read.
The denied target is outside both selected roots. No parent access is required
for reading the repositories independently.

The user reported operation **Glob**. The historical stored record did not retain
the tool name or raw tool input, so that exact operation cannot be independently
recovered. The adapter's stored error is produced by matching an actual failed
streamed `tool_result`, rather than classifying the agent's final explanation.
The raw block itself was not persisted. That distinguishes the stored runtime
error from agent speculation without claiming unavailable transcript evidence.

Two verified handling defects explain the recurring failure:

1. The runtime prompt said to use selected roots, but did not give explicit
   per-repository Read/Glob/Grep discovery instructions. Parent discovery was
   denied correctly; the adapter then reported it as a generic repository grant
   problem and failed the stage without repository-scoped correction.
2. A later access event with no arguments overwrote the previously captured CLI
   arguments. Thus this failing run's original argument list is unavailable.

Inspection of stage context and runtime construction found no common-parent
workspace injection, incorrect cwd, parent preflight enumeration, or adapter
path rewriting. The old run has no native session ID and uses no-session
persistence. Why the model chose parent discovery cannot be established from
the retained evidence. The prompt gap is a correction opportunity, not proof
of the model's internal reasoning.

Installed Claude Code: `2.1.300`. Its local help explicitly says `--restricted`
confines file tools to working directories, **including `--add-dir`**. This
supports the intended argument construction, but does not prove successful
actual Claude Read calls. The preceding run retained `--add-dir` for the second
root, `--restricted`, `--permission-mode dontAsk`, `--tools Read,Glob,Grep`,
`--allowedTools Read,Glob,Grep`, no session persistence, strict empty MCP config,
and the resolved model/effort. Current reconstruction for the failing run has
the same access flags. Original arguments for that failed run remain unknown.

## Focused fix

- `src/access.js`: `repositoryInspectionInstructions` supplies canonical
  absolute Git-root paths and per-root examples. Read uses an absolute filename;
  Glob uses that repository's root plus a relative pattern; Grep stays within a
  selected root. Common-parent, `..`, home and unselected-sibling discovery are
  forbidden. `verifyClaudeGrants` compares actual constructed directory arguments
  against the selected canonical roots before spawn.
- `preflightAccess` continues probing each selected root independently. It labels
  invalid repository paths and OS filesystem denials separately. It never lists
  the common parent. The OS/grant result remains distinct from real tool reads.
- `classifyToolDenial` records operation, target, resolved target, Glob pattern,
  actual redacted error and remediation. Categories distinguish parent traversal,
  another unauthorized operation and denial inside a selected/granted root.
  Missing directory grants stop before spawn with their own category.
- `src/adapters.js`, `AgentRuntime.start`: append the scoped instructions; retain
  failed tool evidence; mark runtime Read verification only after successful
  per-root Read results. No result artifact is accepted after a matched denial.
- `src/engine.js`, access event handler: retain CLI arguments across subsequent
  access events. `failRun` allows one fresh scoped correction for a structured
  Brainstorm/Analyze parent-discovery denial. Other denials fail with their own
  remediation; they never broaden permissions.
- `src/design-stages.js`, `prepare`/`retry`/`prompt`: retain a separate bounded
  access-correction counter across automatic retries and omit failed access
  summaries from the new prompt. Preserve old runs, checkpoints and artifacts.
  Continue remains the same stage, with a fresh native session and rebuilt grants.

Effective permissions remain the first selected root as cwd, only other selected
roots as additional directories, `--restricted`, read-only Read/Glob/Grep,
no shell, no Write/Edit, no nested agents, and strict MCP isolation. Parent and
unselected siblings receive no grant. Developer and review access policies are
unchanged. A parent denial cannot advance Brainstorm or start implementation.

## Validation

- Full suite: 129 tests, 128 passed, zero failures, one Windows-only skip.
- Focused access/stage tests: 17 passed. New cases cover two readable siblings,
  no parent preflight, parent and unselected-sibling rejection, selected-root
  sandbox denial, missing CLI grant, actual tool-result evidence versus prose,
  retained arguments, fresh bounded correction, unchanged read-only grants on
  Continue and no implementation/stage advancement.
- Existing canonical/symlink, spaces, multiple-repository role scope and stage
  isolation tests remain passing. Fake results verify adapter handling; they
  are not proof of the installed runtime sandbox implementation.
- Real filesystem/Git probe: both exact selected paths match their Git roots,
  both OS preflights passed, constructed grants contain exactly those two roots,
  and source status before/after is unchanged. Only CLI version/help were run.
- Local detailed diagnostic: `~/.devquest/parent-access-investigation.json`.

No paid model call or actual Claude Read-tool probe was performed because paid
invocation was previously declined. Read capability is still explicitly
NOT_VERIFIED for the real repositories. Initialization/help success alone is
not treated as file-tool access verification. Existing user Quest state and
artifacts were not changed or retried during the investigation.

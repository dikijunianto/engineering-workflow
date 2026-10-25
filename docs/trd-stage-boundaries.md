# TRD and pre-execution stage boundaries

## Verified failure

The inspected user run was `fece0508-654b-438f-a9a8-26b7b5ddabe4`,
Quest `12c8b15e-fb7b-436d-a8cf-a277989288af`, state `ANALYSIS_COMPLETED`.
Its role was Architect, purpose/stage `trd`, runtime Claude Code, read-only true,
no native session ID. Its effective cwd was the first selected repository;
the second selected repository was passed with `--add-dir`. Restricted tools
were `Read,Glob,Grep`, with no shell, source writes, spawning or external MCP.
The stored response asked for a shell to create branches and asked the user to
switch both repositories. Those permissions had not been granted.

This was not evidence of an incorrectly resolved Developer role or reused
Developer session. No configured `design` skill was injected: the local workflow
skill configuration was empty, and automatic skill discovery did not define a
`design` entry. Historical prompts were not retained, so prompt findings are
reconstructed from the builder and saved specification/analysis, not a captured
original request.

The confirmed gap was in TRD enforcement. Structured design contracts applied
only to Brainstorm and the new Tech analysis. TRD still accepted arbitrary
Markdown or `DEVQUEST_WAITING_INPUT` prose. It therefore accepted an operational
shell/branch request as a valid design question. Generic Continue reinforced
that response by repeating it, together with “inspect Git before changing
files.” The initial prompt had read-only wording but lacked a structured TRD
contract and explicit separation between branch metadata/design imperatives
and execution. The evidence does not establish why the model internally chose
to prepare implementation.

## Changes and state gates

- `src/design-stages.js`: stage contracts now include TRD/Architect and
  Plan/Planner. Structured TRD requires `technical_design`, `trd.md`, summary,
  current-stage questions and risks. Plan requires `implementation_plan`,
  `plan.md`, risks and a validated task graph. Shell, branch-switch/creation,
  write-permission and implementation requests in control text are rejected.
  Technical imperatives inside design documents remain data, not commands.
- TRD completion persists the backend-owned artifact and stops at existing
  `TRD_DRAFT` for human approval. Plan completion stops at `PLAN_DRAFT` for
  human approval. No duplicate review states were added. Invalid results get
  one fresh bounded same-stage correction; previous Quest state and artifacts
  survive rejection. Persistence and state/run updates use the existing SQLite
  transaction and versioned artifact mechanism.
- `src/engine.js`, `design`/`finishRun`/`runAction`: apply the contracts, keep
  reasoning roles read-only, filter stage context, omit skill handoffs for the
  contracted stages, and replace generic execution-oriented Continue wording.
  Continue creates a fresh same-stage run without a native session, excluding
  contaminated summaries while preserving old records and checkpoints. Existing
  specification, analysis and human design inputs remain context. Existing
  legacy Technical Brief and Product optional-spec behavior remain compatible.
- `savePlan` can persist within the surrounding design-result transaction;
  manually saved plans retain their existing transaction and validation.
- `src/repositories.js`, `designMetadata`: fixed backend Git operations supply
  root, current branch, HEAD, working-tree status, configured base, local and
  origin base commits and discrepancy status. Status uses
  `GIT_OPTIONAL_LOCKS=0`. No checkout, fetch, reset, merge or branch creation is
  needed. Metadata is explicitly informational in the prompt.
- `RepositoryOperations.base` refuses differing local/origin configured base
  commits unless repository policy explicitly selects `baseResolution: local`
  or `origin`. That choice is validated and saved by the existing typed
  `CONFIGURE_REPOSITORY` action before workspaces exist. Original checkouts stay
  untouched. Branch and isolated-worktree creation remain Execution operations.
- Jira approvals, selected-root grants, Developer worktree-only writes,
  read-only review and protected-branch gates remain in force.

The original waiting TRD can use Continue (optionally with explicit technical
decisions) to start fresh. It was not retried against company repositories
as part of validation. Original user Quest records/artifacts were preserved.

## Codex scoped reads

The old Codex adapter rejected multi-repository `--add-dir`, which denotes
writable directories. The focused read-only path now uses a backend-owned,
per-run local MCP reader instead of writable additional directories.

`src/repository-reader.js` exposes exactly `ReadRepositoryFile(repoId, path)`.
It accepts only selected registered IDs and repository-relative paths, resolves
canonical paths, rejects escaping symlinks/parent traversal/unselected roots,
limits regular file size and never exposes commands or writes. The endpoint
binds loopback, uses a random per-run URL, checks Host and rejects browser
Origin requests. It closes when the run ends.

`src/adapters.js`, `CodexRuntime.start`/`buildArgs`: use the read-only sandbox,
isolated CLI configuration, only this required MCP server and its one allowed
read tool. Shell, general execution, browser, image tools and nested spawning
stay disabled. The Code Mode host dispatches tool calls; it is required by this
CLI's MCP integration and is not a shell grant. The tool advertises read-only,
non-destructive annotations. Only that named tool has `approval_mode="writes"`,
so its read-only calls can run while global approvals stay `never`; other tools
are not approved. See [official MCP configuration](https://learn.chatgpt.com/docs/extend/mcp).

The adapter rejects a result if any required repository was skipped or a read
was denied. Backend read audit and native MCP-call audit are stored separately.
CLI arguments survive later access events. OS preflight and successful real
runtime reads are explicitly different verification statuses. Claude-specific
restricted execution was not relaxed.

## Automated and fake-runtime verification

Full regression suite: 134 tests, 133 passed, zero failures, one Windows-only
skip. Focused final stage/reader checks: 14 passed. Syntax, formatting and diff
checks passed.

New coverage in `test/design-stages.test.js` verifies the full fake Tech flow
through TRD approval, no automatic plan/execution, planning-only task persistence,
fixed read-only Git operations, configured master/current staging differences,
local/origin discrepancy blocking, exact shell/branch leakage rejection, bounded
correction, clean Continue and preservation of previous drafts. Existing
Brainstorm, analysis, multi-repository, worktree-only Developer and read-only
reviewer tests remain passing.

`test/repository-reader.test.js` checks both selected siblings, unselected roots,
absolute paths, parent traversal, escaping symlinks, command/write rejection,
endpoint authentication/Origin handling, read-only annotations, scoped CLI
configuration and rejection when one repository was skipped. Native dialogs
and paid inference are not used by these automated tests.

## Real Codex evidence

`scripts/verify-trd-live.mjs` is explicit opt-in paid validation. It creates only
two harmless synthetic Git repositories. Before agent execution both have base
`master`, current checkout `staging`, README and representative `pin.js` files.
The backend Git commands, refs, HEADs, branch names, file contents and working
status are captured before/after. No company source or internal documents are
sent. The harness caps actual model invocations, excluding CLI help/catalog
probes from that count. `--one-invocation` allows no additional paid retry.

The CLI-specific catalog offered `gpt-5.6-luna` with low effort. The desktop
cache also listed GPT-6 Luna, but the live CLI catalog did not; no unavailable
model or expensive fallback was selected. Luna was the lowest published credit
rate among listed compatible CLI models. [Official credit rates](https://learn.chatgpt.com/docs/pricing)
are distinct from API prices and actual subscription billing.

Two initially authorized live turns were rejected safely: the first had no
available Code Mode dispatcher; the second attempted both repository reads but
Codex requested tool approval. Neither read repository files or produced an
accepted TRD. The user separately authorized one final test after the dispatcher
and tool-specific read approval configuration were corrected.

Final live result: **PASS**.

- Run: `2503d71c-b370-4f78-93a6-446b55ce0354`, provider Codex.
- Explicit CLI model: `gpt-5.6-luna`; effort `low`; one actual invocation.
- Native MCP calls and backend audit both confirm successful reads of
  `README.md` and `pin.js` in each selected synthetic repository.
- Spec and impact analysis were supplied in the stage prompt; Git metadata was
  provided by the backend. The generated TRD documents `/pin`, HTTP 200 mapping,
  defect fixes, DeleteMany and security risks from no limiter/skipping
  VerifyPasswordEmbed, without requesting implementation permissions.
- DevQuest saved `trd.md`; state changed `ANALYSIS_COMPLETED -> TRD_DRAFT`.
- Ref/HEAD/branch/file/status snapshots match exactly. Both remain on staging.
  No Developer run, task worktree, commit, push, PR, source write or branch
  mutation occurred during the run. Setup created the synthetic branches before
  these snapshots, separately from agent execution.
- Usage: 29,236 input tokens, including 18,688 cached input; 1,391 output tokens
  (87 reasoning output tokens). Actual billed cost is not reported.
- The successful turn's rate-card estimate is 0.103814 credits. Including the
  two rejected turns: 77,484 input, 38,784 cached input and 2,911 output tokens;
  estimate 0.300222 credits. These are arithmetic credit estimates, not a bill,
  dollar cost or verified savings.
- The CLI did not return an independent backend model identifier (`actualModel`
  is null). The explicit requested/accepted CLI configuration is evidenced;
  server-side model identity cannot be independently attested from this stream.

Detailed synthetic evidence and artifact are retained under
`/var/folders/8v/scjtzstj5vxfw2q59nx0dzrh0000gn/T/devquest-trd-live-FoxfbP/`:
`report.json`, `runtime-evidence.json`, and the Quest's `data/quests/.../trd.md`.

## Remaining limits

Claude Code live Read-tool validation remains unverified. No paid Claude call
was made. Codex success does not establish Claude restricted-tool behavior.
Lexical guards catch known operational requests, not every paraphrase; runtime
read-only boundaries and backend stage/approval gates remain the enforcement
boundary. Human review is required for technical/security quality of generated
TRDs. The filesystem/SQLite crash-atomicity limit of existing artifact storage
is unchanged. Changes are uncommitted; no push or PR was performed.

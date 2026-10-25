# Brainstorm stage isolation

## Investigated failure

The inspected Tech Quest was `INTAKE_READY`, with an Architect `brainstorm`
run waiting for input. Its stored stage identifier was absent. It was already
read-only and had both selected repositories in its access scope. The response
claimed “Plan approved. Two blockers remain before I write code.” and requested
an execution strategy and write access. No plan or plan approval existed for
that Quest. No Developer run had started. The stored native session ID was
absent, so this case does not establish native cross-stage session reuse.

The prompt builder injected the complete installed Superpowers brainstorming
skill, including handoffs toward planning/implementation and document write
instructions. Generic continuation loaded that skill again and included the
latest summary, reinforcing the run's own incorrect execution claims. The
result handler accepted arbitrary `DEVQUEST_WAITING_INPUT` prose without a
stage contract. Role resolution and OS repository access were not the cause of
this response. Historical raw prompts were not retained: this trace combines
the stored run/artifacts with inspection of the current builder and installed
skill, rather than claiming a captured original prompt.

## Contract and states

For new or retried Tech brainstorming:

`BRAINSTORMING -> structured technical_spec -> BRAINSTORM_COMPLETED`

The backend writes canonical `spec.md` and its versioned artifact. The agent
has no Write/Edit requirement. The UI offers View Specification, Edit
Specification and an explicit Analyze action. Analysis remains upcoming until
that action is chosen. Editing this specification is allowed before analysis;
a later edit is blocked rather than silently invalidating downstream work.

Analyze creates a separate read-only Architect run:

`ANALYZING -> structured repository_analysis -> ANALYSIS_COMPLETED`

It reads the current spec and selected repository evidence. TRD generation
requires another user action. Neither completion enables automatic execution.
Existing TRD/plan approval and execution gates remain in force.

Both results require the exact stage, recognized status, bounded summary and
questions. Completion requires the expected artifact type/filename and nonempty
Markdown. Waiting requires current-stage questions and no completed artifact.
The known execution/write-permission language is rejected. An invalid result
is recorded as a stage-contract violation; one fresh same-stage correction is
allowed, then a clear failed run is surfaced. Permissions never expand.
Artifact metadata, run result and Quest state are committed in one SQLite
transaction. Versioned filesystem writes use the existing Store behavior;
SQLite rollback does not remove an orphaned file if a later write fails.
Persistence failures do not trigger another reasoning invocation.

## Isolation and recovery

Brainstorming and the new Tech analysis use focused contracts instead of the
full brainstorming/planning skill. Context is allowlisted per stage; early
stages exclude downstream plans and generic summaries. Continue/Send Message
can only retry their existing stage and create a fresh Architect run. A native
session is not resumed. Completed structured runs hide continuation controls.

For the existing stuck Quest, use Continue on its brainstorming run (or send a
current-stage design instruction). Its old summary/checkpoint and artifacts
are retained; the old run links to its replacement. Known contaminated
execution claims are excluded from the replacement prompt. Valid prior
same-stage discussion and saved design documents remain available. If launch
fails, the old waiting run remains retryable. No live recovery was invoked as
part of this fix, because paid model use was not authorized.

Legacy Technical Brief artifacts remain intact. Once a canonical brainstorming
spec exists, it is the single input used instead of the old brief. Product
Quest and legacy TRD/plan output formats remain compatible. Existing repository
read-only grants, model routing and Developer execution gates are unchanged.

## Implementation map

- `src/design-stages.js`: `parseDesignResult`, `DesignStages.prompt`, `prepare`,
  `retry`, `saveSpec`, `finish`: contracts, validation, bounded correction,
  artifact/state persistence and fresh recovery.
- `src/engine.js`: `context`, `design`, `launch`, `finishRun`, `runAction`,
  `SAVE_SPEC`/`FINISH_BRAINSTORM`: context selection, stage metadata, protocol
  integration and compatibility gates.
- `src/adapters.js`: runtime result footer respects the structured contract,
  including native-runtime fallback; no generic waiting-input prose override.
- `public/app.js`: completed-stage controls, canonical spec editor/source,
  explicit Analyze, pipeline state and completed-run continuation controls.
- `test/design-fixture.js`, `test/design-stages.test.js`: structured fake
  results and eight focused schema, isolation, persistence and recovery tests.
- `test/engine.test.js`, `test/ui.test.js`: updated Tech flow and UI regressions.
- `package.json`: syntax checking includes the new stage module.

## Verification

Full regression suite: 125 tests, 124 passed, zero failures, one Windows-only
skip. Final UI verification: 18 UI tests passed after correcting the pipeline
and completed-run controls. Syntax and diff checks passed.

Fake-runtime backend tests use two temporary Git repositories and check both
read-only scopes, source status before/after, backend-created spec/analysis,
new analysis run identity, no Developer run and no automatic TRD. Browser
verification independently created a Tech Quest, observed the completed
brainstorm/spec controls, clicked Analyze, then observed Analysis Completed
and Generate TRD. SQLite showed separate completed Architect runs. No model
inference was used. The original user run remained unchanged, with no new
runs, tasks, worktrees or repositories in the user's database.

Limits: schema checks and known-language guards cannot prove semantic design
quality or recognize every possible paraphrase of an off-stage request.
Read-only runtime restrictions and backend transitions remain the enforcement
boundary. Human review of the specification is still necessary. Live paid
Claude generation and actual runtime tool access were not re-tested.

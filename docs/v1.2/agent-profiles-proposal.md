# DevQuest v1.2 — Versioned Agent Profiles

Status: **PROPOSAL — awaiting architecture approval; no implementation authorized**
Audit date: 2026-10-17
Scope: the current local working tree, including the existing uncommitted v1.1 fixes. Source references below describe that tree, not just the last Git commit.

## Recommendation

Add six versioned, application-owned profile definitions and one small resolver/composer at the existing run-launch boundary. Keep `Engine`, `Orchestration`, `TaskScheduler`, stage handlers and runtime adapters as the execution system. A profile supplies role identity, engineering guidance and requested policy; it cannot authorize an operation or advance the workflow.

The core distinction is **profile intent → resolved backend policy → runtime enforcement → validated output**. Record each layer with the AgentRun. Do not add an agent framework, another scheduler, a delegation tree, a separate profile service or a general-purpose plugin executor.

Roll out profile recording first, with existing routing and permissions unchanged. Introduce the proposed cost-aware routing only as a later, separately gated phase. Profile adoption must not silently change the model or effort of an existing Quest.

## 1. Current architecture findings

### Roles and orchestration

- [`src/routing.js:10`](../../src/routing.js#L10) defines four configurable roles: Architect, Planner, Developer and Reviewer. Orchestrator is a special route in `resolveRoute`, outside that role list. Jira generation has the persisted role `JIRA_APPENDIX`, but resolves through Planner policy and explicitly requires Claude for the installed native skill ([`src/jira-appendix-agent.js:147`](../../src/jira-appendix-agent.js#L147)). There is no unified profile/version registry.
- [`src/engine.js:349`](../../src/engine.js#L349) validates typed actions and serializes workflow mutations. [`src/orchestration.js:30`](../../src/orchestration.js#L30) delegates newer workflow actions to the existing scheduler, repository operations and production review. This is already an orchestration layer; profiles belong inside it.
- Guided/Autonomous behavior is configuration and gate logic. A profile must not acquire an independent authority to schedule stages or publish records.

### Prompt construction and skills

- Design instructions are built in [`Engine.design`](../../src/engine.js#L1383), with stronger contracts in [`DesignStages.prompt`](../../src/design-stages.js#L172). Developer prompts are in [`TaskScheduler.prepareTask`](../../src/scheduler.js#L228), assessment prompts in [`Orchestration.assess`](../../src/orchestration.js#L430), and review/fix prompts in [`ProductionReview`](../../src/production-review.js#L82).
- [`Engine.context`](../../src/engine.js#L1357) inserts Quest artifacts and registered repository records. `designContextKinds` limits upstream documents for isolated design stages. Other callers use a broader default context.
- [`createAdapters`](../../src/adapters.js#L2236) discovers configured/installed skill paths. Its `workflow.instructions` reads a skill as text and appends DevQuest constraints; this is **instruction injection, not proof of native skill registration or execution**. Claude-only bootstrap loads Ponytail/Caveman text, with status explicitly saying execution is not independently verified. Codex does not receive that bootstrap.
- Jira is different: [`SkillRunner.prepareAppendix`](../../src/adapters.js#L1443) copies only the approved, unchanged skill into a private per-session plugin, records its hash, selects a namespaced native `Skill` invocation, and builds a selected Atlassian MCP configuration. Generation and upload use their existing distinct skill contracts. Preserve this mechanism and the Markdown-first artifact contract.

### MCP and repository capabilities

- [`ClaudeCodeRuntime.buildArgs`](../../src/adapters.js#L1282) constructs restricted execution, explicit model/effort, role tools, strict MCP configuration and nested-agent/shell denial. Normal sessions load an empty MCP configuration. Native Jira sessions receive only the selected connection and appropriate tools.
- [`src/jira-mcp-policy.js`](../../src/jira-mcp-policy.js#L2) enforces a fixed backend-owned pre-dispatch policy. Appendix generation permits four metadata reads; preparation adds three read operations; publication adds narrowly scoped issue creation. Tool visibility and prompt instructions alone are not the enforcement boundary.
- [`Engine.launch`](../../src/engine.js#L1440) reconstructs repository scope from current Quest/work records. Design roles receive selected registered roots; Developers receive their assigned workspace; newer Reviewers receive integrated workspaces. Jira generation receives an artifact scope. These are already different access contracts.
- [`preflightAccess`](../../src/access.js#L7) canonicalizes and probes each root independently, checks the working directory and reports exact failures. [`verifyClaudeGrants`](../../src/access.js#L140) rejects omitted/extra CLI grants. OS access/argv initialization is explicitly **not** proof of a successful Claude file-tool read.
- [`CodexRuntime.start`](../../src/adapters.js#L1094) uses the existing read-only repository MCP reader for scoped reasoning, disables general tools/user rules, and requires successful reads from every selected repository. [`src/repository-reader.js`](../../src/repository-reader.js#L8) rejects traversal, unselected repository IDs and symlink escapes. Its current interface reads files, rather than offering Claude-equivalent directory discovery. Profiles must describe that capability difference honestly.
- [`RepositoryOperations`](../../src/repositories.js#L32) owns branch policy and explicit base resolution. [`TaskScheduler`](../../src/scheduler.js#L142) owns worker limits, task workspaces, validation and serialized integration. Preserve original repository protection, task/fix isolation and branch ownership.

### Models and efforts

- [`executionConfig`](../../src/routing.js#L66) validates Quest overrides, modes and limits. [`resolveRoute`](../../src/routing.js#L183) requires models to be `available` and `verified`, checks family policy and exact effort compatibility, rejects Fable/automatic aliases, and records requested/resolved choices and fallback reasons. Explicit model pins do not silently fall back. A configured permitted family fallback is limited to compatible upward routing.
- Current dynamic defaults are Haiku for TRIVIAL/SIMPLE, Sonnet for MODERATE/COMPLEX and Opus for VERY_COMPLEX/CRITICAL; HIGH/CRITICAL risk forces Opus. Reviewer routing defaults to Sonnet/high or Opus/high. The requested Orchestrator defaults to `claude-opus-5-5`/high, **which is a configuration request, not live availability evidence**.
- Dynamic execution currently launches an AI assessment when tasks lack assessments ([`src/orchestration.js:305`](../../src/orchestration.js#L305)). This is the reuse point for deterministic initial classification and on-demand assessment.
- Runtime capability checks inspect CLI version/help and relevant features ([`AgentRuntime.detectCapabilities`](../../src/adapters.js#L582)). They do not establish every model's account entitlement. Runtime output is checked for an unexpected model ([`src/adapters.js:948`](../../src/adapters.js#L948)). Current usage recording is useful but is not a complete, deduplicated cost ledger.

### Stage contracts, persistence and review

- [`src/design-stages.js`](../../src/design-stages.js#L9) has stage-specific objectives, artifact names/types, bounded JSON validation, upstream context selection, fresh-session continuation and one bounded correction for invalid output. It rejects execution/write/branch requests and leaves document persistence to DevQuest. TRD/Plan approval and stage transitions remain backend actions.
- [`finishAgentRun`](../../src/agent-results.js#L10) validates assessments, worker blocker categories and integrated review results. Existing reasoning escalation is already distinguished from environment/permission/dependency failures and bounded by Quest limits.
- [`Store`](../../src/store.js#L23) stores JSON records in SQLite. Artifact revisions are unique files with content hashes; reads verify integrity. Runs persist purpose/stage/role, access scope, redacted CLI arguments, routing, runtime/session identifiers and usage; Jira runs additionally record skill registration/invocation and source artifact IDs.
- Some legacy continuations reuse the same run record and resolve policy again ([`Engine.runAction`](../../src/engine.js#L1821)). Design retries create a fresh run and retain recovery links; Codex policy-bound sessions restart logically; Jira clears native session context. There is no uniform immutable per-attempt profile/policy snapshot.
- [`ProductionReview.review`](../../src/production-review.js#L82) starts a separate read-only Reviewer run after integration and validation. It binds evidence to the integrated commit and cross-repository fingerprint. [`productionReview`](../../src/routing.js#L307) validates the verdict/categories; [`src/agent-results.js:150`](../../src/agent-results.js#L150) rejects stale evidence. Fixes run separately in isolated workspaces. Independence is currently session, role, permissions and exact evidence scope; it does **not** require a different vendor or model.
- Restart recovery preserves workspaces and stops automatic execution ([`Orchestration.recover`](../../src/orchestration.js#L497)). Profile migration must not turn recovery into automatic paid retries.

### Repository standards and instruction leakage

There is no explicit DevQuest loader/manifest for repository `AGENTS.md`, `CLAUDE.md` or engineering standards in the audited source. Agents can read repository files, and runtime auto-loading behavior varies, but neither constitutes a consistent, versioned standards input. Restricted Claude settings and the Codex scoped-reader path make relying on ambient user/project instructions especially unreliable.

The main leakage surfaces are:

1. Full skill text containing handoffs, execution choices or publication instructions that exceed the current stage.
2. Broad default context containing downstream plans/summaries, while isolated stages already use narrower source lists.
3. Checkpoints, task instructions, repository files or prior agent output being interpreted as workflow authority.
4. Native session history or a logical continuation reintroducing old model/tool/context assumptions.
5. Shared bootstrap guidance conflicting with a stage's output protocol or completion rules.
6. Separate prompt constructors drifting as new stages are added; heuristics alone cannot prevent all semantic leakage.

Existing stage validators, fresh sessions, denial classification and backend gates mitigate these risks. Profiles should consolidate composition and provenance; they must not replace those controls or claim to eliminate prompt injection.

## 2. Proposed profile schema

Use checked-in JSON definitions under `profiles/` and a small `src/agent-profiles.js` resolver when implementation is approved. Use Node validation consistent with this codebase; no schema package, editor, inheritance graph or remote registry is needed initially. `schemaVersion` versions the document structure; `identity.version` independently versions each profile's behavior. Any guidance, capability request or policy change creates a new immutable profile version/hash.

Illustrative **definition**, not implemented configuration:

```json
{
  "schemaVersion": 1,
  "identity": {
    "name": "Architect",
    "role": "architect",
    "description": "Evidence-based technical discovery and design",
    "version": "1.0.0"
  },
  "soul": {
    "principles": ["Prefer the smallest correct design", "Separate evidence from assumptions"],
    "specialization": ["Repository impact", "Architecture", "Compatibility and security"],
    "decisionStandards": ["Compare material alternatives", "Record unresolved risks"],
    "collaborationRules": ["Ask current-stage questions", "Stop at the stage boundary"]
  },
  "capabilities": {
    "tools": ["repository.read", "repository.search"],
    "skills": [],
    "mcpPermissions": [],
    "repositoryAccess": "selected-roots-read-only"
  },
  "execution": {
    "supportedStages": ["brainstorm", "analysis", "trd", "spec"],
    "runtimePolicy": "quest-selected-compatible-runtime",
    "modelPolicy": "existing-quest-routing",
    "effortPolicy": "verified-model-effort",
    "escalationPolicy": "bounded-evidenced-reasoning-only"
  },
  "quality": {
    "expectedOutputs": ["Current-stage artifact or current-stage questions"],
    "validationRequirements": ["design-stage-contract", "repository-evidence"],
    "completionCriteria": ["Backend accepts the stage result", "No next-stage operations"]
  }
}
```

Policy/validator strings are references to fixed application-owned implementations, never executable commands, file paths to arbitrary code or agent-defined permissions. Unknown fields/roles/stages/policy references fail validation. Optional search means capability-aware translation: Codex's current reader cannot promise general Glob/Grep. Required unsupported capabilities fail before inference; optional capabilities are reported as unavailable rather than silently emulated with shell.

### Six initial identities and Souls

All start at profile version `1.0.0`. Each complete resolved profile includes the shared rules: preserve security/data, use evidence, report uncertainty, respect approvals, avoid unrelated changes, never self-authorize tools or spawn agents. Shared text can be expanded by the resolver; avoid a user-programmable inheritance system.

| Name / role | Description and specialization | Decision standards and collaboration |
|---|---|---|
| Orchestrator / `orchestrator` | Risk and complexity assessment; dependency and routing advice | Explain evidence and uncertainty; suggest bounded policy decisions; never dispatch tools, stages or workers itself. DevQuest remains the orchestrator. |
| Architect / `architect` | Repository discovery, impact analysis, architecture and technical specifications | Inspect every relevant selected repository directly; compare meaningful alternatives; distinguish current behavior from proposals; ask only current-stage questions. |
| Planner / `planner` | Turn approved design into ordered, testable implementation tasks | Deliverables come from approved scope; stable IDs, explicit repository ownership/dependencies, validation and acceptance; no execution handoff within the same turn. |
| Developer / `developer` | Implement one assigned task, review fix or integration-conflict fix | Small coherent changes; preserve unrelated work; use backend test evidence; report blockers by category; hand off for independent review without self-approval. |
| Reviewer / `reviewer` | Independent production readiness across correctness, security, operations and compatibility | Inspect actual integrated changes; cite actionable evidence; missing evidence is NOT_VERIFIED; do not treat developer summaries as proof or edit the implementation. |
| Jira Specialist / `jira-specialist` | Execute the installed appendix/upload contracts faithfully | Approved plan is sole deliverable source; exact live categories/weights and stable IDs; authoritative Markdown; separate drafting, verification and explicitly approved publishing. |

### Capabilities and execution by profile

The following are **maximum requests**, further narrowed by the actual stage and backend policies. Every resolved profile must contain all schema sections, even when their values are empty arrays.

| Profile | Supported existing purposes/stages | Tools / skills / MCP / repository scope | Runtime, model, effort and escalation policy |
|---|---|---|---|
| Orchestrator | `v11-route` assessment | Repository reads, optional supported search; no workflow skill/MCP except the scoped repository reader on Codex; selected roots read-only | Compatible explicitly selected runtime. Later: on-demand permitted Opus/high for Claude; Codex requires its own explicit verified model policy. No recursive orchestrator or automatic reasoning chain. |
| Architect | Brainstorm, Analysis, TRD, existing Spec | Repository reads/search where supported; only approved stage-safe design guidance; selected roots read-only; no external MCP | Existing Quest route initially. Later Sonnet normal, permitted Opus for evidence-backed high risk/complexity. Verified effort; bounded reasoning escalation only. |
| Planner | Plan | Repository reads/search; planning skill guidance only where compatible with the read-only plan contract; no execution skill/MCP; selected roots read-only | Existing Planner overrides preserved. Later Sonnet normal, high complexity/risk uses permitted Opus. Verified effort; no automatic move to Execute. |
| Developer | Task, review fix, conflict fix; legacy equivalents | Read/search/edit/write in assigned task/fix workspace only; installed implementation guidance; no arbitrary shell, external MCP or native nested spawning | Existing Developer overrides and limits; later low-risk Haiku eligibility, Sonnet normal, Opus complex/high risk. Escalate only on evidenced reasoning complexity within budget. |
| Reviewer | Existing task/repository review and `v11-review` | Read-only relevant integrated workspaces; review evidence and backend validation; no editing, implementation skill, write MCP or developer session reuse | Existing independent Reviewer runtime/model overrides; later Sonnet/high, Opus/high for high risk/complexity. Failed review alone never authorizes escalation. |
| Jira Specialist | Appendix draft, publication preparation, approved sample/batch publication | Native `create-appendix-task-list` / `upload-task-to-jira`, unchanged; artifact-scoped filesystem reads; stage-scoped Atlassian MCP; publication write permission only from exact approval | Native Claude required by current skill integration. Initially inherit the existing Planner route explicitly; add a Jira override without invalidating that inheritance. Future lower-cost choices require verified skill/model capability. No fallback to a substitute generator or Codex proof. |

Backend commit-message preparation remains an existing utility purpose: map it to Developer identity with a **read-only** stage overlay and unchanged office skill; it cannot inherit Developer write access. Legacy review gets a Reviewer overlay. Backend Git, tests, Jira publication approval and PR creation remain typed operations, not general capabilities granted to a Soul. Enumerate all launch purposes before enabling profiles; an unmapped purpose must block profile-mode launch rather than inherit a permissive default.

### Quality contract by profile

| Profile | Expected output | Backend validation | Completion criterion |
|---|---|---|---|
| Orchestrator | Structured Quest/task assessment with evidence | Existing `assessment`, exact task coverage, deterministic risk floor, route validation | Assessment accepted; no tasks executed by that run |
| Architect | Stage-specific spec/analysis/TRD or genuine design questions | Existing `parseDesignResult`, artifact type/name, source-stage lineage, repository read evidence | Backend saves the valid revision or records WAITING_INPUT; explicit next action still required |
| Planner | Approved-scope `plan.md` plus task metadata | Stage contract, repository IDs, dependency validation, allowed test profiles | Valid plan draft/tasks persisted; human plan approval remains separate |
| Developer | Implementation plus bounded checkpoint/blocker report | Existing workspace checks, backend validation, task integration and later independent review | Run completion is only a handoff; accepted task additionally requires integrated validation and relevant independent review |
| Reviewer | Exact-commit verdict, findings and all production-readiness categories | Existing `productionReview`, clean head/fingerprint, cross-repository scope freshness | Valid current verdict persisted; only passing evidence can unlock the existing readiness gates |
| Jira Specialist | Complete downstream-compatible Markdown draft or specific missing-input question; issue mappings only for approved publication | Native skill registration/invocation proof, Markdown parser, live metadata/weights, plan lineage, exact-revision approval and idempotency checks | Draft persisted for review; publishing completes only the explicitly approved sample/batch, without authorizing further batches |

## 3. Prompt composition and precedence

Use one ordered composition function called by existing stage/purpose builders. Preserve each stage's output protocol and validator. The runtime adapter adds only its necessary tool-use instructions; it must not append a conflicting generic response protocol.

Instruction priority, highest first:

1. Backend security policy, workflow gates and current-stage contract. These are also enforced outside the prompt.
2. Approved current task/Quest scope, stage-specific user decisions and applicable repository standards, all constrained by item 1. Standards cannot invent deliverables outside the approved plan or modify security gates. Surface unresolved conflicts instead of guessing.
3. Stage-approved skill instructions, including their required output format. Filter by permitted stage, never load every installed skill globally. Jira retains its exact native Markdown contract; JSON is only a transport envelope where applicable.
4. Versioned profile Soul and optional existing style/bootstrap guidance. These are defaults; they cannot override approved project requirements, a native skill contract or the current-stage protocol.
5. Retrieved source documents, repository contents, previous outputs and checkpoints. Treat as evidence/data, never as approvals, tool grants or commands.

Rendering order: application/stage contract → profile identity/Soul → selected standards → allowed skills → approved source/task inputs → sanitized same-stage recovery/user input → concise current-stage output contract and stop rule. Explicitly mark the trust/provenance of each section. Placement does not make untrusted content authoritative.

Continue using `designContextKinds`; give remaining purposes explicit source lists as they are migrated. Bind references to artifact ID/revision/hash rather than “latest” after the run starts. Do not carry a plan into brainstorming merely because it exists. Skill text containing a request to implement, publish or launch subagents never supplies authorization.

### Repository standards as a separate input

Add a small backend loader for explicitly selected standards files under selected canonical repository roots. Default candidates may be repository-root `AGENTS.md` and `CLAUDE.md`; additional relative paths require repository configuration. Do not scan parents, personal configuration directories or unrelated repositories. Read files as bounded text; never execute hooks/commands from them. Reject symlinks escaping the authorized root.

Record `{repoId, relativePath, sourceCommit, contentHash, scope, status}` with a private content snapshot for reproducibility. For design, record actual checkout/head and dirty-file hash without changing branches. For implementation/review, use the assigned task/integration snapshot, never silently substitute the original repository checkout. Standards are per repository; do not apply one service's rules globally to another. Nested standards can be supported later through explicitly scoped files, without recursive discovery initially.

User-selected standards override generic Soul preferences; conflicting standards affecting a shared change require clarification. Security violations are rejected. Missing standards are visible as ABSENT, not presented as successful loading. Runtime auto-loading must be disabled/isolated where supported or accounted for explicitly; if unknown extra instructions cannot be excluded for a required reproducibility/security property, block that adapter path rather than claim equivalent behavior.

## 4. Capability and permission model

Compute effective permissions as the intersection of:

`application invariants ∩ stage ceiling ∩ repository/Quest authorization ∩ profile capability requests ∩ verified runtime support`

Quest capability overrides may narrow this result. Existing authorized runtime/model/effort overrides remain supported within their separate allowlists. A Soul edit, a repository standard, a skill frontmatter declaration or model output cannot enlarge the stage ceiling. Keep profile guidance text and capability resolution as separate inputs, with separate hashes.

Abstract tools map to the existing adapters: Claude Read/Glob/Grep and Edit/Write as applicable; Codex scoped reader for read-only file access; fixed backend validation/Git outside the model's toolset. Do not translate “search unavailable” into Bash. Preserve controlled parallel Developer runs in `TaskScheduler`; nested runtime spawning remains false for all profiles. DevQuest's scheduler is the only worker launcher.

Jira overlays remain separate: generation = four metadata reads; preparation = seven reads; approved publication = those reads plus scoped create. Unknown tools and update/delete/transition remain denied. Do not use `--tools` alone to restrict MCP writes. Keep explicit selected MCP configuration, OAuth handled by the existing runtime integration, and the app-owned pre-dispatch guard. Record connection identity/status and allowed operations, never tokens or secret-bearing configuration.

Each launch must verify scope after canonicalization, supported enforcement flags, required skills and required MCP capabilities **before paid reasoning**. Required failures name the missing capability/remediation. OS preflight, native skill registration, accepted invocation and completed execution are distinct proof states. Never convert one into another or fabricate unread repository analysis.

## 5. Model/effort policy and cost-aware routing design

### Resolution and compatibility

Keep `modelId`, the explicit verified registry and `resolveRoute` as the enforcement point. Profiles request families/policies; runtime-specific resolution selects exact IDs. Sonnet/Haiku/Opus apply to Claude only. Codex uses a separately permitted Codex model/effort configuration; do not invent cross-vendor family equivalence or automatically switch runtimes. A Claude-only workspace must function with Codex absent. Native Jira remains Claude-specific until independently compatible integration exists.

For the initial profile phase preserve current precedence and record every source. Current model precedence is explicit Quest-wide pin → role override → workspace role route/recommendation → dynamic family; the Orchestrator has its own explicit selection. Retain existing effort precedence until a separately approved policy migration, including the current workspace-route effort behavior. Do not fix surprising override semantics as an incidental profile refactor. In the later routing phase, propose an explicit consistent precedence: Quest-wide pin → role override → workspace role route → profile default → deterministic recommendation, with a visible migration preview for affected Quests.

Then intersect the request with verified runtime, available/verified model IDs, allowed/denied families and exact model-supported effort set. Recheck on each launch. Fable must be rejected in definitions, overrides, recommendations, fallbacks and runtime-reported usage. No “best/default/inherit” model alias. Runtime inheritance is distinct and remains supported.

An explicit unavailable model/effort blocks with an actionable error. A dynamic family may use only a configured safe fallback, preserving risk requirements; log the request, resolution and reason before launch. No implicit effort downgrade or runtime substitution. If Opus is requested but unavailable, do not relabel a Sonnet run as Opus. CLI help support is not proof of model entitlement, and a registry entry can become stale; fail safely on runtime rejection and retain the failed attempt.

### Deterministic initial classification

Use a fixed, versioned classifier in the existing routing path before considering an AI assessor. Inputs are structured approved task metadata, affected repository count, dependency graph, explicit risk flags, expected change scope and available validation. Do not classify unknown work as low risk just because its title says “simple.” Record matched rules, evidence, unknowns and classifier version.

Proposed rules, evaluated in order:

| Evidence | Minimum routing class |
|---|---|
| Security/authorization boundary, secrets handling, irreversible data/schema change, financial correctness/integrity, destructive migration, or explicitly critical impact | HIGH/CRITICAL risk; permitted Opus/high for Claude; stop if the required safe route is unavailable |
| Cross-service protocol/transaction change, complex concurrency, unclear architecture, large dependency scope | COMPLEX/VERY_COMPLEX as appropriate; Opus when complexity or risk requires it; request clarification/assessment for uncertainty |
| Bounded feature or bug fix with clear acceptance, normal scope and meaningful validation | MODERATE/MEDIUM; Sonnet/medium, or high when the verified policy requires deeper reasoning |
| Localized mechanical edit, explicit LOW risk, no API/schema/security change, small known scope, adequate validation and no unresolved unknowns | SIMPLE/LOW; Haiku/low or medium if compatible |
| Missing scope, weak validation or contradictory requirements | At least MODERATE/MEDIUM plus uncertainty; Sonnet or WAITING_INPUT; never infer low risk from missing evidence |

Thresholds for scope must be documented constants and fixture-tested during implementation, not opaque model judgment. Deterministic flags are a floor. Model advice cannot lower a hard risk floor; authorized humans can correct erroneous input with an auditable reason, subject to backend policy. Repository-specific payment/API/domain standards remain repository inputs, not hardcoded global Soul knowledge.

Invoke the existing Orchestrator assessment on demand for unresolved architecture/routing decisions, hard uncertainty, or explicit user request. Use a permitted Opus/high route only if configured and available. It returns advice in the existing assessment protocol; the backend validates and decides. Keep a manual route free of mandatory AI assessment. Do not run an Opus planner for every ordinary task merely because profiles exist.

### Review failures and bounded escalation

Classify evidence before selecting a response:

| Failure class | Response |
|---|---|
| Environment/dependencies, authentication, quota, filesystem/permission, unsupported tool | Repair configuration/dependencies or request help; no model upgrade |
| Invalid stage/protocol output | Existing bounded same-stage correction with unchanged permissions/model; stop at the limit |
| Concrete correctness/test/regression finding | Scoped fix at the current suitable model; revalidate and independently review |
| Security/architecture finding exposing new high-risk scope | Reclassify the work and require policy/approval as applicable; a route change follows the new evidence, not the word FAILED |
| Evidenced reasoning complexity after a valid attempt | One permitted step Haiku→Sonnet or Sonnet→Opus if dynamic policy, pinning and budgets allow; otherwise human attention |
| Inconclusive review, missing evidence or stale integrated head | Gather permitted evidence or rerun fresh review; never fabricate PASSED or escalate by verdict alone |

Reuse the existing retry/escalation/review-cycle limits. Escalation is at most the current configured ceiling (currently up to two model steps); fixes also consume existing retry/review budgets. No automatic escalation of a pinned model, no cycle resetting through a new profile version, and no upgrade merely because a review failed. A later profile version cannot increase an already authorized Quest budget.

### Requested, resolved and actual accounting

Retain separate requested/resolved model and effort, route reason, fallback/escalation reason and actual reported model. Actual effort may be unknown when the CLI does not report it; label it unknown rather than claiming verification from argv alone. Record profile/runtime capability/registry policy versions and verification time so a decision is explainable later.

For total cost per accepted task, add normalized per-attempt usage to the existing run records: input/output/cache tokens, actual provider cost when reported, otherwise a clearly marked estimate with pricing snapshot/currency/time. Unknown cost is null, never zero. Handle cumulative session usage versus per-turn usage explicitly to avoid double counting. Capture failed/rejected attempts when the runtime supplies usage; visibly report missing usage coverage.

An accepted task is integrated, backend-validated work covered by a current passing independent production review; task `COMPLETED` alone is not sufficient if production review is still pending. Reopening invalidates current acceptance while retaining the historical acceptance event. Report direct implementation/retry costs and an explicitly documented allocation of shared assessment/review/fix costs separately, then their total divided by accepted tasks. Include failed attempts; disclose abandoned Quest cost separately. Use equal allocation among the assessment's tasks and the review/fix scope's tasks initially, with an unallocated bucket when no eligible tasks exist. Jira/document generation remains visible as Quest overhead and separately allocated once if presenting a fully loaded total. No double counting shared runs or revisions; no denominator when zero tasks are accepted. Preserve existing token-budget enforcement while correcting its accounting in the separately approved cost phase.

## 6. AgentRun lifecycle integration

Keep the current launch pipeline; insert profile resolution before `Engine.launch` constructs the runtime call:

1. Typed action validates stage, approvals, source artifact identities and current repository/task ownership.
2. Resolve a pinned profile version, existing overrides, stage overlay and recorded standards/skill inputs.
3. Resolve model/effort through the existing registry; validate required adapter support and budgets.
4. Rebuild canonical access scope; preflight required directories, selected skill and applicable MCP metadata. Retain exact failure evidence without inference.
5. Persist an AgentRun snapshot before reasoning starts; record preflight failures as non-executed attempts without altering prior artifacts.
6. Existing adapter translates the resolved policy into restricted flags, selected tools and MCP hooks. Persist sanitized effective arguments/status and observed skill/read evidence.
7. Existing stage/result validators accept or reject output. Only backend gates persist artifacts, integrate, approve or publish.
8. Retry/continue reconstructs the authorized context and creates a fresh attempt; never revive stale stage instructions or grant sets.

Proposed additive run fields:

```text
profile: {schemaVersion, role, name, version, hash, snapshot}
policy: {resolverVersion, stageContractVersion, requested, resolved,
         overrideSources, registryHash, runtimeCapabilities,
         tools, skillManifest, mcpScope, repositoryScope,
         standardsManifest, inputArtifacts, budgets, fingerprint}
prompt: {compositionVersion, hash, privateSnapshotRef}
attempt: {previousRunId, rootRunId, attemptNumber, reason}
accounting: {normalizedUsage, cost, costSource, coverage, acceptanceLinks}
```

The snapshot contains the resolved profile and nonsecret policy, not credentials. Sensitive prompt/standards snapshots remain private local files with bounded size and integrity hashes; UI summaries expose provenance, not environment secrets. Pin profile content, standards content, skill content hashes, inputs and policy decisions, not merely a mutable path named “current.” Security capabilities still revalidate before any continuation; saved grants are evidence, not reusable authority.

For profile-managed runs, never overwrite a finished attempt's routing/profile snapshot. Use a new existing `runs` row with predecessor links for each reasoning turn/retry. If the predecessor is WAITING_INPUT/PAUSED, atomically release its active ownership (for example SUPERSEDED) before inserting the new active attempt; preserve the existing per-task unique index and prevent two running processes. On launch failure, retain a failed child and keep a recoverable predecessor/checkpoint. UI actions can keep accepting the previous run ID and return the new run ID; update their callers/fixtures accordingly. Do not create a second attempt store.

Continue with the same pinned profile by default. A profile change requires an explicit new attempt with visible old/new version and reason, never an in-place edit or automatic adoption of “latest.” Source or capability changes rebuild the policy and may require fresh artifact approval. Native Claude resume is eligible only within the same role/stage and matching profile, prompt inputs and effective policy, with revalidated grants; otherwise restart logically. Preserve the current fresh design/Jira/Codex policy-bound paths. Reviewers always get fresh sessions, including after a fix, with independent context and exact scope; never reuse a Developer session.

## 7. Backward compatibility

- Keep `workflowVersion` and profile schema version independent; adding a Soul does not create another Quest workflow engine.
- Existing Quests retain modes, stages, artifacts, tasks, Jira context, approval history and role overrides. An optional `profileVersion`/`profileSchemaVersion` marker distinguishes adoption; absence means legacy behavior, not an invalid Quest.
- Offer explicit adoption while idle, using the current active-run/operation guard for configuration changes. Show the effective routing/permissions comparison before adoption; no restart, inference or new publication is implicit.
- Initially map Architect/Planner/Developer/Reviewer directly, Orchestrator's special route explicitly, and `JIRA_APPENDIX` to Jira Specialist with **recorded Planner routing inheritance**. Preserve the old role value for historical display or expose a derived label; do not rewrite history.
- Existing installed Jira skills remain unchanged byte-for-byte. Preserve original Markdown/revisions, exact-revision approval and duplicate-publication protection. A profile version change is not Jira approval.
- Default profile requests must not add tools, original-repository writes, unrelated MCPs, additional roots, shell or nested workers. Existing manual model/runtime/effort configuration must produce the same route in the compatibility phase.
- Nonessential style bootstrap can be represented as a recorded guidance input without claiming native execution. Do not silently apply Claude-only preferences to Codex or make optional skills mandatory for unrelated stages.

## 8. Data migration requirements

The current SQLite tables store JSON, so the initial profile fields need no destructive SQL table rewrite and no new profile database/service. Checked-in immutable definitions plus per-run snapshots are sufficient initially. Add any future indexes only after measured query needs.

Migration steps after approval:

1. Back up the database and artifact directories using the app's documented local procedure; run migration tests against copied fixtures, never the live Quest as a test fixture.
2. Add readers tolerant of absent profile/policy/accounting fields. Historical run profile version remains unknown/legacy; a derived role label is not proof of an exact historical prompt or policy.
3. New profile-managed launches write complete snapshots. Do not backfill invented versions, capabilities, actual efforts or costs into old runs.
4. Add predecessor links for new attempts and update UI selection, action responses and history presentation. Keep existing run/artifact/approval IDs and files intact.
5. Store optional Quest profile pins and standards references only on explicit adoption/configuration. Active jobs finish under their original configuration.
6. Rollback disables new adoption while retaining snapshots and all data. An older binary must not resume profile-managed runs it cannot interpret: either refuse those launches with an actionable message or use a reviewed compatibility release. Do not claim rollback is safe merely because JSON accepts extra fields.

Migration acceptance: unchanged artifact IDs/hashes, approval basis, issue mappings, branch ownership, workspace paths and existing failed-run history; no source edits, branch deletion or automatic generation.

## 9. Incremental implementation phases

Each phase is separately reviewable; implementation begins only after this proposal is approved.

| Phase | Smallest complete deliverable | Reuse / expected touchpoints | Exit condition |
|---|---|---|---|
| 1. Definitions and recording | Six validated immutable definitions, pinned resolution and run snapshots; no routing change | New `profiles/` + small resolver; `Engine.launch`, `Orchestration.launch`, Jira launch, config example, profile/engine tests | Legacy routes/capabilities identical; every newly adopted run explains its profile/policy |
| 2. Composition and standards | One composer using existing stage builders, separate per-repo standards manifest and hashes | `design-stages`, scheduler, review prompts, adapter bootstrap/instructions, `Engine.context`; fixtures/tests | Stage output protocols unchanged; no downstream leakage or additional filesystem grants |
| 3. Adapter capability translation | Explicit required/optional capability validation and managed skill/MCP proof states | Existing Claude/Codex args, repository reader, SkillRunner, Jira hooks/preflight | Both adapters fail closed on unsupported required capabilities; Jira native contract and Markdown remain intact |
| 4. Attempts, recovery and UI | Uniform per-attempt provenance, fresh reviewer sessions, compact profile/policy details in existing AgentRun UI | Existing `runs` JSON, resume/retry/recovery paths, action callers, `public/app.js`, migration fixtures | Restart/continue preserve history and enforce current scope; active work not reconfigured |
| 5. Cost-aware policy | Deterministic classifier, Sonnet-first normal routes, narrow Haiku eligibility, on-demand Opus assessment and evidence-based escalation | `routing`, assessment dispatch, `agent-results`, existing scheduler limits/decisions | Explicit opt-in policy migration; deterministic fixtures, overrides/allowlist preserved; FAILED never alone upgrades model |
| 6. Cost/acceptance accounting and release proof | Deduplicated usage/cost coverage and accepted-task metrics, final compatibility regression | Existing run usage/decisions/review/integration records and focused UI | Unknowns visible; shared cost allocated once; full regression passes with no real publishing |

Do not add a profile editor, remote marketplace, automatic self-improving Soul, arbitrary command templates, new orchestration agents or a generic MCP capability broker in these phases. Treat stage contracts as existing executable authority referenced by profiles; avoid duplicating validation rules in profile text.

## 10. Security risks and mitigations

| Risk | Required mitigation |
|---|---|
| Profile activation bypasses local application protections | Use existing authenticated typed actions and idle-configuration guards; preserve localhost Host/Origin checks and session-token validation in `src/server.js`; no generic command/configuration execution endpoint |
| Soul or repo standards claim new permissions | Backend intersection and fixed policy references; adversarial tests proving prose changes cannot alter grants |
| Skill handoff leaks into execution/publication | Stage allowlist, isolated prompt inputs, existing validators and separate approval actions; no global skill load |
| Claimed runtime parity exceeds real enforcement | Adapter support matrix, explicit required capability failure, preserve Claude restricted mode and Codex reader restrictions |
| Repository symlink/parent traversal or stale grants | Existing canonical preflight/reader checks on each launch; no common-parent discovery; reject unrelated roots |
| MCP reads become writes | Existing selected-connection config and pre-dispatch allowlist; exact approved publication scope; unknown operations denied |
| Resume changes model/profile without trace | Immutable per-attempt snapshot, pinned profile, policy comparison and fresh logical sessions on mismatch |
| Reviewer independence weakened | Fresh read-only reviewer session, integrated evidence only, exact commit/cross-repo freshness, separate fix worker |
| Prompt/provenance snapshots expose credentials or company data | Local private files, redaction, bounded retention/export rules, no secrets in policy/logs or requests to another provider |
| Increased cost through retries/assessment loops | Existing shared limits, evidence-based failure taxonomy, no implicit paid tests, no “FAILED → upgrade” rule |
| Trusted profile file replaced in place | Version plus content hash; immutable run snapshot; mismatch invalidates activation and cannot rewrite history |

Prompt precedence cannot prevent all malicious instructions. Security acceptance depends on executable enforcement and real denied-operation evidence, not model obedience. The application cannot claim protection from a malicious local OS user who can edit its code/database; this feature must not expand the existing local trust boundary.

## 11. Regression and verification strategy

Start with existing Node tests and fake adapters. No paid calls are required to implement deterministic resolution, prompt composition or permission tests. Use localhost API/MCP stubs and disposable Git fixtures; never real company documents or real Jira writes.

| Area | Required checks |
|---|---|
| Profile schema/versioning | Six complete profiles; unknown schema/role/policy rejected; changed content changes hash; old version stays reproducible; missing version never means latest |
| Compatibility/overrides | Legacy Quest loads; existing manual/runtime/role/effort results preserved; Jira inherits Planner explicitly; optional styles/skills absent; Claude-only workspace with Codex unavailable |
| Composition/stage leakage | Correct precedence/source manifests; each design stage excludes downstream documents; malicious checkpoints/standards/skill handoffs cannot authorize Execute, shell, branches, agents or publishing; current structured protocols remain unchanged |
| Repository standards | Two repositories with different rules; paths with spaces; dirty design file provenance; task vs integrated snapshots; missing/oversize files; symlink escapes; no parent/global discovery; no project-specific rules in global Soul |
| Filesystem/tool scope | Both selected sibling repositories readable; parent and unselected sibling denied; preflight per root; fresh/resumed grants; Developer task/fix writes only; Reviewer read-only; base branch differs from current checkout |
| Runtime translation | Exact expected Claude/Codex flags; unsupported required flags/capabilities stop before inference; optional search explicitly unavailable; no shell substitutes; nested spawning blocked; native skill registry/invocation/execution proof distinguished |
| Jira contracts/MCP | User MCP exclusion under restricted settings; selected managed MCP only; auth/connection/tool failures; generation writes denied by guard even if visible; live metadata fixture validation; realistic original-skill Markdown accepted downstream; fresh approval after edits; idempotency/ambiguous create reconciliation with fake publisher |
| Model/effort resolution | Fable/aliases rejected at every input and observed-output path; unverified/unavailable IDs blocked; exact unsupported efforts blocked; only explicit compatible fallbacks; requested/resolved/actual separate; no silent runtime substitution |
| Classification/escalation | Stable deterministic risk rules, unknowns not low, high-risk floor cannot be lowered by AI, normal Sonnet/eligible Haiku/high-risk Opus; no mandatory paid assessor; infra/test/stale/FAILED alone do not escalate; explicit pins and combined budgets respected |
| Lifecycle/concurrency | New attempt links without overwritten history; atomic active ownership; two concurrent Developers cannot share task workspace; existing five-worker cap; pause/cancel/restart preserve edits; failed child recoverable; profile update cannot reconfigure live run |
| Review/acceptance | Fresh independent sessions; exact integrated head and cross-repo fingerprint; stale result invalidation; fixes separately validated; no self-approved acceptance or publication |
| Accounting | Session cumulative vs turn usage, cache token normalization, failed usage, missing cost, shared run allocation, zero accepted tasks, reopen history; totals match underlying once-counted attempts |
| Migration/UI | Copied legacy DB; artifact hashes/approvals/issue mappings unchanged; old/new history display; action follows successor run ID; existing RPG page layout remains intact; no automatic restart or publish |

Reuse `test/routing.test.js`, `test/design-stages.test.js`, `test/access.test.js`, `test/repository-reader.test.js`, `test/orchestration.test.js`, `test/adapters.test.js`, `test/engine.test.js`, `test/appendix.test.js`, `test/jira-mcp.test.js` and existing UI tests/fixtures. Add one focused profile test file rather than duplicating the workflow suite. Finish implementation phases with `npm test`, `npm run check` and diff validation. If native CLI behavior later needs inference, request separate bounded approval; fake/stub success is not proof of paid native generation or current account entitlement.

## 12. Acceptance criteria and approval scope

1. All six profiles resolve with complete schema, immutable version/hash and stage-specific capability requests; no new orchestration layer or dependency.
2. Every profile-managed AgentRun/attempt records exact profile, instructions provenance, input revisions, requested/resolved policy, runtime capability evidence and actual outcomes without secrets.
3. Soul/standards/skills cannot expand backend permissions; original repositories, protected branches, selected roots and isolated worktree behavior remain protected.
4. Guided/Autonomous, all existing design/Jira stages, multi-repository access and parallel Developer runs work through the same existing workflow actions.
5. Reviewer runs remain fresh, read-only and independent; stale or failed review cannot unlock readiness. Model/vendor differences are optional, session independence is mandatory.
6. Legacy Quests/overrides/history/artifacts/approvals survive adoption and rollback; unknown historical versions/costs are not fabricated.
7. Installed Jira skills are unchanged; real compatible Markdown remains authoritative; generation cannot publish; only an explicitly approved exact revision can reach the scoped publisher.
8. Verified allowlist, exact effort compatibility, explicit safe fallbacks and Fable exclusion apply across all profile/routing/retry paths; unavailable pinned choices block visibly.
9. Later cost-aware routing uses deterministic risk evidence, Sonnet-first normal work, bounded Haiku eligibility, justified Opus and on-demand assessment; a FAILED verdict alone never upgrades a model.
10. Acceptance/cost metrics are attributable, deduplicated and honest about unknowns; retries do not bypass limits.
11. Focused and existing regression suites pass without real Jira writes; any native runtime/inference claims are supported by separately authorized evidence.
12. Implementation is reviewed phase by phase; approving this document authorizes only the phases explicitly approved by the user.

## Audit verification and remaining limits

This deliverable is documentation only. The audit inspected source paths and existing test coverage; it did not execute the regression suite, launch an AgentRun, inspect company repository contents, modify installed skills or change live Quest data. No paid Claude/Codex calls, Jira publishing, commits, pushes or PRs were performed.

CLI/model entitlement, actual native invocation behavior and the proposed profile/routing behavior were not reverified live. They remain future implementation/validation gates. Existing code/test references establish reuse points and current intent, not proof that this unimplemented design already works. No implementation phase starts until this architecture proposal is reviewed and approved.

# DevQuest engineering Agent Souls

These six Markdown profiles remain the canonical definitions, version `1.0.0`, with their reviewed `status: proposed` metadata. **v1.2.1 now supports explicit per-Quest runtime opt-in.** Existing Quests remain legacy until adoption; editing a file never changes a running AgentRun, model, permission or installed skill.

See [runtime integration](../docs/v1.2/runtime-integration.md) for the implemented behavior and compatibility rules. The design discussion below records the original proposal; statements describing future snapshots, composition and provenance are superseded by that implementation report. Cost-aware model recommendations remain proposed and inactive.

New Quests can select **Enable versioned Agent Profiles**. Existing idle Quests can select **Enable reviewed Agent Profiles** in their overview. Adoption pins all six versions and hashes. Updates require a version bump and explicit refresh; prior attempts always retain their original Soul and configuration. Backend contracts and existing model routing remain authoritative.

A Soul describes engineering judgment, working methods and quality standards. It is not a persona or a security mechanism. DevQuest uses these definitions to prepare consistent, reviewable behavior across its existing Claude Code and Codex adapters, without replacing the deterministic workflow engine.

## Profiles and stages

| Profile | Engineering responsibility | Workflow stages / existing purpose | Maximum intended access |
|---|---|---|---|
| [Orchestrator](orchestrator.md) | Engineering Lead / Technical Decision Coordinator | On-demand assessment; existing `v11-route` | Selected repository roots, read-only; advice only |
| [Architect](architect.md) | Principal Software Architect | Brainstorm, Analyze, TRD; existing legacy Spec where explicitly selected | Selected repository roots, read-only |
| [Planner](planner.md) | Senior Technical Lead / Implementation Strategist | Plan; refinement through the existing Plan action | Selected repository roots, read-only |
| [Developer](developer.md) | Senior Software Engineer | Task, review fix, integration-conflict fix | Assigned task/fix worktree only |
| [Reviewer](reviewer.md) | Independent Production Readiness Engineer | Independent integrated production review; legacy review overlay | Relevant integrated workspaces, read-only; fresh session |
| [Jira Specialist](jira-specialist.md) | Engineering Delivery Coordinator | Appendix generation, review preparation, explicitly approved publishing | Approved document scope; separately restricted Atlassian operations |

Guided and Autonomous modes use the same stage and permission ceilings. Parallel Developers remain scheduled by DevQuest, each in an assigned worktree. No profile grants nested spawning, merging or release authority. Human reviewers remain the final PR gate.

## Definition format and versioning

Each file has valid YAML frontmatter: unique stable `id`, human-readable `name`, semantic `version`, stable `role`, and `status: proposed`. The nineteen required sections cover identity, Soul, execution, capabilities, quality and audit contracts. They correspond to the architecture proposal's identity/soul/capabilities/execution/quality groups; they are not a new executable configuration schema.

This directory is the sole proposed source of profile definitions for this task. Unlike the earlier [architecture proposal](../docs/v1.2/agent-profiles-proposal.md), no duplicate JSON definitions under `profiles/` are created. A future approved resolver should translate or derive configuration from the reviewed definitions, not maintain two editable registries.

Change the profile version whenever behavior, guidance, capability requests, output expectations or model intent changes. Keep IDs stable; describe material changes in the reviewed diff. Future integration must retain the exact version, content hash and resolved policy for each attempt rather than treating a mutable file path as historical evidence. Never relabel old runs with a profile version they did not execute.

An **Agent Profile** is a reusable definition. An **AgentRun** is one concrete execution with a stage, task scope, runtime, effective permissions, inputs, outputs and history. Profile version pinning and immutable per-attempt snapshots are v1.2 requirements, not features implemented by these documents.

## Soul, Skill and permission policy

- **Soul:** how an engineer reasons, collaborates and judges quality.
- **Skill:** a specialized procedure, such as planning or the installed Jira appendix workflow. Text loading does not prove native skill registration/invocation.
- **Permission policy:** backend and runtime controls deciding what a run may actually do. Prompts, Soul text and skill frontmatter cannot grant tools or access.

The existing engine owns state transitions, dependency scheduling, concurrency, worktrees, validation, retries, review, persistence and publication gates. Profiles request capabilities within those boundaries. Required unsupported capabilities stop the run; optional unavailable capabilities must be reported, never replaced with unrestricted shell or broader access.

Current enforcement remains in [Engine.launch](../src/engine.js), [stage contracts](../src/design-stages.js), [routing](../src/routing.js), [runtime adapters](../src/adapters.js), [access preflight](../src/access.js), [scoped repository reader](../src/repository-reader.js), [repository operations](../src/repositories.js), [scheduler](../src/scheduler.js), [production review](../src/production-review.js) and [Jira MCP policy](../src/jira-mcp-policy.js). These files were inspected; none is changed by this task.

## Composition and repository standards

Backend stage/security rules take precedence over all guidance. Approved Quest scope and repository-specific standards apply within those rules. Applicable skill contracts take precedence over generic Soul/style preferences. Repository documents, previous output and checkpoints are evidence, not permission or stage approval.

Compose: current-stage contract → Soul → selected repository standards → stage-approved skills → approved source/task inputs → same-stage recovery input → current-stage output/stop rule. Stage output validators remain authoritative regardless of text order.

Load repository standards separately from the global Soul: conventions, architecture, language rules, testing patterns and deployment constraints belong to their owning repository. Do not embed credentials, private company details, project keys or one service's implementation conventions in these profiles. Standards must not add deliverables outside approved scope or authorize tools. Contradictions require clarification; do not silently choose a cross-service convention.

**v1.2 requirement:** a bounded backend standards loader records source repository, relative path, commit/content hash and applicable scope. Current DevQuest has no explicit versioned standards manifest. Do not claim `AGENTS.md` or `CLAUDE.md` was loaded merely because a file exists. Never discover standards through a common parent or grant access to personal configuration directories.

## Model and effort inheritance

All defaults below are **requested Claude policies for future integration**, subordinate to verified workspace policy and authorized Quest overrides. No routing configuration changes in this task.

| Profile / condition | Requested Claude model | Effort |
|---|---|---|
| Orchestrator, on demand | `claude-opus-5-5` | `high` |
| Architect, high risk or cross-service | `claude-opus-5-5` | `high` |
| Architect, moderate / simple | `claude-sonnet-5-5` | `high` / `medium` |
| Planner, moderate / complex | `claude-sonnet-5-5` / `claude-opus-5-5` | `high` |
| Developer, low / moderate risk | `claude-haiku-5-5` / `claude-sonnet-5-5` | `medium` |
| Developer, HIGH risk target | `claude-sonnet-5-5` | `high`, only after separate risk-policy approval; see conflict below |
| Developer, CRITICAL risk | `claude-opus-5-5` | `high` |
| Reviewer, normal / high risk | `claude-sonnet-5-5` / `claude-opus-5-5` | `high` |
| Jira Specialist | `claude-sonnet-5-5` | `medium`, proposed dedicated default |

The local registry inspected on 2026-10-18 marks those three IDs available and verified, with `low`, `medium`, `high`, `xhigh`, `max` efforts. This is configuration evidence only, not a fresh account entitlement or paid execution test. The example configuration is not evidence of availability. Model/effort compatibility must be checked again at actual launch. Fable is forbidden in all selections, fallbacks and reported usage.

Preserve current resolution: Quest-wide explicit pin → role override → workspace role route/recommendation → dynamic family; Orchestrator has a separate selection. Effort keeps the existing resolver's precedence, including role/workspace effort handling. Profiles cannot silently take precedence over these settings. Explicit unavailable or incompatible choices block; dynamic routing may use only explicitly permitted safe fallbacks. Report requested versus resolved choices and reasons. Do not silently change runtime or effort.

Claude family names do not imply Codex equivalence. For Codex, require a separately verified permitted model and effort for that adapter; do not invent a model ID or map Sonnet to an arbitrary Codex model. The inspected local registry contains no Codex entries, so a Codex launch needs explicit registry configuration. Claude-only environments must work without Codex. Jira's current native-skill integration requires Claude; Codex success cannot prove native Claude skill execution.

### Differences and unresolved policy decisions

1. **HIGH-risk Developer:** the requested Sonnet/high target differs from both the proposal and current backend, which reject lowering HIGH/CRITICAL risk below Opus-family rank for Claude. That floor wins. An explicit HIGH-risk Sonnet pin must fail visibly; existing dynamic routing may select permitted Opus/high and record it. Activating the Sonnet target requires a separate reviewed policy change; these documents do not weaken the floor.
2. **Jira default:** Sonnet/medium is the requested future dedicated preference. Today Jira explicitly uses Planner routing on Claude, which may resolve different effort. Preserve that recorded inheritance until approved integration introduces a compatible dedicated policy.
3. **On-demand Orchestrator:** the requested operating model is on demand. Current dynamic execution may automatically assess tasks without assessments. Deterministic initial classification and on-demand assessment remain future routing work, not a behavior changed by this directory.
4. **Finding detail:** current review JSON has no required separate finding-ID/location/remediation fields. Carry those details in existing `file`/`description` fields; do not invent a new mandatory transport schema.
5. **Profile format/location:** Markdown `agents/` replaces the proposal's illustrative JSON registry for this design deliverable. No registry or parser is implemented.

## Maintenance and future integration

Review profiles with the stage owners and security/runtime policy owners. Check actual output parsers, tool enforcement and model registry before changing a contract. Test that hostile skill/checkpoint/standards text cannot broaden permissions or cross stages. Review quality and token cost together: prefer bounded evidence and referenced revisions over repeating entire histories.

Future integration requires explicit approval for: definition validation/version pinning; a shared composer and standards provenance; adapter capability translation; exact profile/resolved-policy snapshots per attempt; recovery/history handling; and separately approved routing/accounting changes. Preserve installed Jira skills and existing Quest data throughout. No new agent framework is needed.

To add a future profile, first show why an existing role plus a stage overlay is insufficient. Define its unique responsibility, all nineteen sections, ID/version, permitted stage ceiling, runtime compatibility and handoff. Review it before adding a backend mapping; an unrecognized profile must never inherit broad default permissions.

## Validation for this documentation change

Validate all seven files, frontmatter with a YAML parser, unique IDs/roles, semantic versions and all required headings. Check links, exact Claude IDs/efforts against the existing registry, compatibility with stage/result parsers, explicit permission ceilings and absence of private data/credentials. Compare application-file hashes before/after. There is no existing profile-validation script; use a temporary local validation rather than adding an unused runtime/test framework.

Do not infer live runtime enforcement from these checks. No paid model invocation, real Jira publishing or runtime integration is part of this deliverable.

This revision passed YAML/section/identity/version/link checks and pure existing-resolver checks against the local registry: compatible medium/high choices accepted, HIGH-risk Sonnet rejected, dynamic HIGH-risk work resolved to permitted Opus, and Fable rejected. Application/proposal file hashes remained unchanged. These checks ran no agent processes and do not establish current account entitlement.

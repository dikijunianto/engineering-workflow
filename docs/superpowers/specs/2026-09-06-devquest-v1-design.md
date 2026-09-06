# DevQuest v1 — Architectural Design Specification

**Status:** Approved design for implementation planning
**Date:** 2026-09-06
**Scope:** Local-first workflow orchestrator for engineering work, ending at pull-request creation

## 1. Purpose

DevQuest is a local-only developer application that turns a product requirement or technical improvement into a controlled, human-approved, multi-repository engineering workflow. It coordinates existing local tools—Codex, Claude Code, Git, Jira skills, Confluence, and a source-control provider—without making any of them part of the workflow domain.

The product is deliberately a workflow control plane, not an autonomous software-delivery system. Humans approve design and plan artifacts, explicitly publish Jira tasks, manually start individual tasks, and explicitly create pull requests. The v1 workflow ends once the pull request(s) targeting `development` have been created.

## 2. Goals and operating principles

### Goals

- Run entirely on the engineer's machine with a local UI and local server.
- Make progress across product and technical work visible and recoverable.
- Support one Quest affecting multiple registered repositories or microservices.
- Keep work isolated: one Quest × one repository produces one branch, one worktree, and one pull request.
- Allow independent repositories to execute in parallel while preventing concurrent task execution in one repository worktree.
- Treat human approvals and explicit actions as workflow gates.
- Support Codex and Claude Code behind a single runtime contract.
- Preserve concise, useful history without retaining raw agent conversations or terminal streams permanently.

### Principles

1. **Local is the boundary.** DevQuest has no cloud backend, shared coordination service, or remote execution plane in v1.
2. **Intent, not shell access.** The browser requests typed actions; it never submits arbitrary shell commands.
3. **Artifacts are reviewable.** PRD/brief, TRD, `plan.md`, decisions, and checkpoints are readable files as well as structured records.
4. **Adapters at the edge.** The domain never calls Codex, Claude Code, Jira, Confluence, GitHub, GitLab, or Bitbucket directly.
5. **Human control is explicit.** Approval, Jira publication, task starts, and PR creation require an intentional user action.
6. **Recovery is normal.** A closed app, stopped agent process, or restart preserves work and reconciles it rather than declaring it lost.

## 3. Scope

### In v1

- Local web application with a modern dark developer dashboard and light game metaphors.
- Product Quests sourced from a local file or a Confluence main page plus direct, one-level linked Confluence pages.
- Tech Quests sourced through an interactive brainstorming session.
- Product/brief analysis, repository impact analysis, TRD generation, TRD approval, `plan.md` generation, and plan approval.
- An explicit **Publish Tasks to Jira** button using the existing Jira skill.
- Manual start for each task and dependency-aware **Execute Quest**.
- Codex and Claude Code interactive sessions, including message exchange, pause, interruption, and resume.
- Task-level testing and repository-level review before an explicit PR creation action.
- SQLite state, filesystem artifacts, worktree isolation, restart reconciliation, and provider abstractions.

### Explicit non-goals

- Deployments, releases, production operations, pull-request merge, or post-PR automation.
- A cloud backend, collaborative/multi-user live operation, RBAC, or team-wide scheduling.
- Autonomous Jira publication or autonomous PR creation.
- Arbitrary shell execution or a browser terminal.
- A permanent full transcript of agent conversations or raw terminal logs as Quest history.
- Recursive Confluence crawling, unrestricted Confluence search, automatic external-link retrieval, or automatic attachment ingestion.
- A general plugin marketplace or generic workflow language.

## 4. User experience and information architecture

### Visual direction

The UI is a modern dark, professional developer dashboard. Game language is a small recognition layer—**Quest**, **Party**, **Progress**, and **Save Point**—not a role-playing interface. Engineering concepts remain explicit: repositories, tasks, branches, worktrees, approvals, tests, reviews, and pull requests.

### Navigation

```text
Home
├─ Current Sprint
├─ Active Quests
├─ Agent Party
├─ Repository Activity
└─ Recent Activity

Quests
├─ All Quests
├─ Product Quests
└─ Tech Quests

Repositories
├─ Registered repositories
└─ Repository details and health

Agents
├─ Active sessions
├─ Interrupted sessions
└─ Checkpoint summaries

Jira
├─ Published tasks
└─ Publication status

Settings
├─ Workspace
├─ Repository registry
├─ Runtime setup
├─ Jira skill
├─ Confluence
└─ Source control
```

The Home screen is hybrid: it gives situational awareness but does not attempt to operate every workflow stage. Quest Detail is the control center, with `Overview`, `Tasks`, `Repositories`, `Artifacts`, and `Activity` views. It exposes only the next valid primary action, so a new user sees `Analyze PRD`, then `Generate TRD`, rather than every possible action at once.

### Important interactions

- **New Quest** begins by selecting Product Quest or Tech Quest.
- A task card has a runtime selector, status, checkpoint, and a manual **Start** action.
- **Execute Quest** starts all currently eligible tasks according to dependency and repository-serialization rules; it never bypasses approval gates or automatically creates a PR.
- An active agent panel supports an instruction/message exchange. This is agent input, not a shell console.
- Clear status and recovery controls show `Continue` for interrupted work.

## 5. Quest intake and design flow

### Product Quest

Product Quest accepts either:

1. A local file (`.md`, `.txt`, `.pdf`, or `.docx`); or
2. A Confluence main-page URL.

Both inputs become a normalized `PRDDocument` artifact with title, content, source type, source reference, import time, and source version where available. The normalized artifact is the only document the workflow domain consumes.

For a Confluence source, `ConfluenceAdapter` loads the selected main page and its direct linked Confluence pages only. It does not follow links from those supporting pages, visit external links, search Confluence freely, or automatically load attachments. The UI lists the imported pages so the user can verify the agent context. Source page ID and version are retained as provenance. Detecting a later source change is informational in v1; it never overwrites an approved TRD automatically.

The architect runtime analyzes the normalized PRD into requirements, repository impact, technical considerations, and open questions. The user can discuss or correct this analysis before requesting a TRD.

### Tech Quest

Tech Quest accepts a title, problem/improvement description, registered repository selection, and optional goal. It opens an architect-led brainstorming session rather than manufacturing a PRD. When the human chooses **Finish Brainstorm**, DevQuest writes a Technical Brief covering problem, goal, proposed approach, constraints, and key decisions. DevQuest then performs the same repository-impact analysis used for a Product Quest; the initial repository selection is input to that analysis, not a bypass. The Technical Brief and impact analysis then join the same TRD flow as Product Quest.

### Shared approval pipeline

```text
Product: PRD → analysis ─┐
                         ├→ TRD draft → human approval → plan.md draft
Tech:    brief ──────────┘                               → human approval
                                                              → Publish Tasks to Jira
```

The TRD is editable and contains context, goals, non-goals, architecture, affected repositories, data/API changes, service interactions, error handling, compatibility, testing strategy, implementation considerations, and open questions. **Approve TRD** is a hard gate. No plan generation is available until it has been approved.

`plan.md` is likewise reviewable and editable. Its approved form defines tasks, repository assignment, dependencies, execution notes, and expected validation. **Approve Plan** is a hard gate. The Jira skill may be invoked only after plan approval, using an explicit **Publish Tasks to Jira** action. DevQuest records task-to-Jira mappings and publication outcomes.

## 6. Architecture

```text
Browser UI
    │ localhost HTTP + event stream
    ▼
DevQuest local server
    ├─ Workflow domain
    │   ├─ Quest service and approval gates
    │   ├─ Dependency scheduler
    │   ├─ Repository-work manager
    │   ├─ Agent-run manager
    │   ├─ Checkpoint/artifact manager
    │   └─ Recovery reconciler
    ├─ Integration ports
    │   ├─ AgentRuntime
    │   ├─ SkillRunner
    │   ├─ ConfluenceAdapter
    │   └─ SourceControlProvider
    └─ Bounded action executor
    │
    ├─ SQLite: structured state
    ├─ filesystem: readable artifacts and worktrees
    └─ local integrations: CLIs, credentials, Confluence, source control
```

The UI communicates only with the local server. The workflow domain owns transitions, invariants, and authorization of typed actions. Integration adapters translate approved domain operations to local CLI/API work. The bounded action executor owns command construction and allowed working directories; no adapter receives browser-provided command text.

## 7. Domain model

### Primary entities

| Entity | Responsibility |
|---|---|
| `Workspace` | Local DevQuest installation and defaults. |
| `Repository` | An explicitly registered local Git repository, its path, base branch, and source-control configuration. |
| `Quest` | The end-to-end unit of product or technical work. |
| `PRDDocument` / `TechnicalBrief` | Normalized intake artifact for a Product or Tech Quest. |
| `TRD` | Versioned technical design artifact requiring human approval. |
| `Plan` | Versioned `plan.md`, containing executable work definitions and dependencies. |
| `WorkflowTask` | A planned, manually startable unit of implementation work; may map to a Jira issue. |
| `RepositoryWork` | Quest-specific execution container for exactly one repository. |
| `AgentRun` | One interactive runtime session attempting one task or design activity. |
| `Approval` | Immutable record of a human approval, artifact version, actor, and time. |
| `KeyDecision` | A concise decision captured from analysis, conversation, or execution. |
| `Checkpoint` | A concise resumable summary, current Git facts, and next action. |
| `JiraMapping` | Relationship between a workflow task and its published Jira issue. |
| `PullRequest` | The created PR and provider reference for a RepositoryWork. |

### Core relationships

```text
Quest
├─ one intake artifact (PRDDocument or TechnicalBrief)
├─ one current TRD and one current Plan
├─ many WorkflowTasks
├─ many RepositoryWorks (one per affected registered repository)
├─ many approvals, decisions, and checkpoints
└─ many Jira mappings

RepositoryWork
├─ exactly one Quest and one Repository
├─ one branch and one isolated worktree
├─ many assigned WorkflowTasks, processed serially
├─ many AgentRuns
└─ zero or one PullRequest
```

`RepositoryWork` is created before execution when its repository has an approved-plan task. Its unique key is `(quest_id, repository_id)`. That constraint enforces the core invariant: a Quest has at most one worktree, branch, and PR per repository.

### Persistence split

SQLite stores IDs, relationships, states, timestamps, configuration references, source provenance, dependency edges, approvals, Jira mappings, PR references, and checkpoint metadata. The filesystem stores readable artifact bodies and Quest summaries.

Suggested layout:

```text
~/.devquest/
├─ devquest.db
├─ quests/<quest-key>/
│  ├─ prd.md or technical-brief.md
│  ├─ trd.md
│  ├─ plan.md
│  ├─ summary.md
│  └─ checkpoints/<checkpoint-id>.md
└─ worktrees/<quest-key>/<repository-slug>/
```

`summary.md` contains purpose, key decisions, core changes per repository, completed work, remaining work, and blockers. It is not a transcript. Transient streaming output may be visible while a run is live, but permanent Quest history stores only structured events, selected user instructions, outcomes, and concise checkpoints; raw terminal and full conversation logs are not retained as durable history.

## 8. State machines and invariants

### Quest state

```text
DRAFT
  → INTAKE_READY
  → ANALYZING / BRAINSTORMING
  → TRD_DRAFT
  → TRD_APPROVED
  → PLAN_DRAFT
  → PLAN_APPROVED
  → TASKS_PUBLISHED
  → EXECUTING
  → READY_FOR_PR
  → PRS_CREATED

Terminal alternatives: CANCELLED, FAILED_NEEDS_ATTENTION
```

`TASKS_PUBLISHED` means the explicit Jira action succeeded for the required planned tasks. `EXECUTING` may coexist with some unfinished or blocked tasks. `READY_FOR_PR` means every task assigned to every RepositoryWork is completed and the required task tests and repository review passed. `PRS_CREATED` is the v1 success terminal state.

### WorkflowTask state

```text
PLANNED → PUBLISHED → QUEUED → RUNNING
                             ├→ WAITING_INPUT
                             ├→ PAUSED
                             ├→ INTERRUPTED
                             ├→ FAILED
                             └→ COMPLETED
```

`WAITING_INPUT`, `PAUSED`, and `INTERRUPTED` can return to `RUNNING` through an explicit continue action. A task can enter `QUEUED` only after plan approval and Jira publication. It can begin only if all dependencies are `COMPLETED`, the assigned RepositoryWork is available, and no active task owns that repository worktree.

### RepositoryWork state

```text
PLANNED → PREPARING → READY → EXECUTING → REVIEW_REQUIRED
        → READY_FOR_PR → PR_CREATED

Failure/hold states: BLOCKED, RECOVERY_REQUIRED, FAILED_NEEDS_ATTENTION
```

RepositoryWork moves to `REVIEW_REQUIRED` only when every assigned task is completed. It moves to `READY_FOR_PR` only after repository-level review passes and the working tree/branch state is acceptable for a PR.

### AgentRun state

```text
CREATED → STARTING → RUNNING
                     ├→ WAITING_INPUT
                     ├→ PAUSED
                     ├→ INTERRUPTED
                     ├→ FAILED
                     └→ COMPLETED
```

An application restart never treats an unverified `RUNNING` agent as completed. If the corresponding process/session cannot be proven live, reconciliation changes it to `INTERRUPTED` and presents a continuation action.

### Scheduling invariants

1. Tasks in the same `RepositoryWork` are never run concurrently, even when no explicit dependency exists between them.
2. Tasks in different RepositoryWorks may run concurrently only when all cross-repository dependency edges are satisfied.
3. A task is eligible when its plan is approved, Jira mapping exists, dependencies completed, its RepositoryWork is ready, and no active run holds that worktree.
4. **Start** starts only the selected eligible task. **Execute Quest** repeatedly starts eligible tasks within configured local concurrency limits and reevaluates eligibility after each terminal task outcome.
5. A failed, waiting, paused, or interrupted task does not unlock dependent tasks.

## 9. Execution flow

### Preparing repository work

For each affected registered repository, DevQuest resolves the configured base branch (default `development`), creates a Quest-specific branch, and creates its worktree under `~/.devquest/worktrees/<quest-key>/<repository-slug>/`. The engineer's normal checkout remains untouched.

```text
Engineer checkout: ~/company/payment-service
DevQuest worktree: ~/.devquest/worktrees/PAY-142/payment-service
```

All agent runs for that repository work receive the worktree as their fixed working directory. They receive the Quest summary, approved TRD, relevant `plan.md` section, task description/Jira details, key decisions, previous checkpoint, and current Git state.

### Manual task start

The user selects a task and a runtime (with configured defaults and an allowed override), then presses **Start**. DevQuest validates eligibility, ensures its RepositoryWork is prepared, starts an `AgentRun`, and streams live status to the UI. The user can give the active agent instructions and answer questions. Those decisions are summarized into `KeyDecision` or the next checkpoint when relevant.

### Execute Quest

The user presses **Execute Quest** only after explicit plan approval and Jira publication. The scheduler:

1. validates approved artifacts and task mappings;
2. prepares RepositoryWorks as needed;
3. computes eligible tasks from dependencies and repository locks;
4. starts eligible tasks across independent repositories;
5. persists state and a checkpoint at meaningful transitions;
6. unlocks downstream tasks only after successful completion; and
7. surfaces pauses, failures, and questions for human action.

It stops at human-intervention points; it does not skip them, create a PR, or make Jira changes without a new explicit action.

### Validation and review

Each task is expected to run its planned validation through typed actions owned by the backend. On completion of every task in a RepositoryWork, DevQuest requires a repository-level review. That review examines the aggregate worktree diff, relevant test outcomes, and repository status, then produces a concise result. If review finds actionable issues, the RepositoryWork returns to execution with a follow-up task or correction; it cannot become `READY_FOR_PR` merely because all original tasks completed.

### Pull request creation

Once a RepositoryWork is `READY_FOR_PR`, the UI presents **Create Pull Request**. The user invokes it separately for each repository work. `SourceControlProvider` creates the PR from the RepositoryWork branch to its configured base branch, which is `development` in v1. DevQuest records the provider reference and marks the RepositoryWork `PR_CREATED`. The Quest becomes `PRS_CREATED` only after every RepositoryWork has a recorded PR. No merge or deployment follows.

## 10. Integration contracts

### AgentRuntime

The workflow uses a runtime capability contract rather than vendor-specific calls:

```text
AgentRuntime
  detectCapabilities()
  start(context)
  resume(run, context)
  sendMessage(run, message)
  pause(run)
  interrupt(run)
  terminate(run)
  getStatus(run)
  events(run)
```

`CodexRuntime` and `ClaudeCodeRuntime` implement this contract. Capability discovery records installation availability, interactive operation, streaming output, fixed working-directory support, and native-session resume. Runtime selection is constrained to detected, configured runtimes.

When native resume is supported and the prior session is available, `resume` reattaches to it. Otherwise DevQuest uses logical resume: it opens a new session in the same worktree with the Quest summary, approved artifacts, task, decisions, prior checkpoint, and freshly inspected Git state. Logical resume must clearly tell the user it is a new runtime session continuing preserved workflow state.

### SkillRunner

```text
SkillRunner
  execute(skillName, context) → outcome
```

The existing Jira publishing skill is called through `SkillRunner` with the Quest, approved plan location, task definitions, and repository metadata. It returns created/linked issue references and per-task failures. The workflow core does not know the skill's internal command sequence. v1 uses the existing Jira skill only; it does not introduce a general skill ecosystem.

### ConfluenceAdapter

```text
ConfluenceAdapter
  fetchMainPage(url)
  fetchDirectLinkedPages(mainPage)
  getVersion(reference)
```

The adapter normalizes permitted Confluence content and reports provenance, loaded-page list, and failures. Direct links are filtered to Confluence pages in the authorized site context. A failed supporting page is surfaced for user decision; DevQuest never silently substitutes unrelated context.

### SourceControlProvider

```text
SourceControlProvider
  createPullRequest(repositoryWork, baseBranch, title, body)
  getPullRequest(reference)
```

Provider implementations can target GitHub, GitLab, Bitbucket, or another configured system. v1 implements only the provider required by the local installation, but the domain depends solely on this abstraction.

## 11. Security and isolation

### Repository registry and workspace isolation

Repositories are explicitly registered with a canonical local path and configuration. DevQuest may only inspect, create a worktree for, or create a PR from a registered repository. It does not browse arbitrary filesystem paths supplied by the UI.

Each `AgentRun` receives an allowed working directory equal to its RepositoryWork worktree. Runtime invocation must reject an attempt to start outside that directory. Repository tasks never share a worktree with a different repository or Quest.

### Bounded command execution

The UI submits typed domain actions such as:

```text
ANALYZE_PRD, START_BRAINSTORM, GENERATE_TRD, APPROVE_TRD,
GENERATE_PLAN, APPROVE_PLAN, PUBLISH_JIRA, START_AGENT,
CONTINUE_AGENT, PAUSE_AGENT, INTERRUPT_AGENT, RUN_TEST,
REVIEW_REPOSITORY, CREATE_PR
```

The server validates state and constructs the necessary local invocation. There is no `POST /shell`, browser command box, or pass-through terminal endpoint. Free-form text is allowed only as agent instruction content and is sent through `AgentRuntime.sendMessage`, never executed by the server as a command.

### Credentials

Secrets for Confluence, Jira, and source control are not stored in Quest artifacts, the DevQuest SQLite database, or source repositories. DevQuest prefers OS credential storage and already authenticated local CLIs/providers. Non-secret configuration may name a Jira project, base branch, runtime defaults, and repository settings. The UI never displays secret values in activity or checkpoints.

## 12. Recovery and reconciliation

Recovery occurs at application startup and on demand:

```text
Load SQLite
→ identify non-terminal quests/repository works/runs
→ verify registered paths and worktrees
→ inspect Git branch and working-tree facts
→ query runtime/session status where supported
→ reconcile state
→ show actionable recovery status
```

Rules:

- A recorded running process that is missing becomes `INTERRUPTED`, not `FAILED`.
- A present worktree with unexpected branch or Git state enters `RECOVERY_REQUIRED`; DevQuest does not overwrite it.
- A missing worktree blocks that RepositoryWork and presents a repair/recreate path only after explaining the state mismatch.
- A completed runtime session without a persisted completion checkpoint is reconciled as `INTERRUPTED` until the user reviews its Git state and continues or marks it resolved.
- Recovery always preserves artifacts and summaries. It never re-runs a task or recreates a worktree silently.

## 13. Error handling

Errors are represented at the narrowest affected level and include an actionable next step.

| Condition | Result |
|---|---|
| Invalid or unreadable intake file | Quest remains in `DRAFT`/`INTAKE_READY`; show import error and allow replacement. |
| Confluence main page unavailable | Do not create a normalized source; explain authentication/access failure. |
| Direct linked page unavailable | Preserve loaded context and show the missing page before TRD generation; user decides whether to proceed. |
| Runtime not installed/authenticated | Prevent start for that runtime; retain task state and show setup guidance. |
| Agent needs a decision | `WAITING_INPUT`; no dependent task unlocks. |
| Agent process/app closes | `INTERRUPTED`; preserve the latest checkpoint and Git facts. |
| Task test fails | Task remains non-completed; capture concise result/checkpoint and request correction or human decision. |
| Jira publication partially fails | Persist successful mappings, identify failed tasks, and permit an explicit retry only for unresolved tasks. |
| Worktree/Git conflict | RepositoryWork becomes `RECOVERY_REQUIRED` or `BLOCKED`; never discard or reset local changes. |
| Repository review fails | RepositoryWork returns to execution with an explicit finding; PR action remains unavailable. |
| PR provider fails | RepositoryWork remains `READY_FOR_PR`; retain branch and validation state for a later explicit retry. |

## 14. Testing strategy

Testing prioritizes workflow correctness and safety boundaries over adapter internals.

- **Domain unit tests:** approval gates, valid state transitions, dependency eligibility, repository serialization, and terminal Quest conditions.
- **Scheduler tests:** independent repositories can run in parallel; same-repository tasks never overlap; failures/waits do not unlock dependencies.
- **Persistence/recovery tests:** SQLite plus artifact restore, interrupted-run reconciliation, missing-process handling, and no silent worktree recreation.
- **Adapter contract tests:** capability detection, native versus logical resume context, Confluence one-level traversal, Jira partial publication outcomes, and PR provider mapping.
- **Security tests:** unregistered repository rejection, worktree-bound runtime execution, typed-action validation, and no arbitrary-shell endpoint.
- **End-to-end local fixture:** one Quest spanning two small Git repositories, sequential tasks in one repository, a cross-repository dependency, explicit approvals, Jira skill stub, review gate, and manually invoked PR provider stub.

External systems and real credentials are excluded from ordinary automated tests; adapters use controlled fakes or local fixtures. A small manual smoke test verifies configured Codex/Claude Code, Jira skill, Confluence access, and source-control provider on an engineer's machine.

## 15. MVP completion criteria

DevQuest v1 is ready for implementation planning when the implementation can demonstrate this complete path:

1. Register two repositories and configure available Codex/Claude Code runtimes.
2. Create a Product Quest from a local file or permitted Confluence context, or create a Tech Quest from brainstorming.
3. Generate, edit, and explicitly approve TRD and `plan.md`.
4. Explicitly publish planned tasks through the existing Jira skill and record mappings.
5. Create one RepositoryWork per repository with isolated branches and worktrees.
6. Manually start a task, exchange agent instructions, interrupt it, and resume it natively or logically with a checkpoint.
7. Execute eligible tasks across repositories while retaining strict serialization within each repository.
8. Run task validation and repository-level review.
9. Explicitly create one PR per RepositoryWork to `development`.
10. Stop with the Quest in `PRS_CREATED`; do not merge, deploy, or release.

## 16. Design review notes

This specification intentionally resolves the following potential ambiguities:

- **“Parallel execution” is not global parallelism.** It is only permitted across independent RepositoryWorks after dependency checks; a repository worktree is an exclusive execution lane.
- **Jira and PR actions are explicit gates.** “Execute Quest” neither publishes Jira tasks nor creates a PR.
- **Task completion is insufficient for PR readiness.** Task validation and repository-level review are separate mandatory gates.
- **Resume is workflow-level first.** Native runtime resume is used only when available; otherwise the preserved artifact/checkpoint/Git context supports logical resume.
- **Local-only does not mean unrestricted local access.** Registered repositories, fixed worktrees, typed actions, and credential isolation constrain DevQuest's authority.
- **Confluence context is bounded.** The main page plus its direct linked Confluence pages are eligible; no recursive crawling or external-link fetching occurs.
- **History is durable but concise.** Structured state and human-readable summaries persist; raw transcripts and terminal streams do not become permanent Quest history.

No implementation plan is included here. The next step, after human review of this document, is to create an implementation plan from this approved architecture.

# DevQuest

A local engineering workspace for taking a product requirement or technical improvement through design, approval, Jira tasks, implementation and repository review to a pull request.

## Run locally

Requires **Node.js 24+**, Git, and a browser. For agent sessions install and authenticate Codex CLI and/or Claude Code. GitHub PR creation uses your existing `gh auth login` session.

```sh
npm ci
npm start
```

Open **http://127.0.0.1:4310**. The server listens only on loopback. No build, hosted database or cloud deployment is needed. Windows, macOS and Linux are supported by the local Node application; runtime sandbox capabilities depend on the installed vendor CLI and OS.

State lives in `~/.devquest/devquest.db`, readable documents in `~/.devquest/quests/`, and isolated Git worktrees in `~/.devquest/worktrees/`. Use `DEVQUEST_HOME` for a different data directory, `DEVQUEST_CONFIG` for a local configuration file, and `PORT` for another loopback port. Integration configuration is loaded at startup from `~/.devquest/config.json` by default. Keep this data directory outside registered source repositories.

## Use the workflow

1. Register local Git repositories. Each must have a local `development` branch before execution; DevQuest does not create it from an arbitrary branch.
2. Create a Product Quest from a local Markdown, text, PDF, Word file or Confluence page, or create a Tech Quest from an idea.
3. Analyze requirements and repository impact. For Tech Quests, finish brainstorming into a technical brief first. If the agent is waiting for input, answer its questions or select **Finish brainstorm** to request a final brief with unresolved questions recorded.
4. Generate/edit the TRD and approve the displayed revision. Generate/edit the plan, its repository assignments, dependencies and validation profiles; approve that revision.
5. Generate a weighted Jira appendix from the approved plan using **Generate Jira appendix**, or import the output from `/create-appendix-task-list`. Review it, then explicitly publish one sample followed by batches of at most five issues using `/upload-task-to-jira`. The local skills and Claude Code's `atlassian` MCP connection are discovered automatically. An existing executable bridge is still supported. Partial issue mappings are retained; execution waits until each task is fully published.
6. Start a task manually or select **Execute Quest**. Independent repositories may run simultaneously; tasks sharing a repository worktree are serialized. Paused/interrupted sessions keep their repository lane reserved until continued.
7. Exchange instructions between agent turns, or pause a running turn before sending a new instruction. The first implementation using each validation profile must pass baseline checks before an agent starts. Prepare dependencies in the worktree when needed. Each implementation must pass its configured validation. Finish all repository tasks, run repository review, inspect its findings and explicitly approve that review.
8. Generate an office commit message using `/commit-message-creator`, review or edit it, then select **Create PR → development**. The office format is `<type> : <description> (branch)`. PR retries verify the remote head contains the reviewed commit.
9. Request reviewers by GitHub username, then select **Notify Google Chat**. Reviewer and notification outcomes are saved separately from PR creation. With review handoff configured, the Quest remains open until the required handoff succeeds. Notification retries reuse the saved request ID and message.

For a QA bug with an existing Jira issue, approve the plan and choose **Use existing Jira task**. Enter its issue key and optionally its URL. The existing issue tracks all implementation tasks in that Quest; appendix generation and Jira upload are skipped. Confirm the issue exists and covers the planned work. This path does not need the Jira publishing integration and cannot replace a partially published backlog.

Open a Quest’s **Architect** tab to read and download its TRD, specification, implementation plan and Jira ticket documents. Documents start collapsed. Expand one and use **View** to switch between the formatted **Markdown viewer** (default) and exact **Original Markdown**. The viewer hides internal plan metadata; downloads preserve the saved source. Files are stored under `<dataDir>/quests/<questId>/` as `trd.md`, `spec.md`, `plan.md`, `ticket.md` and, when generated, `appendix.md`. Immutable revisions remain in `versions/`. Existing TRD and plan files appear automatically. After TRD approval, generate or import an optional spec; saving it returns an existing plan to review. Ticket documents are saved when issues are published or an existing QA issue is linked.

Approvals apply to immutable artifact revisions. Editing a draft requires approval again. Once Jira tasks are published or an existing issue is linked, the plan is frozen; create a new Quest for scope changes. Failed tests and review findings can be corrected by reopening an eligible task. Reopening an upstream task is blocked after a dependent task starts.

## Integrations

See [integration configuration and optional bridge contract](docs/integrations.md). Actual Jira publishing requires the local skills plus Claude Code's authenticated Atlassian MCP connection, or an existing bridge. GitHub requires an authenticated `gh` CLI. Google Chat uses a webhook URL held in an environment variable. Unconfigured integrations report a setup error; they never fabricate successful results.

Copy the optional [configuration example](devquest.config.example.json) to `~/.devquest/config.json` and replace the example reviewer username. Set `DEVQUEST_GOOGLE_CHAT_WEBHOOK` in the environment before starting the app. Keep the webhook URL out of configuration files. `testing.credentialEnv` lists the names of credentials your local tests and agent need; values come from the process environment and are redacted from test summaries and model output. These controls do not restrict the environment inherited by trusted local processes.

Codex and Claude Code are probed with their installed CLI help. Application interaction is turn based: a completed turn can receive another instruction, and a paused turn continues from an explicit checkpoint. Default sessions do not retain full vendor conversation files; logical resume starts a new process with the current documents, checkpoint and Git state. Opt-in vendor persistence permits native resume only where the CLI supports it. Native sessions can retain vendor transcripts outside DevQuest; consult the vendor retention settings before opting in.

The app itself has no arbitrary-shell endpoint. Executable paths and bridge arguments are trusted machine configuration, never browser request parameters. Runtime instructions are still powerful: use repositories you trust and review changes before approving PR creation. A fixed working directory is not an OS-level filesystem sandbox. Codex requests its workspace/read-only sandbox. Claude uses only explicitly allowed reading tools with `dontAsk` for brainstorming/analysis/review and acceptEdits for implementation, with only Read/Glob/Grep/Edit/Write tools; it cannot invoke Bash through these turns. Install project dependencies in a new worktree using your own terminal when its tests require them.

Local intake limits: 8 MB uploads, 200 PDF pages, 100,000 extracted text characters. Scanned PDFs require a text export; OCR is outside v1. Confluence is limited to the configured HTTPS site, the main page and directly linked pages, with an explicit warning if pages cannot be loaded or limits are reached.

## Recovery and history

Restarting reconciles registered repositories and worktree identities. If a registered repository moved, use **Repositories → Update path**; DevQuest verifies the same remote and compatible worktrees, and preserves Quest references and failed-session continuation paths. Previously running sessions become **Interrupted**; scheduling stays paused until explicitly restarted. Worktrees with missing paths or unexpected branches show **Recovery required**. Restore the expected path/branch manually, then select **Reconcile saved state** in Settings. DevQuest never deletes changes, resets Git or silently reruns interrupted work.

SQLite stores workflow records, version-bound approvals, Jira mappings, PR references and concise activity. The filesystem stores versioned documents, save points and summaries. Live output is bounded and transient; raw terminal streams and whole conversations are not saved as Quest history. A crash before an agent emits its checkpoint can leave the newest changes only in Git; inspect the preserved worktree before continuing.

## Verify

```sh
npm test
npm run check
```

Tests cover approval revision checks, dependency validation, repository serialization, interruption/recovery, partial Jira publication, review invalidation, local HTTP boundaries, file intake and a full two-repository Git fixture. Tests use fake external providers and never consume agent credits or create real Jira issues/PRs. See [verification notes](docs/verification.md) for the delivery evidence and remaining machine-specific checks.

Architecture: [approved design](docs/superpowers/specs/2026-09-06-devquest-v1-design.md). Execution scope and file boundaries: [implementation plan](docs/superpowers/plans/2026-09-06-devquest-v1.md).

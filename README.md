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
3. Analyze requirements and repository impact. For Tech Quests, finish brainstorming into a technical brief first.
4. Generate/edit the TRD and approve the displayed revision. Generate/edit the plan, its repository assignments, dependencies and validation profiles; approve that revision.
5. Configure your existing Jira publishing skill bridge and explicitly select **Publish Tasks to Jira**. Partial publication is retained, so retries send only unmapped tasks with the same idempotency keys.
6. Start a task manually or select **Execute Quest**. Independent repositories may run simultaneously; tasks sharing a repository worktree are serialized. Paused/interrupted sessions keep their repository lane reserved until continued.
7. Exchange instructions between agent turns, or pause a running turn before sending a new instruction. Each implementation must pass its configured validation. Finish all repository tasks, run repository review, inspect its findings and explicitly approve that review.
8. Select **Create PR → development** for each repository. This commits and pushes that repository work and creates its PR. The Quest ends once all PRs exist.

Approvals apply to immutable artifact revisions. Editing a draft requires approval again. Once Jira tasks are published, the plan is frozen; create a new Quest for scope changes. Failed tests and review findings can be corrected by reopening an eligible task. Reopening an upstream task is blocked after a dependent task starts.

## Integrations

See [integration configuration and bridge contract](docs/integrations.md). Actual publishing requires the existing Jira skill executable, Confluence configuration/authentication and an authenticated GitHub CLI. Unconfigured integrations report a setup error; they never fabricate successful results.

Codex and Claude Code are probed with their installed CLI help. Application interaction is turn based: a completed turn can receive another instruction, and a paused turn continues from an explicit checkpoint. Default sessions do not retain full vendor conversation files; logical resume starts a new process with the current documents, checkpoint and Git state. Opt-in vendor persistence permits native resume only where the CLI supports it. Native sessions can retain vendor transcripts outside DevQuest; consult the vendor retention settings before opting in.

The app itself has no arbitrary-shell endpoint. Executable paths and bridge arguments are trusted machine configuration, never browser request parameters. Runtime instructions are still powerful: use repositories you trust and review changes before approving PR creation. A fixed working directory is not an OS-level filesystem sandbox. Codex requests its workspace/read-only sandbox. Claude uses plan mode for reading and acceptEdits for implementation, with only Read/Glob/Grep/Edit/Write tools; it cannot invoke Bash through these turns. Install project dependencies in a new worktree using your own terminal when its tests require them.

Local intake limits: 8 MB uploads, 200 PDF pages, 100,000 extracted text characters. Scanned PDFs require a text export; OCR is outside v1. Confluence is limited to the configured HTTPS site, the main page and directly linked pages, with an explicit warning if pages cannot be loaded or limits are reached.

## Recovery and history

Restarting reconciles registered repositories and worktree identities. Previously running sessions become **Interrupted**; scheduling stays paused until explicitly restarted. Worktrees with missing paths or unexpected branches show **Recovery required**. Restore the expected path/branch manually, then select **Reconcile saved state** in Settings. DevQuest never deletes changes, resets Git or silently reruns interrupted work.

SQLite stores workflow records, version-bound approvals, Jira mappings, PR references and concise activity. The filesystem stores versioned documents, save points and summaries. Live output is bounded and transient; raw terminal streams and whole conversations are not saved as Quest history. A crash before an agent emits its checkpoint can leave the newest changes only in Git; inspect the preserved worktree before continuing.

## Verify

```sh
npm test
npm run check
```

Tests cover approval revision checks, dependency validation, repository serialization, interruption/recovery, partial Jira publication, review invalidation, local HTTP boundaries, file intake and a full two-repository Git fixture. Tests use fake external providers and never consume agent credits or create real Jira issues/PRs. See [verification notes](docs/verification.md) for the delivery evidence and remaining machine-specific checks.

Architecture: [approved design](docs/superpowers/specs/2026-09-06-devquest-v1-design.md). Execution scope and file boundaries: [implementation plan](docs/superpowers/plans/2026-09-06-devquest-v1.md).

# Delivery verification

Verified locally on Windows with Node.js 24 on 2026-09-07.

## Automated checks

- `npm test`: 44 tests passed, no failures. Tests exercise real temporary Git repositories, with fake external model, Jira and PR providers.
- `npm run check`: all application JavaScript parses successfully.
- Tests cover revision-bound approvals, task dependencies and scheduling, partial Jira retries, interrupted-session recovery, process ownership, stale review rejection, idempotent PR retries, and the complete two-repository workflow.
- Adapter tests check CLI argument boundaries, ephemeral/native/logical continuation, process failures, bounded one-level Confluence imports, and commit fingerprints including additions and deletions.
- Server tests check Host/Origin/token boundaries and text, real DOCX and real PDF ingestion.

## Browser checks

The local dashboard was inspected in the browser at desktop size and a 390 × 844 mobile viewport. Repository registration, Product Quest creation, navigation, readable empty states, and persistence after reload were exercised. The preview used a clearly labeled local smoke-test Quest; it did not launch a paid agent or publish external records.

## Review and limitations

Direct code review identified and corrected approval ancestry, repository snapshot checks, PR retries after a commit, retained runtime selection across scheduling waves, orphan-process resume, and PDF parser cleanup. An independent subagent review was requested but could not complete because of its account usage limit; this is not an independent-review sign-off.

Live Codex/Claude task execution and real Jira, Confluence and application-generated GitHub PR publication remain machine-specific integration checks. Automated success does not establish that those services are authenticated or that the existing Jira skill bridge is configured. Installed runtime help was checked without spending model credits. An active workflow source now exists at `.github/workflows/test.yml` for Windows, Ubuntu and macOS. It has not been pushed or observed running remotely in this change; only local results are claimed.

Before using real projects, configure the integrations described in [integrations.md](integrations.md), register repositories with a local `development` branch, and install their test dependencies in the prepared worktrees if needed. Agent sandbox behavior depends on the vendor CLI and OS. No deployment, merge, branch cleanup, or permanent full-conversation storage is included.

## Workflow fixes, 2026-10-14

Added regression coverage for remote PR head verification, review-base changes, new-directory diff coverage, zero-test npm validation, baseline failure recovery, weighted appendix revision binding, partial issue mappings, office commit messages, reviewer readback, notification retries, credential redaction, direct Claude MCP isolation, and frontend publication forms. Direct Jira actions are tested with fake runtimes, not with real office issues. The game theme and existing Product/Tech Quest entry paths remain.


On macOS with Node.js 24.1.0: 79 tests passed, zero failed, one Windows-only test skipped. JavaScript syntax and whitespace checks passed. CI covers Windows, Ubuntu and macOS after publication; it has not run remotely in this session. No live Jira issues, paid model sessions, GitHub PRs, or Google Chat messages were created during verification.


Brainstorming recovery: read-only Claude turns now use an explicit Read/Glob/Grep allowlist with `dontAsk`, rather than Plan mode. A waiting brainstorming turn can request its final technical brief through Finish brainstorm, with the original idea retained during continuation. Desktop command lookup also covers native CLI and Homebrew installation folders. Regression tests cover the mode, command lookup with an empty PATH, and progression from a waiting brainstorm to impact analysis. Saved `spawn claude ENOENT` history was inspected read-only. A later live check showed the registered repository folder no longer existed. The repository was relinked through the application API to the matching GitHub checkout, preserving both Quests and updating four failed design-session working directories.

Claude Code 2.1.285 was also resolved successfully with a restricted desktop PATH using only `--version`; no model turn was started.

Repository repair regression tests cover missing-directory errors, matching SSH/HTTPS remote identity, rejection of a different remote, preservation of Quest references, and the repair form payload. The local server was restarted and Claude Code was successfully probed from the repaired directory with `--version`; no paid brainstorming turn was started.

Existing QA issue flow: engine and frontend regression tests verify approved-plan binding, issue-key and HTTPS URL validation, no Jira publication, implementation eligibility, plan freezing and preservation of partial uploads. The duplicate agent response is also covered. Syntax and whitespace checks passed. The live server was left running because a Claude session was active; restart after the session finishes to load the new backend action. Existing issue existence is confirmed by the engineer, without a live Jira lookup.

Architect documents: checked TRD, optional generated/imported spec, plan and ticket Markdown persistence; immutable revisions, spec-bound plan approval, escaped previews, download content and integrity rejection. All 80 discovered tests completed: 79 passed, one Windows-only test skipped. The idle live server was restarted with no agent sessions active. The existing feature Quest’s Architect tab was inspected in the browser, including its saved TRD and plan and empty spec/ticket states. No live spec-generation turn was started.

Architect view selector: each saved document now defaults to a formatted Markdown viewer with an Original Markdown option. Render tests cover headings, emphasis, lists, tables, fenced code, source preservation and view selection. Raw HTML is escaped, unsafe links are omitted and images render as text. The original source and downloads remain unchanged. Full suite: 80 passed, one Windows-only test skipped; syntax and whitespace checks passed. Browser checks verified the formatted TRD and switching to original Markdown. The idle server was restarted to serve the local Markdown module.

Worktree retry recovery: the live creation failed because the repository had no local `development` branch; a second attempt inspected the missing folder instead of repeating preparation. Preparation failures now retry the same work record only before any task session has started, and a missing base reports a branch setup instruction. Tests verify retry identity, error clearing, READY reconciliation and refusal to recreate worktrees after agent work. Full suite: 82 passed, one Windows-only test skipped; focused reconciliation regression and syntax/whitespace checks passed. After the user created `origin/development`, it was fetched, a local tracking branch created and the initial worktree prepared. The idle server was restarted; the work is READY with no task sessions launched.

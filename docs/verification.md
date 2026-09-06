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

Live Codex/Claude task execution and real Jira, Confluence and application-generated GitHub PR publication remain machine-specific integration checks. Automated success does not establish that those services are authenticated or that the existing Jira skill bridge is configured. Installed runtime help was checked without spending model credits. A [CI template](ci/test.yml) defines checks on Windows and Ubuntu but is not activated: GitHub rejected workflow publication because the existing credential lacks the `workflow` scope. A maintainer can copy it to `.github/workflows/test.yml` with an appropriately authorized credential. Only local test results are claimed here.

Before using real projects, configure the integrations described in [integrations.md](integrations.md), register repositories with a local `development` branch, and install their test dependencies in the prepared worktrees if needed. Agent sandbox behavior depends on the vendor CLI and OS. No deployment, merge, branch cleanup, or permanent full-conversation storage is included.

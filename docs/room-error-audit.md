# Real-project Room error audit

Audited 2026-10-25 against the persisted test Quest: 48 AgentRuns, 14 owner messages, attempt history, task/work state and operations. Historical failures remain evidence; they are not rewritten as successful runs.

## Current recovery evidence

- All 16 execution tasks are COMPLETED with integrated commits and passing task validation.
- Both changed repositories have passing production reviews and validation, exact reviewed-head human approvals, and recorded Bitbucket PRs.
- Quest is PRS_CREATED with automatic execution disabled. No failed current work remains.
- Three completed tasks retained obsolete error text. Successful integration now clears the current task error only after validation passes. Historical failed runs and messages remain intact.

## Failure coverage

| Observed failure | Resolution / retained protection | Regression coverage |
| --- | --- | --- |
| Malformed analysis JSON / oversized plan title | Reject invalid stage contracts; one bounded same-stage correction. No invalid artifact or approval is accepted. Model output failures remain possible. | `test/design-stages.test.js` |
| Appendix approval/configuration and metadata mismatch | Ignore provenance-only differences; retain material configuration and exact artifact/plan approval checks. Preserve verified approved metadata. | `test/jira-settings.test.js`, `test/jira-publication-contract.test.js` |
| Publisher prose instead of JSON / unconfirmed issue marker | Accept unambiguous structured result blocks; deterministic read-only issue reconciliation verifies exact marker/project/Epic before accepting results. Unknown writes still block retry. | `test/adapters.test.js`, `test/jira-publication-contract.test.js` |
| Verifier model/effort mismatch | Model-free verification does not inherit the paid publisher profile. | `test/adapters.test.js`, `test/agent-profiles.test.js` |
| MCP spill filename error | Accept owned `.json` and `.txt` spill files; preserve exact session/tool ownership and 2 MB limit. | `test/jira-mcp.test.js` |
| Partial ticket document / task mapping | Rebuild complete execution-task mappings from verified publication entries; retain stable identities and Publish All Remaining. | `test/jira-publication.test.js`, `test/jira-publication-contract.test.js` |
| Selected-repository / Go dependency reads denied | Every engineering spawn gets selected read-only references and Go module-cache discovery through the controlled reader. Native writes remain confined to the assigned worktree. | `test/selected-repository-scope.test.js`, `test/dependency-access.test.js`, `test/repository-reader.test.js`, `test/agent-profiles.test.js` |
| Reference directory search / assigned Git HEAD history | Bounded directory discovery; exact assigned HEAD reflog grant only. Unrelated Git metadata stays denied. | `test/adapters.test.js`, `test/worktree-access.test.js` |
| Developer workspace differs during conflict repair | Resolve integration repair worktree before task workspace; verify exact pending task/commit ownership. | `test/agent-profiles.test.js`, `test/integration-repair.test.js` |
| Integration worktree contains unrelated changes | Validated repair requires a recorded clean baseline and unchanged passing validation. Historical unrelated edits still require explicit recovery. | `test/integration-repair.test.js` |
| Local master differs from remote | Fresh analysis fetches a separate clean remote snapshot and pins implementation baseline; original checkout/dirty files stay intact. | `test/analysis-baseline.test.js` |
| Owner reply blocked / retry budget exhausted | Waiting-input answers preserve retry budget; explicit bounded retry allowance exists for stopped unintegrated tasks. Occupied/integrated tasks stay protected. | `test/retry-allowance.test.js`, `test/agent-profiles.test.js` |
| Review finished but dashboard remains in Build | Distinguish completed review execution from passed verdict; show review findings/next action and exact approval status. | `test/dashboard.test.js` |
| Bitbucket routed to GitHub / PR action failed silently | Explicit Bitbucket MCP provider; Git pushes reviewed commit; background errors visible on repository card. | `test/bitbucket.test.js`, `test/retry-allowance.test.js`, `test/dashboard.test.js` |
| Bitbucket PR reports abbreviated commit hash | Resolve scoped commit detail to full SHA, validate resolution, then compare exact reviewed SHA. Existing matching PR is reused without another push/POST. | `test/bitbucket.test.js`, `test/adapters.test.js` |

## Expected failures that must remain visible

The test project's Go mock/compiler/vet failures, review findings and target-branch divergence were repaired in its own worktrees and revalidated. They are not universal application fixes. New projects can still contain failing code or require target integration, independent review and human approval.

CLI timeouts, provider outages, missing credentials, insufficient Jira visibility, invalid agent output and retry/ownership guards cannot be guaranteed away. Account-visible Jira search requires explicit artifact/project-scoped acceptance and retains the hidden-duplicate warning. Complete project visibility is never inferred merely from successful search pagination.

No new paid generation, Jira mutation, PR creation or project-code change was performed for this audit. Credential checks compare candidate files against configured integration secrets and common token/private-key signatures; this is not a guarantee against every possible secret encoding. New-project verification uses isolated fixtures and fake model/Jira calls rather than another paid live project.

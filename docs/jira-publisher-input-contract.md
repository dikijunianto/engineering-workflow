# Jira Publisher input contract and existing Quest recovery

Verified 2026-10-19 for Quest `12c8b15e-fb7b-436d-a8cf-a277989288af`.

**The missing input contract is implemented. The real Quest is NOT ready for
publication confirmation:** the connected MCP cannot attest complete visibility
of issues hidden by Jira issue-security rules. Publishing remains blocked under
the user's explicit fail-closed requirement.

## Verified root cause

The failed operation `jira:<questId>` stopped in `SkillRunner.verifyUpload`, before
the publishing call. Its actual persisted error reported missing
`appendixIdempotencyPrefix`, `existingIssues` and appendix-to-execution mapping.

The original flow called `verifyUpload` with only the Quest, Markdown path/content
and installed skill paths. However, DevQuest's own verification prompt required
the marker and existing-issue search. The namespace was constructed later inside
`SkillRunner.publish`, so it was never delivered to this earlier invocation.
`existingIssues` was likewise assembled only at publication time. The explicit
mapping existed in the approved Markdown's section 6.4, but no code parsed it into
publisher inputs or persisted a publication manifest.

These marker/mapping requirements are DevQuest's integration contract, not new
frontmatter in the original installed skill. The original skill requires stable
`T<group>.<n>` cards, original appendix tables, exact category IDs, task-total
weights, Technical story-point classification, assignee, verified Epic, one real
sample followed by explicitly reviewed batches. The original FFE/MOB examples
remain unchanged; DevQuest's existing explicit target-project policy and fresh
metadata provide FCAD/BE context. Neither installed Jira skill was modified.

## Stable namespace and manifest

The durable namespace is the existing publisher's canonical format:

`devquest:12c8b15e-fb7b-436d-a8cf-a277989288af:appendix:`

Example marker: append `T1.1`. Neither an attempt ID nor an artifact revision is
included. The namespace is stored before read-only reconciliation, and therefore
before any possible issue creation. Retries reuse the same manifest and markers.
Changing the site, project, Epic or approved revision fails closed and requires
reconciliation rather than silently replacing the manifest.

Manifest operation ID: `jira-manifest:12c8b15e-fb7b-436d-a8cf-a277989288af`.
Its bindings include:

- Site: `https://amarbank.atlassian.net`.
- Cloud ID: `ad45ee5d-f233-4e8f-9446-3e2444747813`.
- Project: FCAD, ID `11337`; Epic FCAD-6205.
- Approved appendix revision 1, artifact
  `a8f785a8-f3b1-4d5a-b8e8-d21219475102`.
- Appendix SHA-256:
  `8b4d731d2689d15f795eb78179c3f3daa171f1610265e6fb229dbe25fdc8ae0c`.
- Approved Plan/TRD IDs and hashes, original metadata hash and fresh verified
  metadata version.
- All 31 appendix card IDs, explicit execution associations, stable markers,
  intended issue fields, statuses and verification timestamps.
- Reconciliation proof, read audit and private diagnostics. Actual creation
  attempts would be recorded before dispatch and remain uncertain until confirmed.

The manifest currently has state **BLOCKED**, zero confirmed issue keys and no
creation attempt authorized by this task.

## Explicit task mapping

The mapping is parsed from the exact approved section 6.4 traceability table.
Execution keys resolve to the existing graph's full IDs, not matching numeric
prefixes. All 31 cards map to 14 execution tasks; zero cards are unmapped.

| Execution key | Appendix cards |
| --- | --- |
| T1 | T1.1 |
| T2 | T1.2–T1.5 |
| T3 | T1.6, T1.7 |
| T4 | T1.8 |
| T5 | T1.9 |
| T6 | T2.1 |
| T7 | T2.2–T2.7 |
| T8 | T2.8 |
| T9 | T2.9 |
| T10 | T2.10 |
| T11 | T3.1–T3.7 |
| T12 | T3.8 |
| T13 | T4.1 |
| T14 | T5.1–T5.3 |

The contract supports arrays of execution IDs and many-to-many associations.
Explicit `Source: plan.md, Task ...` references are also supported when no
traceability table is supplied. Missing, unknown or duplicate associations require
mapping review; numeric inference is never used. A partial Jira result does not
complete an execution task until every associated appendix card has a verified key.

## Deterministic preflight and actual read-only findings

`verifyUpload` now delegates to the deterministic publication preflight. It no
longer invokes a paid Claude reasoning turn to invent or discover application IDs.
The existing Claude CLI/MCP transport is driven by DevQuest's private localhost
API, using a non-production API key and loopback model endpoint. It emits only
fixed read calls. Restricted execution, the selected Atlassian connection and the
pre-dispatch read-only MCP guard remain in force.

Fresh live checks verified the authenticated site/project, Task metadata, all 22
BE appendix labels/IDs, FCAD-6205 as an Epic, and a unique configured assignee.
The following nine read calls were observed:

1. `getAccessibleAtlassianResources`.
2. `getVisibleJiraProjects`.
3. `getJiraProjectIssueTypesMetadata`.
4. Three pages of `getJiraIssueTypeMetaWithFields`.
5. `getJiraIssue` for the selected Epic.
6. `lookupJiraAccountId`.
7. `searchJiraIssuesUsingJql`, scoped to FCAD, the authenticated tenant and the
   persistent marker phrase.

The search returned **zero visible matching issues**, with complete returned
pagination. This is NOT proof that zero issues exist outside this account's
visibility. The MCP exposes user-scoped search and no independent guarantee of
complete issue-security visibility. The adapter records that limitation instead
of trusting a zero-result page as absence proof.

Live evidence also exposed two real format differences now covered by tests:
Atlassian returns search results as `issues.nodes` with `pageInfo`, and FCAD's
Story Point Type v2 is `option-with-child`. The backend decodes that search shape
and preserves the verified Technical parent option `10949` in
`customfield_11312`; it does not invent a child selection or replace the skill.
When modern Parent and legacy Epic Link both exist, the verified modern Parent
is preferred; the detected legacy field remains the fallback for older projects.

API failures, authentication/permission errors, absent fields, unsupported or
incomplete pagination, missing issue details, duplicate markers, lost prior
mappings and uncertain publication remain blocking. Private failed-read evidence
is retained for diagnostics.

## Publisher payload and duplicate protection

The native publisher receives exact approved Markdown, tenant/project/Epic,
verified field configuration, persistent prefix, explicit mapping arrays,
verified existing-issue records, the manifest and exact-revision publication
authorization. Missing or mismatched inputs fail before a paid runtime starts.
There is no fallback to a reasoning agent for missing deterministic inputs.

Future explicitly confirmed publishing rechecks read-only reconciliation before
dispatch. MCP writes remain restricted to selected pending card IDs and their
exact markers. A private atomic reservation prevents repeated create calls for
the same card within a run. A failed/uncertain create retains its publication
receipt; retries require reconciliation. Existing keys and execution associations
are retained rather than creating another issue.
Returned keys must also have observed `getJiraIssue` evidence for the correct
project and exact marker before being recorded as confirmed. An agent's JSON
claim alone is insufficient; missing confirmation leaves publication uncertain.

The saved real dry-run payload has `publicationAuthorization.explicit: false` and
`publishable: false`. It is review evidence, not authorization to publish. The
fully ready contract was tested only with synthetic read proofs and fake publishers.

## Regression, recovery and remaining decision

Full suite: **263 tests; 261 passed, two expected skips, zero failures**. Skips are
Windows-only coverage and the opt-in private historical Markdown fixture. Syntax
checks and `git diff --check` passed.

Localhost MCP/API stubs and fake adapters cover complete/partial searches,
connection-style responses, existing/absent/duplicate issues, permission failures,
incomplete pagination, partial publication, many-to-many mappings, uncertain
receipts, retry stability, marker-prefix collisions, repeated-create denial and
missing-input rejection before model execution.

All pre-existing target Quest records in runs (15), artifacts (104), approvals (3),
tasks (14), works (0), and prior publication operations remain unchanged. Plan,
TRD, specification, appendix bytes and exact approval are preserved. FCAD settings
and Epic are unchanged. Only the new manifest/read-preparation records and private
diagnostics were added; normal startup updates the Quest timestamp.

The real browser was inspected read-only: Prepare Jira publication is enabled,
Publish is disabled, and the current visibility blocker is shown. No Publish or
Confirm action was invoked. There were **zero real Jira writes and zero paid
model calls**. No edits to the affected company repositories or installed skills,
and no commits, pushes or PRs.

Current readiness: **NO**. No mapping clarification is needed for this Quest.
The remaining requirement is a read-only integration/account whose full FCAD
issue visibility can be independently verified, including issue-security levels.
The user-required fail-closed policy cannot be satisfied merely by acknowledging
the warning or approving a zero-result search. No bypass was added.

Private evidence: `~/.devquest/verification/jira-input-contract-20261019/` contains
the pre-change backup, `mapping-report.json`, `dry-run-publisher-input.json`,
`recovery-result.json` and the real UI screenshot.

Code: `src/jira-publication.js`, `src/engine.js`, `src/adapters.js`,
`src/jira-mcp.js`, `src/jira-mcp-policy.js`, `src/jira-project.js`, `public/app.js`.
Validation: `test/jira-publication-contract.test.js`, `test/publisher-input.js`,
`test/adapters.test.js`, `test/jira-mcp.test.js`, `test/jira-project.test.js`, and
the syntax-check entry in `package.json`. No new dependencies or agent framework.

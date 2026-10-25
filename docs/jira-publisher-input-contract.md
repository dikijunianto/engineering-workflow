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

## Explicit account-visible search acceptance (23 October 2026)

Complete-project visibility remains the default requirement. The user may explicitly accept account-visible duplicate checks for one approved appendix using the authenticated typed action `SET_JIRA_SEARCH_SCOPE` with `scope: "account-visible"` and the exact artifact ID. This records the actor, timestamp, artifact ID/hash, project, site and Epic on the Quest; it does not approve another document or publish issues. `scope: "project-complete"` removes the acceptance.

Preparation may then proceed despite unverified issue-security visibility, while recording `visibilityScope: "account-visible"`. The MCP evidence still reports `visibilityComplete: false`; no complete-visibility attestation is invented. The publication preview and confirmation disclose that hidden duplicates may exist. Changed artifact bytes, revisions or Jira targets invalidate the acceptance, and removing acceptance invalidates account-visible readiness.

This changes the user's accepted duplicate-prevention contract: the durable namespace, exact marker reconciliation among returned issues, search pagination, existing mappings, partial/uncertain-write protection and explicit publication confirmation remain enforced, but absence of hidden duplicates is **not guaranteed**.

Applied to Quest `1e5c7016-f508-426c-a6d1-ce67bfb5aa00`, approved appendix revision 1, at the user's explicit request. Read-only preparation reached READY for 51 cards mapped to 16 execution tasks. The sample confirmation was inspected and cancelled; no publishing action was invoked. Tests: 67 focused publication/settings/dashboard tests passed; production UI build and syntax checks passed.

## Publishing failure visibility and pre-start recovery (2026-10-23)

The 18:53:35 UTC attempt for Quest `1e5c7016-f508-426c-a6d1-ce67bfb5aa00` never reached the native skill. `SkillRunner.publish` rejected the manifest's account-visible scope before `#direct("upload")` / `runtime.start`; its second visibility guard did not honor the exact-revision scope acceptance already validated by the engine. The engine had prematurely persisted STARTED/UNCERTAIN, and no publishing AgentRun existed.

The native adapter now reuses the shared scope acceptance check. Publishing creates a Jira Specialist AgentRun before validation, forwards runtime/skill/output events, and persists errors. Only an explicit pre-dispatch rejection is retryable as FAILED_NOT_STARTED; dispatched or unconfirmed results stay UNCERTAIN. Publisher runs cannot be resumed through generic directed replies; a new attempt requires publication confirmation. Filesystem read-only restrictions and scoped Jira create authorization remain unchanged.

The proven historical pre-start rejection was reconciled locally into failed run `e6c7421e-7c0f-4bc2-b660-b45830abdca5`. Its prior ledger and manifest attempt remain recorded; the namespace, card mappings, approved artifact and revision are unchanged. A private local backup was retained. The app was restarted. Browser verification showed the failure in Room and an enabled exact-revision sample confirmation; that dialog was cancelled. No real publisher, paid model invocation or Jira write was performed during this repair.

Regression coverage includes matching/missing scope acceptance at the native adapter, forwarded native events, visible failed runs, safe pre-start retry, and uncertain post-dispatch failure blocking. Live native publishing remains unverified.

## Prose-wrapped native result recovery (2026-10-23)

Run `e2dfee6f-1249-4db0-83a1-08c911fb6777` invoked the native upload skill and created sample FCAD-6297, but returned explanatory prose around a fenced JSON result. The adapter attempted JSON.parse on the entire final message. The saved response is covered by `test/fixtures/jira-publisher-prose-result.txt`.

`parsePublisherResponse` accepts a plain JSON document or exactly one fenced JSON block; missing, malformed or multiple blocks remain errors. Existing task scope, exact card mapping and independent Jira read-back/marker checks still apply; prose alone is never proof of creation. Fake-runtime publishing now tests prose-wrapped results through those checks.

A fresh deterministic read-only metadata/search preflight found FCAD-6297 in FCAD, with parent FCAD-6205 and the exact T1.1 namespace marker. The manifest and execution task were reconciled through existing read-only reconciliation. The one-issue publication ledger/run were then locally reconciled; original FAILED/UNCERTAIN records remain in history, with the reconciliation evidence attached. The app shows COMPLETED and offers the next explicitly confirmed batch; 50 cards remain pending. The approved Markdown was unchanged. No paid invocation or real Jira write occurred during this repair. Full regression: 378 passed, 2 skipped; syntax check passed. Browser evidence: `docs/design/evidence/jira-sample-reconciled.jpg`.

## Batch native read-back evidence (2026-10-23)

Run `9638a8be-3dd9-46c9-81e2-37c811120a9e` returned five mappings but failed the adapter's native `getJiraIssue` event/key/marker check. Historical raw tool events were not retained, so the exact missing/filtered read-back event cannot be proven from the saved agent claims. Fresh deterministic read-only search confirmed FCAD-6298–FCAD-6302 against T1.2, T1.3, T1.4, T2a.1 and T2a.2, with exact namespace markers, FCAD project and FCAD-6205 parent. Existing read-only reconciliation persisted all six total issue mappings. The failed ledger/run were reconciled locally, with prior FAILED/UNCERTAIN history retained; 45 cards remain pending. No creation was retried.

Native confirmation now matches the verified response issue key rather than requiring that the request used a key instead of a valid numeric issue ID. If native read-back evidence is incomplete, the adapter performs one deterministic read-only publication preflight/search and verifies every claimed key/card against the reconciled manifest. Missing markers, different keys, duplicates, incomplete search, connection failure or wrong target remain failures. No write retry or additional paid generation is involved. Verification status/source/count are persisted on the AgentRun, and interruption propagates to the read-only verification. Installed skills and Jira mutation restrictions are unchanged.

Tests cover numeric-ID read-back, missing native events followed by successful deterministic verification, exact marker boundaries (T1.1 cannot match T1.10), unavailable verification, and absent search matches. Browser evidence: `docs/design/evidence/jira-batch-reconciled.jpg`. Live future publishing was not run during this repair.

## Model-free verifier profile isolation (2026-10-23)

The previous batch-verification fallback passed the publisher's `agentProfileContext` into `prepareAppendix(..., "verify")`. `preflightJiraMcp` deliberately overrides route for model-free local API execution, so `assertProfileInvocation` rejected its inherited paid-agent route as changed. This happened after native publishing, not before issue creation.

`prepareAppendix` now attaches the agent Soul, immutable snapshot and route only for agent execution, excluding deterministic verification. The profile integrity guard is unchanged. Verification retains its read-only MCP allowlist, restricted runtime and no-model local API; publishing retains its exact profile/route. Regression tests assert both configurations explicitly, including absence of create/update/delete/transition tools from verification.

Fresh read-only search reconciled FCAD-6303–FCAD-6307 to T2a.3–T2a.7 for run `a8c05e8b-9181-493e-ac79-0468b309724f`. Exact markers, FCAD project and FCAD-6205 parent matched. Failed-run and uncertain-ledger history were retained. The app was restarted and shows COMPLETED; eleven total cards are mapped, forty remain. No Jira mutations, paid calls or next-batch execution occurred during repair. Browser evidence: `docs/design/evidence/jira-verifier-profile-reconciled.jpg`.

## Sample then all remaining (2026-10-23)

After the first successful sample, the primary action is now “Publish All Remaining Jira Tickets”. Preview and authorization use the exact pending manifest-card count, excluding existing mappings; the former five-card ceiling is removed. The frontend submits the displayed confirmed count, and the backend rejects any larger publication scope. Fresh reconciliation can reduce the count but cannot silently expand it. The immutable publisher profile, MCP card allowlist and per-run authorization carry this same pending scope.

The native skill receives the explicit user answer to its next-batch question: publish all Jira tickets left in this approved document. The initial sample remains limited to one. No generic continuation, automatic retry after uncertain writes, appendix revision change, or duplicate-prevention bypass was added. The runtime timeout scales with the authorized count, capped at thirty minutes; partial or uncertain outcomes still require reconciliation.

Synthetic regression publishes a one-task sample and then more than five remaining tasks, prevents an undersized confirmation from authorizing the remainder, and verifies subsequent publication creates no duplicates. Full regression: 379 passed, 2 skipped; build and syntax checks passed. Actual UI confirmation showed 35 pending tickets for the current Quest and was cancelled. No real publishing or paid calls during this change. Evidence: `docs/design/evidence/jira-publish-all-confirmation.jpg`.

## Owned native output filename compatibility (2026-10-23)

The publish-all run `46f1e780-9cd6-4e6b-80b3-1705b091245e` created its remaining issues, then deterministic verification rejected a native spilled search result. Inspection found `preflight_9.txt` inside the owned Claude session's `tool-results` directory. It contained valid JSON (159,815 bytes); the existing code required the exact filename `preflight_9.json`. The failure was neither the 2,000,000-byte limit nor evidence of Jira rate throttling.

`readOutput` now accepts only `<pending-tool-id>.json` or `<pending-tool-id>.txt` within that same canonical session directory. Regular-file, size and JSON checks remain mandatory. Separate actionable errors identify filename/session mismatch, non-files, and oversized results. Tests cover both formats and rejection of oversized, wrong-name, escaped and truncated outputs.

Live read-only preflight with the fix verified all 51 existing appendix-card markers, project FCAD and Epic FCAD-6205; none remained pending. The failed run/ledger were reconciled locally with prior history and a private backup preserved. Quest state is TASKS_PUBLISHED, implementation remains explicitly stopped (`autoExecute=false`). Publish All Remaining remains the product behavior; no additional internal batch-size policy was introduced for this filename bug. App restarted; full regression 379 passed, 2 skipped; syntax checks passed. No Jira mutation or paid model invocation during repair. Evidence: `docs/design/evidence/jira-all-published-reconciled.jpg`.

## Reconciled ticket-document synchronization (2026-10-23)

The database contained all 51 issue mappings across 16 complete execution tasks, but the latest `ticket` document was revision 2 with only the earlier 16 issue links. Read-only reconciliation updated task mappings without calling `saveTickets`. The earlier manual recovery also omitted that document refresh.

Successful `JiraPublication.prepare` now calls the existing ticket-document generator after recording reconciled mappings. `saveTickets` preserves the current revision when content and source plan are unchanged. Regression verifies a read-only-discovered issue appears in the ticket document and repeated unchanged preparation creates no extra revision.

The existing Quest's local ticket document was regenerated as revision 3, preserving prior revisions: 51 links, 16 complete mappings, zero pending/unlinked entries. Browser verified the saved document, including T4 and T16. No Jira requests, mutations or model calls were needed for this local refresh. Full suite: 379 passed, 2 skipped; syntax checks passed. Evidence: `docs/design/evidence/jira-ticket-document-refreshed.jpg`.

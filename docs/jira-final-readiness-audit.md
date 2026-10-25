# Final Jira publication readiness audit

Audited 2026-10-19. Quest `12c8b15e-fb7b-436d-a8cf-a277989288af`.

**NOT READY for human publication authorization. Production stays BLOCKED.**
No application code, Quest records, approvals, source repositories or installed
skills were changed. No publishing skill, paid generation or real Jira mutation
was invoked. This audit adds this report and private local verification evidence.

## Final publication preview

| Item | Result |
| --- | --- |
| Project / Epic | FCAD / FCAD-6205 |
| Approved appendix | Revision 1, `a8f785a8-f3b1-4d5a-b8e8-d21219475102` |
| SHA-256 | `8b4d731d2689d15f795eb78179c3f3daa171f1610265e6fb229dbe25fdc8ae0c` |
| Intended issues | 31, subject to verified duplicate reconciliation |
| Execution tasks | 14, all explicitly mapped |
| Total weight | 55 points |
| Already existing | 0 visible marker matches; global count UNKNOWN |
| Mapping ambiguities / unmapped cards | 0 / 0 |
| Blocked cards | All 31: absence of hidden duplicates is unverified |
| Account visibility | Browse-filtered FCAD access verified; full project issue visibility NOT verified |
| Production publication | BLOCKED; no authorization or automatic publishing performed |

Future publication still requires a separately authorized single sample, then
reviewed batches of at most five. The preview does not authorize all 31 creates.

## Live visibility findings

The authenticated Claude Code Atlassian MCP connected and exposed 41 tool
schemas. At 08:17:31 UTC, `getVisibleJiraProjects` with `action="browse"`,
`searchString="FCAD"`, `expandIssueTypes=false`, `maxResults=50` returned project
FCAD, ID 11337. This confirms access through the MCP's Browse filter. It is not
a raw `mypermissions` result or proof of an unconditional project-wide grant.

At 08:17:37 UTC, deterministic publication preflight verified the same tenant,
project, Task fields, selected Epic and unique configured assignee. A fresh marker
search returned one empty page with `isLast=true`, no cursor, and
`visibilityComplete=false`. Returned pagination is complete; visibility is not.
All 22 approved Backend option IDs and labels match freshly retrieved metadata.

The live inventory has no permission-scheme, issue-security-scheme, level-member
or effective-project-permission tool. `fetch` accepts only a Jira issue or
Confluence page ARI; it cannot fetch arbitrary Jira REST permission endpoints.
It was not called. No OAuth credentials were extracted or copied into a new
REST client. Missing capability is the verified limitation: there is no evidence
that the account is actually denied Browse access, or that a security scheme
necessarily exists. Both unrestricted and restricted issue visibility remain
possible.

An admin-assisted **read-only** verifier would need:

- Effective account identity and `GET /rest/api/3/mypermissions` for FCAD with
  `BROWSE_PROJECTS`; inspect the permission scheme to distinguish unconditional
  account/group/role grants from issue-dependent grants.
- `GET /rest/api/3/project/FCAD/issuesecuritylevelscheme` and the assigned
  permission scheme. These reads require Administer Projects or Administer Jira;
  no permission elevation was attempted.
- If a security scheme exists: its complete levels and membership rules,
  resolved against the publishing account's effective groups/roles. A visible
  security-level list alone is user-filtered and insufficient. Complete level
  member enumeration can require Administer Jira and appropriate OAuth scopes.
- Evidence of relevant app-access restrictions, with all pagination completed.

Do not give a reasoning agent broad administrator tools. A separate fixed-GET
verifier or authenticated administrator evidence collector should supply these
facts without providing mutation capabilities. A missing/403/ambiguous response
must remain UNKNOWN, not be interpreted as "no security scheme".

Official references: [project permission and security schemes](https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-project-permission-schemes/),
[effective permissions](https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-permissions/),
[security levels and members](https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issue-security-schemes/).

## Realistic security contract

The required scope is the selected FCAD publication namespace, across the whole
project, not merely children of the Epic or issues assigned to the publisher.

1. Bind a trusted, fresh visibility proof to tenant, project, publishing principal,
   permission/security scheme versions, memberships and time. Verify an
   unconditional Browse grant and either no applicable issue-security scheme or
   effective visibility of every level. A user checkbox or model assertion is
   not such a proof. Invalidate on policy/account changes and recheck per batch.
2. Complete reconciliation with exact marker comparisons. The current
   `description ~` search is useful candidate discovery, but its text indexing,
   punctuation and consistency are not proven to provide an exhaustive marker
   index. Before enabling publication, use a complete authorized project inventory
   with local exact matching, or a verified structured-marker integration. Keep
   uncertain-write blocking even when a search returns zero.
3. Serialize publication in the shared durable namespace, preserve the journal
   before dispatch, and reconcile unknown outcomes without automatic creates.
   External publishers must not concurrently use this namespace. A shared lock
   is needed if multiple installations ever publish the same scope.
4. Require exact artifact/hash/source-plan binding and explicit bounded batch
   approval. Validate the dispatched payload against the saved intended fields;
   the present write hook enforces project/card/marker scope, not equality of
   every Epic, weight or custom-field value.

This is a proposed acceptance contract, not an implemented visibility verifier.
The current native adapter always records unverified full visibility, so admin
evidence alone will not automatically unlock its UI. Implement and regression-test
the fixed read-only verifier and its evidence validation before enabling it.

## Idempotency audit

| Control | Verified behavior and limit |
| --- | --- |
| Stable namespace | `devquest:12c8b15e-fb7b-436d-a8cf-a277989288af:appendix:` persisted; card ID appended, no attempt/revision suffix |
| Durable manifest | 31 entries stored in SQLite; tenant/project/Epic, approved revision/hash and Plan/TRD hashes bound; retarget/revision changes require reconciliation |
| Durable mappings | Per-card identities and execution ID arrays persisted; confirmed issue keys retained; a task completes only when all associated cards have keys |
| Existing issues | Complete returned pages and required descriptions/project fields required; duplicates, overlapping pages, lost mappings and one issue with multiple markers fail closed |
| Active publisher | Quest-scoped background key plus server action coordination; one live server per data directory through transactional PID ownership |
| Cross-installation guarantee | NONE: separate data directories or external Jira clients are not coordinated |
| Create reservation | Atomic per-card local reservation before tool dispatch; scoped to one managed runtime, not a Jira uniqueness constraint |
| Unknown result | Durable STARTED receipt and UNCERTAIN manifest before publish; incomplete receipt blocks another publication |
| Confirmation | Agent JSON alone insufficient; observed issue read must confirm key/project/exact marker |
| Partial recovery | Known mappings preserved, pending cards selectable after reconciliation; clearing an uncertain receipt needs an explicit validated recovery path, not automatic retry |

Jira does not enforce unique description markers. An external actor can copy or
remove markers, and search is not a transactional uniqueness check. The current
controls provide fail-closed local retry protection, not distributed exactly-once
delivery. They must not be advertised otherwise.

Code: `src/jira-publication.js:5,71,166,262,279,397`;
`src/engine.js:206,815,823,859`; `src/orchestration.js:60`;
`src/store.js:171`; `src/adapters.js:1648,1687,1755,1892`;
`src/jira-mcp-policy.js:18,73`.

## Approved Markdown reconciliation

The exact approved bytes validate with the original seven-section Markdown
contract and all 22 BE options. All 31 card IDs are unique; section 6.4 maps them
explicitly onto all 14 existing execution tasks. Every manifest entry agrees with
that mapping. The approval, manifest and actual file hashes agree, as do approved
Plan/TRD references and bytes. No artifact was regenerated or revised.

Weights remain **user-confirmed**, not Jira-certified: Very Low/V=1, Low/L=2,
Medium/M=4, High/H=8. Exact original BE labels/IDs are retained; no MOB replacement.
Every intended payload's category IDs were independently compared with its exact
task table. The 31 task totals sum to 55; no duplicate categories within a card,
unmapped identities or duplicate markers were found.

The historical 29 count belongs to failed Haiku run
`0ee5f0d8-5934-4761-9250-716b2d536970`, not this approved revision. That rejected
candidate had 29 task tables and 56 points, invalid IDs/headings and invalid
weight/category formatting. It was never accepted. The successful Sonnet output
is a different document with 31 cards and 55 points; no silent deduplication or
merging of historical output was performed.

## Local-only dry run and tests

The actual approved Markdown and persisted manifest were read through a
read-only SQLite connection. All 31 intended payloads were dispatched only to a
temporary HTTP server bound to `127.0.0.1`. Synthetic issue keys are not real
publication evidence. Production adapters and the upload skill were not invoked.

- 31 mock creates; 31 confirmed card mappings; all 14 cloned execution tasks
  completed. Correct Epic FCAD-6205, Technical option 10949, BE option IDs,
  per-card points, assignee, exact markers and execution associations checked.
- One synthetic 503 before create and one lost response after create. Both
  stopped the simulated attempt. Explicit synthetic reconciliation found the
  latter issue; only remaining cards were retried. Still exactly 31 mock issues.
- Repeated mock create rejected; duplicate-marker and incomplete-pagination
  fixtures rejected by the production reconciler. An empty search without
  visibility proof never unlocked production readiness.
- First mock batch one, subsequent simulated batches no greater than five.
  Synthetic human recovery/approval steps are harness actions, not proof of a
  production recovery UI. Mock-side uniqueness is not a Jira guarantee.
- All audited production rows unchanged before/after: SHA-256
  `aae81c7aa08a594e20e54caeef76f44674c50803f01bc233915f503449b3a589`.
- Existing regression suite: **263 tests, 261 passed, 2 expected skips, 0 failed**.
  `npm run check` and `git diff --check` passed.

Private reproducible scripts, exact payloads, fresh tool schemas/read evidence,
mock dispatch log and results are under
`~/.devquest/verification/jira-final-readiness-20261019/`. Company Markdown and
payloads are not copied into repository fixtures.

The audit also encountered local capability-probe failures: installed Claude help
is 22,110 bytes, exceeding the application's 20,000-character help capture. The
audit harness captured up to 100,000 solely for `--help`; execution restrictions
were unchanged. Application code was not changed; this startup reliability issue
should be addressed separately before relying on a fresh publishing runtime.

## Safety and remaining blockers

Final successful live evidence contains seven metadata/Browse reads plus nine
publication-preflight reads. All were fixed read operations through the existing
verify-stage allowlist, with restricted file access, no shell tool, no other MCP
server and a private loopback model endpoint. No native Skill invocation or paid
model reasoning was requested. Real write methods were never enabled or dispatched.
Earlier probe failures were local capability checks and one invalid read page-size
request; no mutation retry occurred. Runtime enforcement covers this audit's
dispatches, not a Jira-wide administrator audit of other actors.

Real Jira create/update/delete/transition/comment/attachment/other writes from
this audit: **0**. Real denied write attempts: **0**. Forbidden-method tests ran
only locally. Paid invocations: **0**. Publishing: **NOT EXECUTED**.

Remaining blockers: trusted complete-visibility evidence and an implemented
verifier, exhaustive marker reconciliation, dispatched-payload enforcement, and
the local CLI help-probe reliability issue. Unknown-write recovery remains a
deliberate human reconciliation requirement. The existing Quest remains approved
at the document level and BLOCKED at publication; no safety flag was relaxed.

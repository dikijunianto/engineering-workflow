> Managed MCP authentication and FCAD Appendix metadata are now verified. See [the Atlassian MCP investigation](atlassian-mcp-access.md); the earlier live-authentication limitation below is superseded.

# Jira project compatibility investigation and fix

## Finding

The immediate FCAD rejection was **DevQuest's static `project !== "FFE"` validation** in `SkillRunner.validateUpload`, introduced in the preceding Markdown-contract change. It ran before Claude or Jira, so its error was not a Jira denial or a native skill result. The related Epic regex also assumed `FFE-…`. Those project-specific checks are removed.

Both installed skills were read. Their directories contain only `SKILL.md`, not an executable publisher or project allowlist. The generation skill supports a supplied project key/URL when that project's Appendix field is configured. The upload skill's **body**, not just its description, contains explicit FFE/FEG scope, FFE Epic checks and cached MOB mappings. It also says to rediscover context when it differs. These instructions are real, but do not prove a runtime or Jira restriction.

The user's successful manual FCAD workflow is accepted as reported evidence. A likely explanation is that explicit project URL/key/Epic and interactive session context guide Claude to adapt the FFE-oriented instructions. No successful manual transcript was supplied, so that explanation is an inference, not a reproduced result. DevQuest must not turn documentation assumptions into an unconditional project allowlist, nor assume historical success proves current field compatibility.

## Invocation differences and correction

Previously DevQuest rejected FCAD before any upload invocation and saved only project key, Epic, assignee and weight reference. The managed skill also lacks interactive context and another developer's cached memory. Restricted execution and the private, unchanged native skill plugin are retained.

Jira settings now support and reuse:

- Site URL, project key, project URL, optional Epic, assignee and weight reference.
- HTTPS URL validation, no URL credentials, matching site origins and selected project paths.
- Project-specific Epic key validation, followed by live verification of its actual project and Epic issue type.
- Missing URLs remain missing. Only a matching authenticated resource/site and an actual project URL returned by verified metadata can provide defaults. External project homepage URLs are not treated as Jira project URLs.

The native invocation remains `Skill({skill:"devquest-jira:upload-task-to-jira"})` with the unchanged installed file copied into a private per-run plugin. Its input now explicitly identifies the selected project and URLs in `quest.jiraContext`, the immutable approved Markdown revision and its exact bytes, and saved Epic/assignee/reference.

The prompt makes the user's explicit target project supersede the skill's FFE-specific scope for this request, while preserving field/category/weight, Epic/assignee, sample/batch and duplicate checks. If Claude still refuses the project, that is surfaced as a preparation conflict; no replacement publisher runs and no installed file is edited.

## Read-only preparation before publishing

A **Verify Jira project** action invokes that native skill with only Read/Skill and the existing named read-only Atlassian methods. `createJiraIssue` is absent from its allowlist. An operation records progress, errors and verified capabilities; this action cannot publish.

Publishing also performs fresh read-only preparation before writing the durable publication marker or allowing the creation tool. This means authentication/metadata failures are retryable after remediation, without incorrectly classifying a read-only failure as uncertain issue creation.

Compatibility is based on successful native tool results, never solely on a model's final assertion:

1. Authenticated resource and selected project, with matching tenant/site.
2. Target-project Task create metadata and issue type.
3. Available multiselect `customfield_11543`, enabled option IDs/labels matching the approved document.
4. Discovered numeric Weight Points field, Technical Story Point Type option and Epic parent/link field. Cached field IDs are not blindly trusted.
5. Required fields/defaults, writable field operations when exposed, and complete exposed field pagination.
6. The supplied Epic exists as an Epic in the selected project.
7. A positive native preparation confirmation. Missing information, skill refusal and permission denials stop the flow.

Successful target-project create-metadata access is evidence of the user's **Create issues** permission required by those endpoints; it does not guarantee all later issue operations succeed. See [Atlassian's create metadata documentation](https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issues/#api-rest-api-3-issue-createmeta-projectidorkey-issuetypes-issuetypeid-get). Actual assignee lookup and sample creation/read-back remain the installed upload skill's responsibility.

Epic and assignee may be omitted in saved configuration. The unchanged upload skill still requires both before creation; verification reports missing inputs rather than inventing an Epic/assignee or dropping its rules.

## Markdown and safety

The exact approved Markdown remains authoritative: no task regeneration, title/ID/category/weight/dependency/acceptance rewriting occurs. Settings changes invalidate the prior appendix approval. Current revision/hash checks, native skill verification, restricted filesystem execution, no Bash/Git/source writes, explicit sample/batch publication and uncertain-publication retry blocking remain intact.

Only the native upload skill creates issues. No generic publisher or additional Jira mutation API was added. A separate Verify action cannot authorize publication, and its cached success cannot authorize a later publish: publishing verifies again. Existing failed AgentRuns, artifact revisions and mappings remain in place.

## Actual live findings and limits

A free `claude auth status` check confirms Claude login through `claude.ai`; it does **not** prove Atlassian OAuth authorization. Available connector tools expose no callable Jira metadata integration independent of Claude.

A read-only browser request to `https://amarbank.atlassian.net/rest/api/3/issue/createmeta/FCAD/issuetypes` returned:

> You cannot create issues in this project. You are not authorized to perform this operation. Please log in.

This browser session is unauthenticated. The response does not prove FCAD lacks permission, Appendix fields or compatibility in the user's authenticated Claude session. No credentials were exported and no paid Claude invocation was made. Managed Atlassian OAuth, actual FCAD fields/options, Epic FCAD-6205 and assignment permissions remain unverified.

The implementation is ready for an authorized read-only live preparation test after supplying/confirming the target URLs and authenticating the managed Atlassian connection. FCAD is **not yet certified ready for live issue creation**. Preparation must pass and a current appendix revision must be approved before an explicit sample publish.

## Validation and changed files

- `src/jira-project.js`: project/URL normalization and evidence-based capability validation.
- `src/adapters.js`: native read-only preparation, actual tool-result evidence, target-project context and verified native upload handoff.
- `src/engine.js`, `src/orchestration.js`: typed settings/verification actions, operation status and pre-publication preparation.
- `public/app.js`: saved URL configuration, verification action/status and revision-safe feedback.
- `test/jira-fixture.js`, `test/jira-project.test.js`: synthetic Jira API/tool responses for FFE/FCAD, URLs, tenants, Epic, fields, permissions, missing metadata, paging and native read-only/fake-publish sequencing.
- Existing appendix, adapter and UI tests updated; approval and duplicate-publication regression coverage retained.

The fake native-runtime dry run uses synthetic Markdown and fake Jira tool/API responses, creates no actual issues, and demonstrates that missing metadata never reaches the creation phase. It is not proof of live Claude skill adaptation or authenticated Jira compatibility.

Neither installed skill changed. No paid Claude/Codex call, real issue publication, commit, push or PR was performed.

Final full regression: **167 tests, 166 passed, one platform skip, zero failures**. `npm run check`, the new module's syntax check and `git diff --check` passed.

The localhost app was reloaded only after confirming no running AgentRuns/operations or automatically executing Quests. The current Quest remains PLAN_APPROVED with FCAD / FCAD-6205 and its original assignee/reference; all 67 artifact records/files, approvals, failed-run history, tasks and operations matched before/after (normal Quest updatedAt ignored). The failed native-skill attempt remains FAILED with generationActive=false and recoveryBlocked=false. No generation or verification was automatically started.

> The static FFE-only gate described below is superseded by [verified project compatibility](jira-project-compatibility.md). Markdown, approval and retry safeguards remain unchanged.

# Jira appendix: Markdown contract

DevQuest invokes the installed `create-appendix-task-list` skill in its restricted per-run Claude plugin. The skill's Markdown document is authoritative. Neither installed skill is modified.

## Evidence inspected

The actual failed run `4f01d822-fc3d-4d7b-a108-12ab09800f31` failed at `Unknown skill: create-appendix-task-list`. Its saved checkpoint contains that tool error, not a completed Markdown appendix. There is no generated document in that attempt to recover. The earlier native registration fix remains in place.

Additional contract defects found in DevQuest:

- Generation required JSON and arbitrary extra task-card fields absent from the installed skill's output template.
- Capture rejected plain Markdown, and did not validate the original seven-section document or its arithmetic.
- Publishing checked a current artifact ID but did not record separate human approval of that revision.
- The upload prompt embedded instructions rather than invoking the native skill and overrode its required Epic and assignee rules.

## Capture and validation

Generation now asks for complete Markdown directly. JSON `{content: "..."}` remains an optional internal transport envelope. Claude result and assistant text envelopes are decoded; runtime errors remain errors. Nothing reconstructs or rewrites the document.

Validation checks the seven original numbered section headings and §6.1–6.5; live-source matrix option IDs and labels; downstream `#### T<group>.<n> — title` task headings; exact `Appendix line | Category | Weight` tables and `**Task total**` rows; distinct task IDs and categories; matrix weights, task sums, grand totals; 16-point halves; and flagged oversized tasks. Regeneration retains prior IDs or explicit removed placeholders. It does not require extra acceptance-criteria/dependency/scope fields absent from the original template.

For native generation, the actual successful Jira metadata tool response must provide `customfield_11543.allowedValues` for the requested project key. Missing/unparseable metadata fails closed. Matrix labels/IDs must match these live enabled options; model-authored matrix text alone is insufficient evidence. Non-MOB weights still require the installed skill's matching reference; DevQuest does not invent a reference or field options.

Validated bytes become an immutable appendix revision and the `jira-appendix.md` convenience copy. Upload receives the immutable revision path, exact content, ID and hash, never the mutable convenience copy. Manual import passes the same structural validator. Draft import cannot establish live Jira compatibility; the upload skill must verify fields before creation.

A runtime-provided Markdown file path can be imported only from the private per-run temporary artifact directory, with canonical containment, file type and size checks. Escaping symlinks are rejected. Native generation retains Read/Skill and metadata tools only, so it normally returns Markdown text; no Write/Bash tool or repository write grant was added to enable file output.

## Human approval and publication

Artifacts provides Markdown/source viewing, download and explicit approval. Approval records bind the exact revision/hash and its current plan, TRD and Jira context. Changing the document or context requires fresh approval. A rendered approval button submits the displayed revision ID; it cannot silently approve a newer document.

Publishing remains a separate explicit sample/batch action. The installed upload skill is copied unchanged into its own private plugin and invoked as `devquest-jira:upload-task-to-jira`. Its only additional mutation capability is the named Jira `createJiraIssue` tool; local files remain read-only, restricted execution remains enabled, and Bash/nested agents/other skills remain unavailable.

The exact approved Markdown is the sole task document. Stable appendix IDs are returned with Jira mappings and stored alongside execution task mappings. Existing mappings and an appendix-task-specific idempotency prefix are supplied on later batches. Sample and batch limits remain one and at most five respectively. Native result mappings must reference valid appendix and execution IDs.

A durable publication marker is written before invocation. Interrupted calls, missing/invalid mappings or interrupted persistence leave publication uncertain and block automatic retry. This prevents repeating a potentially successful remote create. Reconciliation requires verifying Jira and repairing mappings/marker deliberately; this change does not add automatic remote reconciliation or claim remote exactly-once transactions.

## Installed upload compatibility blocker

The installed `upload-task-to-jira` explicitly targets FFE, rejects other projects, and requires an FFE Epic and assignee. The current Quest remains configured for **FCAD / FCAD-6205**, so native publication is blocked before invoking Claude. DevQuest no longer overrides that rule. Supporting FCAD requires an explicitly approved compatible upload skill; neither installed skill was changed here.

FCAD field availability remains unverified because the previous read-only metadata check lacked an authenticated Jira session. No categories were invented. No paid Claude/Codex calls or real Jira publishing were performed.

## Verification and preservation

Realistic synthetic Markdown follows both installed skill contracts. Automated tests cover direct/enveloped capture, literal downstream heading/table/total parsing, arithmetic/duplicate/category rejection, live metadata extraction, canonical temporary-file imports, stable IDs, revision approval invalidation, exact upload bytes, native upload invocation/grants, UI approval revision binding, and uncertain-publication retry blocking. No real Jira calls are used in tests.

The existing Quest remains `PLAN_APPROVED`, with saved FCAD parameters, 67 artifact records and valid file hashes, original failed-run history and approvals preserved. Retry is available; generation was not automatically restarted. Both installed skill SHA-256 hashes remain unchanged:

- create-appendix-task-list: `3c2e9506f53c3241fd2d5d8cbcf91cd2600fb6ff22e1b24debcfb9d2f8e5c49a`
- upload-task-to-jira: `2acb75b2f56dace902dea96c24352c790f7f2e64b3f25451de05500f5613cce4`

Live model reasoning, authenticated FCAD metadata, and actual Jira publication are unverified. Parsing compatibility is checked against the installed upload skill's documented Markdown grammar; no claim is made that a live upload ran.

## Files and final checks

- `src/appendix-markdown.js`: transport decoding, original-format validator, live-option extraction and confined file import.
- `src/jira-appendix-agent.js`: Markdown capture and persistence.
- `src/adapters.js`: Markdown-first generation prompt, native installed upload skill, exact document handoff and mapping checks.
- `src/engine.js`, `src/orchestration.js`: revision approvals, pre-publication validation and durable uncertain-publication guard.
- `public/app.js`: Artifacts viewing/download and revision-bound approval controls.
- `test/fixtures/jira-appendix.md`, `test/appendix-markdown.test.js`, `test/appendix.test.js`, `test/adapters.test.js`, `test/engine.test.js`, `test/ui.test.js`: synthetic regression coverage.
- This report and a supersession note in `docs/claude-native-appendix-skill.md`.

Final full regression: `npm test` — 159 tests, 158 passed, one platform skip, zero failures. Additional focused adapter metadata test passed. `npm run check`, explicit new-module syntax check and `git diff --check` passed.

The localhost server was restarted with the updated code after confirming no running operations, AgentRuns or automatically executing Quests. Live read-only state inspection confirms the original failed attempt remains FAILED, `generationActive=false`, `recoveryBlocked=false`. All relevant persisted records and artifact hashes matched before/after restart (normal Quest `updatedAt` ignored). No automatic generation was started. No commit, push or PR was made.

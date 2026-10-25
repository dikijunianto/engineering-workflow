import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { appendixTaskMapping, reconcileIssueSearch } from "../src/jira-publication.js";
import { fixture } from "./engine-fixture.js";

const markdown = await readFile(new URL("./fixtures/jira-appendix.md", import.meta.url), "utf8");
const issue = (key, marker) => ({
  key,
  fields: { project: { key: "FFE" }, description: `Approved task\n${marker}\n` },
});
const options = [
  { id: "11515", value: "Refactor or add 1 generic function", points: 2 },
  { id: "11516", value: "Refactor generic function unit test", points: 2 },
];
async function setup(t) {
  const f = await fixture(t);
  await f.plan();
  const q = f.store.get("quests", f.quest.id);
  const metadata = f.store.metadata(q.id, {
    project: "FFE",
    projectId: "100",
    cloudId: "cloud-test",
    options,
    selectedOptions: options,
  });
  f.store.put("quests", {
    ...q,
    jiraMetadata: metadata,
    jiraContext: { project: "FFE", siteUrl: "https://jira.example", epic: "FFE-1" },
  });
  const plan = f.engine.approved(q.id, "plan"),
    trd = f.engine.approved(q.id, "trd");
  const doc = f.store.artifact(q.id, "appendix", markdown);
  const artifact = f.store.put("artifacts", {
    ...doc,
    planArtifactId: plan.id,
    trdArtifactId: trd.id,
    jiraMetadata: metadata,
  });
  await f.engine.action("APPROVE_APPENDIX", { questId: q.id, artifactId: artifact.id });
  const proof = {
    cloudId: "cloud-test",
    projectId: "100",
    siteUrl: "https://jira.example",
    project: "FFE",
    requiredFields: ["summary", "project", "issuetype"],
    weightField: "customfield_10751",
    storyTypeField: "customfield_11312",
    technicalOptionId: "10949",
    appendixField: "customfield_11543",
    searchPages: [{ issues: [], total: 0, startAt: 0, visibilityComplete: true }],
  };
  let captured;
  f.adapters.skill.preflightPublication = async (input) => {
    captured = input;
    return structuredClone(proof);
  };
  return { ...f, artifact, proof, quest: f.store.get("quests", q.id), captured: () => captured };
}

test("explicit source references map appendix identities independently of numeric execution prefixes; ambiguous mappings fail", () => {
  const tasks = [
    { id: "execution-9", key: "A" },
    { id: "execution-2", key: "T8" },
  ];
  assert.deepEqual(appendixTaskMapping(markdown, tasks)[0].executionTaskIds, ["execution-9"]);
  const table = "| Plan execution ID | Jira card(s) |\n|---|---|\n| T8 | T1.1 |\n| A | T1.1 |\n\n";
  const explicit = markdown.replace("### 6.5", table + "### 6.5");
  assert.deepEqual(appendixTaskMapping(explicit, tasks)[0].executionTaskIds.sort(), [
    "execution-2",
    "execution-9",
  ]);
  assert.throws(
    () => appendixTaskMapping(markdown.replaceAll("Task A", "unmapped"), tasks),
    /Mapping review/,
  );
  assert.throws(
    () => appendixTaskMapping(explicit.replace("T8 | T1.1", "T8 | T1.99"), tasks),
    /unknown appendix/,
  );
});

test("indented skill tables accept Jira cards and exact execution IDs with matching task keys", () => {
  const tasks = [{id:"quest-uuid_T1",key:"T1"}];
  const table = "   | Plan execution ID | Repo | Jira cards | Plan dependencies |\n   |---|---|---|---|\n   | `quest-uuid_T1` (T1) | FTS | T1.1 | — |\n\n";
  const document = markdown.replace("### 6.5",table+"### 6.5");
  assert.deepEqual(appendixTaskMapping(document,tasks)[0].executionTaskIds,["quest-uuid_T1"]);
  for (const invalid of [document.replace("(T1)","(T2)"),document.replace("quest-uuid_T1","other-quest_T1"),document.replace("T1.1 |","T1.99 |")]) {
    assert.throws(()=>appendixTaskMapping(invalid,tasks),/Mapping review required/);
  }
  assert.throws(()=>appendixTaskMapping(document,[...tasks,...tasks]),/ambiguous execution/);
});

test("reconciliation requires complete search; duplicate markers, pagination errors, lost mappings and failures never become no-match", () => {
  const manifest = {
    project: "FFE",
    entries: [
      { appendixTaskId: "T1.1", marker: "devquest:q:appendix:T1.1" },
      { appendixTaskId: "T1.10", marker: "devquest:q:appendix:T1.10" },
    ],
  };
  const result = reconcileIssueSearch(manifest, [
    {
      issues: [issue("FFE-10", manifest.entries[1].marker)],
      total: 1,
      startAt: 0,
      visibilityComplete: true,
    },
  ]);
  assert.equal(result.entries[0].issueKey, undefined);
  assert.equal(result.entries[1].issueKey, "FFE-10");
  assert.equal(
    reconcileIssueSearch(manifest, [{ issues: [], isLast: true }]).visibilityVerified,
    false,
  );
  for (const pages of [
    [],
    [{ issues: [], total: 1 }],
    [{ issues: [], error: "permission denied", total: 0 }],
    [{ issues: [], total: 0, startAt: 1 }],
    [
      {
        issues: [
          issue("FFE-1", manifest.entries[0].marker),
          issue("FFE-2", manifest.entries[0].marker),
        ],
        total: 2,
      },
    ],
  ])
    assert.throws(() => reconcileIssueSearch(manifest, pages), /search|pagination|Duplicate/);
  assert.throws(
    () =>
      reconcileIssueSearch(
        { ...manifest, entries: [{ ...manifest.entries[0], issueKey: "FFE-9" }] },
        [{ issues: [], total: 0 }],
      ),
    /not returned/,
  );
});

test("manifest persists before reads, stays stable across retries, supplies full native input and preserves approved content", async (t) => {
  const f = await setup(t),
    history = JSON.stringify(f.store.all("approvals"));
  const first = await f.engine.publication.prepare(f.quest, f.artifact);
  assert.equal(first.state, "READY");
  const input = f.captured();
  assert.equal(input.appendixIdempotencyPrefix, `devquest:${f.quest.id}:appendix:`);
  assert.deepEqual(input.existingIssues, []);
  assert.equal(input.appendixTaskMapping.length, 1);
  assert.equal(input.publicationManifest.id, first.id);
  assert.ok(f.store.get("operations", first.id));
  const again = await f.engine.publication.prepare(f.quest, f.artifact);
  assert.equal(again.id, first.id);
  assert.equal(again.appendixIdempotencyPrefix, first.appendixIdempotencyPrefix);
  assert.equal(again.entries[0].intendedFields.summary, "T1.1 — Alpha change");
  assert.equal(again.entries[0].intendedFields.additional_fields.customfield_10751, 4);
  assert.equal(f.store.content(f.artifact), markdown);
  assert.equal(JSON.stringify(f.store.all("approvals")), history);
  assert.equal(f.engine.publication.requireReady(f.quest, f.artifact).id, first.id);
  const next = f.store.artifact(f.quest.id, "appendix", markdown);
  assert.throws(() => f.engine.publication.resolve(f.quest, next), /modified revision/);
});

test("user-scoped visibility, duplicate markers and API failures block before any publishing runtime", async (t) => {
  for (const mode of ["visibility", "duplicate", "failure", "pagination", "mapping"])
    await t.test(mode, async (t) => {
      const f = await setup(t);
      if (mode === "visibility") f.proof.searchPages[0].visibilityComplete = false;
      if (mode === "failure")
        f.adapters.skill.preflightPublication = async () => {
          throw new Error("Permission denied by read-only Jira search");
        };
      if (mode === "pagination") f.proof.searchPages[0].total = 1;
      if (mode === "duplicate") {
        const marker = `devquest:${f.quest.id}:appendix:T1.1`;
        f.proof.searchPages[0].issues = [issue("FFE-1", marker), issue("FFE-2", marker)];
        f.proof.searchPages[0].total = 2;
      }
      if (mode === "mapping") {
        const task = f.engine.tasks(f.quest.id).find((t) => t.key === "A");
        f.store.put("tasks", { ...task, key: "Unknown" });
      }
      await assert.rejects(
        f.engine.publication.prepare(f.quest, f.artifact),
        /visibility|Duplicate|Permission|pagination|Mapping review/,
      );
      assert.equal(
        f.engine.publication.get(f.quest.id).state,
        mode === "mapping" ? "MAPPING_REVIEW" : "BLOCKED",
      );
      assert.equal(f.pending.length, 0);
      await assert.rejects(
        f.engine.action("PREVIEW_JIRA_PUBLICATION", {
          questId: f.quest.id,
          appendixArtifactId: f.artifact.id,
        }),
      );
    });
});

test("verified existing issues reconcile into execution mappings; partial and uncertain results cannot create a second mapping", async (t) => {
  const f = await setup(t),
    marker = `devquest:${f.quest.id}:appendix:T1.1`;
  f.proof.searchPages[0].issues = [issue("FFE-11", marker)];
  f.proof.searchPages[0].total = 1;
  const manifest = await f.engine.publication.prepare(f.quest, f.artifact);
  const task = f.engine.tasks(f.quest.id).find((t) => t.key === "A");
  assert.equal(task.jira.issues.length, 1);
  assert.equal(task.jira.complete, true);
  assert.equal(task.jira.url, "https://jira.example/browse/FFE-11");
  const ticket = f.store.latest(f.quest.id, "ticket");
  assert.match(f.store.content(ticket), /FFE-11/);
  assert.match(f.store.content(ticket), /Mapping: complete/);
  await f.engine.publication.prepare(f.quest, f.artifact);
  assert.equal(f.store.latest(f.quest.id, "ticket").id, ticket.id);
  assert.equal(f.engine.tasks(f.quest.id).find((t) => t.id === task.id).jira.issues.length, 1);
  assert.throws(
    () =>
      f.engine.publication.recordResults(manifest, [
        { taskId: task.id, appendixTaskId: "T1.1", key: "FFE-12" },
      ]),
    /second issue/,
  );
  f.store.put("operations", {
    id: `jira-publish:${f.quest.id}`,
    questId: f.quest.id,
    state: "STARTED",
  });
  assert.throws(
    () => f.engine.publicationInput(f.quest, { appendixArtifactId: f.artifact.id }),
    /uncertain/,
  );
});

test("partial results keep execution tasks incomplete until all associated cards exist, including many-to-many associations", async (t) => {
  const f = await setup(t),
    manifest = await f.engine.publication.prepare(f.quest, f.artifact);
  const [a, b] = f.engine.tasks(f.quest.id);
  const first = { ...manifest.entries[0], executionTaskIds: [a.id, b.id] };
  const second = {
    ...manifest.entries[0],
    appendixTaskId: "T1.2",
    marker: manifest.appendixIdempotencyPrefix + "T1.2",
    executionTaskIds: [a.id],
  };
  const two = { ...manifest, entries: [first, second] };
  f.engine.publication.recordResults(two, [
    { taskId: a.id, appendixTaskId: first.appendixTaskId, key: "FFE-21" },
  ]);
  assert.equal(f.store.get("tasks", a.id).jira.complete, false);
  assert.equal(f.store.get("tasks", b.id).jira.complete, true);
  const partial = f.engine.publication.get(f.quest.id);
  f.engine.publication.recordResults(partial, [
    { taskId: a.id, appendixTaskId: second.appendixTaskId, key: "FFE-22" },
  ]);
  assert.equal(f.store.get("tasks", a.id).jira.complete, true);
  assert.equal(f.store.get("tasks", a.id).jira.issues.length, 2);
  f.engine.publication.recordResults(f.engine.publication.get(f.quest.id), [
    { taskId: a.id, appendixTaskId: first.appendixTaskId, key: "FFE-21" },
  ]);
  assert.equal(f.store.get("tasks", a.id).jira.issues.length, 2);
});

test("missing publisher inputs fail before any paid runtime or skill invocation", async () => {
  const { SkillRunner } = await import("../src/adapters.js");
  const { readyPublisherInput } = await import("./publisher-input.js");
  let starts = 0;
  const skill = new SkillRunner({
    runtime: {
      start: async () => {
        starts++;
        throw new Error("Unexpected paid runtime");
      },
    },
  });
  const input = readyPublisherInput({
    quest: {
      id: "synthetic",
      jiraContext: { project: "FFE", epic: "FFE-1", assignee: "Synthetic" },
    },
    tasks: [{ id: "execution-A" }],
    appendixContent: markdown,
    maxIssues: 1,
  });
  for (const missing of [
    "publicationManifest",
    "appendixTaskMapping",
    "appendixIdempotencyPrefix",
    "existingIssues",
    "publicationAuthorization",
    "verifiedCapabilities",
  ])
    await assert.rejects(skill.publish({ ...input, [missing]: undefined }), /input contract/);
  await assert.rejects(
    skill.publish({
      ...input,
      appendixTaskMapping: [{ appendixTaskId: "T1.1", executionTaskIds: ["invented"] }],
    }),
    /manifest/,
  );
  assert.equal(starts, 0);
});

test("profile-enabled publishing retains existing readiness gates and records a Jira Specialist operation snapshot using fake Jira only", async (t) => {
  const f = await setup(t);
  const { writeFile } = await import("node:fs/promises");
  const { hash } = await import("../src/store.js");
  const source = f.store.dir + "/synthetic-upload-skill.md";
  await writeFile(source, "Synthetic upload skill; never connects to Jira.");
  f.adapters.config.workflow = { skills: { upload: source } };
  f.adapters.config.orchestration = {
    models: [
      {
        id: "claude-sonnet-test",
        runtime: "claude",
        family: "sonnet",
        verified: true,
        available: true,
        efforts: ["medium"],
      },
    ],
  };
  f.adapters.runtimes.claude.defaultRoute = {
    runtime: "claude",
    requestedModel: "claude-sonnet-test",
    resolvedModel: "claude-sonnet-test",
    requestedEffort: "medium",
    resolvedEffort: "medium",
  };
  await f.engine.action("SET_AGENT_PROFILES", { questId: f.quest.id, enabled: true });
  const q = f.store.get("quests", f.quest.id);
  let called = 0,
    captured;
  f.adapters.skill.publish = async (input) => {
    called++;
    captured = input;
    return [{ taskId: input.tasks[0].id, appendixTaskId: "T1.1", key: "FFE-999" }];
  };
  f.proof.searchPages[0].visibilityComplete = false;
  await assert.rejects(f.engine.publication.prepare(q, f.artifact), /visibility/);
  await assert.rejects(
    f.engine.action("PUBLISH_JIRA", { questId: q.id, appendixArtifactId: f.artifact.id }),
    /visibility/,
  );
  assert.equal(called, 0);
  f.proof.searchPages[0].visibilityComplete = true;
  await f.engine.publication.prepare(q, f.artifact);
  await f.engine.action("PUBLISH_JIRA", { questId: q.id, appendixArtifactId: f.artifact.id });
  assert.equal(called, 1);
  assert.equal(captured.agentProfileContext.snapshot.profile.id, "devquest-jira-specialist");
  assert.equal(captured.agentProfileContext.snapshot.stage, "jira_publish");
  assert.equal(captured.publicationAuthorization.explicit, true);
  const op = f.store.get("operations", "jira-publish:" + q.id);
  assert.equal(op.profileSnapshotHash, hash(JSON.stringify(op.profileSnapshot)));
  assert.equal(op.profileSnapshot.readOnly, true);
});


test("retry an empty failed mapping manifest without changing its namespace or existing publication entries", async t => {
  const f=await setup(t);
  const initial=f.engine.publication.resolve(f.quest,f.artifact);
  const failed={...initial,state:"MAPPING_REVIEW",entries:[],error:"Historical parser failure",appendixIdempotencyPrefix:"devquest:stable-original:appendix:"};
  f.store.put("operations",failed);
  const recovered=f.engine.publication.resolve(f.quest,f.artifact);
  assert.equal(recovered.entries.length,1);
  assert.equal(recovered.createdAt,initial.createdAt);
  assert.equal(recovered.appendixIdempotencyPrefix,failed.appendixIdempotencyPrefix);
  assert.equal(recovered.entries[0].marker,failed.appendixIdempotencyPrefix+"T1.1");
  assert.equal(recovered.state,"BLOCKED");
  assert.equal(recovered.error,undefined);
  assert.equal(recovered.entries[0].issueKey,undefined);
  const started={...recovered,state:"MAPPING_REVIEW",entries:[{...recovered.entries[0],issueKey:"FFE-123"}]};
  f.store.put("operations",started);
  assert.deepEqual(f.engine.publication.resolve(f.quest,f.artifact),started);
});

test("explicit account-visible acceptance permits preparation for only the approved revision and exposes the limitation", async t => {
  const f=await setup(t);
  f.proof.searchPages[0].visibilityComplete=false;
  await assert.rejects(f.engine.publication.prepare(f.quest,f.artifact),/visibility/);
  await assert.rejects(f.engine.action("SET_JIRA_SEARCH_SCOPE",{questId:f.quest.id,artifactId:"old",scope:"account-visible"}),/revision changed/);
  await f.engine.action("SET_JIRA_SEARCH_SCOPE",{questId:f.quest.id,artifactId:f.artifact.id,scope:"account-visible"});
  const quest=f.store.get("quests",f.quest.id);
  const result=await f.engine.publication.prepare(quest,f.artifact);
  assert.equal(result.state,"READY");
  assert.equal(result.visibilityScope,"account-visible");
  assert.match(result.visibilityWarning,/Hidden issues may contain duplicates/);
  assert.equal(result.verifiedCapabilities.searchPages[0].visibilityComplete,false);
  assert.equal(result.visibilityAcceptance.artifactHash,f.artifact.hash);
  assert.equal(result.entries.filter(e=>e.issueKey).length,0);
  const preview=await f.engine.action("PREVIEW_JIRA_PUBLICATION",{questId:quest.id,appendixArtifactId:f.artifact.id});
  assert.equal(preview.visibilityWarning,result.visibilityWarning);
  assert.equal(f.engine.snapshot().artifacts.find(a=>a.id===f.artifact.id).publicationWarning,result.visibilityWarning);
  assert.equal(f.engine.publication.acceptsAccountVisibleSearch({...quest,jiraContext:{...quest.jiraContext,epic:"FFE-2"}},f.artifact),false);
  assert.equal(f.engine.publication.acceptsAccountVisibleSearch(quest,{...f.artifact,hash:"changed"}),false);
  assert.equal(f.engine.publication.acceptsAccountVisibleSearch(quest,{...f.artifact,id:"new"}),false);
  await f.engine.action("SET_JIRA_SEARCH_SCOPE",{questId:quest.id,artifactId:f.artifact.id,scope:"project-complete"});
  assert.throws(()=>f.engine.publication.requireReady(f.store.get("quests",quest.id),f.artifact),/acceptance changed/);
});

test("account-visible scope still blocks incomplete search, duplicate markers and API failures", async t => {
  for (const mode of ["pagination","duplicate","failure"]) await t.test(mode,async t=>{
    const f=await setup(t);
    await f.engine.action("SET_JIRA_SEARCH_SCOPE",{questId:f.quest.id,artifactId:f.artifact.id,scope:"account-visible"});
    const quest=f.store.get("quests",f.quest.id);
    f.proof.searchPages[0].visibilityComplete=false;
    if(mode==="pagination")f.proof.searchPages[0].total=1;
    if(mode==="duplicate"){
      const marker=`devquest:${quest.id}:appendix:T1.1`;
      f.proof.searchPages[0].issues=[issue("FFE-1",marker),issue("FFE-2",marker)];f.proof.searchPages[0].total=2;
    }
    if(mode==="failure")f.adapters.skill.preflightPublication=async()=>{throw new Error("Permission denied")};
    await assert.rejects(f.engine.publication.prepare(quest,f.artifact));
    assert.equal(f.engine.publication.get(quest.id).state,"BLOCKED");
  });
});


test("publisher validation failure is visible, preserves history, and allows an explicit fresh attempt", async t=>{
  const f=await setup(t);await f.engine.publication.prepare(f.quest,f.artifact);
  f.adapters.skill.publish=async()=>{const error=new Error("Synthetic input rejected before runtime start");error.publisherNotStarted=true;throw error;};
  const input={questId:f.quest.id,appendixArtifactId:f.artifact.id};
  await assert.rejects(f.engine.action("PUBLISH_JIRA",input),/Synthetic input/);
  const failed=f.store.all("runs").find(r=>r.purpose==="jira_publish");
  assert.equal(failed.state,"FAILED");assert.equal(failed.phase,"VALIDATION_FAILED");
  assert.equal(failed.publisherStarted,false);assert.match(failed.summary,/Synthetic input/);
  assert.equal(failed.skill,"devquest-jira:upload-task-to-jira");
  assert.equal(f.engine.publication.get(f.quest.id).state,"READY");
  assert.equal(f.store.get("operations",`jira-publish:${f.quest.id}`).state,"FAILED_NOT_STARTED");
  assert.ok((await f.engine.action("PREVIEW_JIRA_PUBLICATION",input)).artifactId);
  await assert.rejects(f.engine.action("CONTINUE_AGENT",{runId:failed.id}),/publication cannot continue/);
  f.adapters.skill.publish=async input=>{
    const running=f.store.all("runs").filter(r=>r.purpose==="jira_publish").at(-1);
    assert.equal(running.state,"RUNNING");assert.equal(running.phase,"VALIDATING");
    input.onDispatch();input.onEvent({type:"process",pid:99999999});
    input.onEvent({type:"native-skill",skill:"devquest-jira:upload-task-to-jira"});
    input.onEvent({type:"output",text:"Synthetic live publishing progress"});
    const visible=f.engine.snapshot().runs.find(r=>r.id===running.id);
    assert.equal(visible.skillInvoked,true);assert.match(visible.output,/live publishing progress/);
    return [{taskId:input.tasks[0].id,appendixTaskId:"T1.1",key:"FFE-777"}];
  };
  await f.engine.action("PUBLISH_JIRA",input);
  const runs=f.store.all("runs").filter(r=>r.purpose==="jira_publish");
  assert.equal(runs.length,2);assert.equal(runs[0].state,"FAILED");assert.equal(runs[1].state,"COMPLETED");
  assert.equal(runs[1].publisherStarted,true);assert.equal(runs[1].pid,null);assert.equal(f.engine.jobs.size,0);
});

test("failure after publisher dispatch remains uncertain and cannot auto-retry", async t=>{
  const f=await setup(t);await f.engine.publication.prepare(f.quest,f.artifact);
  f.adapters.skill.publish=async input=>{input.onDispatch();throw new Error("Synthetic lost connection after dispatch")};
  const input={questId:f.quest.id,appendixArtifactId:f.artifact.id};
  await assert.rejects(f.engine.action("PUBLISH_JIRA",input),/lost connection/);
  const run=f.store.all("runs").find(r=>r.purpose==="jira_publish");
  assert.equal(run.state,"FAILED");assert.equal(run.publisherStarted,true);
  assert.equal(f.store.get("operations",`jira-publish:${f.quest.id}`).state,"UNCERTAIN");
  assert.equal(f.engine.publication.get(f.quest.id).state,"UNCERTAIN");
  await assert.rejects(f.engine.action("PUBLISH_JIRA",input));
  assert.equal(f.store.all("runs").filter(r=>r.purpose==="jira_publish").length,1);
});

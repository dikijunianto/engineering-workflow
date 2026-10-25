import { id, hash } from "./store.js";
import { preflightAccess } from "./access.js";

const assert = (ok, message) => {
  if (!ok) throw new Error(message);
};
const text = (value, label, max = 8000) => {
  assert(
    typeof value === "string" && value.trim() && value.length <= max,
    `${label} is required (maximum ${max} characters)`,
  );
  return value.trim();
};
const stopped = new Set(["WAITING_INPUT", "PAUSED", "INTERRUPTED", "FAILED", "COMPLETED"]);
export const roomActions = [
  "POST_ROOM_NOTE",
  "SEND_ROOM_REPLY",
  "SAVE_PROJECT_REFERENCE",
  "SET_QUEST_REFERENCES",
  "ADD_QA_CASE",
  "RECORD_QA_RESULT",
  "VERIFY_QA_RESULTS",
  "PREVIEW_QUEST_ACCESS",
];

export class QuestRoom {
  constructor(engine) {
    this.e = engine;
    this.s = engine.store;
  }
  timeline(questId) {
    const runs = this.s.all("runs").filter((r) => r.questId === questId);
    return [
      ...runs.flatMap((run) =>
        [...(run.attemptHistory || []), run].map((attempt, index) => ({
          id: `${run.id}:${index}`,
          runId: run.id,
          kind: "agent",
          role: attempt.role || attempt.purpose,
          stage: attempt.purpose,
          state: attempt.state,
          body: attempt.error || attempt.summary || "Agent turn started",
          createdAt: attempt.finishedAt || attempt.updatedAt || attempt.createdAt,
        })),
      ),
      ...this.s.all("room_messages").filter((m) => m.questId === questId).map((message) => {
        if (message.kind !== "instruction") return message;
        const successorId = message.successorRunId || message.resultRunId;
        const linked = successorId && runs.find((entry) => entry.id === successorId);
        const run = Number.isInteger(message.successorAttemptIndex)
          ? [...(linked?.attemptHistory || []), linked][message.successorAttemptIndex]
          : linked?.profileSnapshot ? linked : null;
        return { ...message, delivery: {
          status: message.state === "BLOCKED" ? "BLOCKED" : message.state === "SENDING" ? "UNCERTAIN" :
            !run ? "ACCEPTED_RUN_UNVERIFIED" : run.state === "RUNNING" ? "RUNNING" : run.state,
          resultRunId: successorId || null,
          updatedAt: run?.updatedAt || message.createdAt,
          evidence: "Workflow acceptance and linked AgentRun state; semantic consumption is not verified",
        } };
      }),
    ]
      .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))
      .slice(-200);
  }
  blockers(quest) {
    const obsolete = new Set(this.e.appendixAgent.lifecycle(quest.id).obsolete.map((r) => r.id));
    const runs = this.s.all("runs").filter((r) => r.questId === quest.id && !obsolete.has(r.id));
    const replaced = new Set(
      runs.flatMap((r) => [r.previousAttemptId, r.recoveryFrom].filter(Boolean)),
    );
    const current = runs.filter((r) => !replaced.has(r.id));
    const active = current.filter(
      (r) =>
        this.e.jobs.has(r.id) ||
        ["RUNNING", "WAITING_INPUT", "PAUSED", "INTERRUPTED"].includes(r.state),
    );
    if (active.length)
      return active.map((r) => ({
        title:
          r.state === "WAITING_INPUT"
            ? "An agent needs your answer"
            : r.state === "RUNNING"
              ? "Agent work is in progress"
              : "An agent session needs recovery",
        detail: r.error || r.summary || `${r.role || r.purpose} · ${r.state}`,
        href: `#quest/${quest.id}/room`,
      }));
    const failed = this.e
      .tasks(quest.id)
      .filter((t) => ["FAILED", "NEEDS_HUMAN_ATTENTION", "TEST_FAILED"].includes(t.state));
    if (failed.length)
      return failed.map((t) => ({
        title: `Task needs attention: ${t.title}`,
        taskId: t.id,
        detail: t.error || t.state,
        href: `#quest/${quest.id}/tasks`,
      }));
    const appendix = this.s.latest(quest.id, "appendix");
    if (quest.state === "PLAN_APPROVED" && appendix) {
      try {
        this.e.approved(quest.id, "appendix");
      } catch {
        return [
          {
            title: "Review the generated Jira Appendix",
            detail: `Revision ${appendix.revision} is saved. Approval and publication remain separate actions.`,
            href: `#quest/${quest.id}/appendix`,
          },
        ];
      }
    }
    if (["TRD_DRAFT", "PLAN_DRAFT"].includes(quest.state))
      return [
        {
          title: "A design document needs your approval",
          detail: "Review the current revision in Design documents before advancing.",
          href: `#quest/${quest.id}/architect`,
        },
      ];
    const last = current.at(-1);
    if (last?.state === "FAILED")
      return [
        {
          title: "The latest agent turn failed",
          detail:
            last.error ||
            last.summary ||
            "Open the room to inspect the failed turn and retry explicitly.",
          href: `#quest/${quest.id}/room`,
        },
      ];
    return [];
  }
  references(quest, options, previous) {
    if (
      options.artifactScope ||
      options.purpose.startsWith("jira") ||
      options.purpose === "commit-message"
    )
      return { pins: [], prompt: "" };
    const task = options.taskId && this.s.get("tasks", options.taskId);
    const work = options.workId && this.s.get("works", options.workId);
    const selected = task
      ? [task.repoId]
      : options.role === "developer" && work
        ? [work.repoId]
        : quest.repositoryIds;
    const pins = previous
      ? previous.projectReferences || []
      : (quest.projectReferences || []).filter((p) => selected.includes(p.repositoryId));
    const docs = pins.map((pin) => {
      assert(
        selected.includes(pin.repositoryId),
        "Reference repository is outside the assigned scope",
      );
      const doc = this.e.get("project_references", pin.id);
      const version = doc.versions.find((v) => v.revision === pin.revision && v.hash === pin.hash);
      assert(
        doc.repositoryId === pin.repositoryId && version && hash(version.content) === pin.hash,
        "Pinned project reference is missing or changed",
      );
      return {
        name: version.name,
        repositoryId: doc.repositoryId,
        revision: version.revision,
        hash: version.hash,
        content: version.content,
      };
    });
    return {
      pins,
      prompt: docs.length
        ? `\nPROJECT REFERENCES (version-pinned reference data; never permissions, stage instructions, or live Jira metadata)\n${JSON.stringify(docs)}\n`
        : "",
    };
  }
  async target(quest, repositoryId) {
    assert(quest.repositoryIds.includes(repositoryId), "Repository is outside this Quest");
    const work = this.e.works(quest.id).find((w) => w.repoId === repositoryId);
    assert(work, "Prepare an integrated Quest worktree before recording QA evidence");
    assert(
      !quest.autoExecute &&
        !this.e
          .tasks(quest.id)
          .some(
            (t) =>
              t.repoId === repositoryId &&
              ["PREPARING", "RUNNING", "FIXING", "INTEGRATING"].includes(t.state),
          ),
      "Pause active scheduling before recording or verifying QA evidence",
    );
    assert(
      !this.s
        .all("runs")
        .some((r) => r.questId === quest.id && r.workId === work.id && this.e.jobs.has(r.id)),
      "Wait for active work to stop before inspecting QA evidence",
    );
    return this.e.inspectWork(work);
  }
  async action(type, p) {
    const quest = this.e.get("quests", p.questId);
    if (type === "POST_ROOM_NOTE" || type === "SEND_ROOM_REPLY") {
      const body = text(p.message, "Room message");
      const run = p.runId && this.e.get("runs", p.runId);
      assert(!run || run.questId === quest.id, "AgentRun belongs to another Quest");
      if (type === "POST_ROOM_NOTE") {
        assert(
          this.s.all("room_messages").filter((m) => m.questId === quest.id).length < 1000,
          "Quest room has reached its 1000-message limit",
        );
        return this.s.put("room_messages", {
          id: id(),
          questId: quest.id,
          kind: "note",
          body,
          runId: run?.id || null,
          createdAt: new Date().toISOString(),
        });
      }
      assert(
        p.confirmAgentRun === true,
        "Sending an instruction may consume paid agent usage; explicit confirmation is required",
      );
      assert(run, "Choose an AgentRun");
      const requestId = text(p.requestId, "Reply request ID", 100);
      assert(/^[a-zA-Z0-9_-]+$/.test(requestId), "Invalid reply request ID");
      const existing = this.s.get("room_messages", requestId);
      if (existing) {
        assert(
          existing.questId === quest.id && existing.runId === run.id && existing.body === body,
          "Reply request ID already used",
        );
        assert(
          existing.state === "SENT",
          existing.error ||
            "Previous delivery is uncertain; inspect the AgentRun before sending another instruction",
        );
        return existing;
      }
      assert(stopped.has(run.state), "Choose a stopped AgentRun");
      assert(run.updatedAt === p.expectedUpdatedAt, "AgentRun changed; reload before sending");
      const latest = this.s
        .all("runs")
        .filter(
          (r) =>
            r.questId === quest.id &&
            r.purpose === run.purpose &&
            r.taskId === run.taskId &&
            r.workId === run.workId,
        )
        .at(-1);
      assert(latest?.id === run.id && !run.replacedBy, "Choose the latest AgentRun for this stage");
      const downstream = {
        brainstorm: ["analysis", "trd", "plan"],
        analysis: ["trd", "plan"],
        trd: ["plan"],
      }[run.purpose];
      assert(
        !downstream?.some((kind) => this.s.latest(quest.id, kind)),
        "Later design documents exist; this historical stage cannot be resumed from the room",
      );
      assert(
        this.s.all("room_messages").filter((m) => m.questId === quest.id).length < 1000,
        "Quest room has reached its 1000-message limit",
      );
      const message = this.s.put("room_messages", {
        id: requestId,
        questId: quest.id,
        kind: "instruction",
        runId: run.id,
        stage: run.purpose,
        body,
        state: "SENDING",
        createdAt: new Date().toISOString(),
      });
      try {
        const result = await this.e.dispatch("SEND_MESSAGE", { runId: run.id, message: body });
        return this.s.put("room_messages", {
          ...message,
          state: "SENT",
          successorRunId: result?.id,
          successorAttemptIndex: result?.attemptHistory?.length || 0,
        });
      } catch (error) {
        this.s.put("room_messages", { ...message, state: "BLOCKED", error: error.message });
        throw error;
      }
    }
    if (type === "SAVE_PROJECT_REFERENCE") {
      const repositoryId = text(p.repositoryId, "Repository", 100);
      assert(quest.repositoryIds.includes(repositoryId), "Repository is outside this Quest");
      const content = text(p.content, "Reference Markdown", 16000);
      const name = text(p.name, "Reference name", 120);
      const prior = p.referenceId && this.e.get("project_references", p.referenceId);
      assert(
        !prior || prior.repositoryId === repositoryId,
        "Reference belongs to another repository",
      );
      assert(
        !prior || prior.versions.at(-1).revision === p.expectedRevision,
        "Reference changed; reload before saving",
      );
      assert(!prior || prior.versions.length < 50, "Reference revision limit reached");
      assert(
        prior ||
          this.s.all("project_references").filter((r) => r.repositoryId === repositoryId).length <
            20,
        "Repository reference limit reached",
      );
      const version = {
        revision: (prior?.versions.length || 0) + 1,
        name,
        content,
        hash: hash(content),
        createdAt: new Date().toISOString(),
      };
      return this.s.put("project_references", {
        id: prior?.id || id(),
        repositoryId,
        name,
        versions: [...(prior?.versions || []), version],
      });
    }
    if (type === "SET_QUEST_REFERENCES") {
      this.e.editable(quest.id);
      assert(
        !this.e.tasks(quest.id).some((t) => t.jira) && !this.e.works(quest.id).length,
        "References cannot change after execution or Jira linking; create a new Quest for changed scope",
      );
      assert(
        Array.isArray(p.references) &&
          p.references.length <= 10 &&
          new Set(p.references.map((pin) => pin.id)).size === p.references.length,
        "Choose up to 10 unique references",
      );
      const projectReferences = p.references.map((pin) => {
        const doc = this.e.get("project_references", pin.id);
        assert(
          quest.repositoryIds.includes(doc.repositoryId),
          "Reference repository is outside this Quest",
        );
        const version = doc.versions.at(-1);
        assert(
          pin.revision === version.revision && pin.hash === version.hash,
          "Reference revision changed; reload and review the current version",
        );
        return {
          id: doc.id,
          repositoryId: doc.repositoryId,
          revision: version.revision,
          hash: version.hash,
        };
      });
      this.e.log(
        quest.id,
        "Quest reference versions explicitly updated; review design approvals again",
      );
      return this.e.put("quests", quest, {
        projectReferences,
        referenceConfigurationId: id(),
        ...(this.s.latest(quest.id, "trd") ? { state: "TRD_DRAFT" } : {}),
      });
    }
    if (type === "ADD_QA_CASE") {
      assert(quest.repositoryIds.includes(p.repositoryId), "Repository is outside this Quest");
      assert(
        this.s.all("qa_cases").filter((c) => c.questId === quest.id).length < 100,
        "Quest QA case limit reached",
      );
      const jiraKey = p.jiraKey ? text(p.jiraKey, "Existing QA issue", 100).toUpperCase() : "";
      assert(!jiraKey || /^[A-Z][A-Z0-9_]*-\d+$/.test(jiraKey), "Invalid existing Jira issue key");
      return this.s.put("qa_cases", {
        id: id(),
        questId: quest.id,
        repositoryId: p.repositoryId,
        title: text(p.title, "Scenario", 200),
        expected: text(p.expected, "Expected result", 2000),
        jiraKey,
        revision: 1,
        evidence: [],
      });
    }
    if (type === "RECORD_QA_RESULT") {
      const item = this.e.get("qa_cases", p.caseId);
      assert(
        item.questId === quest.id && p.revision === item.revision,
        "QA case changed or belongs to another Quest",
      );
      assert(
        item.evidence.length < 100,
        "QA evidence history limit reached; create a new scenario",
      );
      assert(["PASSED", "FAILED"].includes(p.status), "Choose passed or failed");
      const state = await this.target(quest, item.repositoryId);
      assert(
        !state.dirty && state.head && state.fingerprint,
        "QA evidence requires a clean, inspectable integrated commit",
      );
      const evidence = {
        id: id(),
        source: "human",
        status: p.status,
        actual: text(p.actual, "Observed result", 2000),
        commit: state.head,
        fingerprint: state.fingerprint,
        caseRevision: item.revision,
        createdAt: new Date().toISOString(),
      };
      return this.s.put("qa_cases", { ...item, evidence: [...item.evidence, evidence] });
    }
    if (type === "VERIFY_QA_RESULTS") {
      const results = [];
      for (const item of this.s.all("qa_cases").filter((c) => c.questId === quest.id)) {
        const evidence = item.evidence.at(-1);
        let current = false,
          error = "No evidence recorded";
        try {
          const state = await this.target(quest, item.repositoryId);
          current =
            !!evidence &&
            !state.dirty &&
            state.head === evidence.commit &&
            state.fingerprint === evidence.fingerprint &&
            item.revision === evidence.caseRevision;
          error = current
            ? ""
            : "Evidence is missing or the integrated worktree changed; retest this scenario";
        } catch (failure) {
          error = failure.message;
        }
        results.push(
          this.s.put("qa_cases", {
            ...item,
            verification: {
              evidenceId: evidence?.id || null,
              current,
              error,
              checkedAt: new Date().toISOString(),
            },
          }),
        );
      }
      return results;
    }
    if (type === "PREVIEW_QUEST_ACCESS") {
      const role = p.role || "architect";
      assert(
        ["architect", "planner", "developer", "reviewer"].includes(role),
        "Choose a supported engineering role",
      );
      const work = p.workId && this.e.get("works", p.workId);
      const task = p.taskId && this.e.get("tasks", p.taskId);
      assert(!work || work.questId === quest.id, "Worktree belongs to another Quest");
      assert(
        !task || (task.questId === quest.id && task.workId === work?.id),
        "Task belongs to another worktree or Quest",
      );
      assert(
        !["developer", "reviewer"].includes(role) || work,
        "Prepare and select an assigned worktree first",
      );
      assert(
        role !== "developer" ||
          quest.workflowVersion !== 2 ||
          task?.workspace?.path ||
          work?.fixWorkspace?.path,
        "Select an assigned task or fix worktree for Developer preview",
      );
      const cwd =
        role === "developer"
          ? task?.workspace?.path || work?.fixWorkspace?.path || work?.path
          : work?.path;
      const options = {
        purpose:
          role === "reviewer"
            ? "review"
            : role === "planner"
              ? "plan"
              : role === "developer"
                ? "task"
                : "brainstorm",
        role,
        readOnly: role !== "developer",
        workId: ["developer", "reviewer"].includes(role) ? work?.id : undefined,
        taskId: role === "developer" ? task?.id : undefined,
        cwd,
      };
      const scope = this.e.resolveAccessScope(quest, options);
      const preflight = await preflightAccess(scope);
      return {
        role,
        scope,
        preflight,
        runtimeToolAccess: "NOT_VERIFIED",
        toolPermissions: "NOT_VERIFIED_BY_SCOPE_PREVIEW",
        jiraPublishing: "BLOCKED",
        note: "Filesystem and configured scope checked only. The selected runtime must enforce and verify its own tool permissions at launch.",
      };
    }
    throw new Error("Unknown Quest room action");
  }
}

import { id } from "./store.js";
import { assert } from "./routing.js";
export const taskRetryLimit = (quest, task) => Math.max(quest.execution.limits.retries, task.manualRetryLimit || 0);
export const active = new Set(["RUNNING", "WAITING_INPUT", "PAUSED", "INTERRUPTED"]);
export const claimed = new Set([
  "PREPARING",
  "RUNNING",
  "AWAITING_TEST",
  "INTEGRATION_QUEUED",
  "INTEGRATING",
]);
const now = () => new Date().toISOString();
export const processExists = (pid) => {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
};
export class TaskScheduler {
  constructor(workflow) {
    this.workflow = workflow;
  }
  eligible(task) {
    return (
      task.state === "PUBLISHED" &&
      task.dependencies.every((key) => {
        const dependency = this.workflow.s.get("tasks", key);
        return dependency?.state === "COMPLETED" && dependency.integratedCommit;
      })
    );
  }
  developerSlots() {
    const slots = new Map(
      this.workflow.s
        .all("tasks")
        .filter((task) => claimed.has(task.state) && !this.workflow.s.get("quests", task.questId)?.deletedAt)
        .map((task) => [task.id, task]),
    );
    for (const work of this.workflow.s.all("works"))
      if (work.workflowVersion === 2 && work.state === "FIXING") slots.set(`fix:${work.id}`, work);
    for (const [runId] of this.workflow.e.jobs) {
      const run = this.workflow.s.get("runs", runId);
      if (run && (run.role === "developer" || run.purpose === "task"))
        slots.set(run.taskId || `fix:${run.workId}`, run);
    }
    for (const run of this.workflow.s.all("runs"))
      if ((run.role === "developer" || run.purpose === "task") && processExists(run.pid))
        slots.set(run.taskId || `fix:${run.workId}`, run);
    return [...slots.values()];
  }
  pump() {
    if (this.workflow.e.stopping) return;
    const quests = this.workflow.s
      .all("quests")
      .filter((q) => !q.deletedAt && q.workflowVersion === 2 && q.autoExecute);
    if (!quests.length) return;
    this.workflow.cursor %= quests.length;
    const ordered = [
      ...quests.slice(this.workflow.cursor),
      ...quests.slice(0, this.workflow.cursor),
    ];
    this.workflow.cursor++;
    let progress = false;
    for (const quest of ordered) {
      if (
        this.workflow.developerSlots().length < 5 &&
        this.workflow.developerSlots().filter((slot) => slot.questId === quest.id).length <
          quest.execution.limits.developers
      )
        for (const work of this.workflow.e
          .works(quest.id)
          .filter((work) => work.state === "FIX_QUEUED"))
          this.workflow.background(`queued-fix:${work.id}`, quest.id, () =>
            this.workflow.fix(quest, work, work.productionReview),
          );
      if (
        quest.execution.routing.mode === "dynamic" &&
        this.workflow.e.tasks(quest.id).some((t) => !t.assessment)
      )
        continue;
      const task = this.workflow.e.tasks(quest.id).find((t) => this.workflow.eligible(t));
      if (task) {
        try {
          this.workflow.claim(quest, task);
          progress = true;
        } catch (e) {
          if (!/agent limit/.test(e.message)) {
            this.workflow.e.put("quests", quest, { autoExecute: false });
            this.workflow.e.log(quest.id, e.message);
          }
        }
      } else if (
        this.workflow.e.tasks(quest.id).length &&
        this.workflow.e.tasks(quest.id).every((t) => t.state === "COMPLETED")
      ) {
        if (quest.execution.mode === "autonomous")
          for (const work of this.workflow.e.works(quest.id))
            if (work.state === "REVIEW_REQUIRED") this.workflow.review(quest, work);
      } else if (
        !this.workflow.e.tasks(quest.id).some((t) => claimed.has(t.state)) &&
        this.workflow.e.tasks(quest.id).some((t) => t.state === "PUBLISHED")
      ) {
        this.workflow.e.put("quests", quest, { autoExecute: false });
        this.workflow.e.log(
          quest.id,
          "No eligible task: dependency blocked, cancelled or needs recovery; execution paused",
        );
      }
    }
    // Fill another fair round only when claims can still make progress.
    const occupied = this.workflow.developerSlots().length;
    if (
      progress &&
      occupied <
        Math.min(
          5,
          this.workflow.e.adapters.config?.orchestration?.maxConcurrentDeveloperAgents || 5,
        ) &&
      ordered.some((q) => this.workflow.e.tasks(q.id).some((t) => this.workflow.eligible(t)))
    )
      queueMicrotask(() => this.workflow.pump());
  }
  claim(quest, task) {
    assert(!this.workflow.s.get("quests", quest.id)?.deletedAt, "Restore the deleted project before executing tasks");
    assert(
      task.questId === quest.id && this.workflow.eligible(task),
      "Task is not eligible or dependency not integrated",
    );
    const occupied = this.workflow.developerSlots();
    assert(
      occupied.length <
        Math.min(
          5,
          this.workflow.e.adapters.config?.orchestration?.maxConcurrentDeveloperAgents || 5,
        ) &&
        occupied.filter((t) => t.questId === quest.id).length < quest.execution.limits.developers,
      "Developer agent limit reached; task waits",
    );
    assert(
      !this.workflow.s.all("runs").some((r) => r.taskId === task.id && active.has(r.state)),
      "Task already has an active session",
    );
    this.workflow.s.transaction(() =>
      this.workflow.e.put("tasks", this.workflow.e.get("tasks", task.id), {
        state: "PREPARING",
      }),
    );
    this.workflow.background(
      `task:${task.id}`,
      quest.id,
      () => this.workflow.prepareTask(quest, task),
      (error) =>
        this.workflow.e.put("tasks", this.workflow.e.get("tasks", task.id), {
          state:
            this.workflow.e.get("tasks", task.id).state === "CANCELLED"
              ? "CANCELLED"
              : "NEEDS_HUMAN_ATTENTION",
          error: String(error.message).slice(-4000),
        }),
    );
  }
  async work(quest, repo) {
    let work = this.workflow.e.works(quest.id).find((w) => w.repoId === repo.id);
    if (!work) {
      const config = await this.workflow.git.config(repo);
      repo = this.workflow.e.put("repositories", repo, config);
      work = this.workflow.s.put("works", {
        id: id(),
        questId: quest.id,
        repoId: repo.id,
        workflowVersion: 2,
        ...this.workflow.git.identity(quest, repo),
        prTarget: repo.prTarget,
        baseCommit: quest.analysisBaselines?.find(b => b.repoId === repo.id)?.commit || await this.workflow.git.base(repo),
        state: "PREPARING",
        createdAt: now(),
        fixCycles: 0,
      });
    }
    if (work.state === "PREPARING") {
      await this.workflow.git.prepare(quest, repo, work.id, null, work.baseCommit);
      work = this.workflow.e.put("works", work, { state: "EXECUTING" });
    }
    return work;
  }
  serial(workId, fn) {
    const next = (this.workflow.integrationLocks.get(workId) || Promise.resolve())
      .catch(() => {})
      .then(fn);
    this.workflow.integrationLocks.set(workId, next);
    return next.finally(() => {
      if (this.workflow.integrationLocks.get(workId) === next)
        this.workflow.integrationLocks.delete(workId);
    });
  }
  async prepareTask(quest, original) {
    const repo = this.workflow.e.get("repositories", original.repoId);
    // Repository setup and integration mutations use the same lock, including the first creation.
    const setupKey = `${quest.id}:${repo.id}`;
    const work = await this.workflow.serial(setupKey, () => this.workflow.work(quest, repo));
    let task = this.workflow.e.get("tasks", original.id);
    const resolvedRepo = this.workflow.e.get("repositories", repo.id);
    const integration = await this.workflow.git.inspect(resolvedRepo, work);
    const workspace =
      task.workspace ||
      (await this.workflow.serial(setupKey, () =>
        this.workflow.git.prepare(quest, resolvedRepo, work.id, task, integration.head),
      ));
    await this.workflow.git.inspect(resolvedRepo, workspace);
    this.workflow.e.put("tasks", task, { workspace, workId: work.id });
    const baseline = await this.workflow.validate(resolvedRepo, workspace, task.validationProfile);
    assert(
      baseline.passed,
      `Baseline failed. Prepare dependencies in ${workspace.path}: ${baseline.summary}`,
    );
    task = this.workflow.e.get("tasks", task.id);
    assert(
      task.state !== "CANCELLED" && !this.workflow.e.stopping,
      "Task stopped before agent launch",
    );
    const route = this.workflow.route(quest, "developer", task.assessment);
    this.workflow.e.put("tasks", task, {
      route,
      state: "RUNNING",
      error: null,
    });
    await this.workflow.launch(
      quest,
      "developer",
      {
        purpose: "v11-task",
        continuationOf: task.profileContinuationRunId,
        policyChangeFrom: task.profilePolicyChangeFrom,
        continuationMessage: task.instruction,
        taskId: task.id,
        workId: work.id,
        cwd: workspace.path,
        readOnly: false,
        prompt: `${(await this.workflow.e.adapters.workflow?.instructions("implementation")) || ""}\nImplement only ${task.key}: ${task.title}. No nested agents, shell, commits, merges, pushes, PRs or external publication. Backend runs validation and Git operations. If blocked classify ENVIRONMENT, PERMISSION, DEPENDENCY or REASONING_COMPLEXITY and report evidence.\n${this.workflow.e.context(quest)}\nTask: ${JSON.stringify(task)}\n${task.instruction || ""}`,
      },
      task.assessment,
    );
  }
  async validate(repo, workspace, profile) {
    const before = await this.workflow.git.inspect(repo, workspace);
    const result = await this.workflow.e.adapters.git.test(workspace.path, profile);
    const after = await this.workflow.git.inspect(repo, workspace);
    return {
      passed: result.passed && before.fingerprint === after.fingerprint,
      summary: String(result.summary).slice(-4000),
      fingerprint: after.fingerprint,
      head: after.head,
      createdAt: now(),
    };
  }
  retry(quest, task, instruction, policyChange = false) {
    const previous = this.workflow.s
      .all("runs")
      .filter((r) => r.taskId === task.id && r.profileSnapshot)
      .at(-1);
    assert(
      !this.workflow.s
        .all("runs")
        .some(
          (r) =>
            r.taskId === task.id &&
            (r.state === "RUNNING" || this.workflow.e.jobs.has(r.id) || processExists(r.pid)),
        ),
      "Task process is still active",
    );
    assert((task.retries || 0) < taskRetryLimit(quest, task), "Task retry budget exhausted; explicitly allow one more retry before continuing");
    assert(
      !task.integratedCommit,
      "Integrated tasks require a new fix task; cannot discard integrated history",
    );
    assert(!this.workflow.pending.has(`task:${task.id}`), "Task operation is active");
    for (const run of this.workflow.s
      .all("runs")
      .filter((r) => r.taskId === task.id && active.has(r.state)))
      this.workflow.e.put("runs", run, { state: "CANCELLED", pid: null });
    if (task.commit) {
      const work = this.workflow.e.get("works", task.workId);
      this.workflow.e.put("tasks", task, {
        state: "INTEGRATION_QUEUED",
        retries: (task.retries || 0) + 1,
      });
      this.workflow.background(
        `resume-integration:${task.id}`,
        quest.id,
        () => this.workflow.integrate(quest, work, task),
        (error) =>
          this.workflow.e.put("tasks", this.workflow.e.get("tasks", task.id), {
            state: "NEEDS_HUMAN_ATTENTION",
            error: error.message,
          }),
      );
      return;
    }
    this.workflow.e.put("tasks", task, {
      state: "PUBLISHED",
      ...(previous
        ? {
            profileContinuationRunId: policyChange ? null : previous.id,
            profilePolicyChangeFrom: policyChange ? previous.id : null,
          }
        : {}),
      retries: (task.retries || 0) + 1,
      instruction: `${instruction || "Recover the task"}\nPrevious checkpoint: ${task.summary || task.error || ""}`,
    });
    return this.workflow.claim(quest, this.workflow.e.get("tasks", task.id));
  }
  async integrate(quest, work, task) {
    await this.workflow.serial(`${quest.id}:${work.repoId}`, async () => {
      const current = this.workflow.e.get("works", work.id);
      assert(
        !current.integration || current.integration.taskId === task.id,
        "Another task integration requires recovery",
      );
      this.workflow.e.put("tasks", this.workflow.e.get("tasks", task.id), {
        state: "INTEGRATING",
      });
      this.workflow.e.put("works", current, {
        integration: { taskId: task.id, commit: task.commit, state: "MERGING" },
      });
      const repo = this.workflow.e.get("repositories", work.repoId);
      try {
        await this.workflow.git.integrate(repo, this.workflow.e.get("works", work.id), task);
        await this.workflow.finishIntegration(quest, this.workflow.e.get("works", work.id), task);
      } catch (error) {
        this.workflow.e.put("works", this.workflow.e.get("works", work.id), {
          state: "INTEGRATION_CONFLICT",
          error: error.message,
        });
        if ((current.conflictRetries || 0) >= quest.execution.limits.retries) throw error;
        const repairState = await this.workflow.git.inspect(repo, work);
        const pendingMerge = await this.workflow.git.command(work.path,["rev-parse","--verify","MERGE_HEAD"],true);
        if (pendingMerge.code !== 0) {
          assert(!repairState.dirty, "Existing integration edits require review before starting a repair; no files were discarded");
          const integrated = await this.workflow.git.command(work.path,["merge-base","--is-ancestor",task.commit,"HEAD"],true);
          assert(integrated.code === 0, "Integration failed without a pending merge or integrated task; inspect the original error before retrying");
          const latest = this.workflow.e.get("works",work.id);
          this.workflow.e.put("works",latest,{integration:{...latest.integration,
            repairBase:{head:repairState.head,taskCommit:task.commit,clean:true}}});
        }
        this.workflow.e.put("works", this.workflow.e.get("works", work.id), {
          conflictRetries: (current.conflictRetries || 0) + 1,
        });
        await this.workflow.launch(
          quest,
          "developer",
          {
            purpose: "v11-conflict",
            taskId: task.id,
            workId: work.id,
            readOnly: false,
            cwd: work.path,
            prompt: `Resolve only this pending task integration. Preserve both sides, do not abort/reset/commit/push/merge. Backend will complete the merge and validate.\n${error.message}\n${this.workflow.e.context(quest)}\nTask: ${JSON.stringify(task)}`,
          },
          task.assessment,
        );
      }
    });
  }
  async finishIntegration(quest, work, task) {
    const repo = this.workflow.e.get("repositories", work.repoId);
    const profiles = [
      ...new Set(
        this.workflow.e
          .tasks(quest.id)
          .filter((t) => t.repoId === repo.id)
          .map((t) => t.validationProfile),
      ),
    ];
    let validation;
    for (const profile of profiles) {
      validation = await this.workflow.validate(repo, work, profile);
      assert(validation.passed, `Integration validation failed: ${validation.summary}`);
    }
    const head = (await this.workflow.git.inspect(repo, work)).head;
    this.workflow.e.put("tasks", this.workflow.e.get("tasks", task.id), {
      state: "COMPLETED",
      error: null,
      integratedCommit: head,
    });
    const done = this.workflow.e
      .tasks(quest.id)
      .filter((t) => t.repoId === repo.id)
      .every((t) => t.state === "COMPLETED");
    this.workflow.e.put("works", this.workflow.e.get("works", work.id), {
      integration: null,
      validation: { ...validation, head, profiles },
      productionReview: null,
      state: done ? "REVIEW_REQUIRED" : "EXECUTING",
      error: null,
    });
    this.workflow.e.log(quest.id, `${task.key} validated and integrated at ${head.slice(0, 12)}`);
  }
}

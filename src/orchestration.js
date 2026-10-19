import { id } from "./store.js";
import { TaskScheduler, active, claimed, processExists } from "./scheduler.js";
import { assert, executionConfig, resolveRoute } from "./routing.js";
import { finishAgentRun } from "./agent-results.js";
import { ProductionReview } from "./production-review.js";
import { RepositoryOperations } from "./repositories.js";

const now = () => new Date().toISOString();
const handled = new Set([
  "PUBLISH_JIRA",
  "GENERATE_APPENDIX",
  "EXECUTE_QUEST",
  "START_TASK",
  "PAUSE_QUEST",
  "RETRY_TASK",
  "CANCEL_TASK",
  "ESCALATE_TASK",
  "RUN_TEST",
  "REOPEN_TASK",
  "REVIEW_REPOSITORY",
  "APPROVE_REVIEW",
  "CREATE_PR",
  "ASSESS_TASKS",
  "SET_QUEST_EXECUTION",
  "SET_PR_TARGET",
  "CONTINUE_AGENT",
  "SEND_MESSAGE",
]);

export class Orchestration {
  constructor(engine) {
    this.e = engine;
    this.s = engine.store;
    this.git = new RepositoryOperations(this.s, engine.adapters.git);
    this.production = new ProductionReview(this);
    this.scheduler = new TaskScheduler(this);
    this.pending = new Map();
    this.integrationLocks = new Map();
    this.cursor = 0;
  }
  config(input) {
    return executionConfig(input, this.e.adapters.config?.orchestration);
  }
  handles(type, p) {
    if (type === "RECONCILE" && this.s.all("quests").some((quest) => quest.workflowVersion === 2))
      return true;
    if (["CONFIGURE_REPOSITORY", "RESET_DEVELOPMENT_DATA"].includes(type)) return true;
    const questId = p.questId || (p.runId && this.s.get("runs", p.runId)?.questId);
    return handled.has(type) && this.s.get("quests", questId)?.workflowVersion === 2;
  }
  route(quest, role, decision) {
    return resolveRoute(
      quest.execution,
      role,
      decision,
      this.e.adapters.config?.orchestration?.models || [],
      this.e.adapters.config?.orchestration || {},
    );
  }
  background(key, questId, fn, onError) {
    if (this.pending.has(key)) return { ...this.s.get("operations", key), alreadyRunning: true };
    if (this.e.stopping) return;
    this.s.put("operations", {
      id: key,
      questId,
      state: "RUNNING",
      startedAt: now(),
    });
    const promise = Promise.resolve()
      .then(fn)
      .then((result) => {
        this.s.put("operations", {
          ...this.s.get("operations", key),
          state: "COMPLETED",
          ...(result?.kind === "appendix" ? { artifactId: result.id } : {}),
          ...(result?.capabilities ? { capabilities: result.capabilities } : {}),
          finishedAt: now(),
        });
      })
      .catch((error) => {
        this.s.put("operations", {
          ...this.s.get("operations", key),
          state: "INTERRUPTED",
          error: String(error.message).slice(-4000),
        });
        onError?.(error);
        if (questId && this.s.get("quests", questId)) {
          this.e.put("quests", this.e.get("quests", questId), {
            autoExecute: false,
          });
          this.e.log(
            questId,
            `${key.startsWith("appendix:") ? "Jira appendix generation failed" : "Execution needs attention"}: ${error.message}`,
          );
        }
      })
      .finally(() => {
        this.pending.delete(key);
        this.e.emit({ type: "changed" });
        this.pump();
      });
    this.pending.set(key, promise);
    return this.s.get("operations", key);
  }
  async settled() {
    while (this.pending.size) await Promise.all([...this.pending.values()]);
  }
  async launch(quest, role, options, decision, existing) {
    assert(!this.e.stopping, "Application is shutting down; agent launch paused");
    const previous =
      existing ||
      this.s.get(
        "runs",
        options.recoveryFrom || options.continuationOf || options.policyChangeFrom || "",
      );
    const route =
      previous?.profileSnapshot && !options.policyChangeFrom
        ? previous.route
        : this.route(quest, role, decision);
    const capabilities = this.e.runtimeStatus[route.runtime];
    assert(capabilities?.available !== false, `${route.runtime} is unavailable`);
    const bootstrap = (await this.e.adapters.workflow?.bootstrap?.(route.runtime)) || {
      text: "",
      status: { ponytail: "NOT_AVAILABLE", caveman: "NOT_AVAILABLE" },
    };
    const limits = quest.execution.limits;
    const tokens = this.s
      .all("runs")
      .filter((r) => r.questId === quest.id)
      .reduce((sum, r) => sum + (r.usage?.input_tokens || 0) + (r.usage?.output_tokens || 0), 0);
    assert(!limits.tokens || tokens < limits.tokens, "Quest token budget reached");
    const record = {
      id: id(),
      questId: quest.id,
      role,
      taskId: options.taskId,
      ...route,
      createdAt: now(),
    };
    this.s.put("decisions", record);
    return this.e.launch(
      quest,
      {
        ...options,
        role,
        route,
        runtime: route.runtime,
        workflowVersion: 2,
        timeoutMs: limits.taskMinutes * 60000,
        executionPolicy: {
          safeFallback: this.e.adapters.config?.orchestration?.claudeSafeFallback,
          nestedSpawning: false,
        },
        bootstrap: bootstrap.text,
        optimizations: bootstrap.status,
      },
      existing,
    );
  }
  async design(quest, role, options) {
    return this.launch(quest, role, options);
  }
  async dispatch(type, p) {
    if (type === "RECONCILE") {
      this.background("reconcile", null, () => this.e.reconcile());
      return;
    }
    if (type === "CONFIGURE_REPOSITORY") {
      const repo = this.e.get("repositories", p.repositoryId);
      assert(
        !this.s.all("works").some((w) => w.repoId === repo.id),
        "Configure the repository before creating workspaces",
      );
      return this.e.put("repositories", repo, await this.git.config(repo, p));
    }
    if (type === "RESET_DEVELOPMENT_DATA") {
      assert(
        p.confirmation === "RESET DEVQUEST TEST DATA",
        "Type RESET DEVQUEST TEST DATA to confirm",
      );
      assert(
        !this.e.jobs.size &&
          !this.pending.size &&
          !this.s.all("runs").some((r) => active.has(r.state)),
        "Stop all agent sessions before resetting test data",
      );
      assert(
        !this.s.all("branches").length && !this.s.all("works").length,
        "Reset would orphan owned worktrees/branches; preserve them and use a new DEVQUEST_HOME instead",
      );
      this.s.transaction(() => {
        for (const table of [
          "quests",
          "tasks",
          "runs",
          "artifacts",
          "approvals",
          "events",
          "decisions",
          "operations",
        ])
          for (const row of this.s.all(table)) this.s.remove(table, row.id);
      });
      this.e.log(
        null,
        "Development Quest records reset; repository configuration and artifact files preserved",
      );
      return;
    }
    const quest = this.e.get("quests", p.questId || this.e.get("runs", p.runId).questId);
    if (type === "GENERATE_APPENDIX") return this.e.appendixAgent.start(quest, p);
    if (type === "PUBLISH_JIRA") {
      this.e.publicationInput(quest, p);
      return this.background(`jira:${quest.id}`, quest.id, () => this.e.dispatch(type, p, true));
    }
    if (type === "SET_QUEST_EXECUTION") {
      const execution = this.config(p.execution);
      assert(
        !this.s
          .all("runs")
          .some(
            (run) =>
              run.questId === quest.id && (run.state === "RUNNING" || processExists(run.pid)),
          ) &&
          !this.s
            .all("operations")
            .some((operation) => operation.questId === quest.id && operation.state === "RUNNING"),
        "Pause active Quest operations before changing agent configuration",
      );
      for (const work of this.e.works(quest.id).filter((work) => !work.pr))
        this.e.put("works", work, {
          productionReview: null,
          state: this.e
            .tasks(quest.id)
            .filter((task) => task.repoId === work.repoId)
            .every((task) => task.state === "COMPLETED")
            ? "REVIEW_REQUIRED"
            : work.state,
        });
      return this.e.put("quests", quest, {
        execution,
        autoExecute: false,
      });
    }
    if (type === "PAUSE_QUEST") {
      this.e.put("quests", quest, { autoExecute: false });
      return;
    }
    if (["CONTINUE_AGENT", "SEND_MESSAGE"].includes(type)) {
      const run = this.e.get("runs", p.runId);
      if (!run.purpose.startsWith("v11-")) return this.e.runAction(type, p);
      assert(
        !this.e.jobs.has(run.id) && !processExists(run.pid),
        "Stop the existing agent process before continuing",
      );
      if (run.profileSnapshot) {
        assert(
          ["WAITING_INPUT", "PAUSED", "INTERRUPTED", "FAILED"].includes(run.state),
          "Only stopped attempts can continue",
        );
        if (run.taskId) {
          const task = this.e.get("tasks", run.taskId);
          assert(
            !task.integratedCommit && (task.retries || 0) < quest.execution.limits.retries,
            "Integrated task or retry budget exhausted",
          );
          this.e.put("tasks", task, { retries: (task.retries || 0) + 1 });
        }
        assert(
          run.role !== "developer" ||
            this.developerSlots().length < Math.min(5, quest.execution.limits.developers),
          "Developer agent limit reached",
        );
        return this.e.runAction(type, p);
      }
      if (run.taskId)
        return this.retry(
          quest,
          this.e.get("tasks", run.taskId),
          p.message || "Continue from the saved checkpoint",
        );
      if (["v11-fix", "v11-conflict"].includes(run.purpose)) {
        const work = this.e.get("works", run.workId);
        const slots = this.developerSlots();
        assert(
          work.state !== "FIXING" &&
            slots.length <
              Math.min(
                5,
                this.e.adapters.config?.orchestration?.maxConcurrentDeveloperAgents || 5,
              ) &&
            slots.filter((slot) => slot.questId === quest.id).length <
              quest.execution.limits.developers,
          "Developer agent limit reached or fix already active; resume waits",
        );
        this.e.put("works", work, { state: "FIXING" });
        this.e.put("runs", run, { state: "CANCELLED", pid: null });
        this.background(
          `resume-fix:${run.id}`,
          quest.id,
          () =>
            this.launch(
              quest,
              "developer",
              {
                purpose: run.purpose,
                workId: work.id,
                readOnly: false,
                cwd: run.cwd,
                prompt: `Continue the preserved fix; do not reset, abort, commit, merge or push.\n${this.e.context(quest)}\nCheckpoint: ${run.summary}\nFindings: ${JSON.stringify(work.productionReview || work.integration)}\nHuman instruction: ${p.message || "Continue"}`,
              },
              this.risk(quest, work),
            ),
          (error) =>
            this.e.put("works", this.e.get("works", work.id), {
              state: "NEEDS_HUMAN_ATTENTION",
              error: error.message,
            }),
        );
        return;
      }
      this.e.put("runs", run, { state: "CANCELLED", pid: null });
      if (run.purpose === "v11-route") return this.assess(quest);
      return this.review(quest, this.e.get("works", run.workId));
    }
    if (type === "ASSESS_TASKS") {
      this.e.approved(quest.id, "plan");
      assert(
        !this.developerSlots().some((slot) => slot.questId === quest.id),
        "Pause developer work before reassessing model routing",
      );
      return this.assess(quest);
    }
    if (type === "EXECUTE_QUEST" || type === "START_TASK") {
      this.e.executionGate(quest);
      this.e.put("quests", quest, {
        autoExecute: type === "EXECUTE_QUEST",
        state: "EXECUTING",
      });
      if (
        quest.execution.routing.mode === "dynamic" &&
        this.e.tasks(quest.id).some((t) => !t.assessment)
      )
        return this.assess(quest);
      if (type === "START_TASK") return this.claim(quest, this.e.get("tasks", p.taskId));
      this.pump();
      return;
    }
    if (["RETRY_TASK", "REOPEN_TASK", "CANCEL_TASK", "ESCALATE_TASK", "RUN_TEST"].includes(type)) {
      const task = this.e.get("tasks", p.taskId);
      assert(task.questId === quest.id, "Task belongs to another Quest");
      if (type === "RUN_TEST") {
        assert(
          task.workspace &&
            !this.s.all("runs").some((run) => run.taskId === task.id && active.has(run.state)),
          "Finish the task agent before validation",
        );
        this.background(`validate:${task.id}`, quest.id, async () => {
          const work = this.e.get("works", task.workId),
            repo = this.e.get("repositories", task.repoId);
          await this.serial(`${quest.id}:${repo.id}`, async () => {
            const validation = await this.validate(
              repo,
              task.integratedCommit ? work : task.workspace,
              task.validationProfile,
            );
            this.e.put("tasks", this.e.get("tasks", task.id), {
              validation,
              ...(!validation.passed ? { state: "NEEDS_HUMAN_ATTENTION" } : {}),
            });
            assert(validation.passed, `Validation failed: ${validation.summary}`);
          });
        });
        return;
      }
      if (type === "CANCEL_TASK") {
        const run = this.s.all("runs").find((r) => r.taskId === task.id && r.state === "RUNNING");
        if (run) {
          this.e.jobs.get(run.id)?.controller.abort();
          this.e.put("runs", run, { state: "INTERRUPTED" });
        }
        this.e.put("tasks", task, { state: "CANCELLED" });
        this.e.put("quests", quest, { autoExecute: false });
        return;
      }
      if (type === "ESCALATE_TASK") {
        assert(task.route?.family !== "opus", "Highest permitted reasoning model already selected");
        assert(
          p.reason === "REASONING_COMPLEXITY" && typeof p.detail === "string" && p.detail.trim(),
          "Only evidenced reasoning complexity permits escalation",
        );
        assert(
          (task.escalations || 0) < quest.execution.limits.escalations,
          "Model escalation budget exhausted",
        );
        const family = task.route?.family === "haiku" ? "sonnet" : "opus";
        const decision = {
          ...(task.assessment || {
            complexity: "COMPLEX",
            risk: "MEDIUM",
            confidence: 1,
          }),
          taskId: task.id,
          recommendedModelFamily: family,
          recommendedEffort: "high",
          reason: p.detail,
        };
        this.route(quest, "developer", decision);
        this.e.put("tasks", task, {
          assessment: decision,
          escalations: (task.escalations || 0) + 1,
        });
      }
      return this.retry(quest, this.e.get("tasks", task.id), p.message, type === "ESCALATE_TASK");
    }
    const work = this.e.get("works", p.workId);
    assert(work.questId === quest.id, "Repository work belongs to another Quest");
    if (type === "SET_PR_TARGET") {
      assert(
        !work.pr &&
          !this.pending.has(`integration:${work.id}`) &&
          !this.pending.has(`pr:${work.id}`) &&
          !this.integrationLocks.has(`publish:${work.id}`),
        "Cannot change target while integrating or after PR creation",
      );
      this.background(`target:${work.id}`, quest.id, async () => {
        const repo = this.e.get("repositories", work.repoId);
        await this.git.ref(repo.path, p.target);
        await this.git.target(repo, work, p.target);
        this.e.put("works", this.e.get("works", work.id), {
          prTarget: p.target,
          productionReview: null,
          validation: null,
          state: "REVIEW_REQUIRED",
        });
        this.production.invalidateScope(quest);
      });
      return;
    }
    if (type === "REVIEW_REPOSITORY") return this.review(quest, work);
    if (type === "APPROVE_REVIEW") {
      this.background(`approve:${work.id}`, quest.id, async () => {
        const approved = await this.ready(quest, this.e.get("works", work.id));
        this.e.put("works", this.e.get("works", work.id), {
          humanApprovedAt: now(),
          humanApprovedCommit: approved.head,
          state: "READY_FOR_PR",
        });
        this.e.refreshQuest(quest.id);
      });
      return;
    }
    if (type === "CREATE_PR") {
      this.background(`pr:${work.id}`, quest.id, () => this.createPr(quest, work, p.reviewers));
      return;
    }
    throw new Error("Invalid v1.1 action");
  }
  assess(quest) {
    if (
      this.s
        .all("runs")
        .some((r) => r.questId === quest.id && r.purpose === "v11-route" && active.has(r.state))
    )
      return;
    this.background(`route:${quest.id}`, quest.id, async () => {
      await this.launch(quest, "orchestrator", {
        purpose: "v11-route",
        readOnly: true,
        cwd: this.e.get("repositories", quest.repositoryIds[0]).path,
        prompt: `Assess complexity, architecture, cross-repository dependencies, business/security/regression risk. Return only JSON {"questAssessment":{"taskId":"${quest.id}","complexity":"COMPLEX","risk":"HIGH","recommendedModelFamily":"opus","recommendedEffort":"high","reason":"Quest-wide architecture and risk evidence","confidence":0.9},"assessments":[{"taskId":"exact task id","complexity":"TRIVIAL|SIMPLE|MODERATE|COMPLEX|VERY_COMPLEX|CRITICAL","risk":"LOW|MEDIUM|HIGH|CRITICAL","recommendedModelFamily":"haiku|sonnet|opus","recommendedRuntime":"claude|codex","recommendedEffort":"low|medium|high","reason":"evidence-based technical reason","confidence":0.9}]}. Do not execute workflow operations.\n${this.e.context(quest)}\nTasks: ${JSON.stringify(this.e.tasks(quest.id))}`,
      });
    });
  }
  eligible(...args) {
    return this.scheduler.eligible(...args);
  }
  developerSlots(...args) {
    return this.scheduler.developerSlots(...args);
  }
  pump(...args) {
    return this.scheduler.pump(...args);
  }
  claim(...args) {
    return this.scheduler.claim(...args);
  }
  work(...args) {
    return this.scheduler.work(...args);
  }
  serial(...args) {
    return this.scheduler.serial(...args);
  }
  prepareTask(...args) {
    return this.scheduler.prepareTask(...args);
  }
  validate(...args) {
    return this.scheduler.validate(...args);
  }
  retry(...args) {
    return this.scheduler.retry(...args);
  }
  onFinish(run, result) {
    return finishAgentRun(this, run, result);
  }
  integrate(...args) {
    return this.scheduler.integrate(...args);
  }
  finishIntegration(...args) {
    return this.scheduler.finishIntegration(...args);
  }
  risk(...args) {
    return this.production.risk(...args);
  }
  review(...args) {
    return this.production.review(...args);
  }
  fix(...args) {
    return this.production.fix(...args);
  }
  ready(...args) {
    return this.production.ready(...args);
  }
  createPr(...args) {
    return this.production.createPr(...args);
  }
  async recover() {
    for (const operation of this.s.all("operations"))
      if (
        !operation.id.startsWith("appendix:") &&
        operation.state === "RUNNING" &&
        !this.pending.has(operation.id)
      )
        this.s.put("operations", { ...operation, state: "INTERRUPTED" });
    for (const quest of this.s.all("quests").filter((q) => q.workflowVersion === 2)) {
      this.e.put("quests", quest, { autoExecute: false });
      for (const task of this.e.tasks(quest.id)) {
        if (
          claimed.has(task.state) &&
          !this.s
            .all("runs")
            .some(
              (run) =>
                run.taskId === task.id &&
                (this.e.jobs.has(run.id) || this.pending.has(`finish:${run.id}`)),
            ) &&
          !this.pending.has(`task:${task.id}`) &&
          !this.pending.has(`resume-integration:${task.id}`)
        )
          this.e.put("tasks", task, {
            state: "INTERRUPTED",
            error:
              "Execution interrupted; inspect preserved task/integration state before resuming",
          });
        if (task.workspace)
          try {
            await this.git.inspect(this.e.get("repositories", task.repoId), task.workspace);
          } catch (error) {
            this.e.put("tasks", this.e.get("tasks", task.id), {
              state: "NEEDS_HUMAN_ATTENTION",
              error: error.message,
            });
          }
      }
      for (const work of this.e.works(quest.id)) {
        if (this.integrationLocks.has(`${quest.id}:${work.repoId}`)) continue;
        try {
          const state = await this.git.inspect(this.e.get("repositories", work.repoId), work);
          if (work.integration) this.e.put("works", work, { state: "INTEGRATION_INTERRUPTED" });
          else if (
            ["FIXING", "REVIEWING"].includes(work.state) &&
            !this.s
              .all("runs")
              .some(
                (run) =>
                  run.workId === work.id && (this.e.jobs.has(run.id) || processExists(run.pid)),
              )
          )
            this.e.put("works", work, {
              state: "NEEDS_HUMAN_ATTENTION",
              error: "Review or fix interrupted; continue its preserved session",
            });
          else if (
            (work.productionReview?.reviewedCommit !== state.head ||
              work.validation?.fingerprint !== state.fingerprint) &&
            work.productionReview
          )
            this.e.put("works", work, {
              productionReview: null,
              state: "REVIEW_REQUIRED",
            });
        } catch (error) {
          this.e.put("works", work, {
            state: "RECOVERY_REQUIRED",
            error: error.message,
          });
        }
      }
    }
  }
}

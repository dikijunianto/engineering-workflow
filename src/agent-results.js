import { assert, assessment, productionReview } from "./routing.js";
const now = () => new Date().toISOString();
const json = (value) =>
  JSON.parse(
    String(value)
      .trim()
      .replace(/^```(?:json)?\s*/, "")
      .replace(/\s*```$/, ""),
  );
export function finishAgentRun(workflow, run, result) {
  const quest = workflow.e.get("quests", run.questId);
  workflow.background(
    `finish:${run.id}`,
    quest.id,
    async () => {
      const content = result.text || result.summary || "";
      if (run.purpose === "v11-route") {
        const data = json(content);
        const questAssessment = assessment(data.questAssessment, quest.id);
        const tasks = workflow.e.tasks(quest.id);
        assert(
          Array.isArray(data.assessments) &&
            data.assessments.length === tasks.length &&
            new Set(data.assessments.map((a) => a.taskId)).size ===
              tasks.length,
          "Orchestrator must assess each task exactly once",
        );
        const decisions = tasks.map((t) =>
          assessment(
            data.assessments.find((a) => a.taskId === t.id),
            t.id,
          ),
        );
        for (const decision of decisions)
          workflow.route(quest, "developer", decision);
        workflow.s.transaction(() => {
          workflow.e.put("quests", workflow.e.get("quests", quest.id), {
            assessment: questAssessment,
          });
          for (const decision of decisions)
            workflow.e.put("tasks", workflow.e.get("tasks", decision.taskId), {
              assessment: decision,
            });
          for (const work of workflow.e
            .works(quest.id)
            .filter((work) => !work.pr && work.productionReview))
            workflow.e.put("works", work, {
              productionReview: null,
              state: "REVIEW_REQUIRED",
            });
        });
        workflow.s.artifact(quest.id, "routing", JSON.stringify(data, null, 2));
        return;
      }
      const work = workflow.e.get("works", run.workId),
        repo = workflow.e.get("repositories", work.repoId);
      if (run.purpose === "v11-task") {
        let task = workflow.e.get("tasks", run.taskId);
        if (task.state === "CANCELLED") return;
        let reported;
        try {
          reported = json(content);
        } catch {}
        if (reported?.status === "BLOCKED") {
          assert(
            [
              "ENVIRONMENT",
              "PERMISSION",
              "DEPENDENCY",
              "REASONING_COMPLEXITY",
            ].includes(reported.category) &&
              typeof reported.evidence === "string" &&
              reported.evidence.length >= 10,
            "Invalid worker blocker evidence",
          );
          workflow.e.put("tasks", task, {
            state: "NEEDS_HUMAN_ATTENTION",
            failureCategory: reported.category,
            error: reported.evidence,
          });
          if (
            reported.category === "REASONING_COMPLEXITY" &&
            quest.execution.routing.mode === "dynamic" &&
            !quest.execution.routing.model &&
            !quest.execution.roles.developer.model
          ) {
            assert(
              task.route.family !== "opus",
              "Highest permitted reasoning model already selected; human attention required",
            );
            assert(
              (task.escalations || 0) < quest.execution.limits.escalations,
              "Model escalation budget exhausted",
            );
            const family = task.route.family === "haiku" ? "sonnet" : "opus";
            workflow.e.put("tasks", workflow.e.get("tasks", task.id), {
              escalations: (task.escalations || 0) + 1,
              assessment: {
                ...task.assessment,
                recommendedModelFamily: family,
                recommendedEffort: "high",
                reason: reported.evidence,
              },
            });
            workflow.retry(
              quest,
              workflow.e.get("tasks", task.id),
              reported.evidence,
            );
            return;
          }
          throw new Error(`${reported.category}: ${reported.evidence}`);
        }
        workflow.e.put("tasks", task, {
          state: "AWAITING_TEST",
          summary: content.slice(-4000),
        });
        const validation = await workflow.validate(
          repo,
          task.workspace,
          task.validationProfile,
        );
        workflow.e.put("tasks", workflow.e.get("tasks", task.id), {
          validation,
        });
        assert(
          validation.passed,
          `Task validation failed: ${validation.summary}`,
        );
        const commit = await workflow.git.commit(
          repo,
          task.workspace,
          `feat : ${task.title.replace(/\s+/g, " ").slice(0, 180)} (${task.workspace.branch})`,
        );
        task = workflow.e.put("tasks", workflow.e.get("tasks", task.id), {
          commit,
          state: "INTEGRATION_QUEUED",
        });
        await workflow.integrate(quest, work, task);
      } else if (run.purpose === "v11-review") {
        const state = await workflow.git.inspect(repo, work);
        const scope = await workflow.production.scope(quest);
        if (
          scope.fingerprint !== run.reviewScope ||
          state.head !== run.reviewedCommit ||
          state.fingerprint !== run.fingerprint
        ) {
          workflow.e.put("works", work, {
            productionReview: null,
            state: "REVIEW_REQUIRED",
          });
          workflow.e.put("runs", run, {
            state: "STALE",
            summary:
              "Quest integration state changed; independent review will be repeated",
          });
          return;
        }
        assert(
          !state.dirty &&
            state.head === run.reviewedCommit &&
            state.fingerprint === run.fingerprint,
          "Review became stale while the reviewer was running",
        );
        const review = productionReview(json(content), state.head);
        workflow.e.put("works", workflow.e.get("works", work.id), {
          productionReview: {
            ...review,
            runtime: run.runtime,
            model: run.route.resolvedModel,
            reviewerRuntime: run.runtime,
            reviewerModel: run.actualModel || run.route.resolvedModel,
            scope: run.reviewScope,
            effort: run.route.resolvedEffort,
            createdAt: now(),
          },
          state:
            review.verdict === "PASSED" ? "REVIEW_PASSED" : "CHANGES_REQUIRED",
        });
        if (review.verdict === "PASSED") {
          await workflow.ready(quest, workflow.e.get("works", work.id));
          if (quest.execution.mode === "autonomous") {
            workflow.e.put("works", workflow.e.get("works", work.id), {
              state: "READY_FOR_PR",
            });
            workflow.e.refreshQuest(quest.id);
            await workflow.production.publishReady(quest);
          }
        } else if (
          review.verdict === "CHANGES_REQUIRED" &&
          quest.execution.mode === "autonomous"
        )
          await workflow.fix(quest, workflow.e.get("works", work.id), review);
        else
          workflow.e.put("works", workflow.e.get("works", work.id), {
            state: "NEEDS_HUMAN_ATTENTION",
          });
      } else if (["v11-fix", "v11-conflict"].includes(run.purpose)) {
        await workflow.serial(`${quest.id}:${repo.id}`, async () => {
          const current = workflow.e.get("works", work.id);
          if (run.purpose === "v11-conflict") {
            const task = workflow.e.get("tasks", current.integration.taskId);
            await workflow.git.integrate(repo, current, task);
            await workflow.finishIntegration(
              quest,
              workflow.e.get("works", work.id),
              task,
            );
          } else {
            const profiles = [
              ...new Set(
                workflow.e
                  .tasks(quest.id)
                  .filter((t) => t.repoId === repo.id)
                  .map((t) => t.validationProfile),
              ),
            ];
            for (const profile of profiles)
              assert(
                (await workflow.validate(repo, current.fixWorkspace, profile))
                  .passed,
                "Review fix validation failed",
              );
            const commit = await workflow.git.commit(
              repo,
              current.fixWorkspace,
              `fix : address production review (${current.fixWorkspace.branch})`,
            );
            const synthetic = {
              id: `fix-${current.id}-${current.fixCycles}`,
              key: "review-fix",
              commit,
            };
            workflow.e.put("works", current, {
              integration: { taskId: synthetic.id, commit, state: "MERGING" },
            });
            await workflow.git.integrate(
              repo,
              workflow.e.get("works", work.id),
              synthetic,
            );
            workflow.e.put("works", workflow.e.get("works", work.id), {
              integration: null,
              productionReview: null,
              state: "REVIEW_REQUIRED",
            });
            workflow.production.invalidateScope(quest);
          }
        });
        workflow.review(quest, workflow.e.get("works", work.id));
      }
    },
    (error) => {
      if (run.taskId)
        workflow.e.put("tasks", workflow.e.get("tasks", run.taskId), {
          state: "NEEDS_HUMAN_ATTENTION",
          error: error.message,
        });
      if (run.workId)
        workflow.e.put("works", workflow.e.get("works", run.workId), {
          state: "NEEDS_HUMAN_ATTENTION",
          error: error.message,
        });
      workflow.e.put("runs", workflow.e.get("runs", run.id), {
        state: "FAILED",
        summary: error.message.slice(-4000),
      });
    },
  );
}

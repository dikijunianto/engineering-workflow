import { assert, productionReview, REVIEW_CATEGORIES } from "./routing.js";
import { hash } from "./store.js";
const now = () => new Date().toISOString();
const active = new Set(["RUNNING", "WAITING_INPUT", "PAUSED", "INTERRUPTED"]);
export class ProductionReview {
  constructor(workflow) {
    this.workflow = workflow;
  }
  async scope(quest) {
    const repositories = [];
    for (const work of this.workflow.e
      .works(quest.id)
      .sort((a, b) => a.repoId.localeCompare(b.repoId))) {
      const repo = this.workflow.e.get("repositories", work.repoId);
      const state = await this.workflow.git.inspect(repo, work);
      repositories.push({
        workId: work.id,
        repository: repo.name,
        head: state.head,
        fingerprint: state.fingerprint,
        dirty: state.dirty,
        diff: state.diff,
      });
    }
    return {
      fingerprint: hash(
        JSON.stringify(
          repositories.map(({ workId, fingerprint }) => ({
            workId,
            fingerprint,
          })),
        ),
      ),
      repositories,
    };
  }
  invalidateScope(quest, includePublished = false) {
    for (const work of this.workflow.e
      .works(quest.id)
      .filter(
        (work) => (includePublished || !work.pr) && work.productionReview?.verdict === "PASSED",
      ))
      this.workflow.e.put("works", work, {
        productionReview: null,
        humanApprovedCommit: null,
        state: "REVIEW_REQUIRED",
      });
  }
  async publishReady(quest) {
    if (
      quest.execution.mode !== "autonomous" ||
      !quest.execution.permissions.createPr
    )
      return;
    const works = this.workflow.e.works(quest.id);
    if (
      !works.length ||
      !works.every(
        (work) =>
          work.productionReview?.verdict === "PASSED" &&
          ["READY_FOR_PR", "PR_CREATED"].includes(work.state),
      )
    )
      return;
    for (const work of works) if (!work.pr && (!work.targetRecovery || work.humanApprovedCommit === work.productionReview.reviewedCommit)) await this.createPr(quest, work);
  }
  risk(quest, work) {
    const risks = this.workflow.e
      .tasks(quest.id)
      .filter((t) => t.repoId === work.repoId)
      .map((t) => t.assessment?.risk || "MEDIUM");
    return {
      risk: risks.includes("CRITICAL")
        ? "CRITICAL"
        : risks.includes("HIGH")
          ? "HIGH"
          : "MEDIUM",
      complexity: "COMPLEX",
      reason: "Independent integrated production review",
    };
  }
  review(quest, work) {
    if (
      this.workflow.e
        .works(quest.id)
        .some((work) =>
          [
            "FIXING",
            "FIX_QUEUED",
            "INTEGRATION_CONFLICT",
            "INTEGRATION_INTERRUPTED",
          ].includes(work.state),
        )
    )
      return;
    if (
      this.workflow.pending.has(`review:${work.id}`) ||
      this.workflow.s
        .all("runs")
        .some(
          (r) =>
            r.workId === work.id &&
            r.purpose === "v11-review" &&
            active.has(r.state),
        )
    )
      return;
    this.workflow.background(
      `review:${work.id}`,
      quest.id,
      async () => {
        const current = this.workflow.e.get("works", work.id),
          repo = this.workflow.e.get("repositories", work.repoId);
        assert(
          (current.reviewAttempts || 0) <
            1 +
              quest.execution.limits.reviewCycles *
                this.workflow.e.works(quest.id).length +
              quest.execution.limits.retries,
          "Production review attempt budget exhausted; human attention required",
        );
        assert(
          !current.integration &&
            this.workflow.e
              .tasks(quest.id)
              .every((t) => t.state === "COMPLETED" && t.integratedCommit),
          "Integrate all tasks before production review",
        );
        const profiles = [
          ...new Set(
            this.workflow.e
              .tasks(quest.id)
              .filter((t) => t.repoId === repo.id)
              .map((t) => t.validationProfile),
          ),
        ];
        for (const profile of profiles)
          assert(
            (await this.workflow.validate(repo, current, profile)).passed,
            "Repository validation failed before review",
          );
        const state = await this.workflow.git.inspect(repo, current);
        const scope = await this.scope(quest);
        assert(
          scope.repositories.every((repo) => !repo.dirty),
          "Quest integration workspaces must be clean for cross-repository review",
        );
        assert(
          !state.dirty,
          "Production review requires a clean integrated commit",
        );
        this.workflow.e.put("works", current, {
          validation: {
            head: state.head,
            fingerprint: state.fingerprint,
            profiles,
            passed: true,
            createdAt: now(),
          },
          state: "REVIEWING",
          reviewAttempts: (current.reviewAttempts || 0) + 1,
        });
        await this.workflow.launch(
          quest,
          "reviewer",
          {
            purpose: "v11-review",
            workId: work.id,
            readOnly: true,
            cwd: work.path,
            fingerprint: state.fingerprint,
            reviewedCommit: state.head,
            reviewScope: scope.fingerprint,
            prompt: `Independent production review of exact commit ${state.head}. Do not edit. Examine full diff, requirements, task summaries, cross-service compatibility and validation evidence. Return only JSON {"verdict":"PASSED|CHANGES_REQUIRED|BLOCKED|NEEDS_HUMAN_ATTENTION","reviewedCommit":"${state.head}","findings":[{"severity":"HIGH|CRITICAL|MEDIUM|LOW","category":"RELIABILITY","file":"path","description":"evidence and correction","blocking":true}],"validation":{"unitTests":"PASSED|FAILED|NOT_VERIFIED","integrationTests":"PASSED|FAILED|NOT_VERIFIED"},"categories":${JSON.stringify(Object.fromEntries(REVIEW_CATEGORIES.map((c) => [c, "PASSED|FAILED|NOT_VERIFIED"])))}}. Missing evidence is NOT_VERIFIED, never invent results.\n${this.workflow.e.context(quest)}\nAll Quest tasks: ${JSON.stringify(this.workflow.e.tasks(quest.id))}\nValidation: ${JSON.stringify(this.workflow.e.get("works", work.id).validation)}\nComplete diff:\n${state.diff}\nCross-repository integrated evidence:\n${JSON.stringify(scope.repositories)}`,
          },
          this.workflow.risk(quest, work),
        );
      },
      (error) =>
        this.workflow.e.put("works", this.workflow.e.get("works", work.id), {
          state: "NEEDS_HUMAN_ATTENTION",
          error: error.message,
        }),
    );
  }
  async fix(quest, work, review) {
    const slots = this.workflow.developerSlots();
    if (
      slots.length >=
        Math.min(
          5,
          this.workflow.e.adapters.config?.orchestration
            ?.maxConcurrentDeveloperAgents || 5,
        ) ||
      slots.filter((slot) => slot.questId === quest.id).length >=
        quest.execution.limits.developers
    ) {
      this.workflow.e.put("works", work, { state: "FIX_QUEUED" });
      return;
    }
    assert(
      work.fixCycles < quest.execution.limits.reviewCycles,
      "Review/fix cycle limit reached; human attention required",
    );
    const repo = this.workflow.e.get("repositories", work.repoId);
    const cycle = work.fixCycles + 1;
    this.workflow.e.put("works", work, { state: "FIXING", fixCycles: cycle });
    const synthetic = {
      id: `review-${work.id}-${cycle}`,
      key: `review-${cycle}`,
    };
    const workspace = await this.workflow.git.prepare(
      quest,
      repo,
      work.id,
      synthetic,
      review.reviewedCommit,
    );
    this.workflow.e.put("works", work, {
      fixCycles: cycle,
      fixWorkspace: workspace,
      state: "FIXING",
    });
    await this.workflow.launch(
      quest,
      "developer",
      {
        purpose: "v11-fix",
        workId: work.id,
        readOnly: false,
        cwd: workspace.path,
        prompt: `Fix the independent production-review findings in this isolated fix worktree. Do not commit, merge, push or spawn nested agents. Preserve all requirements.\n${this.workflow.e.context(quest)}\nFindings: ${JSON.stringify(review)}`,
      },
      this.workflow.risk(quest, work),
    );
  }
  async ready(quest, work) {
    this.workflow.e.approved(quest.id, "trd");
    this.workflow.e.approved(quest.id, "plan");
    assert(
      !this.workflow.pending.has(`review:${work.id}`) &&
        !this.workflow.s
          .all("runs")
          .some((run) => run.workId === work.id && active.has(run.state)),
      "Finish active repository agents before PR readiness",
    );
    assert(
      !this.workflow.pending.has(`target:${work.id}`),
      "PR target validation is still running",
    );
    const repo = this.workflow.e.get("repositories", work.repoId);
    const state = await this.workflow.git.inspect(repo, work);
    assert(
      !state.dirty && !work.integration,
      "Uncommitted changes or unresolved integration block PR readiness",
    );
    const review = work.productionReview;
    assert(
      review &&
        review.verdict === "PASSED" &&
        review.reviewedCommit === state.head,
      "Independent review is missing, blocking or stale",
    );
    productionReview(review, state.head);
    assert(
      review.scope === (await this.scope(quest)).fingerprint,
      "Cross-repository review scope is stale",
    );
    assert(
      work.validation?.passed &&
        work.validation.head === state.head &&
        work.validation.fingerprint === state.fingerprint,
      "Mandatory repository tests are missing or stale",
    );
    assert(
      this.workflow.e
        .tasks(quest.id)
        .every(
          (t) =>
            t.state === "COMPLETED" &&
            t.integratedCommit &&
            t.validation?.passed,
        ),
      "Task validation or integration is incomplete",
    );
    const target = await this.workflow.git.target(repo, work, work.prTarget);
    assert(
      target === state.baseHead,
      "PR target changed; revalidate and review again",
    );
    await this.workflow.git.pushPolicy(repo, work);
    return state;
  }
  async createPr(quest, original, requestedReviewers) {
    return this.workflow.serial(`publish:${original.id}`, () =>
      this.publishPr(quest, original, requestedReviewers),
    );
  }
  async publishPr(quest, original, requestedReviewers) {
    let work = this.workflow.e.get("works", original.id);
    const reviewed = await this.workflow.ready(quest, work);
    const scope = await this.scope(quest);
    assert(
      this.workflow.e
        .works(quest.id)
        .every(
          (work) =>
            work.productionReview?.verdict === "PASSED" &&
            work.productionReview.scope === scope.fingerprint,
        ),
      "Every repository needs a current passing production review before PR publication",
    );
    assert(
      (quest.execution.mode !== "guided" && !work.targetRecovery) ||
        work.humanApprovedCommit === reviewed.head,
      "Human approval of this exact repository review is required",
    );
    const repo = this.workflow.e.get("repositories", work.repoId);
    const reviewers =
      requestedReviewers ||
      work.reviewers ||
      quest.reviewers ||
      (repo.reviewers?.length ? repo.reviewers : undefined) ||
      this.workflow.e.adapters.config?.sourceControl?.reviewers ||
      [];
    assert(
      Array.isArray(reviewers) &&
        reviewers.length <= 20 &&
        reviewers.every((v) => /^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/.test(v)),
      "Invalid human reviewers",
    );
    const pr =
      work.pr ||
      (await this.workflow.e.adapters.sourceControl.create({
        repoPath: repo.path,
        remote: repo.remote,
        path: work.path,
        branch: work.branch,
        baseBranch: work.prTarget,
        title: quest.title,
        reviewers,
        body: `${this.workflow.e.artifact(quest.id, "plan")}\n\nProduction review: ${JSON.stringify(work.productionReview)}`,
        ownership: this.workflow.git.owner(repo, work.branch),
        protectedBranches: repo.protectedBranches,
        expectedHead: reviewed.head,
      }));
    work = this.workflow.e.put("works", this.workflow.e.get("works", work.id), {
      pr,
      state: "PR_CREATED",
      error: null,
      reviewers,
    });
    if (reviewers.length) {
      await this.workflow.e.adapters.sourceControl.requestReview({
        path: work.path,
        remote: repo.remote,
        number: pr.number,
        reviewers,
      });
      this.workflow.e.put("works", this.workflow.e.get("works", work.id), {
        reviewers,
        reviewRequestedAt: now(),
      });
    }
    const done = this.workflow.e
      .works(quest.id)
      .every(
        (w) =>
          w.pr &&
          (!w.reviewers?.length || w.reviewRequestedAt) &&
          (!this.workflow.e.adapters.config?.googleChat?.webhookEnv ||
            w.notifiedAt),
      );
    this.workflow.e.put("quests", this.workflow.e.get("quests", quest.id), {
      state: done ? "PRS_CREATED" : "REVIEW_HANDOFF",
    });
    this.workflow.e.log(
      quest.id,
      `PR created for ${work.branch} → ${work.prTarget}; human merge required`,
    );
    return pr;
  }
}

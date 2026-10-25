import { assert } from "./routing.js";
import { hash } from "./store.js";
const active = new Set(["RUNNING", "WAITING_INPUT", "PAUSED", "INTERRUPTED"]);

export class PrConflicts {
  constructor(workflow) {
    this.w = workflow;
  }
  async resolve(quest, original, expectedHead, continuation) {
    const w = this.w;
    return w.serial(`publish:${original.id}`, async () => {
      let work = w.e.get("works", original.id);
      const repo = w.e.get("repositories", work.repoId);
      if (continuation)
        assert(
          continuation.run.workId === work.id &&
            continuation.run.purpose === "v11-target" &&
            ["WAITING_INPUT", "PAUSED", "INTERRUPTED", "FAILED"].includes(continuation.run.state),
          "Invalid PR conflict continuation",
        );
      assert(
        !w.s
          .all("runs")
          .some(
            (r) => r.questId === quest.id && r.id !== continuation?.run.id && active.has(r.state),
          ),
        "Finish or cancel active Quest agents before PR conflict recovery",
      );
      assert(
        !work.integration &&
          (!["FIXING", "FIX_QUEUED", "REVIEWING"].includes(work.state) ||
            (continuation && work.state === "FIXING")) &&
          !["review:", "approve:", "pr:", "target:", "integration:"].some((prefix) =>
            w.pending.has(prefix + work.id),
          ),
        "Finish current integration, review or publication before conflict recovery",
      );
      assert(
        w.e.tasks(quest.id).every((t) => t.state === "COMPLETED" && t.integratedCommit),
        "Complete all tasks before PR conflict recovery",
      );
      assert(
        w.developerSlots().filter((slot) => !continuation || slot.id !== work.id).length <
          Math.min(5, quest.execution.limits.developers),
        "Developer agent limit reached",
      );
      const state = await w.git.inspect(repo, work);
      assert(state.head === expectedHead, "Epic commit changed; refresh before conflict recovery");
      let recovery = work.targetRecovery;
      if (!recovery) {
        assert(
          !state.dirty,
          "Preserve and resolve existing worktree edits before PR conflict recovery",
        );
        assert(
          (await w.git.command(work.path, ["rev-parse", "--verify", "MERGE_HEAD"], true)).code !==
            0,
          "An unrelated merge is already pending",
        );
        await w.git.ref(repo.path, work.prTarget);
        await w.git.command(repo.path, [
          "fetch",
          "--no-tags",
          "origin",
          `refs/heads/${work.prTarget}:refs/remotes/origin/${work.prTarget}`,
        ]);
        const targetHead = await w.git.command(repo.path, [
          "rev-parse",
          "--verify",
          `refs/remotes/origin/${work.prTarget}^{commit}`,
        ]);
        const preview = await w.git.command(
          work.path,
          ["merge-tree", "--write-tree", state.head, targetHead],
          true,
        );
        assert(
          [0, 1].includes(preview.code) && /^[a-f0-9]{40,64}$/.test(preview.stdout.split("\n")[0]),
          "Cannot verify PR merge conflicts; no branch was created",
        );
        if (preview.code === 0) {
          w.e.put("works", work, {
            prConflictCheck: { target: work.prTarget, targetHead, conflict: false },
          });
          w.e.log(
            quest.id,
            "No PR target conflict found; no clean snapshot or agent was created. Use the normal PR flow.",
          );
          return;
        }
        const branch = work.branch + "-clean";
        await w.git.ref(repo.path, branch);
        assert(!w.git.protected(repo, branch), "Clean snapshot matches protected branch policy");
        const exists = await w.git.command(
          repo.path,
          ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`],
          true,
        );
        assert(
          exists.code === 1 && !w.git.owner(repo, branch),
          "Clean branch already exists; it was preserved. Reconcile it before recovery",
        );
        // Reserve the ref atomically: never overwrite a staging snapshot or user branch.
        await w.git.command(repo.path, [
          "update-ref",
          `refs/heads/${branch}`,
          state.head,
          "0".repeat(state.head.length),
        ]);
        w.s.put("branches", {
          id: hash(`${repo.id}:${branch}`),
          repoId: repo.id,
          questId: quest.id,
          workId: work.id,
          branch,
          head: state.head,
          state: "CLEAN_SNAPSHOT",
          readOnly: true,
        });
        recovery = {
          branch,
          head: state.head,
          target: work.prTarget,
          targetHead,
          previousPr: work.pr || null,
          state: "PREPARED",
          attempts: 0,
          createdAt: new Date().toISOString(),
        };
        work = w.e.put("works", work, { targetRecovery: recovery });
        w.e.log(
          quest.id,
          `Preserved ${branch} at ${state.head}; conflict repair remains on ${work.branch}. Snapshot is local and was not pushed.`,
        );
      }
      assert(
        recovery.state !== "RESOLVED" &&
          recovery.head === state.head &&
          recovery.target === work.prTarget,
        "Existing target recovery cannot be replaced; preserve its clean snapshot and inspect the current branch",
      );
      const answering = continuation?.run.state === "WAITING_INPUT";
      assert(
        answering || recovery.attempts < 1 + quest.execution.limits.retries,
        "PR conflict repair retry budget exhausted; preserved work requires human attention",
      );
      assert(
        (await w.git.command(repo.path, ["rev-parse", `refs/heads/${recovery.branch}`])) ===
          recovery.head,
        "Clean snapshot changed; recovery stopped",
      );
      const pending = await w.git.command(work.path, ["rev-parse", "--verify", "MERGE_HEAD"], true);
      if (pending.code === 0)
        assert(
          pending.stdout.trim() === recovery.targetHead,
          "Pending merge does not match the recorded PR target",
        );
      else {
        assert(!state.dirty, "Existing edits are not part of the recorded target merge");
        const merged = await w.git.command(
          work.path,
          ["merge", "--no-ff", "--no-commit", recovery.targetHead],
          true,
        );
        assert(
          [0, 1].includes(merged.code) &&
            (await w.git.command(work.path, ["rev-parse", "--verify", "MERGE_HEAD"])).trim() ===
              recovery.targetHead,
          "Target merge could not be prepared; work and clean snapshot preserved",
        );
      }
      recovery = {
        ...recovery,
        state: "MERGING",
        attempts: recovery.attempts + (answering ? 0 : 1),
      };
      work = w.e.put("works", w.e.get("works", work.id), {
        targetRecovery: recovery,
        pr: null,
        productionReview: null,
        validation: null,
        humanApprovedCommit: null,
        humanApprovedAt: null,
        reviewRequestedAt: null,
        notifiedAt: null,
        state: "FIXING",
        error: null,
      });
      w.e.put("quests", w.e.get("quests", quest.id), {
        autoExecute: false,
        state: "REVIEW_HANDOFF",
      });
      w.production.invalidateScope(quest, true);
      const run = await w.launch(
        quest,
        "developer",
        {
          purpose: "v11-target",
          recoveryFrom: continuation?.run.id,
          workId: work.id,
          readOnly: false,
          cwd: work.path,
          prompt: `Resolve only the pending PR target merge in this assigned epic worktree. Preserve project requirements and target changes. Do not commit, merge, abort, reset, push or spawn agents. The backend owns the merge commit. Never modify the preserved clean branch ${recovery.branch} at ${recovery.head}; it is the pre-target staging snapshot. Target: ${recovery.target} at ${recovery.targetHead}.\n${w.e.context(quest)}\nHuman instruction: ${String(continuation?.message || "").slice(0, 8000)}`,
        },
        w.risk(quest, work),
      );
      if (
        continuation &&
        active.has(continuation.run.state) &&
        w.s.get("runs", continuation.run.id).state !== "SUPERSEDED"
      )
        w.e.put("runs", continuation.run, { state: "SUPERSEDED" });
      return run;
    });
  }
  async finish(quest, work) {
    const w = this.w,
      repo = w.e.get("repositories", work.repoId),
      r = work.targetRecovery;
    assert(
      r?.state === "MERGING" && r.target === work.prTarget,
      "No recorded PR target merge to complete",
    );
    assert(
      (await w.git.command(repo.path, ["rev-parse", `refs/heads/${r.branch}`])) === r.head,
      "Clean snapshot changed; completion stopped",
    );
    assert(
      (await w.git.command(work.path, ["rev-parse", "HEAD"])) === r.head &&
        (await w.git.command(work.path, ["rev-parse", "--verify", "MERGE_HEAD"])) === r.targetHead,
      "PR conflict repair commit or merge target changed",
    );
    assert(
      !(await w.git.command(work.path, ["ls-files", "-u"])),
      "PR target still has unresolved conflicts",
    );
    const profiles = [
      ...new Set(
        w.e
          .tasks(quest.id)
          .filter((t) => t.repoId === repo.id)
          .map((t) => t.validationProfile),
      ),
    ];
    assert(profiles.length, "PR target repair requires repository validation");
    let validation;
    for (const profile of profiles) {
      validation = await w.validate(repo, work, profile);
      assert(
        validation.passed,
        "PR target repair validation failed; preserved merge requires attention",
      );
    }
    const tested = await w.git.inspect(repo, work);
    assert(
      validation.head === tested.head && validation.fingerprint === tested.fingerprint,
      "PR repair changed after validation",
    );
    await w.git.command(work.path, ["add", "--all"]);
    await w.git.command(work.path, [
      "commit",
      "-m",
      `fix: resolve ${r.target} PR conflicts (${work.branch})`,
    ]);
    const head = (await w.git.inspect(repo, work)).head;
    assert(
      (await w.git.command(work.path, ["merge-base", "--is-ancestor", r.targetHead, head], true))
        .code === 0,
      "Resolved commit does not include the recorded target",
    );
    w.e.put("works", w.e.get("works", work.id), {
      targetRecovery: { ...r, state: "RESOLVED", resolvedHead: head },
      state: "REVIEW_REQUIRED",
      productionReview: null,
      humanApprovedCommit: null,
      validation: null,
      error: null,
    });
    w.e.log(
      quest.id,
      "PR target conflicts resolved and validated; fresh independent review and exact-commit human approval required before publication. Clean snapshot preserved.",
    );
    for (const candidate of w.e.works(quest.id)) w.review(quest, candidate);
  }
}

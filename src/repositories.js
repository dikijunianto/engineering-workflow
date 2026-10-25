import path from "node:path";
import { lstat, mkdir } from "node:fs/promises";
import { hash } from "./store.js";
import { assert } from "./routing.js";

export class RepositoryOperations {
  constructor(store, git) {
    this.store = store;
    this.git = git;
  }
  async command(cwd, args, optional = false) {
    const result = await this.git.runner("git", args, {
      cwd,
      timeoutMs: 120000,
      maxOutput: 200000,
    });
    if (!optional)
      assert(
        result.code === 0,
        `git ${args[0]} failed: ${(result.stderr || result.stdout).slice(-3000)}`,
      );
    return optional ? result : result.stdout.trim();
  }
  async ref(cwd, name) {
    assert(
      typeof name === "string" && name.length <= 200 && !name.startsWith("-"),
      "Invalid Git branch",
    );
    await this.command(cwd, ["check-ref-format", "--branch", name]);
    return name;
  }
  async config(repo, input = {}) {
    let defaultBranch = input.defaultBranch || repo.defaultBranch;
    if (!defaultBranch) {
      const symbolic = await this.command(
        repo.path,
        ["symbolic-ref", "--quiet", "refs/remotes/origin/HEAD"],
        true,
      );
      defaultBranch =
        symbolic.code === 0
          ? symbolic.stdout.trim().replace(/^refs\/remotes\/origin\//, "")
          : await this.command(repo.path, ["branch", "--show-current"]);
    }
    const baseBranch = input.baseBranch || repo.baseBranch || defaultBranch;
    const prTarget = input.prTarget || repo.prTarget || baseBranch;
    for (const ref of [defaultBranch, baseBranch, prTarget])
      await this.ref(repo.path, ref);
    const protectedBranches = [
      ...new Set([
        "main",
        "master",
        defaultBranch,
        ...(input.protectedBranches || repo.protectedBranches || []),
      ]),
    ];
    assert(
      protectedBranches.length <= 50 &&
        protectedBranches.every(
          (v) =>
            typeof v === "string" && /^[\w./*?-]+$/.test(v) && v.length <= 200,
        ),
      "Invalid protected branch patterns",
    );
    const reviewers = input.reviewers || repo.reviewers || [];
    assert(
      Array.isArray(reviewers) &&
        reviewers.length <= 20 &&
        reviewers.every(
          (v) =>
            typeof v === "string" && /^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/.test(v),
        ),
      "Invalid GitHub reviewers",
    );
    const baseResolution = Object.hasOwn(input, "baseResolution") ? input.baseResolution : repo.baseResolution ?? null;
    assert(
      baseResolution === null || ["local", "origin"].includes(baseResolution),
      "Invalid base-resolution policy",
    );
    return {
      defaultBranch,
      baseBranch,
      baseResolution,
      prTarget,
      protectedBranches,
      reviewers,
    };
  }
  protected(repo, branch) {
    return [
      "main",
      "master",
      repo.defaultBranch,
      ...(repo.protectedBranches || []),
    ]
      .filter(Boolean)
      .some((pattern) =>
        new RegExp(
          `^${pattern
            .replace(/[.+^${}()|[\]\\]/g, "\\$&")
            .replaceAll("*", ".*")
            .replaceAll("?", ".")}$`,
        ).test(branch),
      );
  }
  identity(quest, repo, task) {
    const suffix = `${quest.id.slice(0, 8)}-${repo.id.slice(0, 8)}`;
    const branch = task
      ? `task/${task.jira?.key || task.key}-${hash(task.id).slice(0, 12)}`
      : `${quest.epicKey ? `epic/${quest.epicKey}` : "quest"}/${suffix}`;
    return {
      branch,
      path: path.join(
        this.store.dir,
        "worktrees-v11",
        quest.id,
        repo.id,
        task ? `task-${hash(task.id).slice(0, 12)}` : "integration",
      ),
    };
  }
  async analysisSnapshot(quest, repo) {
    const branch = await this.ref(repo.path, repo.baseBranch || repo.defaultBranch);
    await this.command(repo.path, ["fetch", "--no-tags", "origin",
      `refs/heads/${branch}:refs/remotes/origin/${branch}`]);
    const commit = await this.command(repo.path, ["rev-parse", "--verify", `refs/remotes/origin/${branch}^{commit}`]);
    assert(/^[a-f0-9]{40,64}$/.test(commit), "Remote baseline did not resolve to a commit");
    const target = path.join(this.store.dir, "analysis-worktrees", hash(quest.id).slice(0,16), hash(repo.id).slice(0,16), commit);
    const existing = await lstat(target).catch(error => {if(error.code !== "ENOENT") throw error; return null;});
    if (!existing) {
      await mkdir(path.dirname(target), {recursive:true});
      await this.command(repo.path, ["worktree", "add", "--detach", target, commit]);
    }
    assert(await this.command(target, ["rev-parse", "HEAD"]) === commit &&
      !(await this.command(target, ["status", "--porcelain"])), "Analysis snapshot changed; restore its clean baseline before reuse");
    return {repoId:repo.id, branch, remote:"origin", commit, path:target, fetchedAt:new Date().toISOString()};
  }
  async designMetadata(repo) {
    if (!this.git.runner)
      return {
        repoId: repo.id,
        status: "NOT_VERIFIED",
        configuredBase: repo.baseBranch,
      };
    const base = repo.baseBranch || repo.defaultBranch;
    if (!base)
      return {
        repoId: repo.id,
        status: "NOT_VERIFIED",
        reason: "Configured base branch missing",
      };
    await this.ref(repo.path, base);
    const read = (args) =>
      this.git.runner("git", args, {
        cwd: repo.path,
        env: { GIT_OPTIONAL_LOCKS: "0" },
        timeoutMs: 5000,
        maxOutput: 8192,
      });
    const results = await Promise.all([
      read(["rev-parse", "--show-toplevel"]),
      read(["branch", "--show-current"]),
      read(["rev-parse", "--verify", "HEAD"]),
      read(["status", "--porcelain=v1"]),
      read(["rev-parse", "--verify", `refs/heads/${base}^{commit}`]),
      read(["rev-parse", "--verify", `refs/remotes/origin/${base}^{commit}`]),
    ]);
    const [root, current, head, status, local, remote] = results;
    return {
      repoId: repo.id,
      status: results.slice(0, 4).every((r) => r.code === 0)
        ? "VERIFIED"
        : "NOT_VERIFIED",
      gitRoot: root.stdout.trim(),
      configuredBase: base,
      currentBranch: current.stdout.trim(),
      head: head.stdout.trim(),
      dirty: status.code === 0 ? Boolean(status.stdout.trim()) : null,
      localBase: local.code === 0 ? local.stdout.trim() : null,
      remoteBase: remote.code === 0 ? remote.stdout.trim() : null,
      baseDiverges:
        local.code === 0 &&
        remote.code === 0 &&
        local.stdout.trim() !== remote.stdout.trim(),
      baseResolution: repo.baseResolution || null,
      informationalOnly: true,
    };
  }
  async base(repo, target = repo.baseBranch) {
    await this.ref(repo.path, target);
    const local = await this.command(
      repo.path,
      ["rev-parse", "--verify", `refs/heads/${target}^{commit}`],
      true,
    );
    const remote = await this.command(
      repo.path,
      ["rev-parse", "--verify", `refs/remotes/origin/${target}^{commit}`],
      true,
    );
    assert(
      local.code === 0 || remote.code === 0,
      `Branch ${target} is unavailable locally; fetch the repository first`,
    );
    if (
      target === repo.baseBranch &&
      local.code === 0 &&
      remote.code === 0 &&
      local.stdout.trim() !== remote.stdout.trim()
    ) {
      assert(
        ["local", "origin"].includes(repo.baseResolution),
        `Configured base ${target} differs from origin/${target}; explicitly configure baseResolution as local or origin before creating task worktrees. No fetch, checkout or reset was performed.`,
      );
      return (repo.baseResolution === "origin" ? remote : local).stdout.trim();
    }
    return (local.code === 0 ? local : remote).stdout.trim();
  }
  owner(repo, branch) {
    return this.store.get("branches", hash(`${repo.id}:${branch}`));
  }
  async prepare(quest, repo, workId, task, baseCommit) {
    const identity = this.identity(quest, repo, task);
    assert(
      !this.protected(repo, identity.branch),
      "Generated branch matches protected branch policy",
    );
    await this.ref(repo.path, identity.branch);
    const owner = this.owner(repo, identity.branch);
    assert(
      !owner ||
        (owner.questId === quest.id &&
          owner.workId === workId &&
          owner.taskId === task?.id &&
          owner.path === identity.path),
      "Branch ownership mismatch",
    );
    const existing = await this.command(
      repo.path,
      ["show-ref", "--verify", "--quiet", `refs/heads/${identity.branch}`],
      true,
    );
    assert(
      owner || existing.code === 1,
      "Refusing to take ownership of an existing branch",
    );
    let present = false;
    try {
      const info = await lstat(identity.path);
      assert(!info.isSymbolicLink(), "Refusing symbolic worktree path");
      present = true;
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
    }
    if (!owner)
      this.store.put("branches", {
        id: hash(`${repo.id}:${identity.branch}`),
        repoId: repo.id,
        questId: quest.id,
        taskId: task?.id,
        workId,
        ...identity,
        baseCommit,
        state: "PREPARING",
      });
    if (present) await this.git.reconcile({ repoPath: repo.path, ...identity });
    else {
      assert(
        existing.code === 1,
        "Owned branch exists but worktree is missing; restore it before resuming to preserve changes",
      );
      await this.command(repo.path, [
        "worktree",
        "add",
        "-b",
        identity.branch,
        identity.path,
        baseCommit,
      ]);
      await this.git.reconcile({ repoPath: repo.path, ...identity });
    }
    this.store.put("branches", {
      ...this.owner(repo, identity.branch),
      state: "READY",
    });
    return identity;
  }
  async inspect(repo, workspace) {
    const owner = this.owner(repo, workspace.branch);
    assert(
      owner &&
        owner.path === workspace.path &&
        !this.protected(repo, workspace.branch),
      "Workspace ownership or branch policy violation",
    );
    await this.git.reconcile({
      repoPath: repo.path,
      path: workspace.path,
      branch: workspace.branch,
    });
    return this.git.inspect(
      workspace.path,
      (workspace.targetRecovery && workspace.targetRecovery.target === workspace.prTarget && workspace.targetRecovery.targetHead) || await this.base(repo, workspace.prTarget || repo.prTarget),
    );
  }
  async commit(repo, workspace, message) {
    const state = await this.inspect(repo, workspace);
    assert(
      !(await this.command(workspace.path, ["ls-files", "-u"])),
      "Unresolved merge conflicts",
    );
    if (state.dirty) await this.git.commit(workspace.path, message);
    const after = await this.inspect(repo, workspace);
    assert(!after.dirty, "Commit left changes in the workspace");
    return after.head;
  }
  async integrate(repo, work, task, validatedRepair) {
    const current = await this.inspect(repo, work);
    const pending = await this.command(
      work.path,
      ["rev-parse", "--verify", "MERGE_HEAD"],
      true,
    );
    const repair = work.integration?.repairBase;
    const ownedRepair = validatedRepair?.passed === true &&
      validatedRepair.head === current.head && validatedRepair.fingerprint === current.fingerprint &&
      work.integration.taskId === task.id && repair?.clean === true &&
      repair.taskCommit === task.commit && repair.head === current.head;
    assert(
      !current.dirty ||
        ownedRepair ||
        (pending.code === 0 &&
          work.integration?.taskId === task.id &&
          pending.stdout.trim() === task.commit),
      "Integration worktree contains unrelated changes",
    );
    const already = await this.command(
      work.path,
      ["merge-base", "--is-ancestor", task.commit, "HEAD"],
      true,
    );
    if (already.code === 0) {
      if (current.dirty && pending.code !== 0) {
        assert(ownedRepair, "Integration edits lack a validated repair baseline; review preserved changes before retrying");
        return this.commit(repo,work,`chore : repair integration ${task.key} (${work.branch})`);
      }
      return current.head;
    }
    assert(already.code === 1, "Cannot inspect task integration ancestry");
    if (pending.code === 0) {
      assert(
        work.integration?.taskId === task.id &&
          pending.stdout.trim() === task.commit,
        "Unexpected pending merge; manual recovery required",
      );
      assert(
        !(await this.command(work.path, ["ls-files", "-u"])),
        "Integration has unresolved merge conflicts",
      );
      return this.commit(
        repo,
        work,
        `chore : integrate ${task.key} (${work.branch})`,
      );
    }
    const merged = await this.command(
      work.path,
      [
        "merge",
        "--no-ff",
        "--no-edit",
        "-m",
        `chore : integrate ${task.key} (${work.branch})`,
        task.commit,
      ],
      true,
    );
    assert(
      merged.code === 0,
      `Integration conflict; worktrees and commits preserved: ${(merged.stderr || merged.stdout).slice(-2000)}`,
    );
    return (await this.inspect(repo, work)).head;
  }
  async target(repo, work, target) {
    let targetHead;
    if (work.targetRecovery?.target === target) {
      await this.command(repo.path,["fetch","--no-tags","origin",`refs/heads/${target}:refs/remotes/origin/${target}`]);
      targetHead=await this.command(repo.path,["rev-parse","--verify",`refs/remotes/origin/${target}^{commit}`]);
    } else targetHead = await this.base(repo, target);
    const related = await this.command(
      work.path,
      ["merge-base", work.baseCommit, targetHead],
      true,
    );
    assert(
      related.code === 0 && related.stdout.trim(),
      "PR target has unrelated history",
    );
    assert(
      (
        await this.command(
          work.path,
          ["merge-base", "--is-ancestor", targetHead, "HEAD"],
          true,
        )
      ).code === 0,
      "PR target contains unintegrated changes; integrate its updates and revalidate before creating a PR",
    );
    return targetHead;
  }
  async pushPolicy(repo, work) {
    await this.inspect(repo, work);
    assert(
      !this.protected(repo, work.branch),
      "Cannot push a protected branch",
    );
  }
}

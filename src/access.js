import path from "node:path";
import { homedir } from "node:os";
import { constants } from "node:fs";
import { access, realpath, readdir, open, stat } from "node:fs/promises";

// Check the filesystem and the exact grants, never infer access from registry status.
export async function preflightAccess(scope, checkAccess = access) {
  const entries = [];
  for (const required of scope.repositories) {
    const entry = { ...required, status: "FAILED" };
    entries.push(entry);
    try {
      if (!path.isAbsolute(required.path))
        throw new Error("Absolute repository path required");
      entry.canonicalPath = await realpath(required.path);
      if (entry.canonicalPath === path.parse(entry.canonicalPath).root)
        throw new Error("Filesystem root cannot be an agent workspace");
      if (!(await stat(entry.canonicalPath)).isDirectory())
        throw new Error("Repository path is not a directory");
      await checkAccess(entry.canonicalPath, constants.R_OK | constants.X_OK);
      const children = await readdir(entry.canonicalPath, {
        withFileTypes: true,
      });
      const file =
        children.find(
          (child) =>
            child.isFile() &&
            /^(go\.mod|package\.json|README(?:\.md)?)$/i.test(child.name),
        ) ||
        children.find((child) => child.isFile() && !child.name.startsWith("."));
      if (file) {
        const handle = await open(
          path.join(entry.canonicalPath, file.name),
          "r",
        );
        try {
          await handle.read(Buffer.alloc(1), 0, 1, 0);
        } finally {
          await handle.close();
        }
        entry.readProbe = file.name;
      }
      entry.status = "PASSED";
    } catch (error) {
      entry.category = ["EACCES", "EPERM"].includes(error.code)
        ? "OS_FILESYSTEM_DENIAL"
        : "INVALID_REPOSITORY_PATH";
      entry.error = `${error.code || "ACCESS_ERROR"}: ${error.message}`;
    }
  }
  const preflight = {
    status: entries.every((entry) => entry.status === "PASSED")
      ? "PASSED"
      : "FAILED",
    readOnly: scope.readOnly,
    runtimeToolRead: "NOT_VERIFIED",
    repositories: entries,
  };
  if (preflight.status === "FAILED") {
    const failed = entries.filter((entry) => entry.status === "FAILED");
    const error = new Error(
      `Repository access preflight failed: ${failed.map((entry) => `${entry.name || entry.id || entry.path} (${entry.path}): ${entry.error}`).join("; ")}. Restore the registered path and OS read/traverse permissions, then retry. No reasoning was started.`,
    );
    error.accessPreflight = preflight;
    throw error;
  }
  const cwd = await realpath(scope.cwd);
  if (!scope.readOnly && (scope.forbiddenWriteDirectories || []).includes(cwd))
    throw new Error(
      "Developer writes to original repositories are forbidden; use the assigned task worktree",
    );
  if (!entries.some((entry) => entry.canonicalPath === cwd))
    throw new Error(
      "Agent working directory is outside its assigned repository access scope",
    );
  return {
    ...preflight,
    cwd,
    additionalDirectories: [
      ...new Set(entries.map((entry) => entry.canonicalPath)),
    ].filter((directory) => directory !== cwd),
  };
}

// Classify only an actual failed tool result, never the agent's explanation.
export function classifyToolDenial(tool, detail, preflight) {
  const target = tool?.target || "Path not reported";
  const absolute = target.startsWith("~/")
    ? path.join(homedir(), target.slice(2))
    : path.resolve(preflight.cwd, target);
  const roots = preflight.repositories.flatMap((repo) => [
    repo.canonicalPath,
    repo.path,
  ]);
  const inside = (root, candidate) => {
    const relative = path.relative(root, candidate);
    return (
      relative === "" ||
      (!relative.startsWith(`..${path.sep}`) &&
        relative !== ".." &&
        !path.isAbsolute(relative))
    );
  };
  const selected = roots.some((root) => inside(root, absolute));
  const parent = !selected && roots.some((root) => inside(absolute, root));
  const category =
    !tool || !["Read", "Glob", "Grep"].includes(tool.operation)
      ? "AGENT_UNAUTHORIZED_OPERATION"
      : parent
        ? "DISALLOWED_PARENT_TRAVERSAL"
        : !selected
          ? "AGENT_UNAUTHORIZED_OPERATION"
          : "RUNTIME_SANDBOX_DENIAL";
  const remediation = parent
    ? "Retry repository-scoped inspection: inspect each absolute registered root directly; never enumerate their parent. No broader access is needed."
    : !selected
      ? "Use only the selected repository roots. Register and select another repository explicitly if required; no access was granted."
      : "The selected root is granted but its tool call was denied. Check Claude managed permissions and filesystem access; do not expand the scope or disable restricted mode.";
  return {
    category,
    operation: tool?.operation || "UNKNOWN",
    ...(tool?.pattern ? { pattern: tool.pattern } : {}),
    target,
    resolvedTarget: absolute,
    detail,
    remediation,
  };
}

export function repositoryInspectionInstructions(preflight) {
  const roots = preflight.repositories.map((repo) => ({
    id: repo.id,
    name: repo.name,
    gitRoot: repo.canonicalPath,
    readExample: path.join(repo.canonicalPath, repo.readProbe || "README.md"),
  }));
  return `Repository-scoped inspection: ${JSON.stringify(roots)}. For EACH selected repository use Read with an absolute file_path, Glob with path set to that exact gitRoot and a relative pattern, or Grep with path inside that gitRoot. Never discover repositories by listing/globbing their common parent, using .., ~, an unselected sibling, or the filesystem root. These are the complete selected roots; do not search for them. The working directory is ${JSON.stringify(preflight.cwd)}; the other roots are explicit additional grants. Do not request broader permissions. Registered baseBranch values are explicit; never substitute the current checkout branch. Quote actual tool denials; never claim analysis of unread files.`;
}

export function verifyClaudeGrants(args, preflight) {
  const grants = [preflight.cwd];
  for (let i = 0; i < args.length; i++)
    if (args[i] === "--add-dir")
      while (args[i + 1] && !args[i + 1].startsWith("--"))
        grants.push(args[++i]);
  const missing = preflight.repositories.filter(
    (repo) => !grants.includes(repo.canonicalPath),
  );
  const extra = grants.filter(
    (grant) =>
      !preflight.repositories.some((repo) => repo.canonicalPath === grant),
  );
  if (missing.length || extra.length)
    throw Object.assign(
      new Error(
        missing.length
          ? `Missing repository grant: ${missing.map((repo) => repo.name || repo.canonicalPath).join(", ")}. Rebuild the selected-directory CLI grants before starting.`
          : "Unauthorized directory grant: only selected repository roots may be permitted",
      ),
      {
        accessCategory: missing.length
          ? "MISSING_REPOSITORY_GRANT"
          : "UNAUTHORIZED_DIRECTORY_GRANT",
      },
    );
  return grants;
}

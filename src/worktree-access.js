import { execFileSync } from "node:child_process";
import { lstatSync, realpathSync } from "node:fs";
import path from "node:path";

export function worktreeHistoryReferences(cwd, run = execFileSync) {
  try {
    if (!lstatSync(path.join(cwd,".git")).isFile()) return [];
    const gitDir = run("git",["rev-parse","--absolute-git-dir"],{
      cwd,encoding:"utf8",timeout:3000,stdio:["ignore","pipe","pipe"],
    }).trim();
    const head = realpathSync(path.join(gitDir,"logs","HEAD"));
    if (path.basename(head) !== "HEAD") return [];
    return [{id:"assigned-worktree-history",name:"Assigned worktree HEAD history (read-only)",path:path.dirname(head),allowedFiles:["HEAD"]}];
  } catch { return []; }
}

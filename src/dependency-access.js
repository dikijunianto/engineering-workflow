import { existsSync, realpathSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";

// Dependencies are references, never additional writable workspaces.
export function goDependencyReferences(cwd, run = execFileSync) {
  if (!existsSync(path.join(cwd, "go.mod"))) return [];
  let cache;
  try {
    cache = run("go", ["env", "GOMODCACHE"], {
      cwd, encoding:"utf8", timeout:3000,
      env:{...process.env,GOTOOLCHAIN:"local",GOPROXY:"off",GOSUMDB:"off"},
      stdio:["ignore","pipe","pipe"],
    }).trim();
  } catch { return []; }
  if (!path.isAbsolute(cache) || !existsSync(cache)) return [];
  cache = realpathSync(cache);
  if (cache === path.parse(cache).root || !statSync(cache).isDirectory()) return [];
  return [{id:"go-module-cache",name:"Installed Go module dependencies (read-only)",path:cache}];
}

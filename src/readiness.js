import { readdirSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { modelId } from "./routing.js";

const root = fileURLToPath(new URL("../", import.meta.url));
export function sourceBuild() {
  const files = ["package.json", "public/app.js", "public/style.css", "public/index.html", "public/dashboard.js", "public/dashboard.css",
    ...readdirSync(path.join(root, "src")).filter((name) => name.endsWith(".js")).sort().map((name) => `src/${name}`)];
  const digest = createHash("sha256");
  for (const file of files) digest.update(file).update(readFileSync(path.join(root, file)));
  return digest.digest("hex");
}
export const loadedBuild = sourceBuild();
export function buildStatus() {
  try { const diskBuild = sourceBuild(); return { loadedBuild, diskBuild, restartRequired: loadedBuild !== diskBuild }; }
  catch { return { loadedBuild, restartRequired: true }; }
}

// Fixed CLI status probes only: no inference, arbitrary commands or integration writes.
export async function readiness(engine, p) {
  const rows = [];
  const add = (check, status, detail, remediation = "") => rows.push({ check, status, detail, remediation });
  const build = buildStatus();
  add("Application", build.restartRequired ? "FAILED" : "PASSED", build.restartRequired ? "Loaded backend differs from files on disk" : "Loaded backend matches files on disk", build.restartRequired ? "Restart DevQuest and reload this page." : "");
  const names = p.runtime ? [p.runtime] : ["claude", "codex"];
  if (!names.every((name) => ["claude", "codex"].includes(name))) throw new Error("Unsupported runtime");
  for (const name of names) {
    const runtime = engine.adapters.runtimes[name];
    let caps;
    try { caps = await runtime?.detectCapabilities(); } catch { /* Report safe status, never raw credential-bearing output. */ }
    add(`${name} CLI`, caps?.available ? "PASSED" : "FAILED", caps?.available ? caps.version || "Required CLI flags available" : "Runtime unavailable or required flags unsupported", caps?.available ? "" : "Install or update the configured CLI, then restart DevQuest.");
    let authenticated = false, checked = false;
    if (caps?.available && runtime?.runner && runtime.executable) {
      try {
        const result = await runtime.runner(runtime.executable, name === "claude" ? ["auth", "status", "--json"] : ["login", "status"], { timeoutMs: 5000, maxOutput: 16000, env: runtime.env });
        if (name === "claude") { const data = JSON.parse(result.stdout); checked = typeof data.loggedIn === "boolean"; authenticated = result.code === 0 && data.loggedIn === true; }
        else { checked = result.code === 0 && /logged in/i.test(result.stdout + result.stderr); authenticated = checked; }
      } catch { /* Unknown remains unknown; auth payloads are never retained. */ }
    }
    add(`${name} authentication`, checked ? authenticated ? "PASSED" : "FAILED" : "NOT_VERIFIED", authenticated ? "CLI reports authenticated; model entitlement not verified" : "Authentication could not be confirmed", authenticated ? "" : "Check CLI login in your terminal; no model call was made.");
    const models = (engine.adapters.config?.orchestration?.models || []).filter((model) => model.runtime === name && model.available && model.verified);
    const permitted = models.filter((model) => { try { modelId(model.id); return Array.isArray(model.efforts) && model.efforts.length; } catch { return false; } });
    const route = runtime?.defaultRoute;
    if (route) {
      const selected = permitted.find((model) => model.id === route.resolvedModel);
      const compatible = selected?.efforts.includes(route.resolvedEffort);
      add(`${name} default route`, compatible ? "PASSED" : "FAILED",
        `Requested ${route.requestedModel || route.resolvedModel} / ${route.requestedEffort || route.resolvedEffort}; resolved ${route.resolvedModel} / ${route.resolvedEffort}`,
        compatible ? "" : "Select an explicitly permitted model and supported effort. No automatic substitution was attempted.");
    }
    add(`${name} model policy`, permitted.length ? "PASSED" : "FAILED", permitted.length ? permitted.map((model) => `${model.id}: ${model.efforts.join(", ")}`).join("; ") : "No verified permitted models and efforts", permitted.length ? "" : "Verify the explicit model registry; no model will be substituted.");
  }
  if (p.questId) {
    const quest = engine.get("quests", p.questId);
    try {
      const result = await engine.room.action("PREVIEW_QUEST_ACCESS", { ...p, role: p.role || "architect" });
      for (const repo of result.preflight.repositories) add(`Repository: ${repo.name || repo.id}`, "PASSED", repo.canonicalPath);
    } catch (error) {
      add("Repository scope", "FAILED", error.message, "Restore registered roots or select the assigned task worktree, then check again.");
    }
    for (const runtime of names) {
      try {
        const selected = engine.skills.resolve(quest, p.role || "architect", runtime);
        add(`${runtime} assigned skills`, "PASSED", selected.length ? selected.map((entry) => `${entry.pin.name}: source verified, guidance only`).join("; ") : "No registered guidance assigned to this role");
      } catch (error) { add(`${runtime} assigned skills`, "FAILED", error.message, "Reinspect and explicitly reassign the skill for this runtime."); }
    }
  }
  add("MCP and actual runtime tool access", "NOT_VERIFIED", "Checked separately by stage-specific launch preflights; configuration alone does not prove connection or permissions", "Use the stage preflight. This check starts no agent and grants no access.");
  return { checkedAt: new Date().toISOString(), status: rows.some((row) => row.status === "FAILED") ? "BLOCKED" : "CHECKS_PASSED_WITH_UNVERIFIED_ITEMS", rows, paidInvocation: false };
}

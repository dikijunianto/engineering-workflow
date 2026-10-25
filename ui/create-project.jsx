import React, { useState, useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import { FolderGit2, Plus, Check, SlidersHorizontal, Link2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "./components/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "./components/tabs";
import { Button } from "./components/button";
import { Input } from "./components/input";
import { Badge } from "./components/badge";

const control =
  "h-9 w-full rounded-md border border-input bg-zinc-950 px-3 py-1 text-sm leading-5 text-zinc-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-emerald-400 disabled:opacity-50";
const label = "grid min-w-0 gap-2 text-sm font-medium text-zinc-300";
const roles = ["architect", "planner", "developer", "reviewer", "orchestrator"];
export function permittedModels(registry, runtime) {
  return (registry || []).filter(
    (model) =>
      model.available && model.verified && model.runtime === runtime && !/fable/i.test(model.id),
  );
}
export function inheritedJira(workspace, repositoryIds) {
  const matches = Object.values(workspace.projects || {}).filter((project) =>
    project.repositoryIds?.some((id) => repositoryIds.includes(id)),
  );
  return matches.length > 1 ? "" : matches[0]?.project || workspace.defaultProject || "";
}
function Field({ title, children }) {
  return (
    <label className={label}>
      {title}
      {children}
    </label>
  );
}
function Routing({ state, custom }) {
  const [runtime, setRuntime] = useState("claude");
  const [overrides, setOverrides] = useState({
    orchestrator: { runtime: "claude", model: "claude-opus-5-5", effort: "high" },
  });
  const change = (role, update) =>
    setOverrides((previous) => ({ ...previous, [role]: { ...previous[role], ...update } }));
  return (
    <fieldset disabled={!custom} hidden={!custom} className="min-w-0 space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field title="Project runtime">
          <select
            className={control}
            name="executionRuntime"
            value={runtime}
            onChange={(e) => {
              setRuntime(e.target.value);
              setOverrides({ orchestrator: overrides.orchestrator });
            }}
          >
            <option value="claude">Claude Code</option>
            <option value="codex">Codex</option>
          </select>
        </Field>
        <Field title="Routing policy">
          <select name="routingMode" className={control}>
            <option value="dynamic">Dynamic · complexity-aware</option>
            <option value="manual">Manual · configured model</option>
          </select>
        </Field>
        <Field title="Project model">
          <select key={runtime} name="executionModel" className={control}>
            <option value="">Inherit policy</option>
            {permittedModels(state.modelRegistry, runtime).map((model) => (
              <option key={model.id}>{model.id}</option>
            ))}
          </select>
        </Field>
        <Field title="Project effort">
          <select name="executionEffort" className={control}>
            <option>high</option>
            <option>medium</option>
            <option>low</option>
          </select>
        </Field>
      </div>
      <div className="overflow-x-auto rounded-lg border border-zinc-800">
        <table className="dq-routing-table w-full min-w-[560px] text-left text-xs">
          <caption className="sr-only">Agent routing overrides</caption>
          <thead className="bg-zinc-950/50 text-zinc-400">
            <tr>
              {["Agent", "Runtime", "Model", "Effort"].map((heading) => (
                <th key={heading} className="p-3 font-medium">
                  {heading}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {roles.map((role) => {
              const value = overrides[role] || {};
              const effectiveRuntime =
                value.runtime && value.runtime !== "inherit" ? value.runtime : runtime;
              const models = permittedModels(state.modelRegistry, effectiveRuntime);
              const efforts = models.find((model) => model.id === value.model)?.efforts || [];
              return (
                <tr key={role} className="border-t border-zinc-800">
                  <th scope="row" className="p-3 font-medium capitalize text-zinc-300">
                    {role}
                  </th>
                  <td className="p-2">
                    <select
                      aria-label={`${role} runtime`}
                      name={`${role}Runtime`}
                      className={control}
                      value={value.runtime || "inherit"}
                      onChange={(e) =>
                        change(role, { runtime: e.target.value, model: "", effort: "" })
                      }
                    >
                      {role !== "orchestrator" && <option value="inherit">Inherit</option>}
                      <option value="claude">Claude</option>
                      <option value="codex">Codex</option>
                    </select>
                  </td>
                  <td className="max-w-56 p-2">
                    <select
                      aria-label={`${role} model`}
                      name={`${role}Model`}
                      className={control}
                      value={value.model || ""}
                      onChange={(e) => change(role, { model: e.target.value, effort: "" })}
                    >
                      <option value="">
                        {role === "orchestrator"
                          ? "Existing orchestrator default"
                          : "Inherit policy"}
                      </option>
                      {value.model && !models.some((m) => m.id === value.model) && (
                        <option value={value.model} disabled>
                          {value.model} · unavailable
                        </option>
                      )}
                      {models.map((model) => (
                        <option key={model.id}>{model.id}</option>
                      ))}
                    </select>
                  </td>
                  <td className="p-2">
                    <select
                      aria-label={`${role} effort`}
                      name={`${role}Effort`}
                      className={control}
                      value={value.effort || ""}
                      onChange={(e) => change(role, { effort: e.target.value })}
                    >
                      <option value="">Inherit policy</option>
                      {[...new Set([...efforts, ...(value.effort ? [value.effort] : [])])].map(
                        (effort) => (
                          <option key={effort}>{effort}</option>
                        ),
                      )}
                    </select>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-xs leading-5 text-zinc-400">
        Only verified, permitted models are listed. Availability and effort are checked again before
        execution; creating a project starts no agent.
      </p>
      <details className="rounded-lg border border-zinc-800 p-3">
        <summary className="cursor-pointer text-sm text-zinc-400">Budgets & review handoff</summary>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field title="Parallel developers">
            <Input
              name="developerLimit"
              type="number"
              min="1"
              max={state.settings.maxDeveloperAgents || 5}
              defaultValue={state.settings.maxDeveloperAgents || 5}
            />
          </Field>
          <Field title="Task runtime (minutes)">
            <Input name="taskMinutes" type="number" min="1" max="240" defaultValue="60" />
          </Field>
          <div className="sm:col-span-2">
            <Field title="Human PR reviewers">
              <Input name="humanReviewers" placeholder="backend-lead, payment-owner" />
            </Field>
          </div>
          <label className="flex items-start gap-2 text-xs text-zinc-400 sm:col-span-2">
            <input type="checkbox" name="allowAutoPr" className="mt-1 accent-emerald-400" />
            Permit PR creation after validated independent review in Autonomous mode. Never merges,
            deploys or publishes Jira issues.
          </label>
        </div>
      </details>
    </fieldset>
  );
}
export function CreateProjectForm({ state, jiraDefault, onCreate, onClose, busy, setBusy }) {
  const workspace = state.settings.jiraWorkspace || { projects: {} };
  const initial = workspace.projects[jiraDefault] || {};
  const [tab, setTab] = useState("details"),
    [kind, setKind] = useState("PRODUCT"),
    [source, setSource] = useState("text"),
    [repos, setRepos] = useState([]),
    [jira, setJira] = useState(Boolean(initial.project)),
    [project, setProject] = useState(jiraDefault || ""),
    [jiraOverride, setJiraOverride] = useState(false),
    [custom, setCustom] = useState(false),
    [error, setError] = useState("");
  const config = workspace.projects[project] || { project };
  const bodyRef = useRef(null);
  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = 0;
  }, [tab]);
  const applyRepos = (next) => {
    setRepos(next);
    if (!jiraOverride) setProject(inheritedJira(workspace, next));
  };
  const chooseRepo = (id) => {
    const next = repos.includes(id) ? repos.filter((value) => value !== id) : [...repos, id];
    applyRepos(next);
  };
  async function submit(event) {
    event.preventDefault();
    event.stopPropagation();
    if (busy) return;
    const form = event.currentTarget,
      invalid = form.querySelector(":invalid");
    if (invalid) {
      setTab(invalid.closest("[data-tab]")?.dataset.tab || "details");
      setError(
        `${invalid.labels?.[0]?.firstChild?.textContent?.trim() || "A required field"}: ${invalid.validationMessage}`,
      );
      requestAnimationFrame(() => {
        for (let ancestor = invalid.parentElement; ancestor; ancestor = ancestor.parentElement)
          if (ancestor.tagName === "DETAILS") ancestor.open = true;
        invalid.focus();
      });
      return;
    }
    if (!repos.length) {
      setTab("details");
      setError("Select at least one affected repository.");
      return;
    }
    if (!form.elements.title.value.trim()) {
      setTab("details");
      setError("Enter a project title.");
      return;
    }
    setError("");
    setBusy(true);
    try {
      await onCreate(new FormData(form));
      onClose();
    } catch (reason) {
      if (/jira|epic/i.test(reason.message || "")) setTab("jira");
      setError(reason.message || "Project could not be created. Try again.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <form
      data-form="react-create-project"
      onSubmit={submit}
      noValidate
      onChange={(event) => {
        event.stopPropagation();
        setError("");
      }}
      className="flex min-h-0 flex-1 flex-col overflow-hidden"
    >
      <Tabs value={tab} onValueChange={setTab} className="flex min-h-0 flex-1 flex-col">
        <div className="shrink-0 border-b border-zinc-800 px-5 py-3 sm:px-6">
          <TabsList
            aria-label="Create project sections"
            className="grid h-auto w-full grid-cols-3 gap-1 bg-zinc-950/50"
          >
            <TabsTrigger className="whitespace-normal px-2 text-xs" value="details">
              Project Details
            </TabsTrigger>
            <TabsTrigger className="whitespace-normal px-2 text-xs" value="jira">
              Jira & Sync
            </TabsTrigger>
            <TabsTrigger className="flex-wrap whitespace-normal gap-1 px-2 text-xs" value="ai">
              AI Execution Settings
              <Badge variant="outline" className="text-[9px] font-normal">
                {custom ? "Custom routing" : "Defaults applied"}
              </Badge>
            </TabsTrigger>
          </TabsList>
        </div>
        <div
          ref={bodyRef}
          className="dq-project-body min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-5 sm:px-6"
        >
          <TabsContent
            forceMount
            hidden={tab !== "details"}
            value="details"
            data-tab="details"
            className="mt-0 space-y-5 pr-2"
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <Field title="Project Type">
                <select
                  name="kind"
                  value={kind}
                  onChange={(e) => setKind(e.target.value)}
                  className={control}
                >
                  <option value="PRODUCT">Feature</option>
                  <option value="BUG">Bug Fix</option>
                  <option value="TECH">Technical Task</option>
                </select>
              </Field>
              <Field title="Sprint Name">
                <Input name="sprint" maxLength="80" placeholder="Sprint 42" />
              </Field>
            </div>
            <Field title="Title">
              <Input name="title" required maxLength="160" placeholder="What are we building?" />
            </Field>
            <Field title="Requirements / PRD Context">
              <textarea
                name="content"
                rows="4"
                className="min-h-28 w-full resize-y rounded-md border border-input bg-zinc-950 px-3 py-2 font-mono text-sm text-zinc-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-emerald-400"
                placeholder={
                  kind === "BUG"
                    ? "Actual behavior, expected behavior, reproduction steps and constraints…"
                    : "Describe the problem, desired outcome and constraints…"
                }
              />
            </Field>
            <details className="rounded-lg border border-zinc-800 p-3">
              <summary className="cursor-pointer text-xs text-zinc-400">
                Import context from a file or Confluence
              </summary>
              <div className="mt-4 space-y-3">
                <Field title="Context source">
                  <select
                    className={control}
                    name="sourceType"
                    value={source}
                    onChange={(e) => setSource(e.target.value)}
                  >
                    <option value="text">Text above</option>
                    <option value="file">Local file (.md, .txt, .pdf, .docx)</option>
                    <option value="confluence">Confluence page</option>
                  </select>
                </Field>
                <label hidden={source !== "file"} className={label}>
                  Choose a file
                  <Input
                    name="file"
                    type="file"
                    accept=".md,.txt,.pdf,.docx"
                    disabled={source !== "file"}
                    required={source === "file"}
                  />
                  <span className="text-xs text-zinc-400">Maximum 8 MB. Text PDFs only.</span>
                </label>
                <label hidden={source !== "confluence"} className={label}>
                  Confluence page URL
                  <Input
                    name="url"
                    type="url"
                    placeholder="https://company.atlassian.net/wiki/spaces/…"
                    disabled={source !== "confluence"}
                    required={source === "confluence"}
                  />
                  <span className="text-xs text-zinc-400">
                    Main page plus directly linked pages only.
                  </span>
                </label>
              </div>
            </details>
            <fieldset className="space-y-3 rounded-lg border border-zinc-800 bg-zinc-950/60 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <legend className="text-sm font-medium text-zinc-200">
                  Affected Repositories <span className="text-emerald-400">*</span>
                </legend>
                <div className="flex items-center gap-2">
                  <Badge
                    variant="outline"
                    className={
                      repos.length > 0
                        ? "border-emerald-500/40 bg-emerald-500/10 text-[11px] text-emerald-300"
                        : "border-amber-500/40 bg-amber-500/10 text-[11px] text-amber-300"
                    }
                  >
                    {repos.length} of {state.repositories.length} selected
                  </Badge>
                  {state.repositories.length > 1 && (
                    <div className="flex items-center gap-1 text-xs">
                      <button
                        type="button"
                        onClick={() => applyRepos(state.repositories.map((r) => r.id))}
                        className="rounded border border-zinc-700 bg-zinc-900 px-2 py-0.5 text-[11px] text-zinc-300 hover:bg-zinc-800"
                      >
                        Select all
                      </button>
                      {repos.length > 0 && (
                        <button
                          type="button"
                          onClick={() => applyRepos([])}
                          className="rounded border border-zinc-700 bg-zinc-900 px-2 py-0.5 text-[11px] text-zinc-400 hover:bg-zinc-800"
                        >
                          Clear
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
              <p className="text-xs text-zinc-400">
                Deliberate scope selection required. Agents can read and analyze only the repositories explicitly granted below.
              </p>
              <div className="flex flex-wrap gap-2">
                {state.repositories.map((repo) => {
                  const selected = repos.includes(repo.id);
                  return (
                    <label key={repo.id} className="relative cursor-pointer">
                      <input
                        className="peer sr-only"
                        type="checkbox"
                        name="repositoryIds"
                        value={repo.id}
                        checked={selected}
                        onChange={() => chooseRepo(repo.id)}
                      />
                      <span className="flex items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs text-zinc-300 transition-colors peer-checked:border-emerald-500/60 peer-checked:bg-emerald-500/15 peer-checked:text-emerald-200 peer-focus-visible:ring-2 peer-focus-visible:ring-emerald-400">
                        <FolderGit2 className={selected ? "size-3.5 text-emerald-400" : "size-3.5 text-zinc-400"} />
                        <span className="font-medium">{repo.name}</span>
                        <span className="font-mono text-[10px] text-zinc-400">
                          ({repo.baseBranch || repo.defaultBranch || "main"})
                        </span>
                        {selected && <Check className="size-3.5 text-emerald-400" />}
                      </span>
                    </label>
                  );
                })}
              </div>
              <div
                role="status"
                className={`rounded-md border px-3 py-2 text-xs ${
                  repos.length > 0
                    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
                    : "border-amber-500/30 bg-amber-500/10 text-amber-200"
                }`}
              >
                {repos.length > 0 ? (
                  <div className="space-y-1">
                    <p>
                      <strong>Readable scope ({repos.length}):</strong>{" "}
                      {state.repositories
                        .filter((r) => repos.includes(r.id))
                        .map((r) => r.name)
                        .join(", ")}
                    </p>
                    {state.repositories.some((r) => !repos.includes(r.id)) && (
                      <p className="text-[11px] text-zinc-300">
                        Excluded (no agent access):{" "}
                        {state.repositories
                          .filter((r) => !repos.includes(r.id))
                          .map((r) => r.name)
                          .join(", ")}
                      </p>
                    )}
                  </div>
                ) : (
                  <p>
                    No repositories granted yet. Select at least one repository above before creating the project.
                  </p>
                )}
              </div>
            </fieldset>
          </TabsContent>
          <TabsContent
            forceMount
            hidden={tab !== "jira"}
            value="jira"
            data-tab="jira"
            className="mt-0 space-y-5 pr-2"
          >
            <div className="flex items-center justify-between gap-4 rounded-lg border border-zinc-800 p-4">
              <div>
                <p className="flex items-center gap-2 text-sm font-medium">
                  <Link2 className="size-4" />
                  Link with Jira Issue / Epic
                </p>
                <p className="mt-1 text-xs text-zinc-400">
                  Optional. Creating a project never publishes Jira issues.
                </p>
              </div>
              <Button
                type="button"
                role="switch"
                aria-label="Link with Jira Issue / Epic"
                aria-checked={jira}
                variant="ghost"
                className={`h-6 w-11 shrink-0 rounded-full p-0 ${jira ? "bg-emerald-400 hover:bg-emerald-300" : "bg-zinc-700 hover:bg-zinc-600"}`}
                onClick={() => setJira(!jira)}
              >
                <span
                  className={`size-4 rounded-full bg-white transition-transform ${jira ? "translate-x-2" : "-translate-x-2"}`}
                />
              </Button>
            </div>
            {jira && <input type="hidden" name="jiraEnabled" value="on" />}
            {kind === "BUG" && (
              <Field title="Existing QA Jira issue">
                <Input
                  name="existingJiraKey"
                  required
                  placeholder="PROJECT-123"
                  pattern="[A-Za-z][A-Za-z0-9_]*-[0-9]+"
                  maxLength="100"
                />
                <span className="text-xs font-normal text-zinc-400">
                  Keeps the existing QA issue. No duplicate task is created.
                </span>
              </Field>
            )}
            <fieldset disabled={!jira} hidden={!jira} className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field title="Jira Project Key">
                  <Input
                    name="project"
                    required
                    value={project}
                    placeholder="FCAD"
                    onChange={(e) => {
                      setProject(e.target.value.toUpperCase());
                      setJiraOverride(true);
                    }}
                    list="create-jira-projects"
                  />
                  <datalist id="create-jira-projects">
                    {Object.keys(workspace.projects).map((key) => (
                      <option key={key}>{key}</option>
                    ))}
                  </datalist>
                </Field>
                <Field title="Epic Link (optional)">
                  <Input
                    key={`epic-${project}`}
                    name="epic"
                    placeholder={`${project || "PROJECT"}-123 or HTTPS Epic URL`}
                  />
                  <span className="text-xs font-normal text-zinc-400">
                    Use an Epic from {project || "the selected Jira project"}, as a key or an HTTPS
                    /browse/ URL.
                  </span>
                </Field>
                <Field title="Category Family">
                  <select
                    key={`family-${project}`}
                    name="categoryFamily"
                    defaultValue={config.categoryFamily || "BE"}
                    className={control}
                  >
                    <option>BE</option>
                    <option disabled value="FE">
                      FE · not supported by Jira integration
                    </option>
                    <option>MOB</option>
                    <option>ALL</option>
                  </select>
                </Field>
                <Field title="Assignee (optional)">
                  <Input
                    key={`assignee-${project}`}
                    name="assignee"
                    defaultValue={config.assignee || ""}
                  />
                </Field>
              </div>
              <details
                key={project}
                open={!config.siteUrl || !config.projectUrl}
                className="rounded-lg border border-zinc-800 p-3"
              >
                <summary className="cursor-pointer text-xs text-zinc-400">
                  Connection & inherited weight reference
                </summary>
                <div className="mt-4 space-y-4">
                  <Field title="Jira site URL">
                    <Input
                      name="siteUrl"
                      type="url"
                      required
                      defaultValue={config.siteUrl || ""}
                      placeholder="https://your-team.atlassian.net"
                    />
                  </Field>
                  <Field title="Jira project URL">
                    <Input
                      name="projectUrl"
                      type="url"
                      required
                      defaultValue={config.projectUrl || ""}
                    />
                  </Field>
                  <Field title="Atlassian MCP server">
                    <Input
                      name="mcpServer"
                      required
                      defaultValue={config.mcpServer || "atlassian"}
                    />
                  </Field>
                  <div className="grid grid-cols-2 gap-3">
                    {["V", "L", "M", "H"].map((level) => (
                      <Field key={level} title={`BE-${level} points`}>
                        <Input
                          name={`weight${level}`}
                          type="number"
                          min="1"
                          max="16"
                          defaultValue={config.backendWeights?.levels?.[level] || ""}
                        />
                      </Field>
                    ))}
                  </div>
                  <Input
                    name="weightVersion"
                    aria-label="Weight reference version"
                    defaultValue={config.backendWeights?.version || "1.0.0"}
                  />
                  <Input
                    name="weightScale"
                    aria-label="Weight scale"
                    defaultValue={config.backendWeights?.scale || "User Confirmed"}
                  />
                  <Field title="Weight reference / notes">
                    <textarea
                      name="weightReference"
                      rows="3"
                      className={`${control} h-auto py-2`}
                      defaultValue={config.weightReference || ""}
                    />
                  </Field>
                  <Field title="Metadata timeout (seconds)">
                    <Input
                      name="metadataTimeout"
                      type="number"
                      min="10"
                      max="120"
                      defaultValue={config.metadataPreferences?.timeoutSeconds || 60}
                    />
                  </Field>
                  <p className="text-xs text-zinc-400">
                    Existing Backend labels, option IDs and user-confirmed weights are preserved. FE
                    is unavailable in the current integration.
                  </p>
                </div>
              </details>
            </fieldset>
          </TabsContent>
          <TabsContent
            forceMount
            hidden={tab !== "ai"}
            value="ai"
            data-tab="ai"
            className="mt-0 space-y-5 pr-2"
          >
            <fieldset className="space-y-2">
              <legend className="mb-3 flex items-center gap-2 text-sm font-medium text-zinc-300">
                <SlidersHorizontal className="size-4" />
                Model routing
              </legend>
              {[
                [false, "Use Workspace Defaults", "Recommended"],
                [true, "Custom Model Routing", ""],
              ].map(([value, title, hint]) => (
                <label
                  key={title}
                  className={`flex cursor-pointer items-center gap-3 rounded-lg border p-3 text-sm ${custom === value ? "border-emerald-500/40 bg-emerald-500/5" : "border-zinc-800"}`}
                >
                  <input
                    type="radio"
                    name="modelRoutingChoice"
                    checked={custom === value}
                    onChange={() => setCustom(value)}
                    className="accent-emerald-400"
                  />
                  <span className="min-w-0 flex-1 text-left leading-5">{title}</span>
                  {hint && (
                    <Badge variant="outline" className="shrink-0 text-[10px] text-zinc-400">
                      {hint}
                    </Badge>
                  )}
                </label>
              ))}
            </fieldset>
            {!custom && (
              <p className="text-xs leading-5 text-zinc-400">
                Existing default routing and inherited role policies apply. No model overrides are
                added. Runtime availability is checked before any agent starts.
              </p>
            )}
            <Field title="Workflow mode">
              <select name="executionMode" className={control}>
                <option value="guided">Guided · manual approvals</option>
                <option value="autonomous">Autonomous after plan approval & Jira linking</option>
              </select>
            </Field>
            <Routing state={state} custom={custom} />
            <label className="flex items-start gap-2 text-xs leading-5 text-zinc-400">
              <input
                type="checkbox"
                name="agentProfilesEnabled"
                className="mt-1 accent-emerald-400"
              />
              <span className="min-w-0 flex-1 text-left">
                Enable versioned Agent Profiles using existing routing and permissions.
              </span>
            </label>
          </TabsContent>
        </div>
      </Tabs>
      <DialogFooter className="sticky bottom-0 z-10 shrink-0 flex-row flex-wrap items-center justify-end gap-3 border-t border-zinc-800 bg-zinc-900 px-5 py-4 sm:px-6">
        {error && (
          <div role="alert" className="max-h-16 w-full overflow-y-auto text-xs text-red-300">
            {error}
          </div>
        )}
        <Button
          type="button"
          variant="ghost"
          className="text-zinc-300 hover:bg-zinc-800"
          onClick={onClose}
          disabled={busy}
        >
          Cancel
        </Button>
        <Button
          type="submit"
          disabled={busy}
          className="rounded-lg bg-emerald-400 px-5 py-2 font-semibold text-zinc-950 hover:bg-emerald-300"
        >
          <Plus />
          {busy ? "Creating…" : "Create Project"}
        </Button>
      </DialogFooter>
    </form>
  );
}
function CreateProjectDialog(props) {
  const [open, setOpen] = useState(true),
    [busy, setBusy] = useState(false);
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!busy) setOpen(value);
      }}
    >
      <DialogContent
        className="dq-popup dq-create-project flex h-[min(760px,85vh)] max-h-[85vh] w-[calc(100%_-_2rem)] max-w-3xl flex-col gap-0 overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900 p-0 text-zinc-100 shadow-2xl"
        onEscapeKeyDown={(e) => {
          if (busy) e.preventDefault();
        }}
        onPointerDownOutside={(e) => e.preventDefault()}
      >
        <DialogHeader className="sticky top-0 z-10 shrink-0 border-b border-zinc-800 bg-zinc-900 px-5 py-5 text-left sm:px-6">
          <DialogTitle>Create Project</DialogTitle>
          <DialogDescription>
            Start from a PRD, technical task or existing QA issue.
          </DialogDescription>
        </DialogHeader>
        <CreateProjectForm
          {...props}
          busy={busy}
          setBusy={setBusy}
          onClose={() => setOpen(false)}
        />
      </DialogContent>
    </Dialog>
  );
}
let root;
export function openCreateProject(props) {
  if (!root) {
    const container = document.createElement("div");
    container.id = "create-project-dialog";
    document.body.append(container);
    root = createRoot(container);
  }
  root.render(<CreateProjectDialog key={Date.now()} {...props} />);
}

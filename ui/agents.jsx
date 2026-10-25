import React, { useEffect, useState } from "react";
import {
  Bot,
  Network,
  Blocks,
  ListChecks,
  Code2,
  ShieldCheck,
  Ticket,
  Terminal,
  Plus,
  Clock,
  FileText,
  Square,
  MoreHorizontal,
  PlugZap,
  ArrowRight,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "./components/card";
import { Button } from "./components/button";
import { Badge } from "./components/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "./components/dialog";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "./components/dropdown-menu";
import { agentRoles, agentRole, sessionGroups, roleMapping, duration } from "./agents-model";
const icons = {
  orchestrator: Network,
  architect: Blocks,
  planner: ListChecks,
  developer: Code2,
  reviewer: ShieldCheck,
  "jira-specialist": Ticket,
};
const runtimeName = (key) => key === "skill-bridge" ? "Local skill bridge" : (key === "claude" ? "Claude Code" : "Codex CLI");
const control = "mt-3 h-9 w-full rounded-md border border-input bg-zinc-950 px-3 py-1 text-sm";
function Status({ children, working = false }) {
  return (
    <Badge
      variant="outline"
      className={
        working
          ? "gap-1.5 border-emerald-500/20 bg-emerald-500/10 text-emerald-300"
          : "text-zinc-400"
      }
    >
      {working && <span className="size-1.5 animate-pulse rounded-full bg-emerald-400" />}
      {children}
    </Badge>
  );
}
function Session({ run, state, actions, onTerminate, now }) {
  const role = agentRoles.find((role) => role.key === agentRole(run));
  const quest = state.quests.find((quest) => quest.id === run.questId);
  const task = state.tasks.find((task) => task.id === run.taskId);
  return (
    <article className="rounded-lg border border-zinc-800 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="break-words text-sm font-medium">
            {quest?.title || "Project unavailable"}
          </h3>
          <p className="mt-1 text-xs text-zinc-400">
            {role.name} · {run.displayName || task?.title || run.purpose} ·{" "}
            {runtimeName(run.runtime)}
          </p>
        </div>
        <Status working={run.state === "RUNNING"}>{run.state.replaceAll("_", " ")}</Status>
      </div>
      <div className="mt-4 flex items-center justify-between gap-3 text-xs text-zinc-400">
        <span className="min-w-0 break-words">
          {actions.runProgress?.(run) || run.phase || run.purpose}
        </span>
        <span className="flex shrink-0 items-center gap-1 font-mono">
          <Clock className="size-3" />
          {duration(run, now)}
        </span>
      </div>
      {run.state === "RUNNING" && (
        <div
          role="progressbar"
          aria-label="Agent running; percentage not reported"
          className="mt-2 h-1 overflow-hidden rounded-full bg-zinc-800"
        >
          <div className="h-full w-1/3 animate-pulse rounded-full bg-emerald-400/70" />
        </div>
      )}
      <div className="mt-4 flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={() => actions.viewRun(run.id)}>
          <FileText />
          View Logs
        </Button>
        {run.state === "RUNNING" && (
          <Button
            variant="ghost"
            size="sm"
            className="text-red-300 hover:bg-red-500/10 hover:text-red-200"
            onClick={() => onTerminate(run.id)}
          >
            <Square />
            Terminate
          </Button>
        )}
        {run.state !== "RUNNING" && (
          <a
            href={`#quest/${run.questId}/overview`}
            className="inline-flex items-center gap-1 px-2 text-xs text-zinc-400 hover:text-white"
          >
            Open project
            <ArrowRight className="size-3" />
          </a>
        )}
      </div>
    </article>
  );
}
function RuntimeCard({ name, runtime = {}, check }) {
  const [busy, setBusy] = useState(false),
    [result, setResult] = useState(null),
    [error, setError] = useState("");
  const auth = result?.rows?.find((row) => row.check === `${name} authentication`);
  async function test() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      setResult(await check(name));
    } catch (reason) {
      setError(reason.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card className="border-zinc-800 bg-zinc-900">
      <CardHeader className="space-y-3 pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Terminal className="size-4 text-zinc-400" />
          <Badge
            variant="outline"
            className={
              runtime.available
                ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-300"
                : "text-zinc-400"
            }
          >
            {runtime.available
              ? "AVAILABLE"
              : runtime.available === false
                ? "UNAVAILABLE"
                : "NOT CHECKED"}
          </Badge>
        </div>
        <CardTitle className="text-sm">
          {name === "claude" ? "Claude Code CLI" : "Codex CLI"}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <dl className="space-y-3 text-xs">
          <div className="flex flex-wrap justify-between gap-2">
            <dt className="text-zinc-500">CLI version</dt>
            <dd className="max-w-full break-all font-mono text-zinc-300">
              {runtime.version || "Not reported"}
            </dd>
          </div>
          <div className="flex flex-wrap justify-between gap-2">
            <dt className="text-zinc-500">Authentication</dt>
            <dd className="text-zinc-300">
              {auth
                ? auth.status === "PASSED"
                  ? "Verified at last check"
                  : auth.status.replaceAll("_", " ")
                : "Not verified"}
            </dd>
          </div>
          <div className="flex flex-wrap justify-between gap-2">
            <dt className="text-zinc-500">Checkpoint resume</dt>
            <dd className="text-zinc-300">
              {runtime.nativeResume === true
                ? "Native when supported"
                : runtime.nativeResume === false
                  ? "Logical checkpoints"
                  : "Not reported"}
            </dd>
          </div>
          {name === "claude" && (
            <div className="flex flex-wrap justify-between gap-2">
              <dt className="text-zinc-500">Auto Mode</dt>
              <dd className="text-right text-zinc-300">
                {runtime.autoMode ? "CLI supports · org unverified" : "Not reported"}
              </dd>
            </div>
          )}
          <div className="flex flex-wrap justify-between gap-2">
            <dt className="text-zinc-500">Nested agents</dt>
            <dd className="text-zinc-300">
              {runtime.nestedRestriction ? "Restricted by policy" : "Not verified"}
            </dd>
          </div>
        </dl>
        {runtime.reason && <p className="break-words text-xs text-amber-300">{runtime.reason}</p>}
        <Button variant="outline" size="sm" disabled={busy} onClick={test}>
          <PlugZap />
          {busy ? "Checking…" : "Test Connection"}
        </Button>
        <p className="text-xs leading-5 text-zinc-500">
          Read-only CLI and login checks. No model calls.
        </p>
        {error && (
          <p role="alert" className="break-words text-xs text-red-300">
            {error}
          </p>
        )}
        {result && (
          <div role="status" className="space-y-3 border-t border-zinc-800 pt-3">
            <p className="text-xs font-medium text-zinc-300">
              {result.status === "BLOCKED"
                ? "Connection needs attention"
                : "Checks complete · some capabilities unverified"}
            </p>
            {result.rows?.map((row) => (
              <div key={row.check} className="text-xs">
                <p className="font-medium text-zinc-300">
                  {row.check} · {row.status.replaceAll("_", " ")}
                </p>
                <p className="mt-1 break-words text-zinc-400">{row.detail}</p>
                {row.remediation && (
                  <p className="mt-1 break-words text-amber-300">{row.remediation}</p>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
export function Agents({ state, actions }) {
  const [now, setNow] = useState(Date.now()),
    [terminate, setTerminate] = useState(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [setup, setSetup] = useState(null),
    [project, setProject] = useState("");
  const groups = sessionGroups(state.runs);
  useEffect(() => {
    if (!groups.active.length) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [groups.active.length]);
  function openSetup(mode, role) {
    setProject(state.quests[0]?.id || "");
    setSetup({ mode, role });
  }
  async function stop() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await actions.terminateRun(terminate);
      setTerminate(null);
    } catch (reason) {
      setError(reason.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="dq-dashboard space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Agents</h1>
        <p className="mt-2 text-sm text-zinc-400">
          Monitor execution sessions, agent role assignments, and underlying AI CLI runtimes.
        </p>
      </div>
      <div aria-label="Engine status" className="flex flex-wrap gap-2">
        {["claude", "codex"].map((key) => (
          <Badge
            key={key}
            variant="outline"
            className="gap-2 border-zinc-800 px-3 py-1.5 text-zinc-300"
          >
            <span
              className={`size-1.5 rounded-full ${state.runtimes[key]?.available ? "bg-emerald-400" : "bg-zinc-500"}`}
            />
            {runtimeName(key)}:{" "}
            {state.runtimes[key]?.available === true
              ? "CLI Ready"
              : state.runtimes[key]?.available === false
                ? "Unavailable"
                : "Not checked"}
          </Badge>
        ))}
        <Badge variant="outline" className="gap-2 border-zinc-800 px-3 py-1.5 text-zinc-300">
          <Bot className="size-3.5" />
          Active Workers: {groups.active.length}
        </Badge>
      </div>
      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1.85fr)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-6">
          <Card className="border-zinc-800 bg-zinc-900">
            <CardHeader className="border-b border-zinc-800 pb-4">
              <CardTitle className="flex items-center justify-between text-base">
                <span>Active Sessions</span>
                <span className="flex items-center gap-2 text-xs font-normal text-zinc-400">
                  <span
                    className={`size-2 rounded-full ${groups.active.length ? "animate-pulse bg-emerald-400" : "bg-zinc-500"}`}
                  />
                  {groups.active.length ? "Running" : "Idle"}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 p-5">
              {groups.active.length ? (
                groups.active.map((run) => (
                  <Session
                    key={run.id}
                    run={run}
                    state={state}
                    actions={actions}
                    onTerminate={(id) => {
                      setError("");
                      setTerminate(id);
                    }}
                    now={now}
                  />
                ))
              ) : (
                <div className="flex flex-col items-center rounded-lg border border-dashed border-zinc-800 bg-zinc-950/40 px-4 py-10 text-center">
                  <div className="mb-4 rounded-xl border border-zinc-800 bg-zinc-900 p-3">
                    <Terminal className="size-6 text-zinc-500" />
                  </div>
                  <p className="text-sm font-medium">No active agent sessions running</p>
                  <p className="mt-2 max-w-sm text-xs leading-5 text-zinc-400">
                    Choose a project to review the next eligible task and its execution settings.
                  </p>
                  <Button className="mt-5" onClick={() => openSetup("launch")}>
                    <Plus />
                    Launch Agent Task
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
          {groups.attention.length > 0 && (
            <Card className="border-zinc-800 bg-zinc-900">
              <CardHeader>
                <CardTitle className="text-base">
                  Needs Attention <span className="text-zinc-500">({groups.attention.length})</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {groups.attention.map((run) => (
                  <Session key={run.id} run={run} state={state} actions={actions} now={now} />
                ))}
              </CardContent>
            </Card>
          )}
          <Card className="border-zinc-800 bg-zinc-900">
            <CardHeader className="border-b border-zinc-800 pb-4">
              <CardTitle className="text-base">
                Agent Mesh{" "}
                <span className="text-xs font-normal text-zinc-500">(6 Specialized Roles)</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <ul className="divide-y divide-zinc-800">
                {agentRoles.map((role) => {
                  const Icon = icons[role.key],
                    working = groups.active.some((run) => agentRole(run) === role.key);
                  return (
                    <li key={role.key} className="flex items-start gap-3 p-4 sm:p-5">
                      <span className="mt-0.5 rounded-lg border border-zinc-800 bg-zinc-950 p-2">
                        <Icon className="size-4 text-zinc-400" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="text-sm font-medium">{role.name}</h3>
                          <Status working={working}>{working ? "WORKING" : "IDLE"}</Status>
                        </div>
                        <p className="mt-1 text-xs leading-5 text-zinc-400">{role.description}</p>
                        <Badge
                          variant="outline"
                          className="mt-2 max-w-full whitespace-normal break-all font-mono text-[10px] font-normal text-zinc-400"
                        >
                          {roleMapping(state, role.key)}
                        </Badge>
                      </div>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-8 shrink-0 text-zinc-400"
                            aria-label={`${role.name} actions`}
                          >
                            <MoreHorizontal />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent className="dq-popup" align="end">
                          <DropdownMenuItem onSelect={() => openSetup("configure", role.key)}>
                            Configure
                          </DropdownMenuItem>
                          <DropdownMenuItem onSelect={() => openSetup("launch", role.key)}>
                            Run Standalone
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </li>
                  );
                })}
              </ul>
            </CardContent>
          </Card>
          {groups.history.length > 0 && (
            <Card className="border-zinc-800 bg-zinc-900">
              <CardHeader>
                <CardTitle className="text-base">
                  Session History{" "}
                  <span className="text-xs font-normal text-zinc-500">
                    ({groups.history.length})
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {groups.history.map((run) => (
                  <button
                    key={run.id}
                    type="button"
                    className="flex w-full items-center justify-between gap-3 rounded-md p-3 text-left transition-colors hover:bg-zinc-800/50"
                    onClick={() => actions.viewRun(run.id)}
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-xs font-medium">
                        {state.quests.find((q) => q.id === run.questId)?.title ||
                          "Project unavailable"}
                      </span>
                      <span className="text-xs text-zinc-500">
                        {agentRoles.find((role) => role.key === agentRole(run)).name} ·{" "}
                        {run.purpose}
                      </span>
                    </span>
                    <Status>{run.state}</Status>
                  </button>
                ))}
              </CardContent>
            </Card>
          )}
        </div>
        <aside className="min-w-0 space-y-4" aria-label="Runtime Connections & CLI">
          <h2 className="flex items-center gap-2 text-sm font-medium">
            <PlugZap className="size-4 text-zinc-400" />
            Runtime Connections & CLI
          </h2>
          {["claude", "codex"].map((key) => (
            <RuntimeCard
              key={key}
              name={key}
              runtime={state.runtimes[key]}
              check={actions.checkRuntime}
            />
          ))}
          <p className="px-1 text-xs leading-5 text-zinc-500">
            CLI availability is distinct from authentication, model entitlement and stage-specific
            MCP access.
          </p>
        </aside>
      </div>
      <Dialog
        open={Boolean(setup)}
        onOpenChange={(open) => {
          if (!open) setSetup(null);
        }}
      >
        <DialogContent className="dq-popup">
          <DialogHeader>
            <DialogTitle>
              {setup?.mode === "configure" ? "Configure agent role" : "Launch Agent Task"}
            </DialogTitle>
            <DialogDescription>
              {setup?.mode === "configure"
                ? "Role assignments and overrides are configured per project."
                : "Standalone sessions require a project and authorized repository scope. Review its next action before starting any paid run."}
            </DialogDescription>
          </DialogHeader>
          {setup?.role && (
            <p className="text-sm text-zinc-400">
              Selected role: {agentRoles.find((role) => role.key === setup.role)?.name}
            </p>
          )}
          {state.quests.length ? (
            <label className="text-sm text-zinc-300">
              Project
              <select
                className={control}
                value={project}
                onChange={(event) => setProject(event.target.value)}
              >
                {state.quests.map((quest) => (
                  <option key={quest.id} value={quest.id}>
                    {quest.title}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <p className="text-sm text-zinc-400">
              Create a project and select its repositories first.
            </p>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setSetup(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                setSetup(null);
                if (project)
                  location.hash = `#quest/${project}/${setup?.mode === "configure" ? "settings" : "overview"}`;
                else actions.newProject();
              }}
            >
              {project ? "Open Project" : "Create Project"}
              <ArrowRight />
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={Boolean(terminate)}
        onOpenChange={(open) => {
          if (!open && !busy) setTerminate(null);
        }}
      >
        <DialogContent className="dq-popup">
          <DialogHeader>
            <DialogTitle>Terminate session?</DialogTitle>
            <DialogDescription>
              Interrupt the current agent turn. Saved history, checkpoints and worktrees are
              preserved.
            </DialogDescription>
          </DialogHeader>
          {error && (
            <p role="alert" className="text-sm text-red-300">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button variant="ghost" disabled={busy} onClick={() => setTerminate(null)}>
              Cancel
            </Button>
            <Button variant="destructive" disabled={busy} onClick={stop}>
              {busy ? "Interrupting…" : "Terminate Session"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

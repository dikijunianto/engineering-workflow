export { openCreateProject } from "./create-project";
import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Folder,
  Bot,
  GitFork,
  Plus,
  ArrowUpRight,
  ArrowRight,
  Activity,
  GitBranch,
  Bell,
  Search,
  Settings,
  FolderInput,
  Link,
  ChevronDown,
  Clock,
  User,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "./components/card";
import { Button } from "./components/button";
import { Badge } from "./components/badge";
import { Input } from "./components/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "./components/tabs";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "./components/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "./components/dialog";
import { Agents } from "./agents";
import { Sidebar } from "./sidebar";
import { Avatar, AvatarFallback } from "./components/avatar";
import { dashboardData, projectStatus, workspaceSearch, sampleProjects } from "./model";

const date = (value) =>
  value && Number.isFinite(Date.parse(value))
    ? new Intl.DateTimeFormat(undefined, {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      }).format(new Date(value))
    : "Not recorded";
const go = (href) => {
  location.hash = href;
};
function StatCard({ label, value, icon: Icon, href }) {
  return (
    <a href={href} className="dq-stat-link group">
      <Card className="border-border/50 bg-card transition-colors hover:border-zinc-600">
        <CardContent className="p-5 sm:p-6">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">{label}</span>
            <Icon className="size-4 text-muted-foreground group-hover:text-foreground" />
          </div>
          <div className="mt-4 flex flex-wrap items-end justify-between gap-3">
            <strong className="text-4xl font-semibold tracking-tight">{value}</strong>
            <Badge
              variant="outline"
              className="font-normal text-muted-foreground"
              title="Weekly historical metrics are not recorded"
            >
              Trend unavailable
            </Badge>
          </div>
        </CardContent>
      </Card>
    </a>
  );
}
function ProjectCard({ project, state, sample = false }) {
  const repos = sample
    ? ["payments-service · sample"]
    : (project.repositoryIds || []).map(
        (id) => state.repositories.find((r) => r.id === id)?.name || "Unavailable repository",
      );
  const agents = sample
    ? project.sampleAgents
    : state.runs.filter((r) => r.questId === project.id && r.state === "RUNNING").length;
  const content = (
    <>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <div className="rounded-lg border border-border bg-background p-2">
            <Folder className="size-4 text-muted-foreground" />
          </div>
          <div className="min-w-0">
            <h3 className="break-words text-sm font-semibold">{project.title}</h3>
            <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
              <GitBranch className="size-3 shrink-0" />
              <span className="break-words">
                {repos.join(", ") ||
                  (project.deletedAt
                    ? "Repository details retained in project history"
                    : "No repository connected")}
              </span>
            </p>
          </div>
        </div>
        <Badge
          variant="outline"
          className={
            project.state === "PRS_CREATED"
              ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-300"
              : "text-muted-foreground"
          }
        >
          {projectStatus(project)}
        </Badge>
      </div>
      <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <Bot className="size-3.5" />
          {agents} active agents
        </span>
        <span className="flex items-center gap-1.5">
          <Clock className="size-3.5" />
          {project.deletedAt ? "Archived" : "Updated"}{" "}
          {project.deletedAt
            ? date(project.deletedAt)
            : sample
              ? "just now · sample"
              : date(project.updatedAt || project.createdAt)}
        </span>
        {!sample && <ArrowUpRight className="ml-auto size-4" />}
      </div>
    </>
  );
  return sample ? (
    <div className="rounded-lg border border-border p-4">{content}</div>
  ) : (
    <a
      className="block rounded-lg border border-border p-4 transition-colors hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring"
      href={project.deletedAt ? "#quests/deleted" : `#quest/${project.id}/overview`}
    >
      {content}
    </a>
  );
}
export function Overview({ state, actions }) {
  const [filter, setFilter] = useState("all");
  const [preview, setPreview] = useState(false);
  const data = dashboardData(state, filter);
  const events = [...state.events]
    .sort((a, b) => (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0))
    .slice(0, 6);
  return (
    <div className="dq-dashboard space-y-7">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="mb-2 text-xs font-medium uppercase tracking-widest text-muted-foreground">
            Workspace
          </p>
          <h1 className="text-xl font-semibold tracking-tight">Overview</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Your projects, agents and latest workspace activity.
          </p>
        </div>
        <Button onClick={actions.newProject}>
          <Plus />
          New Project
        </Button>
      </div>
      <section className="grid gap-4 sm:grid-cols-3" aria-label="Workspace metrics">
        <StatCard label="Active Projects" value={data.active} icon={Folder} href="#quests" />
        <StatCard label="Running Agents" value={data.running} icon={Bot} href="#agents" />
        <StatCard
          label="Repositories"
          value={data.repositories}
          icon={GitFork}
          href="#repositories"
        />
      </section>
      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1.85fr)_minmax(0,1fr)]">
        <Card className="min-w-0 border-border/50 bg-card">
          <Tabs value={filter} onValueChange={setFilter}>
            <CardHeader className="gap-5 border-b border-border/60 pb-4">
              <div className="flex items-center justify-between gap-3">
                <CardTitle className="text-base">Active Projects</CardTitle>
                <Button
                  variant="link"
                  size="sm"
                  onClick={actions.newProject}
                  className="h-auto p-0 text-muted-foreground hover:text-foreground"
                >
                  <Plus />
                  New Project
                </Button>
              </div>
              <TabsList aria-label="Filter projects" className="self-start bg-muted/40">
                <TabsTrigger value="all">All</TabsTrigger>
                <TabsTrigger value="active">Active</TabsTrigger>
                <TabsTrigger value="archived">Archived</TabsTrigger>
              </TabsList>
            </CardHeader>
            <TabsContent value={filter} className="mt-0">
              <CardContent className="p-5 sm:p-6">
                {filter === "archived" && (
                  <p className="mb-4 text-xs text-muted-foreground">
                    Archived shows deleted projects. Restore them from{" "}
                    <a className="underline" href="#quests/deleted">
                      Deleted projects
                    </a>
                    .
                  </p>
                )}
                {data.projects.length ? (
                  <div className="space-y-3">
                    {data.projects.map((project) => (
                      <ProjectCard key={project.id} project={project} state={state} />
                    ))}
                  </div>
                ) : (
                  <div className="flex min-h-80 flex-col items-center justify-center rounded-lg border border-dashed border-zinc-700/70 bg-background/30 px-5 py-10 text-center">
                    <div className="mb-5 rounded-2xl border border-border bg-card p-4">
                      <Folder className="size-8 text-muted-foreground" strokeWidth={1.5} />
                    </div>
                    <h2 className="text-base font-medium">
                      {filter === "archived"
                        ? "No archived projects"
                        : filter === "active"
                          ? "No active projects"
                          : "Build your first project"}
                    </h2>
                    <p className="mt-2 max-w-sm text-sm leading-6 text-muted-foreground">
                      Get started by building a project from a PRD, technical task, or bug report.
                    </p>
                    <Button className="mt-6" onClick={actions.newProject}>
                      <Plus />
                      Create First Project
                    </Button>
                  </div>
                )}
                {!state.quests.length && filter !== "archived" && (
                  <div className="mt-4">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-xs text-muted-foreground"
                      aria-expanded={preview}
                      onClick={() => setPreview(!preview)}
                    >
                      {preview ? "Hide" : "Show"} sample project preview
                      <ChevronDown className={preview ? "rotate-180" : ""} />
                    </Button>
                    {preview && (
                      <div className="mt-3 space-y-3">
                        <p className="text-xs text-muted-foreground">
                          Sample data · Preview only. These are not saved projects.
                        </p>
                        {sampleProjects.map((project) => (
                          <ProjectCard key={project.id} project={project} state={state} sample />
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </TabsContent>
          </Tabs>
        </Card>
        <div className="min-w-0 space-y-6">
          <Card className="border-border/50 bg-card">
            <CardHeader className="border-b border-border/60 pb-4">
              <CardTitle className="flex items-center gap-2 text-base">
                <Activity className="size-4 text-muted-foreground" />
                Recent Activity Log
              </CardTitle>
            </CardHeader>
            <CardContent className="p-5 sm:p-6">
              {events.length ? (
                <ol className="dq-timeline space-y-6">
                  {events.map((event, index) => (
                    <li key={event.id || index} className="relative flex gap-3">
                      <span className="relative z-10 flex size-8 shrink-0 items-center justify-center rounded-full border border-border bg-card">
                        <Activity className="size-3.5 text-muted-foreground" />
                      </span>
                      <div className="min-w-0 pt-0.5">
                        <p className="break-words text-sm leading-5">{event.message}</p>
                        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                          <time dateTime={event.createdAt}>{date(event.createdAt)}</time>
                          <span
                            className="rounded border border-border px-1.5 py-0.5 font-mono text-[10px]"
                            title="Activity events do not include verified code-diff metrics"
                          >
                            diff n/a
                          </span>
                        </div>
                      </div>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  No workspace activity yet.
                </p>
              )}
            </CardContent>
          </Card>
          <Card className="border-border/50 bg-card">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Quick Actions</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 px-3 pb-3">
              {[
                [FolderInput, "Import Repository", actions.addRepository],
                [Bot, "Deploy New Agent", () => go("#agents")],
                [Link, "Link Jira Board", actions.jiraSettings],
              ].map(([Icon, label, handler]) => (
                <Button
                  key={label}
                  variant="ghost"
                  onClick={handler}
                  className="w-full justify-start gap-3 text-muted-foreground hover:text-foreground"
                >
                  <Icon />
                  {label}
                  <ArrowRight className="ml-auto" />
                </Button>
              ))}
              <p className="px-3 pt-2 text-xs text-muted-foreground">
                Agent setup opens before any execution.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
function Header({ state }) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [notifications, setNotifications] = useState(false);
  useEffect(() => {
    const handler = (e) => {
      if (
        (e.metaKey || e.ctrlKey) &&
        e.key.toLowerCase() === "k" &&
        !document.querySelector('dialog[open], .dq-create-project[data-state="open"]')
      ) {
        e.preventDefault();
        setSearchOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);
  const results = workspaceSearch(state, query);
  // Only the latest attempt per role/stage/task contributes to current notifications.
  const latest = new Map();
  for (const run of [...state.runs].sort(
    (a, b) => (Date.parse(a.createdAt) || 0) - (Date.parse(b.createdAt) || 0),
  ))
    latest.set(`${run.questId}:${run.role}:${run.stage}:${run.taskId || run.workId || ""}`, run);
  const attention = [...latest.values()].filter(
    (r) =>
      ["FAILED", "WAITING_INPUT", "INTERRUPTED"].includes(r.state) &&
      state.quests.some((q) => q.id === r.questId),
  );
  return (
    <div className="dq-header flex items-center gap-2">
      <Button
        variant="outline"
        className="h-9 gap-2 border-border bg-background text-muted-foreground sm:w-56 sm:justify-start"
        onClick={() => setSearchOpen(true)}
        aria-label="Search workspace"
      >
        <Search />
        <span className="hidden sm:inline">Search workspace</span>
        <kbd className="ml-auto hidden rounded border border-border px-1 text-[10px] sm:inline">
          ⌘ K
        </kbd>
      </Button>
      <Button
        size="icon"
        variant="ghost"
        className="relative size-9 text-muted-foreground"
        aria-label={`Notifications${attention.length ? `, ${attention.length} need attention` : ""}`}
        onClick={() => setNotifications(true)}
      >
        <Bell />
        {attention.length > 0 && (
          <span className="absolute right-1 top-1 size-1.5 rounded-full bg-primary" />
        )}
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" className="size-9 rounded-full p-0" aria-label="Workspace menu">
            <Avatar className="size-8">
              <AvatarFallback className="border border-border bg-accent text-xs">
                <User className="size-4" />
              </AvatarFallback>
            </Avatar>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="dq-popup w-52">
          <DropdownMenuLabel>Local workspace</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => go("#settings")}>
            <Settings className="mr-2 size-4" />
            Settings & integrations
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => go("#repositories")}>
            <GitFork className="mr-2 size-4" />
            Repositories
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog open={searchOpen} onOpenChange={setSearchOpen}>
        <DialogContent className="dq-popup sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Search workspace</DialogTitle>
            <DialogDescription>Find a saved project or repository.</DialogDescription>
          </DialogHeader>
          <Input
            aria-label="Search projects and repositories"
            placeholder="Type a project or repository name…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div className="space-y-1">
            {results.map((item, i) => (
              <Button
                key={i}
                variant="ghost"
                className="h-auto w-full justify-between whitespace-normal text-left"
                onClick={() => {
                  setSearchOpen(false);
                  go(item.href);
                }}
              >
                {item.label}
                <Badge variant="outline" className="ml-3 shrink-0">
                  {item.type}
                </Badge>
              </Button>
            ))}
            <p className="text-sm text-muted-foreground" role="status">
              {query && !results.length
                ? "No matching projects or repositories."
                : !query
                  ? "Search uses this local workspace only."
                  : `${results.length} results`}
            </p>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={notifications} onOpenChange={setNotifications}>
        <DialogContent className="dq-popup sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Notifications</DialogTitle>
            <DialogDescription>Latest agent attempts needing your attention.</DialogDescription>
          </DialogHeader>
          <div className="max-h-80 space-y-2 overflow-y-auto">
            {attention.length ? (
              attention.map((run) => (
                <Button
                  key={run.id}
                  variant="outline"
                  className="h-auto w-full justify-start whitespace-normal text-left"
                  onClick={() => {
                    setNotifications(false);
                    go(`#quest/${run.questId}/overview`);
                  }}
                >
                  {state.quests.find((q) => q.id === run.questId)?.title} · {run.stage || run.role}{" "}
                  · {run.state.replaceAll("_", " ")}
                </Button>
              ))
            ) : (
              <p className="text-sm text-muted-foreground">
                You’re all caught up. No agents need attention.
              </p>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
let overviewRoot, headerRoot, sidebarRoot, sidebarProps;
let engineConnected = false;
export function setConnection(connected) {
  engineConnected = connected;
  if (sidebarRoot && sidebarProps)
    sidebarRoot.render(<Sidebar {...sidebarProps} connected={connected} />);
}
export function updateDashboard(state, actions, { route = "home", restartRequired = false } = {}) {
  const sidebar = document.getElementById("sidebar-content");
  if (sidebar) {
    sidebarRoot ||= createRoot(sidebar);
    sidebarProps = { state, route, restartRequired };
    sidebarRoot.render(<Sidebar {...sidebarProps} connected={engineConnected} />);
  }
  const header = document.getElementById("dashboard-header");
  if (header) {
    headerRoot ||= createRoot(header);
    headerRoot.render(<Header state={state} />);
  }
  const target = document.getElementById("dashboard-root");
  if (target) {
    overviewRoot ||= createRoot(target);
    overviewRoot.render(
      route === "agents" ? (
        <Agents state={state} actions={actions} />
      ) : (
        <Overview state={state} actions={actions} />
      ),
    );
  }
}
export function unmountOverview() {
  overviewRoot?.unmount();
  overviewRoot = undefined;
}

import React from "react";
import {
  LayoutDashboard,
  FolderGit2,
  GitFork,
  Bot,
  Sparkles,
  SquareCheck,
  Settings,
} from "lucide-react";
import { version } from "../package.json";

const groups = [
  {
    title: "WORKSPACE",
    links: [
      ["home", "Overview", LayoutDashboard],
      ["quests", "Projects", FolderGit2],
      ["repositories", "Repositories", GitFork],
    ],
  },
  {
    title: "AI ENGINE",
    links: [
      ["agents", "Agents", Bot],
      ["skills", "Skills", Sparkles],
    ],
  },
  { title: "INTEGRATION", links: [["jira", "Jira Tasks", SquareCheck]] },
  { title: "SYSTEM", links: [["settings", "Settings", Settings]] },
];

export function Sidebar({ state, route = "home", connected = false, restartRequired = false }) {
  const selected = route === "quest" ? "quests" : route;
  const running = state.runs.filter((run) => run.state === "RUNNING").length;
  const ready = connected && !restartRequired;
  return (
    <nav id="primary-navigation" className="dq-sidebar" aria-label="Main navigation">
      {groups.map((group) => (
        <section
          key={group.title}
          aria-label={group.title}
          className={group.title === "SYSTEM" ? "dq-system" : ""}
        >
          <h2 className="mb-2 px-3 text-[10px] font-medium tracking-widest text-zinc-500">
            {group.title}
          </h2>
          <div className="space-y-1">
            {group.links.map(([key, label, Icon]) => (
              <a
                key={key}
                href={`#${key}`}
                data-nav={key}
                aria-current={selected === key ? "page" : undefined}
                className={`group flex min-h-9 items-center gap-2.5 rounded-r-lg border-l-2 px-3 py-2 text-[13px] font-medium transition-colors ${selected === key ? "active border-emerald-500 bg-zinc-800/80 text-white" : "border-transparent text-zinc-400 hover:bg-zinc-800/40 hover:text-zinc-200"}`}
              >
                <Icon
                  className={`size-4 ${selected === key ? "text-white" : "text-current"}`}
                  aria-hidden="true"
                />
                <span>{label}</span>
                {["quests", "repositories"].includes(key) && (
                  <span
                    id={key === "quests" ? "quest-count" : "repository-count"}
                    className="ml-auto rounded-full bg-zinc-800 px-1.5 py-0.5 text-[10px] tabular-nums text-zinc-400"
                  >
                    {key === "quests" ? state.quests.length : state.repositories.length}
                  </span>
                )}
                {key === "agents" && running > 0 && (
                  <span
                    className="ml-auto size-1.5 rounded-full bg-emerald-400"
                    role="img"
                    aria-label={`${running} running agents`}
                    title={`${running} running agents`}
                  />
                )}
              </a>
            ))}
          </div>
          {group.title === "SYSTEM" && (
            <div
              className="mt-4 flex items-center gap-1.5 border-t border-zinc-800/60 px-3 pt-4 text-[10px] text-zinc-500"
              role="status"
              title="Local DevQuest connection status. Provider authentication and model availability are checked separately."
            >
              <span
                className={`size-1.5 shrink-0 rounded-full ${ready ? "bg-emerald-400" : "bg-amber-400"}`}
                aria-hidden="true"
              />
              <span>
                {restartRequired
                  ? "Restart required"
                  : ready
                    ? "Local engine ready"
                    : "Engine reconnecting"}
              </span>
              <span aria-hidden="true">|</span>
              <span>v{version}</span>
            </div>
          )}
        </section>
      ))}
    </nav>
  );
}

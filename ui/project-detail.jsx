import React, { useState, useEffect } from "react";
import { Marked } from "marked";
import {
  ArrowLeft,
  Settings,
  Play,
  Check,
  FileText,
  Copy,
  Download,
  Edit3,
  Eye,
  Code2,
  GitBranch,
  GitFork,
  GitPullRequest,
  Bot,
  Clock,
  AlertTriangle,
  Sparkles,
  Send,
  Terminal,
  CheckCircle2,
  XCircle,
  CircleDot,
  Layers,
  ShieldCheck,
  MessageSquare,
  ListChecks,
  ExternalLink,
  Pause,
  RotateCcw,
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
} from "./components/dialog";

const escHtml = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char],
  );

const safeUrl = (value) => {
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? escHtml(url.href) : "#";
  } catch {
    return "#";
  }
};

const markdownParser = new Marked({
  renderer: {
    html({ text }) {
      return escHtml(text);
    },
    link({ href, tokens }) {
      const label = this.parser.parseInline(tokens);
      const url = safeUrl(href);
      return url === "#"
        ? label
        : `<a href="${url}" target="_blank" rel="noreferrer" class="text-emerald-400 underline hover:text-emerald-300">${label}</a>`;
    },
    image({ text }) {
      return escHtml(text);
    },
  },
});

function renderMarkdown(content = "") {
  const cleaned = String(content || "").split("<!-- devquest-tasks")[0];
  return markdownParser.parse(cleaned);
}

const ROLE_DEFS = [
  { key: "orchestrator", label: "Orchestrator", purposes: ["v11-route"] },
  { key: "jira_appendix", label: "Jira Specialist", purposes: ["jira_appendix_generation", "jira_publish"] },
  { key: "architect", label: "Architect", purposes: ["brainstorm", "analysis", "trd", "spec"] },
  { key: "planner", label: "Planner", purposes: ["plan"] },
  { key: "developer", label: "Developer", purposes: ["task", "v11-task", "v11-fix"] },
  { key: "reviewer", label: "Reviewer", purposes: ["review", "v11-review"] },
];

export function roleForRun(run) {
  if (!run) return ROLE_DEFS[4];
  return (
    ROLE_DEFS.find((r) => r.key === run.role || r.purposes.includes(run.purpose)) || ROLE_DEFS[4]
  );
}

const STAGE_NAMES = {
  brainstorm: "Brainstorm",
  analysis: "Repository analysis",
  trd: "Technical design",
  spec: "Specification",
  plan: "Implementation plan",
  jira_appendix_generation: "Jira appendix",
  jira_publish: "Jira publication",
  task: "Implementation",
  "v11-task": "Implementation",
  "v11-fix": "Implementation fix",
  "v11-route": "Routing",
  review: "Independent review",
  "v11-review": "Independent review",
};

export function latestRunAttempts(runs = []) {
  const latest = new Map();
  for (const run of runs) {
    latest.set(JSON.stringify([run.questId, run.purpose, run.taskId || run.workId || null]), run);
  }
  return [...latest.values()];
}

export function getArtifact(state, questId, kind) {
  const found = (state.artifacts || []).find((a) => a.questId === questId && a.kind === kind);
  if (!found) return undefined;
  return {
    ...found,
    content: found.content ?? found.markdown ?? "",
    revision: found.revision ?? found.version ?? 1,
  };
}

function implementationComplete(state, quest) {
  const tasks = (state?.tasks || []).filter(t=>t.questId===quest.id);
  return ["EXECUTING","TASKS_PUBLISHED"].includes(quest.state) && tasks.length > 0 && tasks.every(t=>t.state === "COMPLETED");
}

export function getStageLabel(state, quest) {
  const runs = (state.runs || []).filter((r) => r.questId === quest.id);
  const active = latestRunAttempts(runs).find((run) =>
    ["RUNNING", "WAITING_INPUT"].includes(run.state),
  );
  if (active && STAGE_NAMES[active.purpose]) return STAGE_NAMES[active.purpose];
  if (implementationComplete(state,quest)) return "Independent review";
  return (
    {
      INTAKE_READY: quest.kind === "TECH" ? "Brainstorm" : "Requirements analysis",
      BRAINSTORM_COMPLETED: "Repository analysis",
      ANALYZED: "Technical design",
      TRD_DRAFT: "Review TRD",
      TRD_APPROVED: "Implementation plan",
      PLAN_DRAFT: "Review plan",
      PLAN_APPROVED: getArtifact(state, quest.id, "appendix") ? "Jira appendix" : "Plan approved",
      TASKS_PUBLISHED: "Implementation",
      EXECUTING: "Implementation",
      READY_FOR_PR: "Independent review",
      REVIEW_HANDOFF: "Team review",
      PRS_CREATED: "Pull requests created",
    }[quest.state] || String(quest.state || "").replaceAll("_", " ")
  );
}

export function getStageIndex(quest, state) {
  if (quest.state === "PRS_CREATED") return 4;
  if (["READY_FOR_PR", "REVIEW_HANDOFF"].includes(quest.state)) return 3;
  if (implementationComplete(state,quest)) return 3;
  if (["EXECUTING", "TASKS_PUBLISHED"].includes(quest.state)) return 2;
  if (["TRD_APPROVED", "PLAN_DRAFT", "PLAN_APPROVED"].includes(quest.state)) return 1;
  return 0;
}

function statusBadgeClass(status = "") {
  if (
    [
      "COMPLETED",
      "APPROVED",
      "PASSED",
      "READY",
      "AVAILABLE",
      "CONFIGURED",
      "TRD_APPROVED",
      "PLAN_APPROVED",
      "PRS_CREATED",
      "TEAM_NOTIFIED",
    ].includes(status)
  ) {
    return "border-emerald-500/30 bg-emerald-500/10 text-emerald-300";
  }
  if (
    ["RUNNING", "EXECUTING", "PREPARING", "STARTING", "GENERATING_APPENDIX", "SENDING"].includes(
      status,
    )
  ) {
    return "border-sky-500/30 bg-sky-500/10 text-sky-300";
  }
  if (
    [
      "WAITING_INPUT",
      "PAUSED",
      "INTERRUPTED",
      "AWAITING_TEST",
      "AWAITING_REVIEW",
      "TRD_DRAFT",
      "PLAN_DRAFT",
      "REVIEW_HANDOFF",
      "DRAFT",
      "INTAKE_READY",
      "BRAINSTORM_COMPLETED",
      "ANALYZED",
    ].includes(status)
  ) {
    return "border-amber-500/30 bg-amber-500/10 text-amber-300";
  }
  if (
    [
      "FAILED",
      "BLOCKED",
      "RECOVERY_REQUIRED",
      "TEST_FAILED",
      "BASELINE_FAILED",
      "NEEDS_HUMAN_ATTENTION",
    ].includes(status)
  ) {
    return "border-red-500/30 bg-red-500/10 text-red-300";
  }
  return "border-zinc-700 bg-zinc-800/80 text-zinc-300";
}

function StatusPill({ status }) {
  const label = String(status || "IDLE").replaceAll("_", " ");
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[11px] font-medium tracking-wide uppercase ${statusBadgeClass(status)}`}
    >
      <span className="size-1.5 rounded-full bg-current" />
      {label}
    </span>
  );
}

function formatTime(value) {
  if (!value || !Number.isFinite(Date.parse(value))) return "Just now";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export function computeStageActions(state, quest) {
  const id = quest.id;
  const tasks = (state.tasks || []).filter((t) => t.questId === id);
  const runs = (state.runs || []).filter((r) => r.questId === id);
  const appendixDoc = getArtifact(state, id, "appendix");
  const planDoc = getArtifact(state, id, "plan");
  const trdDoc = getArtifact(state, id, "trd");
  const specDoc = getArtifact(state, id, "spec");
  const briefDoc = getArtifact(state, id, "technical-brief");
  const analysisDoc = getArtifact(state, id, "analysis");
  const brainstormDoc = getArtifact(state, id, "brainstorm");

  const appendixJob = runs
    .filter((r) => r.purpose === "jira_appendix_generation")
    .at(-1);
  const appendixRunning = appendixJob?.generationActive === true;
  const appendixFailed = appendixJob && ["FAILED", "INTERRUPTED"].includes(appendixJob.state);
  const appendixReady = Boolean(appendixDoc && appendixDoc.planArtifactId === planDoc?.id);
  const appendixApproved = appendixDoc?.approved === true;

  const active = runs.some((r) =>
    r.purpose === "jira_appendix_generation"
      ? r.generationActive === true
      : ["RUNNING", "PAUSED", "INTERRUPTED", "WAITING_INPUT"].includes(r.state),
  );

  let primary = null;
  const secondary = [];

  if (active) {
    const waiting = runs.some((r) => r.state === "WAITING_INPUT");
    primary = {
      label: waiting ? "Answer Agent in Room" : "View Agent Progress",
      href: `#quest/${id}/room`,
    };
    if (
      quest.kind === "TECH" &&
      !briefDoc &&
      specDoc?.sourceStage !== "brainstorm" &&
      runs.some((r) => r.purpose === "brainstorm" && r.state === "WAITING_INPUT")
    ) {
      secondary.push({
        label: "Finish Brainstorm",
        action: "FINISH_BRAINSTORM",
        data: { "quest-id": id },
      });
    }
  } else {
    if (quest.kind === "TECH" && quest.state === "BRAINSTORM_COMPLETED") {
      secondary.push({
        label: "View Specification",
        href: `#quest/${id}/documents/spec`,
      });
      secondary.push({
        label: "Edit Specification",
        action: "edit-spec",
        data: { "quest-id": id },
      });
    }
    if (quest.kind === "TECH" && !briefDoc && specDoc?.sourceStage !== "brainstorm") {
      if (brainstormDoc) {
        primary = {
          label: "+ Finish Brainstorm",
          action: "FINISH_BRAINSTORM",
          data: { "quest-id": id },
        };
        secondary.push({
          label: "Restart Brainstorm",
          action: "START_BRAINSTORM",
          data: { "quest-id": id },
        });
      } else {
        primary = {
          label: "+ Start Brainstorm",
          action: "START_BRAINSTORM",
          data: { "quest-id": id },
        };
      }
    }
    if (
      !analysisDoc &&
      (quest.kind === "PRODUCT" || briefDoc || specDoc?.sourceStage === "brainstorm")
    ) {
      const item = {
        label: "+ Analyze Requirements & Repos",
        action: "ANALYZE_PRD",
        data: { "quest-id": id },
      };
      if (!primary) primary = item;
      else secondary.push(item);
    }
    if (analysisDoc && !trdDoc) {
      const item = {
        label: "+ Generate TRD",
        action: "GENERATE_TRD",
        data: { "quest-id": id },
      };
      if (!primary) primary = item;
      else secondary.push(item);
    }
    if (quest.state === "TRD_DRAFT") {
      primary = {
        label: "Approve TRD",
        action: "APPROVE_TRD",
        data: { "quest-id": id, "artifact-id": trdDoc?.id || "" },
      };
      secondary.push({
        label: "Review TRD Markdown",
        href: `#quest/${id}/documents/trd`,
      });
      secondary.push({
        label: "Edit TRD",
        action: "edit-trd",
        data: { "quest-id": id },
      });
    }
    if (quest.state === "TRD_APPROVED") {
      primary = {
        label: "+ Generate Implementation Plan",
        action: "GENERATE_PLAN",
        data: { "quest-id": id },
      };
      secondary.push({
        label: "Write Plan Manually",
        action: "edit-plan",
        data: { "quest-id": id },
      });
    }
    if (quest.state === "PLAN_DRAFT") {
      primary = {
        label: "Approve Plan",
        action: "APPROVE_PLAN",
        data: { "quest-id": id, "artifact-id": planDoc?.id || "" },
      };
      secondary.push({
        label: "Review Plan Markdown",
        href: `#quest/${id}/documents/plan`,
      });
      secondary.push({
        label: "Edit Plan",
        action: "edit-plan",
        data: { "quest-id": id },
      });
    }
    if (quest.state === "PLAN_APPROVED") {
      if (quest.existingJiraKey && !tasks.some((t) => t.jira)) {
        primary = {
          label: "Link Existing QA Issue",
          action: "existing-jira-dialog",
          data: { "quest-id": id },
        };
      } else if (appendixReady && !appendixRunning && !appendixApproved) {
        if (appendixDoc?.approvalReady === false) {
          primary = {
            label: "Review Appendix",
            description: appendixDoc.approvalError,
            href: `#quest/${id}/documents/appendix`,
          };
        } else {
          primary = {
            label: "Approve Appendix Revision",
            action: "APPROVE_APPENDIX",
            data: { "quest-id": id, "artifact-id": appendixDoc?.id || "" },
          };
        }
      } else if (appendixReady && appendixApproved && !appendixRunning) {
        if (appendixDoc?.publicationReady === false) {
          primary = {
            label: "Prepare Jira Publication",
            description: appendixDoc.publicationError,
            action: "VERIFY_JIRA_PROJECT",
            data: { "quest-id": id, "artifact-id": appendixDoc?.id || "" },
          };
        } else {
          primary = {
            label: tasks.some((t) => t.jira)
              ? "+ Publish All Remaining Jira Tickets"
              : "+ Publish to Jira (Sample)",
            action: "PUBLISH_JIRA",
            description: appendixDoc.publicationWarning,
            data: { "quest-id": id },
          };
        }
      } else if (!appendixRunning) {
        primary = {
          label: appendixFailed
            ? "+ Retry Appendix Generation"
            : appendixDoc
              ? "+ Regenerate Jira Appendix"
              : "+ Generate Jira Appendix",
          action: "appendix-dialog",
          data: { "quest-id": id },
        };
      }

      secondary.push({
        label: "Edit Jira Configuration",
        action: "jira-settings",
        data: { "quest-id": id },
      });
      secondary.push({
        label: "Import Jira Appendix",
        action: "edit-appendix",
        data: { "quest-id": id },
      });
      if (!tasks.some((t) => t.jira)) {
        secondary.push({
          label: "Use Existing Jira Task",
          action: "existing-jira-dialog",
          data: { "quest-id": id },
        });
      }
      if (appendixReady && appendixApproved) {
        secondary.push({
          label: "Prepare Jira Publication",
          action: "VERIFY_JIRA_PROJECT",
          data: { "quest-id": id, "artifact-id": appendixDoc?.id || "" },
        });
      }
    }
    if (implementationComplete(state,quest)) {
      primary = {label:"Review Findings",href:`#quest/${id}/work`};
    } else if (["TASKS_PUBLISHED", "EXECUTING"].includes(quest.state)) {
      primary = {
        label: "+ Start Implementation",
        action: "EXECUTE_QUEST",
        data: { "quest-id": id },
      };
      if (quest.autoExecute) {
        secondary.push({
          label: "Pause Scheduling",
          action: "PAUSE_QUEST",
          data: { "quest-id": id },
        });
      }
    }
    if (["READY_FOR_PR", "REVIEW_HANDOFF", "PRS_CREATED"].includes(quest.state)) {
      primary = {
        label: quest.state === "PRS_CREATED" ? "View Pull Requests" : "Review Repository Changes",
        href: `#quest/${id}/work`,
      };
    }
  }

  return { primary, secondary, active };
}

function ActionTriggerButton({ item, primary = false }) {
  if (!item) return null;
  const className = primary
    ? "inline-flex h-8 items-center gap-1.5 rounded-lg bg-emerald-400 px-3.5 text-xs font-semibold text-zinc-950 shadow-sm transition-colors hover:bg-emerald-300"
    : "inline-flex h-8 items-center gap-1.5 rounded-lg border border-zinc-700/80 bg-zinc-800/90 px-3 text-xs font-medium text-zinc-200 transition-colors hover:border-zinc-600 hover:bg-zinc-800";

  if (item.href) {
    return (
      <a href={item.href} className={className}>
        {item.label}
      </a>
    );
  }
  const dataAttrs = {};
  for (const [k, v] of Object.entries(item.data || {})) {
    dataAttrs[`data-${k}`] = v;
  }
  return (
    <button type="button" data-action={item.action} {...dataAttrs} className={className}>
      {item.label}
    </button>
  );
}

/* ==========================================================================
   TAB 1: OVERVIEW (65% / 35% Two-Column Developer Workstation Layout)
   ========================================================================== */
function OverviewTab({ state, quest, actions }) {
  const id = quest.id;
  const tasks = (state.tasks || []).filter((t) => t.questId === id);
  const works = (state.works || []).filter((w) => w.questId === id);
  const runs = (state.runs || []).filter((r) => r.questId === id);
  const { primary, secondary, active } = computeStageActions(state, quest);
  const currentStageName = getStageLabel(state, quest);

  const sourceDoc =
    getArtifact(state, id, quest.kind === "PRODUCT" ? "prd" : "spec") ||
    getArtifact(state, id, "technical-brief") ||
    getArtifact(state, id, "idea") ||
    getArtifact(state, id, "tech_goal") ||
    getArtifact(state, id, "prd");

  const linkedRepos = (quest.repositoryIds || []).map((repoId) => {
    const repo = (state.repositories || []).find((r) => r.id === repoId);
    const work = works.find((w) => w.repoId === repoId);
    return {
      id: repoId,
      name: repo?.name || repoId,
      path: repo?.path || "Local repository",
      branch: work?.branch || repo?.baseBranch || repo?.defaultBranch || "development",
      target: work?.prTarget || repo?.prTarget || "development",
      status: repo?.error ? "RECOVERY_REQUIRED" : work?.state || "READY",
    };
  });

  const recentRuns = latestRunAttempts(runs).slice(-3).reverse();
  const blockers = state.questRooms?.[id]?.blockers || [];
  const blockedReviews = works.filter(w=>["CHANGES_REQUIRED","NEEDS_HUMAN_ATTENTION","BLOCKED"].includes(w.productionReview?.verdict));
  const completedTasks = tasks.filter((t) => t.state === "COMPLETED").length;

  return (
    <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,65fr)_minmax(0,35fr)]">
      {/* LEFT COLUMN (65%): Next Action Card + Project Brief Card */}
      <div className="min-w-0 space-y-5">
        {/* Next Action Card */}
        <Card className="border-zinc-800 bg-zinc-900">
          <CardHeader className="border-b border-zinc-800/80 px-5 py-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className="flex size-6 items-center justify-center rounded-md bg-emerald-500/15 text-emerald-400">
                  <Play className="size-3.5" />
                </span>
                <CardTitle className="text-sm font-semibold text-zinc-100">
                  Next Action · {currentStageName}
                </CardTitle>
              </div>
              <Badge
                variant="outline"
                className="border-emerald-500/30 bg-emerald-500/10 text-[11px] text-emerald-300"
              >
                Stage {getStageIndex(quest,state) + 1} of 5
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-4 p-5">
            {implementationComplete(state,quest) && blockedReviews.length > 0 &&
              <p className="rounded border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200">
                Review finished with unresolved findings: {blockedReviews.map(w=>(state.repositories || []).find(r=>r.id===w.repoId)?.name || w.repoId).join(", ")}. A completed reviewer session is not an approval; review these findings before creating a PR.
              </p>}
            <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
              <div className="space-y-1">
                <h3 className="text-sm font-medium text-zinc-100">
                  {quest.state === "PRS_CREATED"
                    ? "All pull requests and configured handoffs are complete"
                    : quest.state === "BRAINSTORM_COMPLETED"
                      ? "Technical specification saved — analyze repository impact next"
                      : active
                        ? "An AI agent session is currently active or awaiting your reply"
                        : implementationComplete(state,quest)
                          ? "Implementation complete — review findings and readiness"
                          : `Ready for ${currentStageName.toLowerCase()} execution`}
                </h3>
                <p className="text-xs leading-relaxed text-zinc-400">
                  {quest.state === "PRS_CREATED"
                    ? "Inspect pull request links and QA verification records in the Work tab."
                    : active
                      ? "Open the Agent Room to inspect live streaming output or answer pending agent questions."
                      : "Trigger the immediate workflow action below or review saved design artifacts before proceeding."}
                </p>
              </div>
              <div className="shrink-0">
                <ActionTriggerButton item={primary} primary />
              </div>
            </div>

            {primary?.description && <p role="status" className="text-xs text-amber-300">{primary.description}</p>}
            {(secondary.length > 0 || quest.workflowVersion !== 2) && (
              <div className="flex flex-wrap items-center gap-2 border-t border-zinc-800/80 pt-3.5">
                {quest.workflowVersion !== 2 && (
                  <select
                    id="quest-runtime"
                    aria-label="Architect runtime"
                    className="h-9 rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-1.5 text-xs leading-5 text-zinc-200"
                  >
                    {Object.entries(state.runtimes || {}).map(([key, rt]) => (
                      <option key={key} value={key} disabled={!rt.available}>
                        {key === "codex" ? "Codex" : "Claude Code"}
                        {rt.available ? "" : " · unavailable"}
                      </option>
                    ))}
                  </select>
                )}
                {secondary.map((item, idx) => (
                  <ActionTriggerButton key={idx} item={item} />
                ))}
              </div>
            )}

            {quest.warnings?.length > 0 && (
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200">
                <p className="font-medium">{quest.warnings.join(" · ")}</p>
                <label className="mt-2 flex items-center gap-2 text-zinc-200">
                  <input type="checkbox" id="accept-warnings" className="rounded border-zinc-700" />
                  Continue with incomplete source context
                </label>
              </div>
            )}

            {blockers.length > 0 && (
              <div className="space-y-2 border-t border-zinc-800 pt-3">
                {blockers.map((b, i) => (
                  <div
                    key={i}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs"
                  >
                    <div>
                      <strong className="text-amber-300">{b.title}</strong>
                      <p className="text-zinc-300">{b.detail}</p>
                    </div>
                    <a
                      href={b.href}
                      {...(b.taskId ? {"data-action":"task-attention","data-task-id":b.taskId} : {})}
                      className="rounded-md border border-amber-400/40 bg-amber-500/20 px-2.5 py-1 text-xs font-medium text-amber-200 hover:bg-amber-500/30"
                    >
                      Review action
                    </a>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Project Brief Card */}
        <Card className="border-zinc-800 bg-zinc-900">
          <CardHeader className="border-b border-zinc-800/80 px-5 py-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <FileText className="size-4 text-zinc-400" />
                <CardTitle className="text-sm font-semibold text-zinc-100">Project Brief</CardTitle>
                {sourceDoc && (
                  <Badge variant="outline" className="border-zinc-700 text-[10px] text-zinc-400">
                    {sourceDoc.kind.toUpperCase()} · r{sourceDoc.revision}
                  </Badge>
                )}
              </div>
              <a
                href={`#quest/${id}/documents`}
                className="text-xs font-medium text-emerald-400 hover:text-emerald-300"
              >
                Open Documents View →
              </a>
            </div>
          </CardHeader>
          <CardContent className="space-y-4 p-5">
            {/* Target Repos & Scope Metadata Bar */}
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-zinc-800/90 bg-zinc-950/60 px-3.5 py-2.5 text-xs">
              <span className="font-medium text-zinc-400">Target Repos:</span>
              {linkedRepos.length > 0 ? (
                linkedRepos.map((repo) => (
                  <span
                    key={repo.id}
                    className="inline-flex items-center gap-1.5 rounded-md border border-zinc-700/80 bg-zinc-900 px-2 py-0.5 font-mono text-[11px] text-zinc-200"
                  >
                    <GitFork className="size-3 text-emerald-400" />
                    {repo.name}
                  </span>
                ))
              ) : (
                <span className="text-zinc-500">No repositories linked</span>
              )}
              <span className="ml-auto text-zinc-400">
                Scope: <strong className="text-zinc-200">{completedTasks}/{tasks.length} tasks</strong>
              </span>
            </div>

            {/* Rendered Markdown Brief */}
            {sourceDoc?.content ? (
              <article
                className="markdown-view max-h-[420px] overflow-y-auto rounded-lg border border-zinc-800/70 bg-zinc-950/50 p-4 text-sm leading-relaxed text-zinc-200"
                dangerouslySetInnerHTML={{ __html: renderMarkdown(sourceDoc.content) }}
              />
            ) : (
              <div className="rounded-lg border border-dashed border-zinc-800 bg-zinc-950/40 p-6 text-center text-xs text-zinc-400">
                Define the project goal, technical brief, or PRD to populate this workspace brief.
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* RIGHT COLUMN (35%): Linked Repositories + Recent Agent Activity */}
      <div className="min-w-0 space-y-5">
        {/* Linked Repositories Card */}
        <Card className="border-zinc-800 bg-zinc-900">
          <CardHeader className="border-b border-zinc-800/80 px-5 py-4">
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
                <GitFork className="size-4 text-zinc-400" />
                Linked Repositories
              </CardTitle>
              <Badge variant="outline" className="border-zinc-700 text-[11px] text-zinc-400">
                {linkedRepos.length}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="divide-y divide-zinc-800/70 p-0">
            {linkedRepos.length > 0 ? (
              linkedRepos.map((repo) => (
                <div key={repo.id} className="space-y-2 px-5 py-3.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-xs font-semibold text-zinc-100">{repo.name}</p>
                      <p className="truncate font-mono text-[11px] text-zinc-500">{repo.path}</p>
                    </div>
                    <StatusPill status={repo.status} />
                  </div>
                  <div className="flex flex-wrap items-center gap-3 text-[11px] text-zinc-400">
                    <span className="inline-flex items-center gap-1 font-mono text-zinc-300">
                      <GitBranch className="size-3 text-emerald-400" />
                      {repo.branch}
                    </span>
                    <span>→ target: {repo.target}</span>
                  </div>
                </div>
              ))
            ) : (
              <p className="p-5 text-center text-xs text-zinc-500">No repositories connected.</p>
            )}
          </CardContent>
        </Card>

        {/* Recent Agent Activity (Last 3 Actions) */}
        <Card className="border-zinc-800 bg-zinc-900">
          <CardHeader className="border-b border-zinc-800/80 px-5 py-4">
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
                <Bot className="size-4 text-zinc-400" />
                Recent Agent Activity
              </CardTitle>
              <a
                href={`#quest/${id}/room`}
                className="text-xs font-medium text-emerald-400 hover:text-emerald-300"
              >
                Open Room →
              </a>
            </div>
          </CardHeader>
          <CardContent className="p-5">
            {recentRuns.length > 0 ? (
              <ol className="dq-timeline space-y-5">
                {recentRuns.map((run) => {
                  const role = roleForRun(run);
                  const summary = String(
                    run.error ||
                      (run.summary || "").replace(/^\s*DEVQUEST_WAITING_INPUT\b[ \t]*(?:\r?\n)?/, "") ||
                      "Executing current workflow stage",
                  ).slice(0, 160);
                  return (
                    <li key={run.id} className="relative flex gap-3">
                      <span className="relative z-10 flex size-8 shrink-0 items-center justify-center rounded-full border border-zinc-700 bg-zinc-950 text-emerald-400">
                        <Bot className="size-3.5" />
                      </span>
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex flex-wrap items-center justify-between gap-1.5">
                          <strong className="text-xs font-semibold text-zinc-100">
                            {role.label}
                          </strong>
                          <StatusPill status={run.state} />
                        </div>
                        <p className="break-words text-xs leading-relaxed text-zinc-400">
                          {summary}
                        </p>
                        <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-[11px] text-zinc-500">
                          <span>
                            {run.runtime === "codex" ? "Codex" : "Claude Code"} ·{" "}
                            {STAGE_NAMES[run.purpose] || run.purpose}
                          </span>
                          {actions.viewRun && (
                            <button
                              type="button"
                              onClick={() => actions.viewRun(run.id)}
                              className="text-emerald-400 hover:underline"
                            >
                              Logs
                            </button>
                          )}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ol>
            ) : (
              <div className="py-6 text-center text-xs text-zinc-500">
                No agent runs recorded for this project yet.
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

/* ==========================================================================
   TAB 2: DOCUMENTS (25% File Tree Sidebar / 75% Markdown Viewport Canvas)
   ========================================================================== */
function DocumentsTab({ state, quest, focusDocument }) {
  const id = quest.id;
  const tasks = (state.tasks || []).filter((t) => t.questId === id);
  const runs = (state.runs || []).filter((r) => r.questId === id);

  const editable =
    !runs.some((run) =>
      ["RUNNING", "WAITING_INPUT", "PAUSED", "INTERRUPTED"].includes(run.state),
    ) && !tasks.some((task) => task.jira);

  const goalArtifact =
    getArtifact(state, id, "idea") ||
    getArtifact(state, id, "tech_goal") ||
    getArtifact(state, id, "prd") ||
    getArtifact(state, id, "technical-brief");
  const analysisArtifact = getArtifact(state, id, "analysis");
  const trdArtifact = getArtifact(state, id, "trd");
  const specArtifact = getArtifact(state, id, "spec");
  const planArtifact = getArtifact(state, id, "plan");
  const ticketArtifact = getArtifact(state, id, "ticket") || getArtifact(state, id, "appendix");
  const appendixArtifact = getArtifact(state, id, "appendix");

  const docItems = [
    {
      key: "goal",
      title: quest.kind === "PRODUCT" ? "Product Requirements" : "Technical Goal",
      fileName: quest.kind === "PRODUCT" ? "prd.md" : "idea.md",
      doc: goalArtifact,
      editAction: null,
      emptyHint: "Created automatically during project intake or brainstorming.",
    },
    ...(analysisArtifact
      ? [
          {
            key: "analysis",
            title: "Repository Analysis",
            fileName: "analysis.md",
            doc: analysisArtifact,
            editAction: null,
            emptyHint: "Run Analyze Requirements & Repositories to generate.",
          },
        ]
      : []),
    {
      key: "trd",
      title: "TRD",
      fileName: "trd.md",
      doc: trdArtifact,
      editAction: editable && trdArtifact ? "edit-trd" : null,
      approveAction: quest.state === "TRD_DRAFT" && trdArtifact ? "APPROVE_TRD" : null,
      emptyHint: "Complete repository analysis and select Generate TRD.",
    },
    {
      key: "spec",
      title: "Specification",
      fileName: "spec.md",
      doc: specArtifact,
      editAction: editable ? "edit-spec" : null,
      canGenerateSpec:
        editable &&
        !(quest.kind === "TECH" && quest.designProtocol === 1) &&
        ["TRD_APPROVED", "PLAN_DRAFT", "PLAN_APPROVED"].includes(quest.state),
      emptyHint:
        "Generate or import a specification after TRD approval, or run Brainstorm for Tech Quests.",
    },
    {
      key: "plan",
      title: "Implementation Plan",
      fileName: "plan.md",
      doc: planArtifact,
      editAction: editable && planArtifact ? "edit-plan" : null,
      approveAction: quest.state === "PLAN_DRAFT" && planArtifact ? "APPROVE_PLAN" : null,
      emptyHint: "Approve the TRD first, then generate or write the implementation plan.",
    },
    {
      key: "ticket",
      title: "Jira Tickets",
      fileName: appendixArtifact && !getArtifact(state, id, "ticket") ? "appendix.md" : "ticket.md",
      doc: ticketArtifact,
      editAction: editable ? "edit-appendix" : null,
      isAppendix: ticketArtifact?.kind === "appendix",
      emptyHint: "Generate a Jira appendix from the approved plan or link an existing QA issue.",
    },
  ];

  if (appendixArtifact && getArtifact(state, id, "ticket")) {
    docItems.push({
      key: "appendix",
      title: "Jira Appendix",
      fileName: "appendix.md",
      doc: appendixArtifact,
      editAction: editable ? "edit-appendix" : null,
      isAppendix: true,
      emptyHint: "Weighted Jira task appendix.",
    });
  }

  const initialKey =
    focusDocument && docItems.some((d) => d.key === focusDocument)
      ? focusDocument
      : docItems.find((d) => d.doc)?.key || "goal";

  const [selectedKey, setSelectedKey] = useState(initialKey);
  const [viewMode, setViewMode] = useState("viewer");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (focusDocument && docItems.some((d) => d.key === focusDocument)) {
      setSelectedKey(focusDocument);
    }
  }, [focusDocument]);

  const activeEntry = docItems.find((d) => d.key === selectedKey) || docItems[0];
  const activeDoc = activeEntry?.doc;

  const isStaleSpec =
    activeEntry?.key === "spec" &&
    activeDoc &&
    activeDoc.sourceStage !== "brainstorm" &&
    activeDoc.trdArtifactId !== trdArtifact?.id;

  const handleCopy = async () => {
    if (!activeDoc?.content || typeof navigator === "undefined" || !navigator.clipboard) return;
    try {
      await navigator.clipboard.writeText(activeDoc.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Ignore clipboard failures
    }
  };

  return (
    <div className="grid items-start gap-5 lg:grid-cols-[minmax(220px,25fr)_minmax(0,75fr)]">
      {/* LEFT FILE TREE NAV (25%) */}
      <Card className="border-zinc-800 bg-zinc-900">
        <CardHeader className="border-b border-zinc-800/80 px-4 py-3.5">
          <div className="flex items-center justify-between">
            <CardTitle className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
              Document Tree
            </CardTitle>
            <Badge variant="outline" className="border-zinc-700 text-[10px] text-zinc-400">
              {docItems.filter((d) => d.doc).length}/{docItems.length} saved
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-1 p-2">
          {docItems.map((item) => {
            const selected = item.key === activeEntry.key;
            const hasDoc = Boolean(item.doc);
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => {
                  setSelectedKey(item.key);
                  setCopied(false);
                }}
                className={`flex w-full items-center justify-between gap-2 rounded-lg border px-3 py-2.5 text-left text-xs transition-colors ${
                  selected
                    ? "border-emerald-500/40 bg-emerald-500/10 text-zinc-100"
                    : "border-transparent text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-200"
                }`}
              >
                <div className="flex min-w-0 items-center gap-2.5">
                  <FileText
                    className={`size-4 shrink-0 ${selected ? "text-emerald-400" : hasDoc ? "text-zinc-400" : "text-zinc-600"}`}
                  />
                  <div className="min-w-0">
                    <p className="truncate font-medium">{item.title}</p>
                    <p className="truncate font-mono text-[10px] text-zinc-500">{item.fileName}</p>
                  </div>
                </div>
                {hasDoc ? (
                  <span className="shrink-0 rounded border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 font-mono text-[10px] text-emerald-300">
                    r{item.doc.revision}
                  </span>
                ) : (
                  <span className="shrink-0 rounded border border-zinc-800 bg-zinc-950 px-1.5 py-0.5 text-[10px] text-zinc-500">
                    Empty
                  </span>
                )}
              </button>
            );
          })}
        </CardContent>
      </Card>

      {/* RIGHT DOCUMENT VIEWPORT (75%) */}
      <Card className="min-w-0 border-zinc-800 bg-zinc-900">
        <CardHeader className="border-b border-zinc-800/80 px-5 py-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <CardTitle className="text-base font-semibold text-zinc-100">
                  {activeEntry.title}
                </CardTitle>
                <span className="rounded border border-zinc-700 bg-zinc-950 px-2 py-0.5 font-mono text-[11px] text-zinc-400">
                  {activeEntry.fileName}
                </span>
                {activeDoc && (
                  <Badge
                    variant="outline"
                    className="border-emerald-500/30 bg-emerald-500/10 text-[11px] text-emerald-300"
                  >
                    Revision {activeDoc.revision}
                  </Badge>
                )}
                {activeEntry.isAppendix && activeDoc?.approved && (
                  <StatusPill status="APPROVED" />
                )}
              </div>
              {activeDoc?.file && (
                <p className="truncate font-mono text-[11px] text-zinc-500">{activeDoc.file}</p>
              )}
            </div>

            {/* Viewport Action Toolbar: Copy, Rendered/Source Toggle, Edit, Approve, Download */}
            <div className="flex flex-wrap items-center gap-2">
              {activeDoc && !activeDoc.error && (
                <>
                  <div className="inline-flex rounded-lg border border-zinc-800 bg-zinc-950 p-0.5">
                    <button
                      type="button"
                      onClick={() => setViewMode("viewer")}
                      className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium ${
                        viewMode === "viewer"
                          ? "bg-zinc-800 text-zinc-100"
                          : "text-zinc-400 hover:text-zinc-200"
                      }`}
                    >
                      <Eye className="size-3.5" />
                      Rendered
                    </button>
                    <button
                      type="button"
                      onClick={() => setViewMode("source")}
                      className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium ${
                        viewMode === "source"
                          ? "bg-zinc-800 text-zinc-100"
                          : "text-zinc-400 hover:text-zinc-200"
                      }`}
                    >
                      <Code2 className="size-3.5" />
                      Raw Source
                    </button>
                  </div>

                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleCopy}
                    className="h-8 gap-1.5 border-zinc-700 bg-zinc-950 text-xs text-zinc-200 hover:bg-zinc-800"
                  >
                    {copied ? <Check className="size-3.5 text-emerald-400" /> : <Copy className="size-3.5" />}
                    {copied ? "Copied" : "Copy"}
                  </Button>
                </>
              )}

              {activeEntry.editAction && (
                <button
                  type="button"
                  data-action={activeEntry.editAction}
                  data-quest-id={id}
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-950 px-3 text-xs font-medium text-zinc-200 hover:bg-zinc-800"
                >
                  <Edit3 className="size-3.5" />
                  Edit
                </button>
              )}

              {activeEntry.canGenerateSpec && (
                <button
                  type="button"
                  data-action="GENERATE_SPEC"
                  data-quest-id={id}
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 text-xs font-medium text-emerald-300 hover:bg-emerald-500/20"
                >
                  <Sparkles className="size-3.5" />
                  Generate Spec
                </button>
              )}

              {activeEntry.approveAction && activeDoc && (
                <button
                  type="button"
                  data-action={activeEntry.approveAction}
                  data-quest-id={id}
                  data-artifact-id={activeDoc.id}
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-emerald-400 px-3 text-xs font-semibold text-zinc-950 hover:bg-emerald-300"
                >
                  <Check className="size-3.5" />
                  {activeEntry.key === "trd" ? "Approve TRD" : "Approve Plan"}
                </button>
              )}

              {activeEntry.isAppendix && activeDoc?.approved && (
                <Badge className="border-emerald-500/30 bg-emerald-500/10 text-emerald-300">Approved revision {activeDoc.revision}</Badge>
              )}

              {activeEntry.isAppendix && activeDoc && !activeDoc.approved && (
                <button
                  type="button"
                  disabled={activeDoc.approvalReady === false}
                  title={activeDoc.approvalError || ""}
                  data-action="APPROVE_APPENDIX"
                  data-quest-id={id}
                  data-artifact-id={activeDoc.id}
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-emerald-400 px-3 text-xs font-semibold text-zinc-950 hover:bg-emerald-300 disabled:opacity-50"
                >
                  <Check className="size-3.5" />
                  Approve Appendix
                </button>
              )}

              {activeDoc && !activeDoc.error && (
                <a
                  href={`/api/artifacts/${encodeURIComponent(activeDoc.id)}`}
                  download
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-950 px-3 text-xs font-medium text-zinc-200 hover:bg-zinc-800"
                >
                  <Download className="size-3.5" />
                  Download .md
                </a>
              )}
            </div>
          </div>
        </CardHeader>

        <CardContent className="p-5">
          {isStaleSpec && (
            <div className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200">
              The TRD changed after this specification was saved. Regenerate or update this specification before using it.
            </div>
          )}

          {activeDoc ? (
            activeDoc.error ? (
              <pre className="overflow-x-auto rounded-lg border border-red-500/30 bg-zinc-950 p-4 font-mono text-xs text-red-300">
                {activeDoc.error}
              </pre>
            ) : viewMode === "source" ? (
              <pre
                tabIndex={0}
                aria-label={`${activeEntry.title} original Markdown`}
                className="max-h-[640px] overflow-auto rounded-lg border border-zinc-800 bg-zinc-950 p-5 font-mono text-xs leading-relaxed text-zinc-200"
              >
                {activeDoc.content}
              </pre>
            ) : (
              <article
                tabIndex={0}
                aria-label={`${activeEntry.title} rendered Markdown`}
                className="markdown-view max-h-[640px] overflow-y-auto rounded-lg border border-zinc-800 bg-zinc-950 p-6 text-sm leading-relaxed text-zinc-200"
                dangerouslySetInnerHTML={{ __html: renderMarkdown(activeDoc.content) }}
              />
            )
          ) : (
            <div className="flex min-h-[320px] flex-col items-center justify-center rounded-lg border border-dashed border-zinc-800 bg-zinc-950/50 p-8 text-center">
              <FileText className="mb-3 size-8 text-zinc-600" />
              <h3 className="text-sm font-semibold text-zinc-200">
                {activeEntry.title} not generated yet
              </h3>
              <p className="mt-1 max-w-md text-xs leading-relaxed text-zinc-400">
                {activeEntry.emptyHint}
              </p>
              {activeEntry.editAction && (
                <button
                  type="button"
                  data-action={activeEntry.editAction}
                  data-quest-id={id}
                  className="mt-4 inline-flex h-8 items-center gap-1.5 rounded-lg bg-emerald-400 px-3.5 text-xs font-semibold text-zinc-950 hover:bg-emerald-300"
                >
                  <Edit3 className="size-3.5" />
                  Write / Import {activeEntry.title}
                </button>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/* ==========================================================================
   TAB 3: WORK (4-Column Task Pipeline View + Repository PRs & QA)
   ========================================================================== */
function WorkTab({ state, quest }) {
  const id = quest.id;
  const tasks = (state.tasks || []).filter((t) => t.questId === id);
  const works = (state.works || []).filter((w) => w.questId === id);
  const runs = (state.runs || []).filter((r) => r.questId === id);
  const qaCases = (state.qaCases || []).filter((c) => c.questId === id);

  const classifyTask = (task) => {
    if (task.state === "COMPLETED" || task.state === "PASSED") return "done";
    if (
      ["AWAITING_TEST", "TEST_FAILED", "FAILED", "NEEDS_HUMAN_ATTENTION"].includes(task.state)
    ) {
      return "review";
    }
    if (["PREPARING", "RUNNING", "WAITING_INPUT", "PAUSED", "INTERRUPTED"].includes(task.state)) {
      return "progress";
    }
    return "queue";
  };

  const columns = [
    { key: "queue", title: "Queue", items: tasks.filter((t) => classifyTask(t) === "queue") },
    {
      key: "progress",
      title: "In Progress",
      items: tasks.filter((t) => classifyTask(t) === "progress"),
    },
    {
      key: "review",
      title: "Code Review",
      items: tasks.filter((t) => classifyTask(t) === "review"),
    },
    { key: "done", title: "Done", items: tasks.filter((t) => classifyTask(t) === "done") },
  ];

  const getTaskTestPill = (task) => {
    if (task.validation?.passed === true || task.state === "COMPLETED") {
      return (
        <span className="inline-flex items-center gap-1 rounded border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 font-mono text-[10px] text-emerald-300">
          <CheckCircle2 className="size-3" />
          {task.validationProfile || "tests"}: PASS
        </span>
      );
    }
    if (task.state === "TEST_FAILED" || task.validation?.passed === false) {
      return (
        <span className="inline-flex items-center gap-1 rounded border border-red-500/30 bg-red-500/10 px-1.5 py-0.5 font-mono text-[10px] text-red-300">
          <XCircle className="size-3" />
          {task.validationProfile || "tests"}: FAIL
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 rounded border border-zinc-700 bg-zinc-950 px-1.5 py-0.5 font-mono text-[10px] text-zinc-400">
        <CircleDot className="size-3 text-amber-400" />
        {task.validationProfile || "no-profile"}
      </span>
    );
  };

  return (
    <div className="space-y-6">
      {/* 4-Column Task Pipeline View */}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {columns.map((col) => (
          <Card key={col.key} className="flex flex-col border-zinc-800 bg-zinc-900">
            <CardHeader className="border-b border-zinc-800/80 px-4 py-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-xs font-semibold uppercase tracking-wider text-zinc-300">
                  {col.title}
                </CardTitle>
                <Badge variant="outline" className="border-zinc-700 text-[11px] text-zinc-400">
                  {col.items.length}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="flex-1 space-y-3 p-3">
              {col.items.length > 0 ? (
                col.items.map((task) => {
                  const repo = (state.repositories || []).find((r) => r.id === task.repoId);
                  const work = works.find((w) => w.repoId === task.repoId);
                  const taskRun = runs.filter((r) => r.taskId === task.id).at(-1);
                  const agentRoleLabel = taskRun ? roleForRun(taskRun).label : "Developer";
                  const branchName =
                    task.workspace?.branch ||
                    work?.branch ||
                    repo?.baseBranch ||
                    repo?.defaultBranch ||
                    "development";

                  return (
                    <article
                      key={task.id}
                      className="space-y-2.5 rounded-lg border border-zinc-800 bg-zinc-950/80 p-3.5"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-1.5">
                        <span className="font-mono text-[11px] font-semibold text-emerald-400">
                          {task.key}
                        </span>
                        {task.jira?.key && (
                          <span className="rounded border border-zinc-700 bg-zinc-900 px-1.5 py-0.5 font-mono text-[10px] text-zinc-300">
                            {task.jira.key}
                          </span>
                        )}
                        <StatusPill status={task.state} />
                      </div>

                      <h4 className="text-xs font-semibold leading-snug text-zinc-100">
                        {task.title}
                      </h4>

                      {task.error && <div className="rounded border border-amber-500/30 bg-amber-500/10 p-2 text-xs text-amber-200">
                        <p>{task.error.split("\n")[0]}</p>
                        <button type="button" data-action="task-attention" data-task-id={task.id}
                          className="mt-2 underline">Review blocker</button>
                      </div>}

                      {/* Agent Role + Git Branch + Test Status Pills */}
                      <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                        <span className="inline-flex items-center gap-1 rounded border border-zinc-800 bg-zinc-900 px-1.5 py-0.5 text-[10px] font-medium text-zinc-300">
                          <Bot className="size-3 text-emerald-400" />
                          {agentRoleLabel}
                        </span>
                        <span className="inline-flex items-center gap-1 rounded border border-zinc-800 bg-zinc-900 px-1.5 py-0.5 font-mono text-[10px] text-zinc-300">
                          <GitBranch className="size-3 text-sky-400" />
                          {repo?.name || task.repoId}:{branchName}
                        </span>
                        {getTaskTestPill(task)}
                      </div>

                      {task.dependencies?.length > 0 && (
                        <p className="text-[11px] text-zinc-500">
                          Depends on:{" "}
                          {task.dependencies
                            .map((depId) => state.tasks.find((t) => t.id === depId)?.key || depId)
                            .join(", ")}
                        </p>
                      )}

                      {task.validation?.summary && (
                        <pre className="max-h-20 overflow-auto rounded border border-zinc-800/80 bg-zinc-900/90 p-2 font-mono text-[10px] text-zinc-300">
                          {task.validation.summary}
                        </pre>
                      )}

                      {/* Task Controls */}
                      <div className="flex flex-wrap items-center gap-1.5 border-t border-zinc-800/70 pt-2">
                        {quest.workflowVersion !== 2 && (
                          <select
                            aria-label={`Runtime for ${task.key}`}
                            data-task-runtime={task.id}
                            className="h-8 rounded border border-zinc-700 bg-zinc-900 px-2.5 py-1 text-[11px] leading-4 text-zinc-200"
                          >
                            {Object.entries(state.runtimes || {}).map(([key, rt]) => (
                              <option key={key} value={key} disabled={!rt.available}>
                                {key === "codex" ? "Codex" : "Claude Code"}
                              </option>
                            ))}
                          </select>
                        )}
                        {task.state === "PUBLISHED" && (
                          <button
                            type="button"
                            data-action="START_TASK"
                            data-quest-id={id}
                            data-task-id={task.id}
                            className="rounded bg-emerald-400 px-2.5 py-1 text-[11px] font-semibold text-zinc-950 hover:bg-emerald-300"
                          >
                            Start
                          </button>
                        )}
                        {["AWAITING_TEST", "TEST_FAILED", "COMPLETED"].includes(task.state) && (
                          <button
                            type="button"
                            data-action="RUN_TEST"
                            data-quest-id={id}
                            data-task-id={task.id}
                            className="rounded border border-zinc-700 bg-zinc-900 px-2.5 py-1 text-[11px] font-medium text-zinc-200 hover:bg-zinc-800"
                          >
                            Run Tests
                          </button>
                        )}
                        {quest.workflowVersion !== 2 &&
                          ["COMPLETED", "TEST_FAILED"].includes(task.state) && (
                            <button
                              type="button"
                              data-action="REOPEN_TASK"
                              data-quest-id={id}
                              data-task-id={task.id}
                              className="rounded border border-zinc-700 bg-zinc-900 px-2.5 py-1 text-[11px] font-medium text-zinc-200 hover:bg-zinc-800"
                            >
                              Reopen
                            </button>
                          )}
                        {quest.workflowVersion === 2 &&
                          ["FAILED", "INTERRUPTED", "CANCELLED", "NEEDS_HUMAN_ATTENTION"].includes(
                            task.state,
                          ) &&
                          !task.integratedCommit && (
                            <button
                              type="button"
                              data-action="RETRY_TASK"
                              data-quest-id={id}
                              data-task-id={task.id}
                              className="rounded border border-zinc-700 bg-zinc-900 px-2.5 py-1 text-[11px] font-medium text-zinc-200 hover:bg-zinc-800"
                            >
                              Retry Task
                            </button>
                          )}
                        {quest.workflowVersion === 2 &&
                          ["PREPARING", "RUNNING", "WAITING_INPUT"].includes(task.state) && (
                            <button
                              type="button"
                              data-action="CANCEL_TASK"
                              data-quest-id={id}
                              data-task-id={task.id}
                              className="rounded border border-red-500/40 bg-red-500/10 px-2.5 py-1 text-[11px] font-medium text-red-300 hover:bg-red-500/20"
                            >
                              Cancel
                            </button>
                          )}
                      </div>
                    </article>
                  );
                })
              ) : (
                <div className="flex min-h-[140px] items-center justify-center rounded-lg border border-dashed border-zinc-800/80 p-4 text-center text-xs text-zinc-500">
                  No tasks in {col.title.toLowerCase()}
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Repository Integration, Code Review & PR Handoff Section */}
      <div className="grid gap-5 lg:grid-cols-2">
        <Card className="border-zinc-800 bg-zinc-900">
          <CardHeader className="border-b border-zinc-800/80 px-5 py-4">
            <CardTitle className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
              <GitPullRequest className="size-4 text-emerald-400" />
              Repository Worktrees & Pull Request Handoff
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 p-5">
            {works.length > 0 ? (
              works.map((work) => {
                const repo = (state.repositories || []).find((r) => r.id === work.repoId);
                const publication = (state.operations || []).find(o=>o.id===`pr:${work.id}`);
                const publishing = publication?.state === "RUNNING";
                const savedPublicationError = !work.pr && publication?.state !== "RUNNING" && publication?.error;
                const publicationError = savedPublicationError && /(?:@|\/\/)bitbucket\.org[:/]/i.test(repo?.remote || "") &&
                  /known GitHub host/.test(savedPublicationError)
                    ? state.settings?.provider === "Bitbucket MCP"
                      ? "The previous attempt used GitHub CLI and failed. Bitbucket MCP is now configured; retry Create PR to publish through Bitbucket. Your review approval is preserved."
                      : "PR creation failed: this is a Bitbucket repository, but the configured publisher uses GitHub CLI. A Bitbucket PR integration is required. Your review approval is preserved."
                    : savedPublicationError;
                return (
                  <div
                    key={work.id}
                    className="space-y-3 rounded-lg border border-zinc-800 bg-zinc-950/70 p-4"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <h4 className="text-xs font-semibold text-zinc-100">
                          {repo?.name || work.repoId}
                        </h4>
                        <p className="font-mono text-[11px] text-zinc-400">
                          {work.branch} → {work.prTarget || "development"}
                        </p>
                      </div>
                      <StatusPill status={work.state} />
                    </div>
                    <p className="truncate font-mono text-[11px] text-zinc-500">{work.path}</p>
                    {(work.error || publicationError) && (
                      <p className="rounded border border-red-500/30 bg-red-500/10 p-2 text-xs text-red-300">
                        {work.error || publicationError}
                      </p>
                    )}
                    {work.review?.summary && (
                      <pre className="max-h-32 overflow-auto rounded border border-zinc-800 bg-zinc-900 p-2.5 font-mono text-[11px] text-zinc-300">
                        {work.review.summary}
                      </pre>
                    )}
                    <div className="flex flex-wrap items-center gap-2 pt-1">
                      {!work.pr && (
                        <button
                          type="button"
                          data-action="REVIEW_REPOSITORY"
                          data-quest-id={id}
                          data-work-id={work.id}
                          className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs font-medium text-zinc-200 hover:bg-zinc-800"
                        >
                          Review Repository
                        </button>
                      )}
                      {work.humanApprovedCommit && !work.pr && <span className="text-xs text-emerald-300">Review approved</span>}
                      {(work.review || work.productionReview?.verdict === "PASSED") && !work.pr && !work.humanApprovedCommit && (
                        <button
                          type="button"
                          data-action="APPROVE_REVIEW"
                          data-quest-id={id}
                          data-work-id={work.id}
                          className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-300 hover:bg-emerald-500/20"
                        >
                          Approve Review
                        </button>
                      )}
                      {work.state === "READY_FOR_PR" && (
                        <button
                          type="button"
                          data-action="create-pr-dialog"
                          disabled={publishing}
                          data-quest-id={id}
                          data-work-id={work.id}
                          className="rounded-lg bg-emerald-400 px-3 py-1.5 text-xs font-semibold text-zinc-950 hover:bg-emerald-300"
                        >
                          {publishing ? "Creating pull request…" : `Create PR → ${work.prTarget || "development"}`}
                        </button>
                      )}
                      {work.pr && !work.notifiedAt && !work.notification && (
                        <button
                          type="button"
                          data-action="reviewers-dialog"
                          data-quest-id={id}
                          data-work-id={work.id}
                          className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs font-medium text-zinc-200 hover:bg-zinc-800"
                        >
                          Request Reviewers
                        </button>
                      )}
                      {work.pr && (
                        <a
                          href={safeUrl(work.pr.url)}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 rounded-lg bg-emerald-400 px-3 py-1.5 text-xs font-semibold text-zinc-950 hover:bg-emerald-300"
                        >
                          View Pull Request
                          <ExternalLink className="size-3" />
                        </a>
                      )}
                    </div>
                  </div>
                );
              })
            ) : (
              <p className="py-6 text-center text-xs text-zinc-500">
                Isolated Git worktrees are prepared automatically when task execution starts.
              </p>
            )}
          </CardContent>
        </Card>

        {/* Manual QA & Verification Summary */}
        <Card className="border-zinc-800 bg-zinc-900">
          <CardHeader className="border-b border-zinc-800/80 px-5 py-4">
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
                <ShieldCheck className="size-4 text-emerald-400" />
                Tests & Human QA Scenarios
              </CardTitle>
              <Badge variant="outline" className="border-zinc-700 text-[11px] text-zinc-400">
                {qaCases.length} scenarios
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-4 p-5">
            {qaCases.length > 0 ? (
              <div className="space-y-2.5">
                {qaCases.map((c) => {
                  const latestEv = c.evidence?.at(-1);
                  return (
                    <div
                      key={c.id}
                      className="flex items-start justify-between gap-3 rounded-lg border border-zinc-800 bg-zinc-950/70 p-3 text-xs"
                    >
                      <div className="space-y-1">
                        <p className="font-semibold text-zinc-100">{c.title}</p>
                        <p className="text-zinc-400">Expected: {c.expected}</p>
                      </div>
                      <StatusPill status={latestEv?.status || "NOT_TESTED"} />
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-xs text-zinc-500">
                No manual QA scenarios recorded yet. Add a scenario below to track human verification.
              </p>
            )}

            <form
              data-form="qa-case"
              data-collaboration="true"
              data-draft-key="qa-case"
              className="space-y-3.5 rounded-lg border border-zinc-800/90 bg-zinc-950/50 p-4"
            >
              <input type="hidden" name="questId" value={id} />
              <p className="text-xs font-semibold text-zinc-200">Add QA Scenario</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="grid min-w-0 gap-1.5 text-[11px] font-medium text-zinc-400">
                  <span>Repository</span>
                  <select
                    name="repositoryId"
                    aria-label="QA Repository"
                    className="h-9 w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs leading-5 text-zinc-100 focus:border-emerald-500/60 focus:outline-none"
                  >
                    {(quest.repositoryIds || []).map((rId) => (
                      <option key={rId} value={rId}>
                        {(state.repositories || []).find((r) => r.id === rId)?.name || rId}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="grid min-w-0 gap-1.5 text-[11px] font-medium text-zinc-400">
                  <span>Scenario Title</span>
                  <input
                    name="title"
                    required
                    maxLength={200}
                    placeholder="Scenario title…"
                    className="h-9 w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs leading-5 text-zinc-100 focus:border-emerald-500/60 focus:outline-none"
                  />
                </label>
              </div>
              <label className="grid min-w-0 gap-1.5 text-[11px] font-medium text-zinc-400">
                <span>Expected Behavior & Verification Criteria</span>
                <textarea
                  name="expected"
                  required
                  rows={2}
                  maxLength={2000}
                  placeholder="Expected behavior and verification criteria…"
                  className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs leading-relaxed text-zinc-100 focus:border-emerald-500/60 focus:outline-none"
                />
              </label>
              <label className="grid min-w-0 gap-1.5 text-[11px] font-medium text-zinc-400">
                <span>Existing QA Jira Issue (Optional)</span>
                <input
                  name="jiraKey"
                  placeholder="e.g. PROJ-123 (leave blank if none)"
                  className="h-9 w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs leading-5 text-zinc-100 focus:border-emerald-500/60 focus:outline-none"
                />
              </label>
              <p className="form-error text-xs text-red-300" role="alert" />
              <button
                type="submit"
                className="inline-flex h-8 items-center rounded-lg border border-zinc-700 bg-zinc-800 px-3.5 text-xs font-medium text-zinc-100 transition-colors hover:bg-zinc-700"
              >
                Save QA Scenario
              </button>
            </form>

            {qaCases.length > 0 && (
              <form
                data-form="qa-result"
                data-collaboration="true"
                data-draft-key="qa-result"
                className="space-y-3.5 rounded-lg border border-zinc-800/90 bg-zinc-950/50 p-4"
              >
                <input type="hidden" name="questId" value={id} />
                <p className="text-xs font-semibold text-zinc-200">Record Human Test Result</p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="grid min-w-0 gap-1.5 text-[11px] font-medium text-zinc-400">
                    <span>Scenario</span>
                    <select
                      name="caseId"
                      className="h-9 w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs leading-5 text-zinc-100"
                    >
                      {qaCases.map((c) => (
                        <option key={c.id} value={`${c.id}|${c.revision}`}>
                          {c.title}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="grid min-w-0 gap-1.5 text-[11px] font-medium text-zinc-400">
                    <span>Outcome</span>
                    <select
                      name="status"
                      className="h-9 w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs leading-5 text-zinc-100"
                    >
                      <option value="PASSED">Passed</option>
                      <option value="FAILED">Failed</option>
                    </select>
                  </label>
                </div>
                <label className="grid min-w-0 gap-1.5 text-[11px] font-medium text-zinc-400">
                  <span>Observed Result</span>
                  <textarea
                    name="actual"
                    required
                    rows={2}
                    maxLength={2000}
                    placeholder="What you observed during manual verification…"
                    className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs leading-relaxed text-zinc-100"
                  />
                </label>
                <p className="form-error text-xs text-red-300" role="alert" />
                <button
                  type="submit"
                  className="inline-flex h-8 items-center rounded-lg bg-emerald-400 px-3.5 text-xs font-semibold text-zinc-950 hover:bg-emerald-300"
                >
                  Record Result
                </button>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

/* ==========================================================================
   TAB 4: ROOM (Interactive Agent Room Layout: Center Feed + Bottom Input Bar)
   ========================================================================== */
function RoomTab({ state, quest, actions }) {
  const id = quest.id;
  const room = state.questRooms?.[id];
  const timeline = room?.timeline || [];
  const runs = (state.runs || []).filter((r) => r.questId === id);

  // Eligible stopped runs that can receive a directed instruction
  const stoppedRuns = runs.filter((r) => {
    const downstream = {
      brainstorm: ["analysis", "trd", "plan"],
      analysis: ["trd", "plan"],
      trd: ["plan"],
    }[r.purpose];
    const latest = runs
      .filter(
        (other) =>
          other.purpose === r.purpose &&
          other.taskId === r.taskId &&
          other.workId === r.workId,
      )
      .at(-1);
    return (
      r.purpose !== "jira_publish" &&
      !r.replacedBy &&
      latest?.id === r.id &&
      !downstream?.some((kind) => getArtifact(state, id, kind)) &&
      ["WAITING_INPUT", "PAUSED", "INTERRUPTED", "FAILED", "COMPLETED"].includes(r.state)
    );
  });

  const [mode, setMode] = useState(stoppedRuns.length > 0 ? "instruction" : "note");
  const [messageText, setMessageText] = useState("");
  const [selectedRunToken, setSelectedRunToken] = useState(
    stoppedRuns[0] ? `${stoppedRuns[0].id}|${stoppedRuns[0].updatedAt || ""}` : "",
  );
  const [requestId] = useState(
    () => `${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );

  useEffect(() => {
    if (stoppedRuns.length > 0 && !selectedRunToken) {
      setSelectedRunToken(`${stoppedRuns[0].id}|${stoppedRuns[0].updatedAt || ""}`);
    }
  }, [stoppedRuns, selectedRunToken]);

  const presets = [
    { label: "@Architect analyze impact", role: "architect", text: "@Architect analyze repository impact, boundary contracts, and migration risks." },
    { label: "@Developer write tests", role: "developer", text: "@Developer write comprehensive unit and integration tests covering edge cases." },
    { label: "@Planner refine tasks", role: "planner", text: "@Planner refine task breakdown, validation profiles, and repository dependencies." },
    { label: "@Reviewer check edge cases", role: "reviewer", text: "@Reviewer audit integrated changes for regressions, security, and production readiness." },
  ];

  const applyPreset = (preset) => {
    setMessageText((prev) => (prev ? `${prev}\n${preset.text}` : preset.text));
    const matchingRun = stoppedRuns.find((r) => roleForRun(r).key === preset.role);
    if (matchingRun) {
      setMode("instruction");
      setSelectedRunToken(`${matchingRun.id}|${matchingRun.updatedAt || ""}`);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Main Center Feed: Live Execution Log & Timeline Stream */}
      <Card className="border-zinc-800 bg-zinc-900">
        <CardHeader className="border-b border-zinc-800/80 px-5 py-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <Terminal className="size-4 text-emerald-400" />
              <CardTitle className="text-sm font-semibold text-zinc-100">
                Agent Room · Live Execution & Decision Stream
              </CardTitle>
            </div>
            <div className="flex items-center gap-2 text-xs text-zinc-400">
              <span>{timeline.length} timeline entries</span>
              <span>·</span>
              <span>{runs.filter((r) => r.state === "RUNNING").length} running</span>
            </div>
          </div>
        </CardHeader>

        <CardContent className="max-h-[520px] space-y-4 overflow-y-auto p-5">
          {/* Active Running Sessions Live Stream */}
          {runs
            .filter((r) => r.state === "RUNNING")
            .map((run) => {
              const role = roleForRun(run);
              return (
                <div
                  key={run.id}
                  className="space-y-3 rounded-lg border border-emerald-500/40 bg-zinc-950 p-4"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="size-2 animate-pulse rounded-full bg-emerald-400" />
                      <strong className="text-xs font-semibold text-emerald-300">
                        {role.label} · {run.runtime === "codex" ? "Codex" : "Claude Code"}
                      </strong>
                      <span className="text-xs text-zinc-400">
                        ({STAGE_NAMES[run.purpose] || run.purpose})
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        data-action="PAUSE_AGENT"
                        data-run-id={run.id}
                        className="rounded border border-zinc-700 bg-zinc-900 px-2.5 py-1 text-[11px] text-zinc-200 hover:bg-zinc-800"
                      >
                        Pause
                      </button>
                      <button
                        type="button"
                        data-action={
                          run.purpose === "jira_appendix_generation"
                            ? "CANCEL_APPENDIX"
                            : "INTERRUPT_AGENT"
                        }
                        data-run-id={run.id}
                        className="rounded border border-red-500/40 bg-red-500/10 px-2.5 py-1 text-[11px] text-red-300 hover:bg-red-500/20"
                      >
                        Interrupt
                      </button>
                    </div>
                  </div>
                  <p
                    data-run-progress={run.id}
                    className="font-mono text-[11px] text-zinc-400"
                  >
                    {actions.runProgress ? actions.runProgress(run) : "Agent session running…"}
                  </p>
                  <pre
                    data-output={run.id}
                    className="max-h-48 overflow-auto rounded border border-zinc-800 bg-zinc-900/90 p-3 font-mono text-xs text-zinc-200"
                  >
                    {run.summary || "Streaming live agent output…"}
                  </pre>
                </div>
              );
            })}

          {/* Chronological Timeline Stream (Flat, Zero Nested Accordions) */}
          {timeline.length > 0 ? (
            <ol className="space-y-3">
              {timeline.map((entry, idx) => {
                const isAgent = entry.kind === "agent";
                const canReply =
                  isAgent && stoppedRuns.some((r) => r.id === entry.runId);
                const entryRun = stoppedRuns.find(r=>r.id===entry.runId);
                const entryTask = state.tasks.find(t=>t.id===entryRun?.taskId);
                const retryLimit = Math.max(quest.execution?.limits?.retries || 0, entryTask?.manualRetryLimit || 0);
                const needsRetryAllowance = canReply && entryRun.state !== "WAITING_INPUT" && entryTask &&
                  !entryTask.integratedCommit && (entryTask.retries || 0) >= retryLimit && retryLimit < 10;
                return (
                  <li
                    key={entry.id || idx}
                    className="rounded-lg border border-zinc-800 bg-zinc-950/80 p-4"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-800/70 pb-2.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={`inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-semibold ${
                            isAgent
                              ? "bg-emerald-500/15 text-emerald-300"
                              : "bg-sky-500/15 text-sky-300"
                          }`}
                        >
                          {isAgent ? <Bot className="size-3.5" /> : <MessageSquare className="size-3.5" />}
                          {isAgent ? entry.role : "Owner Note / Instruction"}
                        </span>
                        <span className="font-mono text-xs text-zinc-400">
                          {entry.stage || entry.kind}
                        </span>
                        {entry.state && <StatusPill status={entry.state} />}
                      </div>
                      <div className="flex items-center gap-2">
                        {entry.createdAt && (
                          <time className="font-mono text-[11px] text-zinc-500">
                            {formatTime(entry.createdAt)}
                          </time>
                        )}
                        {needsRetryAllowance && <button type="button" data-action="retry-budget" data-task-id={entryTask.id}
                          className="rounded border border-amber-500/40 bg-amber-500/10 px-2.5 py-0.5 text-[11px] text-amber-300">Allow one more retry</button>}
                        {canReply && (
                          <button
                            type="button"
                            onClick={() => {
                              const run = stoppedRuns.find((r) => r.id === entry.runId);
                              if (run) {
                                setMode("instruction");
                                setSelectedRunToken(`${run.id}|${run.updatedAt || ""}`);
                              }
                            }}
                            className="rounded border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-0.5 text-[11px] font-medium text-emerald-300 hover:bg-emerald-500/20"
                          >
                            {entry.state === "WAITING_INPUT" ? "Answer" : "Reply"}
                          </button>
                        )}
                      </div>
                    </div>

                    <pre className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-zinc-200">
                      {entry.body}
                    </pre>

                    {entry.delivery && (
                      <div className="mt-2.5 flex flex-wrap items-center gap-2 rounded border border-zinc-800 bg-zinc-900/70 px-3 py-1.5 text-[11px] text-zinc-400">
                        <strong className="text-emerald-300">
                          Delivery: {entry.delivery.status}
                        </strong>
                        <span>· {entry.delivery.evidence}</span>
                      </div>
                    )}
                    {entry.error && (
                      <p className="mt-2 rounded border border-red-500/30 bg-red-500/10 p-2 text-xs text-red-300">
                        {entry.error}
                      </p>
                    )}
                  </li>
                );
              })}
            </ol>
          ) : (
            <div className="flex min-h-[220px] flex-col items-center justify-center rounded-lg border border-dashed border-zinc-800 bg-zinc-950/40 p-6 text-center">
              <MessageSquare className="mb-2 size-7 text-zinc-600" />
              <p className="text-sm font-medium text-zinc-300">No agent turns or room notes yet</p>
              <p className="mt-1 max-w-md text-xs text-zinc-500">
                Start a workflow stage or use the composer bar below to save engineering notes and send instructions to stopped agent turns.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Bottom Input Bar: Preset Triggers + Textarea + Send Note / Instruction */}
      <Card className="border-zinc-800 bg-zinc-900">
        <CardContent className="space-y-3.5 p-4 sm:p-5">
          {/* Preset Action Triggers */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
              Quick Presets:
            </span>
            {presets.map((preset) => (
              <button
                key={preset.label}
                type="button"
                onClick={() => applyPreset(preset)}
                className="inline-flex items-center gap-1.5 rounded-full border border-zinc-700/80 bg-zinc-950 px-3 py-1 font-mono text-xs text-emerald-300 transition-colors hover:border-emerald-500/50 hover:bg-emerald-500/10"
              >
                <Sparkles className="size-3" />
                {preset.label}
              </button>
            ))}

            <div className="ml-auto inline-flex rounded-lg border border-zinc-800 bg-zinc-950 p-0.5">
              <button
                type="button"
                onClick={() => setMode("note")}
                className={`rounded-md px-2.5 py-1 text-xs font-medium ${
                  mode === "note"
                    ? "bg-zinc-800 text-zinc-100"
                    : "text-zinc-400 hover:text-zinc-200"
                }`}
              >
                Room Note (No Agent)
              </button>
              <button
                type="button"
                disabled={stoppedRuns.length === 0}
                onClick={() => setMode("instruction")}
                className={`rounded-md px-2.5 py-1 text-xs font-medium disabled:opacity-40 ${
                  mode === "instruction"
                    ? "bg-emerald-500/20 text-emerald-300"
                    : "text-zinc-400 hover:text-zinc-200"
                }`}
              >
                Direct Agent Instruction ({stoppedRuns.length})
              </button>
            </div>
          </div>

          {mode === "instruction" && stoppedRuns.length > 0 ? (
            <form
              data-form="room-reply"
              data-collaboration="true"
              data-draft-key="room-reply"
              className="space-y-3"
            >
              <input type="hidden" name="questId" value={id} />
              <input type="hidden" name="requestId" value={requestId} />
              <div className="flex flex-wrap items-center gap-3">
                <label className="text-xs font-medium text-zinc-300">Target Stopped Agent:</label>
                <select
                  name="runToken"
                  required
                  value={selectedRunToken}
                  onChange={(e) => setSelectedRunToken(e.target.value)}
                  className="h-9 flex-1 rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-1.5 text-xs leading-5 text-zinc-200"
                >
                  {stoppedRuns.map((r) => {
                    const tokenVal = `${r.id}|${r.updatedAt || ""}`;
                    return (
                      <option key={r.id} value={tokenVal}>
                        {roleForRun(r).label} · {STAGE_NAMES[r.purpose] || r.purpose} · {r.state}
                      </option>
                    );
                  })}
                </select>
              </div>
              <textarea
                name="message"
                required
                rows={3}
                maxLength={8000}
                value={messageText}
                onChange={(e) => setMessageText(e.target.value)}
                placeholder="Write an instruction for the selected stopped agent turn (e.g. @Architect analyze impact)…"
                className="w-full rounded-lg border border-zinc-700 bg-zinc-950 p-3 text-xs leading-relaxed text-zinc-100 focus:border-emerald-500/60 focus:outline-none"
              />
              <div className="flex flex-wrap items-center justify-between gap-3">
                <label className="flex items-center gap-2 text-xs text-zinc-400">
                  <input
                    type="checkbox"
                    name="confirmAgentRun"
                    required
                    className="rounded border-zinc-700"
                  />
                  I understand this starts an agent turn and may consume paid usage.
                </label>
                <button
                  type="submit"
                  className="inline-flex h-9 items-center gap-2 rounded-lg bg-emerald-400 px-4 text-xs font-semibold text-zinc-950 hover:bg-emerald-300"
                >
                  <Send className="size-3.5" />
                  Send Note / Instruction to Agent
                </button>
              </div>
              <p className="form-error text-xs text-red-300" role="alert" />
            </form>
          ) : (
            <form
              data-form="room-note"
              data-collaboration="true"
              data-draft-key="room-note"
              className="space-y-3"
            >
              <input type="hidden" name="questId" value={id} />
              <textarea
                name="message"
                required
                rows={3}
                maxLength={8000}
                value={messageText}
                onChange={(e) => setMessageText(e.target.value)}
                placeholder="Save an engineering decision note or handoff observation to this project room (starts no agent)…"
                className="w-full rounded-lg border border-zinc-700 bg-zinc-950 p-3 text-xs leading-relaxed text-zinc-100 focus:border-emerald-500/60 focus:outline-none"
              />
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span className="text-xs text-zinc-500">
                  Saving a note records context in the room without starting an agent or changing approvals.
                </span>
                <button
                  type="submit"
                  className="inline-flex h-9 items-center gap-2 rounded-lg bg-emerald-400 px-4 text-xs font-semibold text-zinc-950 hover:bg-emerald-300"
                >
                  <Send className="size-3.5" />
                  Send Note / Instruction to Agent
                </button>
              </div>
              <p className="form-error text-xs text-red-300" role="alert" />
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/* ==========================================================================
   PROJECT SETTINGS DIALOG (Opened via Header Settings Icon)
   ========================================================================== */
function ProjectSettingsModal({ open, onOpenChange, state, quest }) {
  const id = quest.id;
  const works = (state.works || []).filter((w) => w.questId === id);
  const tasks = (state.tasks || []).filter((t) => t.questId === id && t.workspace?.path);
  const skills = (state.skills || []).filter((skill) =>
    Object.values(skill.compatibility || {}).includes("DECLARED_COMPATIBLE"),
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="dq-popup max-h-[85vh] max-w-2xl overflow-y-auto border-zinc-800 bg-zinc-900 text-zinc-100">
        <DialogHeader>
          <DialogTitle>Project Settings · {quest.title}</DialogTitle>
          <DialogDescription>
            Configure readiness probes, agent profiles, assigned skills, and access preflights.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 pt-2 text-xs">
          {/* Agent Profile Mode */}
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-zinc-800 bg-zinc-950 p-4">
            <div>
              <h4 className="font-semibold text-zinc-100">
                Agent Guidance · {quest.agentProfiles?.enabled ? "Versioned" : "Standard"}
              </h4>
              <p className="mt-0.5 text-zinc-400">
                Project ID: <code className="text-zinc-300">{id}</code>
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                data-action="SET_AGENT_PROFILES"
                data-quest-id={id}
                data-enabled="true"
                className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 font-medium text-zinc-200 hover:bg-zinc-800"
              >
                {quest.agentProfiles?.enabled ? "Refresh Profile Versions" : "Enable Agent Profiles"}
              </button>
              {quest.agentProfiles?.enabled && (
                <button
                  type="button"
                  data-action="SET_AGENT_PROFILES"
                  data-quest-id={id}
                  data-enabled="false"
                  className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 font-medium text-zinc-400 hover:bg-zinc-800"
                >
                  Disable
                </button>
              )}
            </div>
          </div>

          {/* Readiness Check Form */}
          <form
            data-form="readiness"
            data-collaboration="true"
            data-draft-key="readiness"
            className="space-y-3 rounded-lg border border-zinc-800 bg-zinc-950 p-4"
          >
            <input type="hidden" name="questId" value={id} />
            <h4 className="font-semibold text-zinc-100">Check Readiness (No Agent Starts)</h4>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="grid gap-1 text-zinc-400">
                Runtime
                <select
                  name="runtime"
                  className="h-9 rounded border border-zinc-700 bg-zinc-900 px-3 py-1.5 leading-5 text-zinc-200"
                >
                  <option value="claude">Claude Code</option>
                  <option value="codex">Codex</option>
                </select>
              </label>
              <label className="grid gap-1 text-zinc-400">
                Role
                <select
                  name="role"
                  className="h-9 rounded border border-zinc-700 bg-zinc-900 px-3 py-1.5 leading-5 text-zinc-200"
                >
                  <option value="architect">Architect</option>
                  <option value="planner">Planner</option>
                </select>
              </label>
            </div>
            <p className="form-error text-red-300" role="alert" />
            <button
              type="submit"
              className="rounded-lg bg-emerald-400 px-3 py-1.5 font-semibold text-zinc-950 hover:bg-emerald-300"
            >
              Check Readiness
            </button>
          </form>

          {/* Preview Agent Access Form */}
          <form
            data-form="access-preview"
            data-collaboration="true"
            data-draft-key="access-preview"
            className="space-y-3 rounded-lg border border-zinc-800 bg-zinc-950 p-4"
          >
            <input type="hidden" name="questId" value={id} />
            <h4 className="font-semibold text-zinc-100">Preview Agent Repository Access</h4>
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="grid gap-1 text-zinc-400">
                Role
                <select
                  name="role"
                  className="h-9 rounded border border-zinc-700 bg-zinc-900 px-3 py-1.5 leading-5 text-zinc-200"
                >
                  <option value="architect">Architect</option>
                  <option value="planner">Planner</option>
                  <option value="developer">Developer</option>
                  <option value="reviewer">Reviewer</option>
                </select>
              </label>
              <label className="grid gap-1 text-zinc-400">
                Worktree
                <select
                  name="workId"
                  className="h-9 rounded border border-zinc-700 bg-zinc-900 px-3 py-1.5 leading-5 text-zinc-200"
                >
                  <option value="">Not selected</option>
                  {works.map((w) => (
                    <option key={w.id} value={w.id}>
                      {(state.repositories || []).find((r) => r.id === w.repoId)?.name || w.repoId}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1 text-zinc-400">
                Task
                <select
                  name="taskId"
                  className="h-9 rounded border border-zinc-700 bg-zinc-900 px-3 py-1.5 leading-5 text-zinc-200"
                >
                  <option value="">Not selected</option>
                  {tasks.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.title}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <p className="form-error text-red-300" role="alert" />
            <button
              type="submit"
              className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 font-medium text-zinc-200 hover:bg-zinc-800"
            >
              Check Access Scope
            </button>
          </form>

          {skills.length > 0 && (
            <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-4">
              <h4 className="font-semibold text-zinc-100">Compatible Registered Skills</h4>
              <p className="mt-1 text-zinc-400">
                {skills.length} compatible skill(s) available in workspace library.
              </p>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ==========================================================================
   MAIN EXPORT: COMPACT HIGH-DENSITY DEVELOPER WORKSTATION (/quest/[id])
   ========================================================================== */
export function ProjectDetail({
  state,
  actions = {},
  questId,
  tab = "overview",
  focusDocument = "",
}) {
  const normalizedTab =
    {
      architect: "documents",
      artifacts: "documents",
      appendix: "documents",
      tasks: "work",
      repositories: "work",
      qa: "work",
      activity: "room",
      references: "overview",
      settings: "overview",
    }[tab] || (["overview", "documents", "work", "room"].includes(tab) ? tab : "overview");

  const [settingsOpen, setSettingsOpen] = useState(
    tab === "settings" || tab === "references",
  );

  useEffect(() => {
    if (tab === "settings" || tab === "references") setSettingsOpen(true);
  }, [tab]);

  const quest = (state.quests || []).find((q) => q.id === questId);
  const deletedQuest = (state.deletedQuests || []).find((q) => q.id === questId);

  if (!quest && deletedQuest) {
    return (
      <div className="dq-dashboard rounded-xl border border-zinc-800 bg-zinc-900 p-8 text-center">
        <h1 className="text-lg font-semibold text-zinc-100">Project Deleted</h1>
        <p className="mt-2 text-xs text-zinc-400">
          Restore this project from Deleted projects to review its documents or continue work.
        </p>
        <a
          href="#quests/deleted"
          className="mt-4 inline-flex h-9 items-center rounded-lg bg-emerald-400 px-4 text-xs font-semibold text-zinc-950"
        >
          View Deleted Projects
        </a>
      </div>
    );
  }

  if (!quest) {
    return (
      <div className="dq-dashboard rounded-xl border border-zinc-800 bg-zinc-900 p-8 text-center">
        <h1 className="text-lg font-semibold text-zinc-100">Project Not Found</h1>
        <p className="mt-2 text-xs text-zinc-400">Return to your project list.</p>
        <a
          href="#quests"
          className="mt-4 inline-flex h-9 items-center rounded-lg bg-emerald-400 px-4 text-xs font-semibold text-zinc-950"
        >
          Back to Projects
        </a>
      </div>
    );
  }

  const stageIdx = getStageIndex(quest,state);
  const { primary: primaryCta } = computeStageActions(state, quest);
  const runs = (state.runs || []).filter((r) => r.questId === quest.id);
  const tasks = (state.tasks || []).filter((t) => t.questId === quest.id);
  const blocked =
    latestRunAttempts(runs).some((run) =>
      /FAILED|WAITING_INPUT|INTERRUPTED|PAUSED/.test(run.state),
    ) ||
    (state.works || []).some(
      (work) => work.questId === quest.id && work.state === "RECOVERY_REQUIRED",
    );

  const steps = [
    { num: 1, label: "Define", tab: "documents" },
    { num: 2, label: "Plan", tab: "documents" },
    { num: 3, label: "Build", tab: "work" },
    { num: 4, label: "Review", tab: "work" },
    { num: 5, label: "Done", tab: "overview" },
  ];

  const navTabs = [
    { key: "overview", label: "Overview" },
    {
      key: "documents",
      label: "Documents",
      count: (state.artifacts || []).filter((a) => a.questId === quest.id).length,
    },
    { key: "work", label: "Work", count: tasks.length },
    {
      key: "room",
      label: "Room",
      count: (state.questRooms?.[quest.id]?.timeline || []).length,
    },
  ];

  return (
    <div className="dq-dashboard min-h-full space-y-5 bg-zinc-950 text-zinc-100">
      {/* 1. COMPACT UNIVERSAL HEADER (STICKY TOP) */}
      <header className="sticky top-0 z-30 -mx-1 rounded-b-xl border-b border-zinc-800 bg-zinc-950/95 px-4 pt-3 shadow-lg backdrop-blur">
        {/* Row 1: Breadcrumb, Status Badges, and Actions */}
        <div className="flex flex-wrap items-center justify-between gap-3 pb-3">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <nav
              aria-label="Project breadcrumb"
              className="flex min-w-0 items-center gap-1.5 text-xs text-zinc-400"
            >
              <a href="#home" className="hover:text-zinc-200">
                Workspace
              </a>
              <span aria-hidden="true" className="text-zinc-600">
                /
              </span>
              <a href="#quests" className="hover:text-zinc-200">
                Projects
              </a>
              <span aria-hidden="true" className="text-zinc-600">
                /
              </span>
              <h1 className="truncate text-sm font-semibold text-zinc-100">{quest.title}</h1>
            </nav>

            <div className="flex flex-wrap items-center gap-1.5 pl-1">
              <span className="rounded border border-violet-500/30 bg-violet-500/10 px-2 py-0.5 text-[10px] font-semibold tracking-wider uppercase text-violet-300">
                {quest.kind === "PRODUCT" ? "FEATURE" : "TECHNICAL"}
              </span>
              <StatusPill status={implementationComplete(state,quest) ? "REVIEW_REQUIRED" : quest.state} />
              {quest.sprint && (
                <span className="rounded border border-zinc-700 bg-zinc-900 px-2 py-0.5 text-[11px] font-medium text-zinc-300">
                  {quest.sprint}
                </span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <a
              href="#quests"
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-zinc-800 bg-zinc-900 px-3 text-xs font-medium text-zinc-300 transition-colors hover:border-zinc-700 hover:bg-zinc-800 hover:text-zinc-100"
            >
              <ArrowLeft className="size-3.5" />
              Back to Projects
            </a>
            <button
              type="button"
              onClick={() => setSettingsOpen(true)}
              aria-label="Project settings"
              title="Project settings"
              className="inline-flex size-8 items-center justify-center rounded-lg border border-zinc-800 bg-zinc-900 text-zinc-300 transition-colors hover:border-zinc-700 hover:bg-zinc-800 hover:text-zinc-100"
            >
              <Settings className="size-4" />
            </button>
          </div>
        </div>

        {/* Row 2: Horizontal Compact Stepper + Primary Stage CTA */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-zinc-800/80 py-2.5">
          <ol
            aria-label="Project workflow"
            className="flex flex-wrap items-center gap-1"
          >
            {steps.map((step, idx) => {
              const done = idx < stageIdx || quest.state === "PRS_CREATED";
              const current = idx === stageIdx && !done;
              return (
                <li key={step.label} className="flex items-center">
                  <a
                    href={`#quest/${quest.id}/${step.tab}`}
                    aria-current={current ? "step" : undefined}
                    className={`inline-flex h-7 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-all ${
                      current
                        ? blocked
                          ? "border-amber-400/70 bg-amber-500/15 text-amber-200 ring-2 ring-amber-500/20"
                          : "border-emerald-400/80 bg-emerald-500/15 text-emerald-200 ring-2 ring-emerald-500/20"
                        : done
                          ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/15"
                          : "border-zinc-800 bg-zinc-900/80 text-zinc-500 hover:border-zinc-700 hover:text-zinc-300"
                    }`}
                  >
                    {done ? (
                      <Check className="size-3 text-emerald-400" />
                    ) : (
                      <span className="font-mono text-[11px]">{step.num}.</span>
                    )}
                    <span>{step.label}</span>
                  </a>
                  {idx < steps.length - 1 && (
                    <span
                      aria-hidden="true"
                      className={`mx-1 h-px w-3 ${done ? "bg-emerald-500/40" : "bg-zinc-800"}`}
                    />
                  )}
                </li>
              );
            })}
          </ol>

          <div className="flex items-center gap-2">
            <ActionTriggerButton item={primaryCta} primary />
          </div>
        </div>

        {primaryCta?.description && <p role="status" className="mb-3 text-xs text-amber-300">{primaryCta.description}</p>}
        {/* Navigation Bar: Underlined Horizontal Tabs [Overview] [Documents] [Work] [Room] */}
        <nav
          aria-label="Project sections"
          className="flex items-center gap-1 border-t border-zinc-800/80 pt-1"
        >
          {navTabs.map((item) => {
            const active = normalizedTab === item.key;
            return (
              <a
                key={item.key}
                href={`#quest/${quest.id}/${item.key}`}
                aria-current={active ? "page" : undefined}
                className={`inline-flex items-center gap-2 border-b-2 px-3.5 py-2 text-xs font-semibold transition-colors ${
                  active
                    ? "border-emerald-400 text-zinc-100"
                    : "border-transparent text-zinc-400 hover:border-zinc-700 hover:text-zinc-200"
                }`}
              >
                <span>{item.label}</span>
                {typeof item.count === "number" && (
                  <span
                    className={`rounded-full px-1.5 py-0.2 font-mono text-[10px] ${
                      active ? "bg-emerald-500/20 text-emerald-300" : "bg-zinc-800 text-zinc-400"
                    }`}
                  >
                    {item.count}
                  </span>
                )}
              </a>
            );
          })}
        </nav>
      </header>

      {/* ACTIVE TAB WORKSPACE CONTENT */}
      <div className="pb-8">
        {normalizedTab === "overview" && (
          <OverviewTab state={state} quest={quest} actions={actions} />
        )}
        {normalizedTab === "documents" && (
          <DocumentsTab state={state} quest={quest} focusDocument={focusDocument} />
        )}
        {normalizedTab === "work" && <WorkTab state={state} quest={quest} />}
        {normalizedTab === "room" && (
          <RoomTab state={state} quest={quest} actions={actions} />
        )}
      </div>

      {/* Project Settings Dialog */}
      <ProjectSettingsModal
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        state={state}
        quest={quest}
      />
    </div>
  );
}

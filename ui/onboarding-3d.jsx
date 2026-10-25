import React, { useState, useEffect, useRef, useCallback } from "react";
import { createRoot } from "react-dom/client";
import {
  Sparkles,
  Play,
  Pause,
  ChevronLeft,
  ChevronRight,
  ShieldCheck,
  Bot,
  Layers,
  Lock,
  Check,
  ArrowRight,
  Box,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "./components/dialog";
import { Button } from "./components/button";
import { Badge } from "./components/badge";

import { useReducedMotion } from "./use-reduced-motion";
import { EngineeringViewport } from "./engineering-viewport";

const STORAGE_KEY = "devquest_onboarding_3d_seen_v1";
const AUTO_PLAY_DURATION_MS = 8500;

export const ONBOARDING_STAGES = [
  {
    id: "pipeline",
    stepNumber: "00",
    shortTitle: "Full 3D Pipeline",
    badge: "System Architecture",
    title: "How DevQuest Turns Ideas into Verified Pull Requests",
    subtitle:
      "A local-first, deterministic AI engineering workspace that guides product requirements, tech improvements, and QA bugs through gated design, Jira sync, isolated multi-agent coding, and independent review.",
    roles: ["Orchestrator", "Architect", "Planner", "Jira Specialist", "Developer ×5", "Reviewer"],
    camera: { targetX: 0, targetY: 0, targetZ: 0, yaw: -0.42, pitch: 0.36, zoom: 0.78 },
    purpose:
      "Eliminate chaotic, unreviewed AI code generation by enforcing structured engineering artifacts, human approval gates, and isolated Git worktrees on your local machine.",
    mechanism:
      "Connects your local Git repositories with Claude Code and Codex CLI. Every stage produces versioned Markdown documents (trd.md, spec.md, plan.md, appendix.md) stored locally in ~/.devquest/ and SQLite.",
    governance:
      "100% local loopback execution. No automatic merges, no unverified model substitutions, and no code written until design and Jira gates are explicitly approved.",
    highlights: [
      "6 Engineering Stations",
      "Up to 5 Concurrent Isolated Git Worktrees",
      "Immutable Revision-Bound Approvals",
      "Local SQLite + Versioned Markdown State",
    ],
    ctaLabel: "Start Step-by-Step Tour",
    ctaAction: "next",
  },
  {
    id: "intake",
    stepNumber: "01",
    shortTitle: "1. Intake & Repos",
    badge: "Define & scope",
    title: "Multi-Source Requirement Intake & Repository Binding",
    subtitle:
      "Start a Product Quest from documents, a Tech Quest from an engineering idea, or a bug fix linked to an existing QA Jira issue.",
    roles: ["Architect", "Repository Resolver"],
    camera: { targetX: -420, targetY: 5, targetZ: 50, yaw: -0.25, pitch: 0.32, zoom: 1.42 },
    purpose:
      "Bring raw requirements and target Git repositories together with strict branch policies before any AI agent touches your codebase.",
    mechanism:
      "Ingests local Markdown (.md), plain text (.txt), PDFs (up to 200 pages), Word (.docx), or HTTPS Confluence pages. Tech Quests include interactive AI brainstorming to refine technical briefs first.",
    governance:
      "Repositories enforce base branch, PR target branch, branch protection patterns, and OS-level workspace path verification before execution.",
    highlights: [
      "Ingest .md, .txt, .pdf, .docx & Confluence",
      "Interactive AI Brainstorming for Tech Quests",
      "Multi-Repository Impact Scope & Branch Policy",
      "Zero-Inference Readiness & Access Preflight",
    ],
    ctaLabel: "Import Repository",
    ctaAction: "addRepository",
  },
  {
    id: "analysis",
    shortTitle: "Analysis",
    badge: "Read-only discovery",
    stepNumber: "02",
    title: "Inspect the selected repositories",
    subtitle: "Understand services and dependencies before choosing a design.",
    roles: ["Architect"],
    camera: { yaw: 0.38, zoom: 1 },
    purpose:
      "Map the affected services and identify constraints using only the repositories selected for this project.",
    mechanism:
      "Repository-scoped inspection feeds the technical design. This illustration does not run an agent or read repository files.",
    governance:
      "Read-only analysis. Implementation requires an approved plan and the existing execution gates.",
    highlights: [
      "Selected repositories only",
      "Read-only discovery",
      "Dependency analysis",
      "No implementation",
    ],
    ctaLabel: "View repositories",
    ctaAction: "addRepository",
  },
  {
    id: "design",
    stepNumber: "02",
    shortTitle: "2. TRD & Plan Gates",
    badge: "Architecture & planning",
    title: "AI Architect, Implementation Plan & Immutable Approval Gates",
    subtitle:
      "Generate, inspect, and edit the Technical Requirements Document (TRD), optional Specification, and dependency-aware Implementation Plan.",
    roles: ["Architect", "Planner"],
    camera: { targetX: -210, targetY: 10, targetZ: -45, yaw: 0.18, pitch: 0.34, zoom: 1.48 },
    purpose:
      "Ensure the technical architecture, repository assignments, task dependencies, and test validation profiles are agreed upon before coding begins.",
    mechanism:
      "The Architect Agent analyzes your repositories in read-only mode to produce trd.md. After TRD approval, the Planner Agent generates plan.md with task dependency graphs and test profiles.",
    governance:
      "Approvals bind to immutable artifact revisions. Editing any draft automatically invalidates prior approval and requires explicit human re-approval.",
    highlights: [
      "Read-Only Repository Impact Analysis",
      "Formatted Markdown Viewer & Raw Source Editor",
      "Task Dependency Graph & Validation Profiles",
      "Revision-Bound Cryptographic Approval Lock",
    ],
    ctaLabel: "Create a Project",
    ctaAction: "newProject",
  },
  {
    id: "jira",
    stepNumber: "03",
    shortTitle: "3. Jira Appendix",
    badge: "Backlog synchronization",
    title: "Weighted Jira Appendix & Controlled Batch Publication",
    subtitle:
      "Translate your approved engineering plan into weighted Jira tasks with sample-first verification, or link an existing QA issue.",
    roles: ["Jira Specialist"],
    camera: { targetX: 0, targetY: 5, targetZ: 45, yaw: -0.12, pitch: 0.35, zoom: 1.48 },
    purpose:
      "Bridge engineering architecture and project management with calibrated complexity weights (V / L / M / H) and safe, duplicate-free Jira publishing.",
    mechanism:
      "The Jira Specialist Agent generates appendix.md from the approved plan. Uses local skills and Claude Code's authenticated Atlassian MCP connection to publish tickets.",
    governance:
      "Publishes 1 sample issue first for verification, followed by explicit batches of at most 5 issues. Once published (or linked to a QA bug), the plan is frozen.",
    highlights: [
      "Calibrated Backend Weights (V / L / M / H)",
      "Sample-First Verification + Max 5 Batch Upload",
      "Direct QA Bug Issue Linking Bypass",
      "Frozen Scope Guarantee After Publication",
    ],
    ctaLabel: "Configure Jira Integration",
    ctaAction: "jiraSettings",
  },
  {
    id: "worktrees",
    stepNumber: "04",
    shortTitle: "4. Agent Worktrees",
    badge: "Parallel execution",
    title: "Task-Isolated Git Worktrees & Multi-Agent Orchestration",
    subtitle:
      "Execute up to 5 concurrent Developer Agents in isolated Git worktrees with verified model routing and serialized branch integration.",
    roles: ["Orchestrator", "Developer ×5"],
    camera: { targetX: 215, targetY: -5, targetZ: -40, yaw: 0.28, pitch: 0.38, zoom: 1.38 },
    purpose:
      "Run parallel AI implementation tasks across repositories safely without branch collisions, dirty working trees, or unverified model fallbacks.",
    mechanism:
      "Each task gets an isolated Git worktree in ~/.devquest/worktrees/. The Orchestrator routes tasks by complexity. Tasks pass baseline checks and validation profiles before serialized integration.",
    governance:
      "Pause, resume from checkpoints, or send turn-based instructions in the Quest Room. Reasoning escalation stops after 2 attempts; never deletes uncommitted Git work.",
    highlights: [
      "Up to 5 Concurrent Developer Agents",
      "Isolated Git Worktrees per Task",
      "Verified Model Policy (Claude Code & Codex)",
      "Baseline Checks & Serialized Branch Integration",
    ],
    ctaLabel: "Explore Agent Mesh",
    ctaAction: "agents",
  },
  {
    id: "review",
    stepNumber: "05",
    shortTitle: "5. Review & PR",
    badge: " Production Gate & Handoff",
    title: "Independent Production Review, GitHub PR & Team Notification",
    subtitle:
      "Audit integrated repository changes through an independent Reviewer Agent, create standardized Pull Requests, and notify Google Chat.",
    roles: ["Reviewer", "GitHub CLI", "Google Chat"],
    camera: { targetX: 425, targetY: 10, targetZ: 45, yaw: 0.35, pitch: 0.33, zoom: 1.45 },
    purpose:
      "Verify that all integrated tasks meet production readiness standards and human QA checklists before opening a Pull Request.",
    mechanism:
      "An independent Reviewer Agent inspects the integrated repository diff (bounded to 3 review/fix cycles). Generates office commit messages: <type> : <description> (branch).",
    governance:
      "PR creation is explicit opt-in via authenticated gh CLI and verifies the remote head matches the reviewed commit. Reviewer assignment and Google Chat notifications are tracked with idempotent retries.",
    highlights: [
      "Mandatory Independent Production-Readiness Gate",
      "Bounded Review/Fix Cycles (Max 3 Attempts)",
      "Human Tests & QA Observation Checklist",
      "Verified GitHub PR + Google Chat Handoff",
    ],
    ctaLabel: "Start Building Now",
    ctaAction: "newProject",
  },
];

export const Onboarding3DCanvas = EngineeringViewport;

export function Onboarding3DModal({ open, onOpenChange, state, actions = {}, initialStage = 0 }) {
  const [stageIndex, setStageIndex] = useState(initialStage);
  const [autoPlay, setAutoPlay] = useState(false);
  const reducedMotion = useReducedMotion();
  const stageNav = useRef(null);
  useEffect(() => {
    const reveal = () =>
      stageNav.current
        ?.querySelector('[aria-selected="true"]')
        ?.scrollIntoView({ block: "nearest", inline: "center", behavior: "instant" });
    reveal();
    window.addEventListener("resize", reveal);
    return () => window.removeEventListener("resize", reveal);
  }, [stageIndex, open]);

  useEffect(() => {
    setStageIndex(initialStage);
  }, [initialStage]);

  const stage = ONBOARDING_STAGES[stageIndex] || ONBOARDING_STAGES[0];
  useEffect(() => {
    if (!open || !autoPlay || reducedMotion || stageIndex === 5) return;
    const timer = setTimeout(
      () => setStageIndex((prev) => (prev + 1) % ONBOARDING_STAGES.length),
      AUTO_PLAY_DURATION_MS,
    );
    return () => clearTimeout(timer);
  }, [open, autoPlay, stageIndex, reducedMotion]);

  useEffect(() => {
    if (stageIndex === 5 || reducedMotion) setAutoPlay(false);
  }, [stageIndex, reducedMotion]);

  const selectStage = useCallback((idx) => {
    setAutoPlay(false);
    setStageIndex(idx);
  }, []);

  const handleClose = (nextOpen) => {
    if (!nextOpen) {
      try {
        localStorage.setItem(STORAGE_KEY, "1");
      } catch {
        // Ignore storage errors in restricted environments
      }
    }
    onOpenChange(nextOpen);
  };

  const triggerStageAction = () => {
    if (stage.ctaAction === "next") {
      setAutoPlay(true);
      setStageIndex(1);
      return;
    }
    handleClose(false);
    if (stage.ctaAction === "newProject") actions.newProject?.();
    else if (stage.ctaAction === "addRepository") actions.addRepository?.();
    else if (stage.ctaAction === "jiraSettings") actions.jiraSettings?.();
    else if (stage.ctaAction === "agents") {
      location.hash = "#agents";
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="dq-popup dq-onboarding-dialog flex h-[min(840px,92vh)] max-h-[92vh] w-[calc(100%_-_1.5rem)] max-w-6xl flex-col gap-0 overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950 p-0 text-zinc-100 shadow-2xl">
        <DialogHeader className="flex shrink-0 flex-row flex-wrap items-center justify-between gap-3 border-b border-zinc-800/80 bg-zinc-900/90 px-5 py-3.5 text-left pr-12">
          <div className="flex items-center gap-3">
            <div className="flex size-9 items-center justify-center rounded-lg border border-emerald-500/30 bg-emerald-500/10 text-emerald-400">
              <Box className="size-4" />
            </div>
            <div>
              <DialogTitle className="flex items-center gap-2 text-base font-semibold text-zinc-100">
                DevQuest workflow guide
                <Badge
                  variant="outline"
                  className="border-emerald-500/30 bg-emerald-500/10 text-[10px] text-emerald-300"
                >
                  {stageIndex === 5 ? "Interactive guide" : "Interactive 3D"}
                </Badge>
              </DialogTitle>
              <DialogDescription className="text-xs text-zinc-400">
                Explore what DevQuest does and how requirements flow through AI agents, Git
                worktrees, and human approval gates.
              </DialogDescription>
            </div>
          </div>
          {stageIndex !== 5 && (
            <div className="flex items-center gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={stageIndex === 5 || reducedMotion}
                onClick={() => setAutoPlay((v) => !v)}
                className="h-8 gap-1.5 border-zinc-700 bg-zinc-900 text-xs text-zinc-200 hover:bg-zinc-800"
              >
                {autoPlay ? (
                  <Pause className="size-3.5 text-emerald-400" />
                ) : (
                  <Play className="size-3.5" />
                )}
                {autoPlay ? "Auto-Tour On" : "Auto-Tour Paused"}
              </Button>
            </div>
          )}
        </DialogHeader>

        {/* Stage Stepper Bar */}
        <div
          className="flex shrink-0 items-center gap-1.5 overflow-x-auto border-b border-zinc-800/80 bg-zinc-900/50 px-5 py-2.5"
          ref={(node) => {
            stageNav.current = node;
            const selected = node?.querySelector('[aria-selected="true"]');
            if (selected)
              node.scrollLeft =
                selected.offsetLeft -
                node.offsetLeft -
                (node.clientWidth - selected.clientWidth) / 2;
          }}
          role="tablist"
          aria-label="Onboarding workflow stages"
          onKeyDown={(e) => {
            const next =
              e.key === "ArrowRight"
                ? (stageIndex + 1) % ONBOARDING_STAGES.length
                : e.key === "ArrowLeft"
                  ? (stageIndex - 1 + ONBOARDING_STAGES.length) % ONBOARDING_STAGES.length
                  : e.key === "Home"
                    ? 0
                    : e.key === "End"
                      ? ONBOARDING_STAGES.length - 1
                      : null;
            if (next === null) return;
            e.preventDefault();
            selectStage(next);
            e.currentTarget.querySelectorAll('[role="tab"]')[next]?.focus();
          }}
        >
          {ONBOARDING_STAGES.map((item, idx) => {
            const active = idx === stageIndex;
            return (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={active}
                tabIndex={active ? 0 : -1}
                aria-controls="dq-tour-stage"
                onClick={() => selectStage(idx)}
                className={`flex shrink-0 items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                  active
                    ? "border-emerald-500/50 bg-emerald-500/15 text-emerald-300"
                    : "border-transparent bg-zinc-900/60 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200"
                }`}
              >
                <span>{item.shortTitle.replace(/^\d+\.\s*/, "")}</span>
              </button>
            );
          })}
        </div>

        {/* Main 3D Viewport + Stage Explanation Split Layout */}
        <div
          id="dq-tour-stage"
          role="tabpanel"
          aria-label={stage.shortTitle.replace(/^\d+\.\s*/, "")}
          className="flex min-h-0 flex-1 flex-col"
        >
          <div className="dq-world-layout">
            <EngineeringViewport stageIndex={stageIndex} onSelectStage={selectStage} />
            {/* Right: Structured Explanation of Purpose, Mechanism & Safety Gates */}
            <div className="flex flex-col justify-between space-y-5 overflow-y-auto bg-zinc-900/40 p-5 sm:p-6">
              <div className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Badge
                    variant="outline"
                    className="border-emerald-500/30 bg-emerald-500/10 text-xs text-emerald-300"
                  >
                    {stage.badge}
                  </Badge>
                  <span className="font-mono text-xs text-zinc-400">
                    {stageIndex === 0 ? "Overview" : `Station ${stageIndex} / 6`}
                  </span>
                </div>

                <div>
                  <h2 className="text-lg font-semibold leading-snug text-zinc-100">
                    {stage.title}
                  </h2>
                  <p className="mt-1.5 text-xs leading-relaxed text-zinc-400">{stage.subtitle}</p>
                </div>

                {/* Active Roles in this Stage */}
                <div className="flex flex-wrap items-center gap-1.5 pt-1">
                  <span className="mr-1 text-[11px] font-medium uppercase tracking-wider text-zinc-400">
                    Illustrated roles:
                  </span>
                  {stage.roles.map((role) => (
                    <span
                      key={role}
                      className="inline-flex items-center gap-1 rounded-md border border-zinc-700/80 bg-zinc-800/70 px-2 py-0.5 text-[11px] font-medium text-zinc-200"
                    >
                      <Bot className="size-3 text-emerald-400" />
                      {role}
                    </span>
                  ))}
                </div>

                <p className="text-xs text-amber-200">
                  You approve the plan and review changes before publishing or merging.
                </p>
                <details className="dq-world-details">
                  <summary>Workflow details & safety</summary>
                  <div className="space-y-2.5 pt-1">
                    <div className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-3.5">
                      <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-sky-400">
                        <Sparkles className="size-3.5" />
                        What It Does (Purpose)
                      </h3>
                      <p className="mt-1.5 text-xs leading-relaxed text-zinc-300">
                        {stage.purpose}
                      </p>
                    </div>

                    <div className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-3.5">
                      <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-emerald-400">
                        <Layers className="size-3.5" />
                        How It Works Under the Hood
                      </h3>
                      <p className="mt-1.5 text-xs leading-relaxed text-zinc-300">
                        {stage.mechanism}
                      </p>
                    </div>

                    <div className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-3.5">
                      <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-amber-400">
                        <ShieldCheck className="size-3.5" />
                        Human Control & Safety Gate
                      </h3>
                      <p className="mt-1.5 text-xs leading-relaxed text-zinc-300">
                        {stage.governance}
                      </p>
                    </div>
                  </div>

                  {/* Stage Key Capabilities Checklist */}
                  <div className="rounded-lg border border-zinc-800/80 bg-zinc-950/40 p-3.5">
                    <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
                      Key Capabilities in This Stage
                    </h3>
                    <ul className="grid gap-1.5 sm:grid-cols-2">
                      {stage.highlights.map((item) => (
                        <li key={item} className="flex items-start gap-2 text-xs text-zinc-300">
                          <Check className="mt-0.5 size-3.5 shrink-0 text-emerald-400" />
                          <span>{item}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </details>
              </div>

              {/* Footer Navigation Controls */}
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-zinc-800 pt-4">
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      selectStage(
                        (stageIndex - 1 + ONBOARDING_STAGES.length) % ONBOARDING_STAGES.length,
                      )
                    }
                    className="border-zinc-700 bg-zinc-900 text-zinc-200 hover:bg-zinc-800"
                  >
                    <ChevronLeft className="size-4" />
                    Previous
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => selectStage((stageIndex + 1) % ONBOARDING_STAGES.length)}
                    className="border-zinc-700 bg-zinc-900 text-zinc-200 hover:bg-zinc-800"
                  >
                    Next Stage
                    <ChevronRight className="size-4" />
                  </Button>
                </div>

                <Button
                  type="button"
                  size="sm"
                  onClick={triggerStageAction}
                  className="bg-emerald-400 font-semibold text-zinc-950 hover:bg-emerald-300"
                >
                  {stage.ctaLabel}
                  <ArrowRight className="size-4" />
                </Button>
              </div>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

let onboardingRoot;
export function openOnboarding3D(props = {}) {
  if (typeof document === "undefined") return;
  if (!onboardingRoot) {
    const container = document.createElement("div");
    container.id = "onboarding-3d-dialog";
    document.body.append(container);
    onboardingRoot = createRoot(container);
  }
  const Wrapper = () => {
    const [open, setOpen] = useState(true);
    return <Onboarding3DModal {...props} open={open} onOpenChange={setOpen} />;
  };
  onboardingRoot.render(<Wrapper key={Date.now()} />);
}

export function shouldAutoOpenOnboarding() {
  try {
    return typeof localStorage !== "undefined" && !localStorage.getItem(STORAGE_KEY);
  } catch {
    return false;
  }
}

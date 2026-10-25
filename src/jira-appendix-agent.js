import path from "node:path";
import { readFile } from "node:fs/promises";
import { hash } from "./store.js";
import { decodeAppendix, validateAppendix, importAppendixFile } from "./appendix-markdown.js";
import { processExists } from "./scheduler.js";
import { assert } from "./routing.js";

import { selectAppendixOptions } from "./jira-settings.js";

export const appendixPurpose = "jira_appendix_generation";
export class JiraAppendixAgent {
  constructor(engine) {
    this.e = engine;
    this.s = engine.store;
    this.preflights = new Set();
  }
  owned(record, legacy = false) {
    return legacy ? this.e.v11.pending.has(record.id) : this.e.jobs.has(record.id);
  }
  status(record, legacy = false) {
    return {
      generationActive: this.owned(record, legacy),
      recoveryBlocked: !this.owned(record, legacy) && processExists(record.pid),
    };
  }
  lifecycle(questId) {
    const runs = this.s.all("runs").filter((r) => r.questId === questId && r.purpose === appendixPurpose),
      artifact = this.s.latest(questId, "appendix"),
      producer = runs.findIndex((r) => r.id === artifact?.runId && r.state === "COMPLETED"),
      result = { active: [], terminal: [], obsolete: [], operations: [] };
    for (const [index, run] of runs.entries()) {
      const status = this.status(run);
      const state = status.generationActive || status.recoveryBlocked ? "active"
        : ["COMPLETED", "FAILED", "CANCELLED", "INTERRUPTED", "SUPERSEDED"].includes(run.state) ? "terminal"
        : index < producer && Date.parse(run.finishedAt) < Date.parse(artifact.createdAt) ? "obsolete"
        : "active";
      result[state].push(run);
    }
    result.operations = this.s.all("operations").filter((op) =>
      [`appendix-preflight:${questId}`, `appendix:${questId}`].includes(op.id) &&
      (op.state === "RUNNING" || this.status(op, true).generationActive || this.status(op, true).recoveryBlocked));
    return result;
  }
  assertIdle(questId) {
    const lifecycle = this.lifecycle(questId);
    assert(!lifecycle.active.length && !lifecycle.operations.length,
      "Finish or cancel the active Jira Appendix generation before approving or publishing this revision");
    return lifecycle;
  }
  reconcile() {
    for (const op of this.s.all("operations")) {
      if (
        op.id === `appendix-preflight:${op.questId}` &&
        op.state === "RUNNING" &&
        !this.preflights.has(op.questId)
      )
        this.s.put("operations", {
          ...op,
          state: "INTERRUPTED",
          generationActive: false,
          error: "Preflight interrupted; retry explicitly. No paid retry was scheduled.",
        });
    }
    for (const [table, legacy] of [
      ["runs", false],
      ["operations", true],
    ]) {
      for (const record of this.s.all(table)) {
        if (
          legacy ? record.id !== `appendix:${record.questId}` : record.purpose !== appendixPurpose
        )
          continue;
        if (this.owned(record, legacy) || processExists(record.pid)) continue;
        const timedOut =
          legacy &&
          ["RUNNING", "INTERRUPTED"].includes(record.state) &&
          /timed out/i.test(record.error || "");
        if (record.state !== "RUNNING" && !record.pid && !timedOut) continue;
        const state =
          timedOut || record.state === "FAILED"
            ? "FAILED"
            : record.state === "RUNNING"
              ? "INTERRUPTED"
              : record.state;
        this.s.put(table, {
          ...record,
          state,
          phase: state,
          pid: null,
          ...(record.pid ? { previousPid: record.pid } : {}),
          ...(record.state === "RUNNING" && !(legacy ? record.error : record.summary)
            ? legacy
              ? {
                  error:
                    "Generation interrupted: no owned job or live recorded runtime process remains.",
                }
              : {
                  summary:
                    "Generation interrupted: no owned job or live recorded runtime process remains.",
                }
            : {}),
          finishedAt: record.finishedAt || new Date().toISOString(),
          reconciledAt: new Date().toISOString(),
          recoveryReason:
            "No owned generation job or live recorded process; retry is available. Historical errors and artifacts preserved.",
        });
        if (this.s.get("quests", record.questId))
          this.e.log(
            record.questId,
            `Jira Appendix attempt recovered (${record.id}): ${state}; stale process reference cleared, history preserved`,
          );
      }
    }
  }
  async start(quest, input = {}, existing) {
    this.reconcile();
    const recoveryFrom =
      existing?.state === "FAILED" && /Unknown skill/.test(existing.summary || "")
        ? existing.id
        : undefined;
    if (recoveryFrom) existing = undefined;
    if (input.requestId) {
      assert(
        typeof input.requestId === "string" && /^[a-zA-Z0-9-]{1,80}$/.test(input.requestId),
        "Invalid appendix request ID",
      );
      const prior = this.s
        .all("runs")
        .find(
          (r) =>
            r.questId === quest.id &&
            r.purpose === appendixPurpose &&
            r.requestId === input.requestId,
        );
      if (prior && !existing) return prior;
    }
    assert(
      !this.s
        .all("runs")
        .some(
          (r) =>
            r.questId === quest.id &&
            r.purpose === appendixPurpose &&
            r.state === "CANCELLED" &&
            this.e.jobs.has(r.id),
        ),
      "Cancelled appendix process is still stopping; retry in a moment",
    );
    const lifecycle = this.lifecycle(quest.id);
    assert(!existing || !lifecycle.obsolete.some((run) => run.id === existing.id),
      "This historical Jira Appendix attempt was superseded; generate a new revision instead of resuming it");
    const attempts = [...lifecycle.active, ...lifecycle.terminal, ...lifecycle.obsolete];
    for (const run of attempts) {
      if (run.id !== existing?.id && this.owned(run)) return run;
      assert(
        !this.status(run).recoveryBlocked,
        "A recorded appendix process still exists outside this server's execution ownership. Verify that process before retrying; it has not been stopped or marked failed.",
      );
    }
    const legacy = this.s.get("operations", `appendix:${quest.id}`);
    if (legacy)
      assert(
        !this.status(legacy, true).generationActive && !this.status(legacy, true).recoveryBlocked,
        "A previous appendix process is still active or requires ownership verification; no duplicate generation started.",
      );
    if (existing) {
      assert(!this.e.jobs.has(existing.id), "Previous appendix process is still stopping");
      assert(
        !["RUNNING", "COMPLETED"].includes(existing.state),
        "Wait for completion; use Regenerate for a new revision",
      );
    }
    const saved = quest.jiraContext || {};
    const { plan, jiraContext } = this.e.appendixInput(quest, {
      ...saved,
      ...input,
      planArtifactId: input.planArtifactId || this.s.latest(quest.id, "plan")?.id,
    });
    assert(
      !quest.jiraConfig?.enabled || (jiraContext.siteUrl && jiraContext.projectUrl),
      "Complete Jira site URL and project URL in Edit Jira Configuration before generation",
    );
    const trd = this.e.approved(quest.id, "trd");
    this.e.editable(
      quest.id,
      attempts.filter((r) => !this.owned(r) && !processExists(r.pid)).map((r) => r.id),
    );
    this.e.put("quests", quest, { jiraContext, autoExecute: false });
    assert(
      !quest.jiraConfig?.explicitlyDisabled,
      "Jira integration is disabled. Enable it in Edit Jira Configuration before generation",
    );
    const config = quest.execution || this.e.v11.config();
    const route = this.e.jiraSettings.route(quest);
    const data = {
      quest: { id: quest.id, title: quest.title, jiraContext, jiraConfig: quest.jiraConfig },
      planPath: plan.file,
      planContent: this.s.content(plan),
      planArtifactId: plan.id,
      trdPath: trd.file,
      trdContent: this.s.content(trd),
      trdArtifactId: trd.id,
      previousAppendix: this.e.artifact(quest.id, "appendix"),
      tasks: this.e.tasks(quest.id),
      repositories: quest.repositoryIds.map((id) => {
        const r = this.e.get("repositories", id);
        return {
          id: r.id,
          name: r.name,
          path: r.path,
          baseBranch: r.baseBranch,
        };
      }),
      humanInput: input.message || "",
      skillPaths: this.e.adapters.config?.workflow?.skills || {},
    };
    assert(
      this.e.adapters.skill.prepareAppendix,
      "Configure the installed create-appendix-task-list skill integration",
    );
    const operation = {
      id: `appendix-preflight:${quest.id}`,
      questId: quest.id,
      state: "RUNNING",
      phase: "VERIFYING_CONFIGURATION",
      generationActive: true,
      startedAt: new Date().toISOString(),
      runtime: "claude",
      model: route.resolvedModel,
      effort: route.resolvedEffort,
    };
    this.preflights.add(quest.id);
    this.s.put("operations", operation);
    this.e.emit({ type: "changed" });
    let prepared;
    try {
      prepared = await this.e.adapters.skill.prepareAppendix(data);
      assert(
        this.e.adapters.skill.preflightAppendix,
        "Configure the read-only Atlassian MCP preflight before generation",
      );
      this.s.put("operations", { ...operation, phase: "VERIFYING_METADATA_AND_SKILL" });
      this.e.emit({ type: "changed" });
      const jiraPreflight = await this.e.adapters.skill.preflightAppendix(data, prepared, route);
      assert(
        jiraPreflight.status === "READY" && jiraPreflight.options?.length,
        "Atlassian metadata preflight failed; no paid generation started",
      );
      assert(
        !jiraPreflight.project || jiraPreflight.project === jiraContext.project,
        "Metadata preflight returned a different Jira project; no generation started",
      );
      const selectedOptions = selectAppendixOptions(
        { ...jiraPreflight, project: jiraContext.project },
        { ...quest.jiraConfig, ...jiraContext },
      );
      const metadata = this.s.metadata(quest.id, {
        ...jiraPreflight,
        project: jiraContext.project,
        fieldId: "customfield_11543",
        fieldContext: jiraPreflight.fieldContext || {
          projectId: jiraPreflight.projectId,
          issueTypeId: jiraPreflight.issueTypeId,
        },
        selectedOptions,
        provenance: "Authenticated read-only Atlassian MCP preflight",
        weightReference: quest.jiraConfig?.backendWeights || jiraContext.weightReference,
      });
      this.e.put("quests", this.e.get("quests", quest.id), { jiraMetadata: metadata });
      prepared.mcpGuard &&
        Object.assign(prepared.mcpGuard, {
          cloudId: jiraPreflight.cloudId,
          siteUrl: jiraPreflight.siteUrl,
          projectId: jiraPreflight.projectId,
        });
      if (this.e.adapters.skill.attachAppendixMetadata)
        await this.e.adapters.skill.attachAppendixMetadata(
          prepared,
          { ...jiraPreflight, selectedOptions },
          metadata,
        );
      else
        prepared.prompt += `\nVerified read-only Jira options: ${JSON.stringify(selectedOptions)}`;
      assert(
        !quest.jiraConfig?.enabled || prepared.appendixMetadata,
        "Jira runtime adapter must expose a verified metadata-read contract before generation",
      );
      const run = this.e.launch(
        quest,
        {
          ...prepared,
          jiraPreflight: { ...jiraPreflight, options: selectedOptions },
          jiraMetadata: metadata,
          requestId: input.requestId,
          recoveryFrom,
          purpose: appendixPurpose,
          displayName: "Jira Specialist",
          stage: "JIRA",
          role: "JIRA_APPENDIX",
          runtime: "claude",
          route,
          workflowVersion: 2,
          readOnly: true,
          planArtifactId: plan.id,
          trdArtifactId: trd.id,
          jiraContext,
          cwd: prepared.inputDirectory || path.dirname(plan.file),
          artifactScope: true,
          timeoutMs: Math.min(config.limits?.taskMinutes || 10, 30) * 60000,
          executionPolicy: { nestedSpawning: false },
          // Start clean on Continue: old skill/tool grants and artifact context cannot leak back in.
          sessionId: undefined,
        },
        existing ? { ...existing, sessionId: undefined } : undefined,
      );
      this.e.log(
        quest.id,
        "Jira Appendix Agent created; native skill invocation required; no Jira publication authorized",
      );
      this.s.put("operations", {
        ...operation,
        state: "COMPLETED",
        phase: "READY",
        generationActive: false,
        runId: run.id,
        finishedAt: new Date().toISOString(),
      });
      this.preflights.delete(quest.id);
      return run;
    } catch (error) {
      this.s.put("operations", {
        ...operation,
        state: "FAILED",
        phase: "PREFLIGHT_FAILED",
        generationActive: false,
        error: error.message,
        finishedAt: new Date().toISOString(),
      });
      this.e.log(
        quest.id,
        `Jira Appendix preflight failed: ${error.message}. No generation started.`,
      );
      this.preflights.delete(quest.id);
      await prepared?.cleanup?.();
      throw error;
    }
  }
  recordMetadataRead(run, event) {
    const contract = run.appendixMetadata,
      previous = run.metadataConsumption || { ranges: [], toolUseIds: [] };
    if (!contract || event.file !== contract.file || event.hash !== contract.hash) return previous;
    const ranges = [];
    for (const [start, end] of [
      ...previous.ranges,
      ...(Array.isArray(event.ranges) ? event.ranges : []),
    ]
      .filter(
        ([a, b]) =>
          Number.isInteger(a) && Number.isInteger(b) && a >= 1 && b >= a && b <= contract.lineCount,
      )
      .sort((a, b) => a[0] - b[0])) {
      const last = ranges.at(-1);
      if (last && start <= last[1] + 1) last[1] = Math.max(end, last[1]);
      else ranges.push([start, end]);
    }
    return {
      status:
        ranges.length === 1 && ranges[0][0] === 1 && ranges[0][1] === contract.lineCount
          ? "READ_VERIFIED"
          : "PARTIAL",
      ranges,
      toolUseIds: [...new Set([...previous.toolUseIds, event.toolUseId])],
      fileHash: contract.hash,
      snapshotHash: contract.snapshotHash,
    };
  }
  async finish(run, result) {
    let content = String(result.text || "");
    try {
      const parsed = decodeAppendix(result.text);
      if (result.markdownPath || parsed.markdownPath)
        parsed.content = await importAppendixFile(
          result.markdownPath || parsed.markdownPath,
          run.artifactDirectory,
        );
      if (parsed.waitingInput || result.waitingInput) {
        assert(
          typeof parsed.question === "string" && parsed.question.trim(),
          "Missing-input response must contain a question",
        );
        this.e.put("runs", run, {
          state: "WAITING_INPUT",
          summary: parsed.question.slice(0, 4000),
        });
        this.e.log(
          run.questId,
          `Jira Appendix Agent needs input: ${parsed.question.slice(0, 1000)}`,
        );
        return;
      }
      assert(
        run.skillInvoked,
        "Native create-appendix-task-list invocation was not verified; no appendix accepted. Check skill discovery and Skill tool permissions.",
      );
      assert(
        this.e.approved(run.questId, "plan").id === run.planArtifactId &&
          this.e.approved(run.questId, "trd").id === run.trdArtifactId,
        "Approved documents changed during generation; previous appendix preserved. Regenerate from the current approved plan.",
      );
      content = parsed.content;
      if (run.appendixMetadata) {
        assert(
          run.appendixMetadata.snapshotHash === run.jiraMetadata?.hash,
          "Appendix metadata snapshot changed; no appendix accepted",
        );
        assert(
          run.metadataConsumption?.status === "READ_VERIFIED",
          "Verified Appendix metadata was not completely read through the Read tool. Read appendix-options.json in full; no appendix accepted",
        );
        assert(
          hash(await readFile(run.appendixMetadata.file, "utf8")) === run.appendixMetadata.hash,
          "Appendix metadata input changed; no appendix accepted",
        );
      }
      assert(
        Array.isArray(run.jiraAppendixOptions) && run.jiraAppendixOptions.length,
        "Live Choose Appendix (v3) options were not verified for this project; no appendix accepted. Check Jira metadata access and retry.",
      );
      const verifiedOptions = run.jiraMetadata
        ? this.s.metadataContent(run.jiraMetadata).selectedOptions
        : run.jiraAppendixOptions;
      validateAppendix(
        content,
        verifiedOptions,
        this.e.artifact(run.questId, "appendix"),
        run.jiraMetadata && this.e.get("quests", run.questId).jiraConfig?.enabled
          ? { project: run.jiraContext.project, completeMatrix: !!run.appendixMetadata }
          : {},
      );
      const artifact = this.s.artifact(run.questId, "appendix", content);
      this.s.materialize({ ...artifact, kind: "jira-appendix" });
      this.s.put("artifacts", {
        ...artifact,
        planArtifactId: run.planArtifactId,
        trdArtifactId: run.trdArtifactId,
        runId: run.id,
        jiraMetadata: run.jiraMetadata,
        metadataConsumption: run.appendixMetadata
          ? {
              ...run.metadataConsumption,
              status: "VERIFIED",
              matrixOptionCount: run.jiraAppendixOptions.length,
            }
          : null,
      });
      this.e.put("runs", run, {
        state: "COMPLETED",
        phase: "COMPLETED",
        artifactId: artifact.id,
        ...(run.appendixMetadata
          ? {
              metadataConsumption: {
                ...run.metadataConsumption,
                status: "VERIFIED",
                matrixOptionCount: run.jiraAppendixOptions.length,
              },
            }
          : {}),
        summary: "Jira Appendix generated successfully. Review generated tasks before publishing.",
      });
      this.e.log(
        run.questId,
        "Jira Appendix Agent completed; appendix saved for review, no issues published",
      );
    } catch (error) {
      const diagnostic = this.s.appendixDiagnostic(run, content, error.message);
      this.e.put("runs", this.e.get("runs", run.id), { appendixDiagnostic: diagnostic });
      throw error;
    }
  }
}

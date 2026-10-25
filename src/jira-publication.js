import { hash } from "./store.js";
import { validateAppendix } from "./appendix-markdown.js";
import { assert } from "./routing.js";

export function acceptsAccountVisibleSearch(quest, artifact) {
    const acceptance = quest.jiraSearchScopeAcceptance;
    return acceptance?.scope === "account-visible" &&
      acceptance.artifactId === artifact.id && acceptance.artifactHash === artifact.hash &&
      acceptance.project === quest.jiraContext.project &&
      acceptance.siteUrl === new URL(quest.jiraContext.siteUrl).origin &&
      acceptance.epic === (quest.jiraContext.epic || "");
  }

export function appendixTaskMapping(markdown, tasks) {
  const cards = validateAppendix(markdown),
    mapping = new Map(cards.map((c) => [c.id, []]));
  const rows = markdown.split(/\r?\n/);
  let columns,
    traceabilityTable = false;
  for (const line of rows) {
    const row = line.trim();
    if (!row.startsWith("|")) {
      columns = undefined;
      continue;
    }
    const cells = row
      .slice(1, row.lastIndexOf("|"))
      .split("|")
      .map((s) => s.replace(/[`*]/g, "").trim());
    const cardColumn = cells.findIndex(cell => ["Jira card(s)", "Jira cards"].includes(cell));
    if (cells.includes("Plan execution ID") && cardColumn !== -1) {
      traceabilityTable = true;
      columns = [cells.indexOf("Plan execution ID"), cardColumn];
      continue;
    }
    if (!columns || cells.every(cell => /^:?-+:?$/.test(cell))) continue;
    const reference = cells[columns[0]] || "";
    const identity = reference.match(/^([A-Za-z0-9][\w-]*)(?:\s+\(([\w-]+)\))?$/);
    const matches = identity ? tasks.filter(task => identity[2]
      ? task.id === identity[1] && task.key === identity[2]
      : task.id === identity[1] || task.key === identity[1]) : [];
    assert(matches.length === 1, `Mapping review required: unknown or ambiguous execution reference ${reference}`);
    const task = matches[0];
    const expanded = cells[columns[1]].replace(
      /(T[\w-]+\.)(\d+)\s*[–-]\s*\1(\d+)/g,
      (_, prefix, a, b) => {
        assert(+b >= +a && +b - +a < 1000, "Invalid appendix task range");
        return Array.from({ length: +b - +a + 1 }, (_, i) => prefix + (+a + i)).join(", ");
      },
    );
    const ids = expanded.split(/\s*,\s*/);
    for (const id of ids) {
      assert(mapping.has(id), `Mapping review required: unknown appendix reference ${id}`);
      assert(
        !mapping.get(id).includes(task.id),
        `Mapping review required: duplicate association ${id}`,
      );
      mapping.get(id).push(task.id);
    }
  }
  if (!traceabilityTable) {
    for (const card of cards) {
      const body = markdown.split(`#### ${card.id} — `)[1]?.split(/^#### |^## 4\./m)[0] || "";
      const source = body
        .split("\n")
        .find((line) => /^- Source:/.test(line) && line.includes("plan.md"));
      const references = [...(source || "").matchAll(/\bTask ([\w-]+)\b/g)];
      for (const reference of references) {
        const task = tasks.find((t) => t.key === reference[1]);
        assert(task, `Mapping review required: unknown plan task ${reference[1]}`);
        if (!mapping.get(card.id).includes(task.id)) mapping.get(card.id).push(task.id);
      }
    }
  }
  assert(
    [...mapping.values()].every((ids) => ids.length),
    "Mapping review required: every appendix card needs an explicit execution reference; numeric prefixes are not mappings",
  );
  return cards.map((card) => ({
    appendixTaskId: card.id,
    executionTaskIds: mapping.get(card.id),
    title: card.title,
    points: card.total,
  }));
}

export function reconcileIssueSearch(manifest, pages) {
  assert(pages.length, "Existing issue search was not completed");
  const issues = [],
    seen = new Set();
  let next = 0;
  for (const page of pages) {
    assert(
      !page.error && Array.isArray(page.issues),
      "Existing issue search failed or response is invalid",
    );
    assert(
      page.startAt === undefined || page.startAt === next,
      "Existing issue search pagination is incomplete",
    );
    for (const issue of page.issues) {
      assert(
        issue.key && issue.fields?.project?.key && issue.fields.description !== undefined,
        "Existing issue search omitted required issue fields; visibility is incomplete",
      );
      assert(!seen.has(issue.key), "Existing issue search returned overlapping pages");
      seen.add(issue.key);
      issues.push(issue);
    }
    next += page.issues.length;
  }
  const last = pages.at(-1);
  assert(
    last.isLast === true || (Number.isInteger(last.total) && next === last.total),
    "Existing issue search pagination is incomplete; never assume zero issues",
  );
  const entries = manifest.entries.map((entry) => {
    const marker = new RegExp(entry.marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "(?![\\w.-])");
    const matches = issues.filter((issue) =>
      marker.test(JSON.stringify(issue.fields?.description || "")),
    );
    assert(
      matches.length <= 1,
      `Duplicate idempotency marker ${entry.marker}; reconcile matching Jira issues`,
    );
    const issue = matches[0];
    if (issue) {
      assert(
        issue.fields?.project?.key === manifest.project && /^\w+-\d+$/.test(issue.key),
        "Existing issue is outside the selected project",
      );
      assert(
        !entry.issueKey || entry.issueKey === issue.key,
        `Existing mapping changed for ${entry.appendixTaskId}`,
      );
    }
    assert(
      !entry.issueKey || issue,
      `Previously mapped issue ${entry.issueKey} was not returned; search visibility or publication is uncertain`,
    );
    return {
      ...entry,
      ...(issue
        ? {
            issueKey: issue.key,
            issueUrl: manifest.siteUrl ? `${manifest.siteUrl}/browse/${issue.key}` : entry.issueUrl,
            status: "EXISTING",
          }
        : {}),
      lastVerifiedAt: new Date().toISOString(),
    };
  });
  const keys = entries.filter((e) => e.issueKey).map((e) => e.issueKey);
  assert(
    new Set(keys).size === keys.length,
    "One existing Jira issue contains multiple appendix markers; human reconciliation required",
  );
  return {
    entries,
    complete: true,
    visibleIssueCount: issues.length,
    matchedIssueCount: keys.length,
    visibilityVerified: pages.every((p) => p.visibilityComplete === true),
    checkedAt: new Date().toISOString(),
  };
}

export class JiraPublication {
  constructor(engine) {
    this.e = engine;
    this.s = engine.store;
  }
  enabled() {
    return (
      typeof this.e.adapters.skill.preflightPublication === "function" &&
      !this.e.adapters.skill.bridge?.executable
    );
  }
  get(questId) {
    return this.s.get("operations", `jira-manifest:${questId}`);
  }
  resolve(quest, artifact) {
    const old = this.get(quest.id),
      siteUrl = new URL(quest.jiraContext.siteUrl).origin;
    if (old) {
      assert(
        old.siteUrl === siteUrl &&
          old.project === quest.jiraContext.project &&
          old.epic === quest.jiraContext.epic,
        "Publication target changed; reconcile the existing manifest before changing its namespace",
      );
      assert(
        old.artifactId === artifact.id && old.artifactHash === artifact.hash,
        "Approved appendix changed; reconcile the existing publication manifest before publishing a modified revision",
      );
      // Mapping failures happen before any write; retry only their empty manifests.
      if (old.state !== "MAPPING_REVIEW" || old.entries?.length) return old;
    }
    const plan = this.e.approved(quest.id, "plan"),
      trd = this.e.approved(quest.id, "trd");
    const metadata = this.s.metadataContent(artifact.jiraMetadata || quest.jiraMetadata);
    const base = {
      id: `jira-manifest:${quest.id}`,
      questId: quest.id,
      state: "BLOCKED",
      siteUrl,
      project: quest.jiraContext.project,
      projectId: metadata.projectId,
      cloudId: metadata.cloudId,
      epic: quest.jiraContext.epic,
      artifactId: artifact.id,
      artifactHash: artifact.hash,
      revision: artifact.revision,
      planArtifactId: plan.id,
      planHash: plan.hash,
      trdArtifactId: trd.id,
      trdHash: trd.hash,
      metadataHash: (artifact.jiraMetadata || quest.jiraMetadata).hash,
      appendixIdempotencyPrefix: old?.appendixIdempotencyPrefix || `devquest:${quest.id}:appendix:`,
      createdAt: old?.createdAt || new Date().toISOString(),
      entries: [],
    };
    this.s.put("operations", base);
    try {
      const mappings = appendixTaskMapping(this.s.content(artifact), this.e.tasks(quest.id));
      const issues = this.e.tasks(quest.id).flatMap((t) => t.jira?.issues || []);
      assert(
        issues.every((i) => mappings.some((m) => m.appendixTaskId === i.appendixTaskId)),
        "Stored Jira issue associations need reconciliation; an appendix card ID is missing",
      );
      return this.s.put("operations", {
        ...base,
        entries: mappings.map((m) => {
          const matches = [
            ...new Set(
              issues.filter((i) => i.appendixTaskId === m.appendixTaskId).map((i) => i.key),
            ),
          ];
          assert(matches.length <= 1, "Stored issue mappings contain duplicate appendix markers");
          return {
            ...m,
            marker: base.appendixIdempotencyPrefix + m.appendixTaskId,
            status: "PENDING",
            ...(matches.length ? { issueKey: matches[0] } : {}),
          };
        }),
      });
    } catch (error) {
      this.s.put("operations", { ...base, state: "MAPPING_REVIEW", error: error.message });
      throw error;
    }
  }
  input(quest, artifact, manifest) {
    assert(manifest.entries.length, "Mapping review required before publication preparation");
    return {
      quest,
      appendixPath: artifact.file,
      appendixContent: this.s.content(artifact),
      appendixArtifactId: artifact.id,
      appendixHash: artifact.hash,
      appendixIdempotencyPrefix: manifest.appendixIdempotencyPrefix,
      appendixTaskMapping: manifest.entries.map((e) => ({
        appendixTaskId: e.appendixTaskId,
        executionTaskIds: e.executionTaskIds,
      })),
      existingIssues: manifest.entries
        .filter((e) => e.issueKey)
        .map((e) => ({
          appendixTaskId: e.appendixTaskId,
          executionTaskIds: e.executionTaskIds,
          key: e.issueKey,
          url: e.issueUrl,
          marker: e.marker,
        })),
      publicationManifest: manifest,
      skillPaths: this.e.adapters.config?.workflow?.skills || {},
    };
  }
  acceptsAccountVisibleSearch(quest, artifact) {
    return acceptsAccountVisibleSearch(quest, artifact);
  }
  requireReady(quest, artifact) {
    const manifest = this.get(quest.id);
    assert(
      manifest && manifest.state === "READY",
      manifest?.error ||
        "Prepare Jira publication first: verified issue reconciliation and a complete publication manifest are required",
    );
    assert(
      manifest.artifactId === artifact.id &&
        manifest.artifactHash === artifact.hash &&
        manifest.project === quest.jiraContext.project &&
        manifest.siteUrl === new URL(quest.jiraContext.siteUrl).origin &&
        manifest.epic === quest.jiraContext.epic,
      "Publication manifest no longer matches the approved revision or Jira target",
    );
    assert(manifest.visibilityScope !== "account-visible" || this.acceptsAccountVisibleSearch(quest, artifact),
      "Account-visible Jira search acceptance changed; prepare publication again");
    return manifest;
  }
  async prepare(quest, artifact, coordinated = false) {
    this.e.appendixArtifactInput(quest, artifact.id);
    assert(
      coordinated ||
        (!this.e.v11.pending.has(`jira:${quest.id}`) &&
          this.s.get("operations", `jira:${quest.id}`)?.state !== "RUNNING"),
      "Publication is already active",
    );
    let manifest = this.resolve(quest, artifact);
    assert(manifest.state !== "MAPPING_REVIEW", manifest.error);
    try {
      const proof = await this.e.adapters.skill.preflightPublication(
        this.input(quest, artifact, manifest),
      );
      assert(
        proof.cloudId === manifest.cloudId &&
          proof.projectId === manifest.projectId &&
          proof.siteUrl === manifest.siteUrl,
        "Authenticated publication target differs from the persisted namespace",
      );
      const search = reconcileIssueSearch(manifest, proof.searchPages);
      manifest = {
        ...manifest,
        entries: search.entries,
        verifiedCapabilities: proof,
        verifiedMetadataVersion: hash(JSON.stringify(proof)),
        search: { ...search, entries: undefined },
        verifiedAt: search.checkedAt,
      };
      const options = this.s.metadataContent(
        artifact.jiraMetadata || quest.jiraMetadata,
      ).selectedOptions;
      const md = this.s.content(artifact);
      const taskText = md.slice(md.indexOf("## 3."), md.indexOf("## 4."));
      const knownFields = new Set([
        "summary",
        "project",
        "issuetype",
        "parent",
        "assignee",
        proof.weightField,
        proof.storyTypeField,
        proof.appendixField,
        proof.parentField,
      ]);
      assert(
        (proof.requiredFields || []).every((f) => knownFields.has(f)),
        "Additional required Jira create fields need explicit values before publication",
      );
      assert(
        !(proof.requiredFields || []).includes("assignee") || proof.assigneeAccountId,
        "Required assignee was not resolved",
      );
      manifest.entries = manifest.entries.map((entry) => {
        const section =
          taskText.split(`#### ${entry.appendixTaskId} — `)[1]?.split(/^#### /m)[0] || "";
        const labels = section
          .split("\n")
          .filter((line) => line.startsWith("|"))
          .map((line) => line.split("|")[2]?.trim().replace(/^`|`$/g, ""));
        const categoryIds = options
          .filter((o) => labels.includes(o.value))
          .map((o) => ({ id: String(o.id) }));
        assert(categoryIds.length, `Missing verified category IDs for ${entry.appendixTaskId}`);
        return {
          ...entry,
          intendedFields: {
            projectKey: manifest.project,
            issueTypeName: "Task",
            summary: `${entry.appendixTaskId} — ${entry.title}`,
            description: section + `\n\n${entry.marker}`,
            ...(manifest.epic && (!proof.parentField || proof.parentField === "parent")
              ? { parent: { key: manifest.epic } }
              : {}),
            contentFormat: "markdown",
            ...(proof.assigneeAccountId ? { assignee_account_id: proof.assigneeAccountId } : {}),
            additional_fields: {
              ...(manifest.epic && proof.parentField && proof.parentField !== "parent"
                ? { [proof.parentField]: manifest.epic }
                : {}),
              [proof.weightField]: entry.points,
              [proof.storyTypeField]: { id: proof.technicalOptionId },
              [proof.appendixField]: categoryIds,
            },
          },
        };
      });
      assert(
        search.visibilityVerified || this.acceptsAccountVisibleSearch(quest, artifact),
        "Jira search pagination completed, but issue-security visibility is user-scoped and not independently verified. Publication remains blocked; supply a read-only integration that can attest complete project issue visibility",
      );
      manifest = this.s.put("operations", {
        ...manifest,
        state: "READY",
        error: "",
        visibilityScope: search.visibilityVerified ? "project-complete" : "account-visible",
        visibilityWarning: search.visibilityVerified ? "" : "Only issues visible to your Jira account were checked. Hidden issues may contain duplicates; complete project visibility was not verified.",
        visibilityAcceptance: search.visibilityVerified ? null : quest.jiraSearchScopeAcceptance,
        verifiedMetadataVersion: hash(JSON.stringify(proof)),
        manifestHash: hash(JSON.stringify(manifest.entries)),
      });
      this.recordResults(manifest, []);
      this.e.saveTickets(quest);
      return manifest;
    } catch (error) {
      if (error.jiraReadEvidence?.length) {
        const evidence = this.s.metadata(quest.id, {
          options: [],
          evidence: error.jiraReadEvidence,
        });
        manifest = {
          ...manifest,
          diagnostics: [
            ...(manifest.diagnostics || []),
            { ...evidence, error: error.message, createdAt: new Date().toISOString() },
          ],
        };
      }
      this.s.put("operations", { ...manifest, state: "BLOCKED", error: error.message });
      throw error;
    }
  }
  recordResults(manifest, results) {
    const entries = manifest.entries.map((entry) => {
      const matches = results.filter((r) => r.appendixTaskId === entry.appendixTaskId);
      assert(matches.length <= 1, "Duplicate publication result for one appendix card");
      if (!matches.length) return entry;
      const r = matches[0];
      assert(
        entry.executionTaskIds.includes(r.taskId) &&
          new RegExp(`^${manifest.project}-\\d+$`).test(r.key),
        "Publisher returned an out-of-scope mapping",
      );
      assert(
        !entry.issueKey || entry.issueKey === r.key,
        "Publisher returned a second issue for the same stable appendix card",
      );
      return {
        ...entry,
        issueKey: r.key,
        issueUrl: manifest.siteUrl ? `${manifest.siteUrl}/browse/${r.key}` : entry.issueUrl,
        status: "CONFIRMED",
        lastVerifiedAt: new Date().toISOString(),
      };
    });
    assert(
      results.every((r) => entries.some((e) => e.appendixTaskId === r.appendixTaskId)),
      "Publisher returned an unknown appendix card",
    );
    const keys = entries.filter((e) => e.issueKey).map((e) => e.issueKey);
    assert(
      new Set(keys).size === keys.length,
      "Publisher associated the same Jira issue with multiple appendix cards",
    );
    const latest = this.get(manifest.questId) || manifest,
      attempts = [...(latest.attempts || [])];
    if (results.length && attempts.length)
      attempts[attempts.length - 1] = {
        ...attempts.at(-1),
        state: "CONFIRMED",
        results,
        finishedAt: new Date().toISOString(),
      };
    this.s.put("operations", {
      ...latest,
      entries,
      state: "READY",
      error: "",
      attempts,
      manifestHash: hash(JSON.stringify(entries)),
    });
    const expanded = [];
    for (const taskId of new Set(entries.flatMap((e) => e.executionTaskIds))) {
      const associated = entries.filter((e) => e.executionTaskIds.includes(taskId)),
        complete = associated.every((e) => e.issueKey);
      for (const e of associated.filter((e) => e.issueKey)) {
        const task = this.s.get("tasks", taskId),
          issues = [...(task.jira?.issues || [])];
        if (!issues.some((i) => i.key === e.issueKey))
          issues.push({
            key: e.issueKey,
            url: e.issueUrl,
            appendixTaskId: e.appendixTaskId,
            appendixArtifactId: manifest.artifactId,
          });
        this.s.put("tasks", {
          ...task,
          jira: {
            ...task.jira,
            key: issues[0].key,
            url: issues[0].url || task.jira?.url || "",
            issues,
            complete,
          },
          state: complete ? "PUBLISHED" : task.state,
        });
        expanded.push({
          taskId,
          appendixTaskId: e.appendixTaskId,
          key: e.issueKey,
          url: e.issueUrl,
          complete,
        });
      }
    }
    return expanded;
  }
}

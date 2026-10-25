import { createHash } from "node:crypto";
import { validateAppendix } from "../src/appendix-markdown.js";
import { jiraContext, verifyJiraProject } from "../src/jira-project.js";
import { jiraEvidence } from "./jira-fixture.js";

// Synthetic deterministic preflight proof; never connects to Jira or an AI runtime.
export function readyPublisherInput(input) {
  const appendixHash = createHash("sha256").update(input.appendixContent).digest("hex"),
    appendixArtifactId = "approved-fixture",
    appendixIdempotencyPrefix = `devquest:${input.quest.id}:appendix:`;
  const context = jiraContext(input.quest.jiraContext);
  const entries = validateAppendix(input.appendixContent).map((c) => ({
    appendixTaskId: c.id,
    executionTaskIds: [input.tasks[0].id],
    marker: appendixIdempotencyPrefix + c.id,
  }));
  return {
    ...input,
    appendixHash,
    appendixArtifactId,
    appendixIdempotencyPrefix,
    existingIssues: [],
    appendixTaskMapping: entries.map((e) => ({
      appendixTaskId: e.appendixTaskId,
      executionTaskIds: e.executionTaskIds,
    })),
    publicationManifest: {
      state: "READY",
      project: context.project,
      cloudId: jiraEvidence(context.project)[1].input.cloudId,
      projectId: "100",
      search: { complete: true, visibilityVerified: true },
      artifactId: appendixArtifactId,
      artifactHash: appendixHash,
      appendixIdempotencyPrefix,
      entries,
    },
    verifiedCapabilities: {
      ...verifyJiraProject(context, input.appendixContent, jiraEvidence(context.project)),
      appendixHash,
      contextKey: JSON.stringify(context),
    },
    publicationAuthorization: {
      explicit: true,
      artifactId: appendixArtifactId,
      hash: appendixHash,
      maxIssues: input.maxIssues,
    },
  };
}

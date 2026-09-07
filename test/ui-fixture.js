// Synthetic UI test data only. Never loaded by the production application.
export function uiFixture() {
  const questId = "quest-ui-fixture";
  return {
    repositories: [
      {
        id: "payment",
        name: "payment-service",
        path: "E:\\Workspace\\payment-service",
      },
      {
        id: "notification",
        name: "notification-service",
        path: "E:\\Workspace\\notification-service",
      },
    ],
    quests: [
      {
        id: questId,
        title: "Recurring payment · UI test fixture",
        kind: "PRODUCT",
        state: "EXECUTING",
        sprint: "Sprint 24.10 · UI fixture",
        repositoryIds: ["payment", "notification"],
        warnings: [],
        sources: [],
        autoExecute: false,
      },
    ],
    tasks: [
      {
        id: "t1",
        questId,
        key: "PAY-T01",
        title: "Add recurring payment model",
        repoId: "payment",
        state: "COMPLETED",
        validationProfile: "node-test",
        dependencies: [],
        jira: { key: "PAY-501", url: "https://example.test/PAY-501" },
        validation: { passed: true, summary: "node-test: passed" },
      },
      {
        id: "t2",
        questId,
        key: "PAY-T02",
        title: "Implement recurring scheduler",
        repoId: "payment",
        state: "COMPLETED",
        validationProfile: "node-test",
        dependencies: ["t1"],
        jira: { key: "PAY-502", url: "https://example.test/PAY-502" },
      },
      {
        id: "t3",
        questId,
        key: "PAY-T03",
        title: "Publish recurring payment event",
        repoId: "payment",
        state: "RUNNING",
        validationProfile: "node-test",
        dependencies: ["t2"],
        jira: { key: "PAY-503", url: "https://example.test/PAY-503" },
      },
      {
        id: "t4",
        questId,
        key: "PAY-T04",
        title: "Send reminder notifications",
        repoId: "notification",
        state: "PUBLISHED",
        validationProfile: "npm-test",
        dependencies: ["t3"],
        jira: { key: "PAY-504", url: "https://example.test/PAY-504" },
      },
    ],
    works: [
      {
        id: "work-payment",
        questId,
        repoId: "payment",
        state: "EXECUTING",
        path: "E:\\DevQuest\\worktrees\\payment",
        branch: "devquest/recurring-payment",
        review: null,
      },
      {
        id: "work-notification",
        questId,
        repoId: "notification",
        state: "READY",
        path: "E:\\DevQuest\\worktrees\\notification",
        branch: "devquest/recurring-payment",
        review: null,
      },
    ],
    runs: [
      {
        id: "architect-1",
        questId,
        purpose: "trd",
        runtime: "claude",
        state: "COMPLETED",
        summary: "Use a versioned event contract between services.",
      },
      {
        id: "planner-1",
        questId,
        purpose: "plan",
        runtime: "claude",
        state: "COMPLETED",
        summary: "Implement the scheduler before connecting notifications.",
      },
      {
        id: "developer-1",
        questId,
        taskId: "t3",
        workId: "work-payment",
        purpose: "task",
        runtime: "codex",
        state: "RUNNING",
        summary:
          "UI test fixture: implementing event publication and its tests.",
        updatedAt: "2026-09-07T03:00:00Z",
      },
    ],
    artifacts: [
      {
        id: "prd-v1",
        questId,
        kind: "prd",
        revision: 1,
        content:
          "Implement recurring payment functionality including the database model, scheduler and versioned events. Allow customers to set up automatic payments and receive notifications for upcoming payments.\n\nAcceptance: scheduled charges are idempotent, failures can be retried, and reminder notifications are sent once.",
      },
      {
        id: "analysis-v1",
        questId,
        kind: "analysis",
        revision: 1,
        content:
          "Payment owns scheduling; notification consumes payment events.",
      },
      {
        id: "trd-v1",
        questId,
        kind: "trd",
        revision: 1,
        content:
          "# Technical design\nUse payment.recurring.created.v1 between services.",
      },
      {
        id: "plan-v1",
        questId,
        kind: "plan",
        revision: 1,
        content:
          "# Plan\nImplement the model, scheduler, events and notifications.",
      },
    ],
    events: [
      {
        id: "e1",
        questId,
        message: "UI fixture: scheduler validation passed",
        createdAt: "2026-09-07T02:50:00Z",
      },
      {
        id: "e2",
        questId,
        message: "UI fixture: approved plan published to Jira",
        createdAt: "2026-09-07T02:40:00Z",
      },
    ],
    runtimes: { codex: { available: true }, claude: { available: true } },
    settings: {
      dataDir: "E:\\DevQuest · test fixture",
      concurrency: 2,
      jiraConfigured: true,
      confluenceConfigured: true,
    },
  };
}

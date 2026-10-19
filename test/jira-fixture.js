export function jiraEvidence(project = "FCAD") {
  const cloudId = "synthetic-cloud";
  const scope = { cloudId, projectIdOrKey: project };
  const event = (method, input, data) => ({
    type: "jira-read",
    method,
    input,
    content: [{ type: "text", text: JSON.stringify(data) }],
    error: false,
  });
  return [
    event("getAccessibleAtlassianResources", {}, [{ id: cloudId, url: "https://jira.example" }]),
    event(
      "getVisibleJiraProjects",
      { cloudId },
      {
        values: [
          {
            id: "100",
            key: project,
            projectUrl: `https://jira.example/jira/software/c/projects/${project}`,
          },
        ],
      },
    ),
    event("getJiraProjectIssueTypesMetadata", scope, {
      issueTypes: [{ id: "10001", name: "Task", subtask: false }],
    }),
    event(
      "getJiraIssueTypeMetaWithFields",
      { ...scope, issueTypeId: "10001" },
      {
        fields: {
          summary: { name: "Summary", required: true, schema: { type: "string" } },
          parent: { name: "Parent", required: false, schema: { type: "issuelink" } },
          customfield_11543: {
            name: "Choose Appendix (v3)",
            required: true,
            schema: { type: "array", items: "option" },
            allowedValues: [
              { id: "11515", value: "Refactor or add 1 generic function" },
              { id: "11516", value: "Refactor generic function unit test" },
            ],
          },
          customfield_10751: { name: "Weight Points", required: true, schema: { type: "number" } },
          customfield_11312: {
            name: "Story Point Type (v2)",
            required: true,
            schema: { type: "option" },
            allowedValues: [{ id: "10949", value: "Technical" }],
          },
        },
      },
    ),
    event(
      "getJiraIssue",
      { cloudId, issueIdOrKey: `${project}-1` },
      { key: `${project}-1`, fields: { project: { key: project }, issuetype: { name: "Epic" } } },
    ),
  ];
}

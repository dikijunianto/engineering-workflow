export const designResult = (
  stage,
  content = "# Technical specification\nPreserve service behavior.",
  openQuestions = [],
) =>
  JSON.stringify({
    stage,
    status: openQuestions.length ? "waiting_input" : "completed",
    ...(openQuestions.length
      ? {}
      : {
          artifact: {
            type: {
              brainstorm: "technical_spec",
              analysis: "repository_analysis",
              trd: "technical_design",
              plan: "implementation_plan",
            }[stage],
            filename: {
              brainstorm: "spec.md",
              analysis: "analysis.md",
              trd: "trd.md",
              plan: "plan.md",
            }[stage],
            content,
          },
        }),
    summary: openQuestions.length
      ? "A technical decision needs clarification"
      : "Read-only design completed",
    openQuestions,
    risks: [],
  });

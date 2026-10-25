import { REVIEW_CATEGORIES } from "../src/routing.js";
export const models = ["haiku", "sonnet", "opus"].map((family) => ({
  id: `claude-${family}-5-5`,
  family,
  runtime: "claude",
  available: true,
  verified: true,
  efforts: ["low", "medium", "high"],
}));
export const review = (commit, verdict = "PASSED") => ({
  verdict,
  reviewedCommit: commit,
  findings:
    verdict === "PASSED"
      ? []
      : [
          {
            severity: "HIGH",
            category: "RELIABILITY",
            file: "a.txt",
            description: "Fix validation behavior",
            blocking: true,
          },
        ],
  validation: { unitTests: "PASSED", integrationTests: "NOT_VERIFIED" },
  categories: Object.fromEntries(REVIEW_CATEGORIES.map((c) => [c, "PASSED"])),
});

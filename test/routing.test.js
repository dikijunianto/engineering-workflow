import { test } from "node:test";
import assert from "node:assert/strict";
import {
  executionConfig,
  resolveRoute,
  assessment,
  epicInput,
  productionReview,
  REVIEW_CATEGORIES,
} from "../src/routing.js";

import { models, review } from "./v11-fixture.js";

test("routing validates complexity, risk, manual precedence and efforts", () => {
  const config = executionConfig({ routing: { mode: "dynamic" } });
  const simple = assessment(
    {
      taskId: "T1",
      complexity: "SIMPLE",
      risk: "LOW",
      recommendedModelFamily: "haiku",
      recommendedEffort: "medium",
      reason: "Pure documentation",
      confidence: 0.95,
    },
    "T1",
  );
  assert.equal(
    resolveRoute(config, "developer", simple, models).family,
    "haiku",
  );
  assert.equal(
    resolveRoute(
      config,
      "developer",
      {
        ...simple,
        risk: "HIGH",
        recommendedModelFamily: "opus",
        recommendedEffort: "high",
      },
      models,
    ).family,
    "opus",
  );
  const manual = executionConfig({ routing: { model: "claude-opus-5-5" } });
  assert.equal(
    resolveRoute(manual, "developer", simple, models).resolvedModel,
    "claude-opus-5-5",
  );
  assert.equal(
    resolveRoute(config, "orchestrator", null, models).resolvedEffort,
    "high",
  );
  assert.throws(
    () =>
      resolveRoute(
        {
          ...config,
          routing: { ...config.routing, effort: "unsupported" },
          roles: {
            ...config.roles,
            developer: { runtime: "inherit", effort: "unsupported" },
          },
        },
        "developer",
        simple,
        models,
      ),
    /effort/,
  );
});
test("forbidden models, unverified registries and unsafe fallbacks are blocked", () => {
  assert.throws(
    () => executionConfig({ routing: { model: "claude-fable-5" } }),
    /Fable/,
  );
  assert.throws(
    () =>
      assessment(
        {
          taskId: "T1",
          complexity: "SIMPLE",
          risk: "LOW",
          recommendedModelFamily: "fable",
          recommendedEffort: "medium",
          reason: "bad",
          confidence: 1,
        },
        "T1",
      ),
    /Forbidden/,
  );
  const config = executionConfig({ routing: { mode: "dynamic" } });
  assert.throws(
    () =>
      resolveRoute(
        config,
        "orchestrator",
        null,
        models.filter((m) => m.family !== "opus"),
      ),
    /No verified/,
  );
  assert.throws(
    () =>
      resolveRoute(
        config,
        "developer",
        null,
        models.map((m) => ({ ...m, verified: false })),
      ),
    /No verified/,
  );
  assert.throws(
    () =>
      resolveRoute(config, "developer", null, [
        ...models,
        { ...models[0], id: "fable-as-fallback" },
      ]),
    /Fable/,
  );
  const fallback = resolveRoute(
    config,
    "developer",
    null,
    models.filter((m) => m.family === "opus"),
    { fallbacks: { sonnet: ["claude-opus-5-5"] } },
  );
  assert.match(fallback.fallbackReason, /explicitly permitted/);
  assert.throws(
    () =>
      resolveRoute(
        config,
        "developer",
        { risk: "HIGH" },
        models.filter((m) => m.family === "haiku"),
        { fallbacks: { opus: ["claude-haiku-5-5"] } },
      ),
    /No verified/,
  );
});
test("optional Epic and exact-commit production review are validated", () => {
  assert.deepEqual(epicInput("pay-100"), { epicKey: "PAY-100", epicUrl: "" });
  assert.equal(
    epicInput("https://team.example/browse/PAY-100").epicKey,
    "PAY-100",
  );
  assert.throws(() =>
    epicInput("https://user:secret@team.example/browse/PAY-100"),
  );
  const commit = "a".repeat(40);
  assert.equal(productionReview(review(commit), commit).verdict, "PASSED");
  assert.throws(
    () => productionReview(review(commit), "b".repeat(40)),
    /exact integrated/,
  );
  assert.throws(
    () =>
      productionReview(
        { ...review(commit, "CHANGES_REQUIRED"), verdict: "PASSED" },
        commit,
      ),
    /Blocking/,
  );
  assert.throws(
    () => productionReview({ ...review(commit), categories: {} }, commit),
    /every production/,
  );
});

test("cross-runtime reviewer overrides remain optional and model-safe", () => {
  const registry = [
    ...models,
    {
      id: "gpt-6.1-sol",
      runtime: "codex",
      family: "gpt",
      available: true,
      verified: true,
      efforts: ["high"],
    },
  ];
  const config = executionConfig({
    runtime: "claude",
    routing: { mode: "dynamic" },
    roles: {
      reviewer: { runtime: "codex", model: "gpt-6.1-sol", effort: "high" },
    },
  });
  const route = resolveRoute(
    config,
    "reviewer",
    { risk: "HIGH", complexity: "COMPLEX" },
    registry,
  );
  assert.equal(route.runtime, "codex");
  assert.equal(route.resolvedModel, "gpt-6.1-sol");
  assert.throws(
    () => executionConfig({ limits: { developers: 6 } }),
    /developer limit/,
  );
  assert.equal(
    executionConfig({}, { maxConcurrentDeveloperAgents: 3 }).limits.developers,
    3,
  );
});

test("Claude-only verified catalog preserves dynamic tiers and explicit upward fallbacks", () => {
  const config = executionConfig({
    runtime: "claude",
    routing: { mode: "dynamic" },
  });
  for (const [complexity, family, effort] of [
    ["TRIVIAL", "haiku", "low"],
    ["SIMPLE", "haiku", "medium"],
    ["MODERATE", "sonnet", "medium"],
    ["COMPLEX", "sonnet", "high"],
    ["VERY_COMPLEX", "opus", "high"],
    ["CRITICAL", "opus", "high"],
  ]) {
    const route = resolveRoute(
      config,
      "developer",
      { complexity, risk: "LOW" },
      models,
    );
    assert.equal(route.runtime, "claude");
    assert.equal(route.resolvedModel, `claude-${family}-5-5`);
    assert.equal(route.resolvedEffort, effort);
  }
  const unavailable = models.filter((model) => model.family !== "haiku");
  assert.throws(
    () =>
      resolveRoute(config, "developer", { complexity: "SIMPLE" }, unavailable),
    /No verified/,
  );
  const policy = { fallbacks: { haiku: ["claude-sonnet-5-5"] } };
  const fallback = resolveRoute(
    config,
    "developer",
    { complexity: "SIMPLE" },
    unavailable,
    policy,
  );
  assert.equal(fallback.resolvedModel, "claude-sonnet-5-5");
  assert.match(fallback.fallbackReason, /explicitly permitted/);
  assert.throws(
    () =>
      resolveRoute(
        config,
        "orchestrator",
        null,
        unavailable.filter((model) => model.family !== "opus"),
        { fallbacks: { opus: ["claude-sonnet-5-5"] } },
      ),
    /No verified/,
  );
  assert.throws(
    () =>
      resolveRoute(config, "developer", null, models, {
        fallbacks: { haiku: ["ClAuDe-FaBlE-5-1"] },
      }),
    /Fable/,
  );
  for (const model of ["best", "default", "opusplan", "inherit"])
    assert.throws(
      () => executionConfig({ routing: { model } }),
      /automatic model aliases/,
    );
  const limited = models.map((model) => ({
    ...model,
    efforts: ["low", "medium"],
  }));
  assert.throws(
    () => resolveRoute(config, "orchestrator", null, limited),
    /does not support verified effort high/,
  );
});

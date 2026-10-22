import { test } from "node:test";
import assert from "node:assert/strict";
import { sessionGroups, agentRole, roleMapping, duration } from "../ui/agents-model.js";

test("agent sessions retain running processes while superseded failures move into history", () => {
  const old = { id: "old", questId: "q", purpose: "task", taskId: "t", state: "FAILED" };
  const active = { ...old, id: "active", state: "RUNNING" };
  const done = { ...old, id: "done", state: "COMPLETED" };
  const waiting = { id: "wait", questId: "q", purpose: "plan", state: "WAITING_INPUT" };
  const groups = sessionGroups([old, active, done, waiting]);
  assert.deepEqual(groups.active, [active]);
  assert.deepEqual(groups.attention, [waiting]);
  assert.ok(groups.history.includes(old));
  assert.equal(agentRole({ purpose: "jira_appendix_generation" }), "jira-specialist");
  assert.equal(agentRole({ role: "reviewer", purpose: "v11-review" }), "reviewer");
  assert.equal(agentRole({ purpose: "analysis" }), "architect");
});
test("mapping uses configured project models and elapsed duration never invents a start time", () => {
  assert.equal(roleMapping({ quests: [] }, "architect"), "Inherited model policy");
  assert.equal(
    roleMapping(
      { quests: [{ execution: { roles: { architect: { model: "permitted-model" } } } }] },
      "architect",
    ),
    "permitted-model",
  );
  assert.equal(duration({ state: "RUNNING" }), "Not recorded");
  assert.equal(
    duration(
      { state: "RUNNING", startedAt: "2026-01-01T00:00:00Z" },
      Date.parse("2026-01-01T00:01:05Z"),
    ),
    "1m 5s",
  );
  assert.equal(
    duration({
      state: "COMPLETED",
      startedAt: "2026-01-01T00:00:00Z",
      finishedAt: "2026-01-01T00:00:08Z",
    }),
    "8s",
  );
});

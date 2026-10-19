import test from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { validateAppendix, decodeAppendix } from "../src/appendix-markdown.js";
import { selectAppendixOptions } from "../src/jira-settings.js";

// Forensic normalization reports latent errors; it never changes or accepts the document.
function inspect(content, options) {
  const section = (n, end) =>
    content.slice(content.indexOf(`## ${n}. `), end ? content.indexOf(`## ${end}. `) : undefined);
  const cells = (line) =>
    line
      .trim()
      .replace(/^\||\|$/g, "")
      .split("|")
      .map((s) => s.trim());
  const number = (value) => Number(value.replace(/\*/g, "").trim());
  const matrix = section(1, 2),
    taskSection = section(3, 4);
  const headers = [...taskSection.matchAll(/^#### (\S+) — (.+)$/gm)];
  const counts = new Map();
  headers.forEach((h) => counts.set(h[1], (counts.get(h[1]) || 0) + 1));
  const report = {
    documentHash: createHash("sha256").update(content).digest("hex"),
    completeSections:
      [1, 2, 3, 4, 5, 6, 7].every((n) => content.includes(`## ${n}. `)) &&
      [1, 2, 3, 4, 5].every((n) => content.includes(`### 6.${n} `)),
    annotatedMatrixWeightCells: 0,
    matrixMatches: 0,
    matrixMismatches: [],
    taskHeadings: headers.length,
    invalidTaskIds: headers.filter((h) => !/^T[\w-]+\.\d+$/.test(h[1])).length,
    duplicateTaskIds: [...counts].filter(([, n]) => n > 1).map(([id]) => id),
    missingTables: [],
    categoryIdAnnotations: 0,
    lineMatches: 0,
    lineMismatches: [],
    duplicateCategories: [],
    totalErrors: [],
    tasksWithTables: 0,
    lineItems: 0,
    totalPoints: 0,
  };
  for (const line of matrix.split("\n")) {
    if (!line.startsWith("|")) continue;
    const [weight, categories] = cells(line),
      points = Number(weight.replace(/[*]/g, "").match(/^\d+/)?.[0]);
    if (/\*\*\d+ pt\*\*\s*\([VLMH]\)/.test(weight)) report.annotatedMatrixWeightCells++;
    for (const match of (categories || "").matchAll(/`([^`]+)`\s*\(`?(\d+)`?\)/g)) {
      const option = options.find(
        (o) => o.value === match[1] && String(o.id) === match[2] && o.points === points,
      );
      if (option) report.matrixMatches++;
      else report.matrixMismatches.push({ id: match[2], label: match[1], points });
    }
  }
  for (const [i, heading] of headers.entries()) {
    const body = taskSection.slice(heading.index + heading[0].length, headers[i + 1]?.index);
    const table = body.match(
      /^\| Appendix line \| Category \| Weight \|\n\|[- :|]+\|\n((?:\|[^\n]*(?:\n|$))+)/m,
    );
    if (!table) {
      report.missingTables.push(heading[1]);
      continue;
    }
    report.tasksWithTables++;
    let total = 0,
      declared;
    const seen = new Set();
    for (const line of table[1].trim().split("\n")) {
      const row = cells(line);
      if (row[0] === "**Task total**") {
        declared = number(row[2]);
        continue;
      }
      const suffix = row[1].match(/\s+\(id (\d+)\)$/),
        label = row[1].replace(/\s+\(id \d+\)$/, "");
      if (suffix) report.categoryIdAnnotations++;
      const option = options.find(
        (o) =>
          o.value === label &&
          (!suffix || String(o.id) === suffix[1]) &&
          o.points === number(row[2]),
      );
      if (option) report.lineMatches++;
      else report.lineMismatches.push({ task: heading[1], label });
      if (seen.has(label)) report.duplicateCategories.push(heading[1]);
      seen.add(label);
      total += number(row[2]);
      report.lineItems++;
    }
    if (declared !== total)
      report.totalErrors.push({ task: heading[1], declared, computed: total });
    report.totalPoints += total;
  }
  const grand = section(4, 5).match(/\| \*\*GRAND TOTAL\*\* \| \*\*(\d+)\*\* \| \*\*(\d+)\*\* \|/);
  report.grandTotalMatches =
    !!grand &&
    Number(grand[1]) === report.tasksWithTables &&
    Number(grand[2]) === report.totalPoints;
  try {
    validateAppendix(content, options);
    report.accepted = true;
  } catch (error) {
    report.accepted = false;
    report.firstError = error.message;
  }
  return report;
}

test("failed format fixture identifies matrix annotations, invalid/duplicate IDs and category-cell decorations without accepting it", async () => {
  const content = await readFile(
    new URL("./fixtures/jira-appendix-failed-format.md", import.meta.url),
    "utf8",
  );
  const report = inspect(content, [
    { id: "11515", value: "Refactor or add 1 generic function", points: 2 },
    { id: "11516", value: "Refactor generic function unit test", points: 2 },
  ]);
  assert.equal(report.accepted, false);
  assert.match(report.firstError, /unsupported Weight cell/);
  assert.equal(report.annotatedMatrixWeightCells, 1);
  assert.equal(report.invalidTaskIds, 2);
  assert.deepEqual(report.duplicateTaskIds, ["T1"]);
  assert.equal(report.categoryIdAnnotations, 2);
  assert.equal(report.matrixMatches, 2);
  assert.deepEqual(report.totalErrors, []);
  assert.equal(report.grandTotalMatches, true);
});

test(
  "actual private failed Claude response remains rejected and its complete forensic evidence is reproducible",
  { skip: !process.env.DEVQUEST_FAILED_APPENDIX_FIXTURE },
  async () => {
    const file = process.env.DEVQUEST_FAILED_APPENDIX_FIXTURE;
    const content = await readFile(file, "utf8");
    const metadata = JSON.parse(
      await readFile(path.join(path.dirname(file), "inputs/jira-appendix-metadata.json"), "utf8"),
    );
    const selected = selectAppendixOptions(
      { project: metadata.project, options: metadata.options },
      {
        categoryFamily: "BE",
        backendWeights: {
          project: metadata.project,
          source: "User Confirmed",
          levels: metadata.weightReference.levelToPoints,
        },
      },
    );
    const report = inspect(content, selected);
    const native = JSON.parse(
      await readFile(path.join(path.dirname(file), "native-result.json"), "utf8"),
    );
    report.nativeStopReason = native.stop_reason;
    report.rawTransportMatchesMarkdown = decodeAppendix(JSON.stringify(native)).content === content;
    assert.equal(
      report.documentHash,
      "37fde1c0c2b02880ad774025f581830c0bc488bc8412fee2dc462c493f45e20f",
    );
    assert.equal(report.accepted, false);
    assert.equal(report.completeSections, true);
    assert.equal(report.nativeStopReason, "end_turn");
    assert.equal(report.rawTransportMatchesMarkdown, true);
    assert.equal(report.matrixMatches, 22);
    assert.deepEqual(report.matrixMismatches, []);
    assert.equal(report.annotatedMatrixWeightCells, 4);
    assert.equal(report.taskHeadings, 32);
    assert.equal(report.invalidTaskIds, 32);
    assert.deepEqual(report.duplicateTaskIds, ["T2", "T7", "T11"]);
    assert.equal(report.tasksWithTables, 29);
    assert.equal(report.categoryIdAnnotations, 46);
    assert.equal(report.lineMatches, 46);
    assert.deepEqual(report.lineMismatches, []);
    assert.deepEqual(report.duplicateCategories, []);
    assert.deepEqual(report.totalErrors, []);
    assert.equal(report.grandTotalMatches, true);
    if (process.env.DEVQUEST_APPENDIX_DIAGNOSTICS_OUT)
      await writeFile(
        process.env.DEVQUEST_APPENDIX_DIAGNOSTICS_OUT,
        JSON.stringify(report, null, 2),
        { mode: 0o600 },
      );
  },
);

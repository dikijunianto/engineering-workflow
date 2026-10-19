import { readFile, realpath, lstat } from "node:fs/promises";
import path from "node:path";

const sections = [
  "Appendix reference (weight matrix)",
  "Categorization heuristics",
  "Tasks (each ≤ 8 pt, target)",
  "Grand total",
  "Weight distribution (per-task)",
  "Open items / known gaps",
  "Suggested Jira import format",
];
const fail = (message) => {
  throw new Error(`Appendix is incomplete or invalid: ${message}`);
};
const cells = (line) =>
  line
    .trim()
    .replace(/^\||\|$/g, "")
    .split(/(?<!\\)\|/)
    .map((s) => s.trim());
const plain = (s) => s.replace(/[*`]/g, "").trim();
const category = (s) =>
  plain(s)
    .replace(/\s*\(half\)\s*$/, "")
    .trim();

// The document stays byte-for-byte authoritative; parsed values are validation/indexes only.
export function validateAppendix(content, liveOptions, previousContent = "", context = {}) {
  const verifyWeight = (label, id, weight) => {
    const option = liveOptions?.find(
      (o) => o.value === label && String(o.id) === id && !o.disabled,
    );
    if (liveOptions && !option) fail(`category not in verified live Jira options: ${label}`);
    if (option?.points !== undefined && option.points !== weight)
      fail(`incorrect project reference weight for ${label}: expected ${option.points}`);
  };
  if (typeof content !== "string" || !content.trim() || content.length > 100000)
    fail("expected complete Markdown (maximum 100,000 characters)");
  const headings = [...content.matchAll(/^## (\d)\. (.+)\r?$/gm)];
  if (
    headings.length !== 7 ||
    headings.some((h, i) => h[1] !== String(i + 1) || h[2] !== sections[i])
  )
    fail("preserve the skill's seven numbered section headings");
  for (let i = 1; i <= 5; i++)
    if (!new RegExp(`^### 6\\.${i} `, "m").test(content)) fail(`missing §6.${i}`);
  const matrix = content.slice(headings[0].index, headings[1].index);
  if (!matrix.includes("customfield_11543") || !/\*\*Source:\*\*/.test(matrix))
    fail("missing live Jira appendix source");
  if (context.project && !matrix.includes(`Jira project ` + "`" + context.project + "`"))
    fail("Appendix source must identify the selected Jira project " + context.project);
  const weights = new Map();
  for (const line of matrix.split("\n")) {
    if (!line.trim().startsWith("|")) continue;
    const row = cells(line),
      weight = Number(plain(row[0] || "").replace(/\s*pt$/, ""));
    if (![1, 2, 4, 8, 16].includes(weight)) continue;
    for (const match of (row[1] || "").matchAll(/`([^`]+)`\s*\(\s*(?:id:\s*)?`?(\d+)`?\s*\)/g)) {
      const label = category(match[1]);
      const tier = label.match(/^MOB-([VLMH])/);
      if (tier && weight !== { V: 1, L: 2, M: 4, H: 8 }[tier[1]])
        fail(`incorrect MOB tier weight for ${label}`);
      if (weights.has(label) && weights.get(label) !== weight)
        fail(`conflicting matrix weight for ${label}`);
      if (
        liveOptions &&
        !liveOptions.some(
          (o) => o.value === label && String(o.id) === match[2] && o.disabled !== true,
        )
      )
        fail(`category not in verified live Jira options: ${label}`);
      verifyWeight(label, match[2], weight);
      weights.set(label, weight);
    }
    // The skill also permits the Jira option ID in a separate third column.
    if (row[2] && /^\d+$/.test(plain(row[2]))) {
      const label = category(row[1]);
      if (
        liveOptions &&
        !liveOptions.some(
          (o) => o.value === label && String(o.id) === plain(row[2]) && o.disabled !== true,
        )
      )
        fail(`category not in verified live Jira options: ${label}`);
      verifyWeight(label, plain(row[2]), weight);
      weights.set(label, weight);
    }
  }
  if (!weights.size) {
    const annotated = matrix
      .split("\n")
      .filter((line) => line.trim().startsWith("|"))
      .map((line) => cells(line)[0])
      .find((cell) => /\(.[^)]*\)/.test(cell));
    fail(
      "matrix must include exact category labels, Jira option IDs and weights" +
        (annotated
          ? `; unsupported Weight cell ${annotated}. Use **1 pt**, **2 pt**, **4 pt**, **8 pt** without tier annotations`
          : ""),
    );
  }
  if (context.completeMatrix && liveOptions?.some((o) => !weights.has(o.value)))
    fail("section 1 matrix must include every verified selected category, ID and weight");
  const taskSection = content.slice(headings[2].index, headings[3].index);
  const matches = [...taskSection.matchAll(/^#### (T[\w-]+\.\d+) — (.+)\r?$/gm)];
  if ([...taskSection.matchAll(/^#### /gm)].length !== matches.length)
    fail("all task cards require stable T<group>.<n> IDs");
  if (!matches.length) fail("missing downstream-compatible #### T<group>.<n> — title cards");
  for (const previous of previousContent.matchAll(/^#### (T[\w-]+\.\d+) — /gm)) {
    if (!matches.some((m) => m[1] === previous[1]))
      fail(`missing stable task ID ${previous[1]}; retain a removed placeholder`);
  }
  const ids = new Set(),
    tasks = [];
  for (const [i, match] of matches.entries()) {
    if (ids.has(match[1])) fail(`duplicate task ID ${match[1]}`);
    ids.add(match[1]);
    if (match[2] === "(removed)") continue;
    const body = taskSection.slice(match.index + match[0].length, matches[i + 1]?.index);
    const table = body.match(
      /^\| Appendix line \| Category \| Weight \|\r?\n\|[- :|]+\|\r?\n((?:\|[^\n]*(?:\n|$))+)/m,
    );
    if (!table) fail(`${match[1]} requires Appendix line | Category | Weight table`);
    const rows = table[1].trim().split("\n").map(cells),
      seen = new Set();
    let total = 0,
      declared,
      lines = 0;
    for (const row of rows) {
      if (row[0] === "**Task total**") {
        if (declared !== undefined || row[1] || !/^\*\*\d+\*\*$/.test(row[2]))
          fail(`${match[1]} malformed Task total row`);
        declared = Number(plain(row[2]));
        continue;
      }
      if (declared !== undefined || row.length !== 3 || !row[0])
        fail(`${match[1]} malformed appendix line`);
      const label = category(row[1]),
        weight = Number(plain(row[2]));
      if (seen.has(label)) fail(`${match[1]} repeats category ${label}; split the task`);
      seen.add(label);
      const expected = weights.get(label);
      if (!expected || weight !== (expected === 16 ? 8 : expected))
        fail(`${match[1]} unknown category or incorrect matrix weight: ${label}`);
      if (expected === 16 && !/Part [12] of 2/.test(match[2]))
        fail(`${match[1]} must identify its 16-point half`);
      total += weight;
      lines++;
    }
    if (!lines || declared !== total)
      fail(`${match[1]} Task total does not equal its appendix lines`);
    if (
      total > 8 &&
      (!match[2].includes("[⚠ exceeds 8pt — see §6]") ||
        !content.slice(headings[5].index).includes(match[1]))
    )
      fail(`${match[1]} exceeds 8 points without a flagged §6 re-split`);
    const dependencyText = body.match(/(?:Depends on|Dependencies):([^\n]+)/i)?.[1] || "";
    const dependencies = [...new Set(dependencyText.match(/T[\w-]+\.\d+/g) || [])];
    tasks.push({ id: match[1], title: match[2], total, dependencies });
  }
  const visiting = new Set(),
    visited = new Set();
  const visit = (task) => {
    if (visited.has(task.id)) return;
    if (visiting.has(task.id)) fail(`dependency cycle at ${task.id}`);
    visiting.add(task.id);
    for (const id of task.dependencies) {
      const dependency = tasks.find((t) => t.id === id);
      if (!dependency) fail(`${task.id} depends on unknown task ${id}`);
      visit(dependency);
    }
    visiting.delete(task.id);
    visited.add(task.id);
  };
  tasks.forEach(visit);
  const grand = content
    .slice(headings[3].index, headings[4].index)
    .match(/^\| \*\*GRAND TOTAL\*\* \| \*\*(\d+)\*\* \| \*\*(\d+)\*\* \|\r?$/m);
  if (
    !tasks.length ||
    !grand ||
    Number(grand[1]) !== tasks.length ||
    Number(grand[2]) !== tasks.reduce((sum, t) => sum + t.total, 0)
  )
    fail("grand total task count/weight does not match the task cards");
  return tasks.map(({ dependencies, ...task }) => task);
}

export function decodeAppendix(text) {
  let value = String(text || "");
  // Decode CLI transport, never mistake a tool result or arbitrary object for a document.
  for (let depth = 0; depth < 4; depth++) {
    const candidate = value
      .trim()
      .replace(/^DEVQUEST_WAITING_INPUT\s*/, "")
      .replace(/^```json\s*\n([\s\S]*)\n```$/, "$1");
    let parsed;
    try {
      parsed = JSON.parse(candidate);
    } catch {
      break;
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      fail("unrecognized Claude transport envelope");
    if (parsed.is_error) fail(String(parsed.result || "Claude execution failed"));
    if (parsed.waitingInput || typeof parsed.markdownPath === "string") return parsed;
    if (typeof parsed.content === "string") value = parsed.content;
    else if (parsed.type === "result" && typeof parsed.result === "string") value = parsed.result;
    else if (parsed.type === "assistant" && Array.isArray(parsed.message?.content))
      value = parsed.message.content
        .filter((b) => b.type === "text")
        .map((b) => b.text)
        .join("\n");
    else fail("unrecognized Claude transport envelope");
  }
  const waiting = value.match(/(?:^|\n)DEVQUEST_WAITING_INPUT\s*\n([\s\S]*)$/);
  if (waiting) {
    try {
      const question = JSON.parse(waiting[1]);
      if (question.waitingInput === true && typeof question.question === "string") return question;
    } catch {}
  }
  value = value.replace(/^```(?:markdown|md)\s*\r?\n([\s\S]*)\r?\n```\s*$/, "$1");
  return { content: value };
}

export async function importAppendixFile(file, directory) {
  if (!directory || !path.isAbsolute(file))
    fail("file import requires an authorized temporary artifact directory");
  const root = await realpath(directory),
    target = await realpath(file);
  const relative = path.relative(root, target);
  if (
    !relative ||
    relative.startsWith("..") ||
    path.isAbsolute(relative) ||
    path.extname(target) !== ".md" ||
    !(await lstat(target)).isFile()
  )
    fail("Markdown file is outside the authorized artifact directory");
  const info = await lstat(target);
  if (info.size > 100000) fail("Markdown file exceeds the size limit");
  return readFile(target, "utf8");
}

// Only called on the response to the selected project's actual Jira metadata tool call.
export function appendixOptions(value, depth = 0) {
  if (depth > 12 || !value) return null;
  if (typeof value === "string") {
    try {
      return appendixOptions(JSON.parse(value), depth + 1);
    } catch {
      return null;
    }
  }
  if (typeof value !== "object") return null;
  const field =
    value.customfield_11543 ||
    (value.fieldId === "customfield_11543" ||
    value.key === "customfield_11543" ||
    value.id === "customfield_11543"
      ? value
      : null);
  if (Array.isArray(field?.allowedValues))
    return field.allowedValues.filter((o) => o.id && typeof o.value === "string" && !o.disabled);
  for (const child of Object.values(value)) {
    const options = appendixOptions(child, depth + 1);
    if (options) return options;
  }
  return null;
}

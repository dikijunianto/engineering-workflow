import test from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdtemp, writeFile, symlink, rm, mkdir } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  validateAppendix,
  decodeAppendix,
  importAppendixFile,
  appendixOptions,
} from "../src/appendix-markdown.js";
import { SkillRunner } from "../src/adapters.js";
const markdown = await readFile(new URL("./fixtures/jira-appendix.md", import.meta.url), "utf8");

test("original skill Markdown and Claude transport envelopes preserve the exact downstream document", () => {
  for (const output of [
    markdown,
    JSON.stringify({ content: markdown }),
    JSON.stringify({ type: "result", result: markdown }),
    JSON.stringify({ type: "result", result: JSON.stringify({ content: markdown }) }),
    JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: markdown }] } }),
  ]) {
    const doc = decodeAppendix(output).content;
    assert.equal(doc, markdown);
    assert.deepEqual(validateAppendix(doc), [{ id: "T1.1", title: "Alpha change", total: 4 }]);
    // Literal downstream upload skill parsing contract, without changing the document.
    const cards = [...doc.matchAll(/^#### (T[^\s]+) — (.+)$/gm)];
    assert.equal(cards[0][1], "T1.1");
    assert.match(doc, /\| Appendix line \| Category \| Weight \|/);
    assert.match(doc, /\| \*\*Task total\*\* \| \| \*\*4\*\* \|/);
  }
  assert.equal(decodeAppendix("```markdown\n" + markdown + "```").content, markdown.trimEnd());
  assert.equal(validateAppendix(markdown.replace(/\*\*Notes\*\*[\s\S]*?\*\*Phase Group/, "**Phase Group")).length, 1);
  assert.equal(
    decodeAppendix('{"waitingInput":true,"question":"Need live field"}').question,
    "Need live field",
  );
  assert.throws(
    () => decodeAppendix('{"type":"result","is_error":true,"result":"Unknown skill"}'),
    /Unknown skill/,
  );
});

test("reject malformed documents, repeated categories, fabricated options and incorrect weights", () => {
  for (const doc of [
    "Saved",
    "# arbitrary text",
    markdown.replace("## 7. Suggested Jira import format", "## 7. Other"),
    markdown.replace("| **Task total** | | **4** |", "| **Task total** | | **3** |"),
    markdown.replaceAll(
      "Refactor generic function unit test | 2 |",
      "Refactor or add 1 generic function | 2 |",
    ),
    markdown.replaceAll("Refactor generic function unit test | 2 |", "Invented category | 2 |"),
    markdown.replace("| **GRAND TOTAL** | **1** | **4** |", "| **GRAND TOTAL** | **2** | **4** |"),
  ])
    assert.throws(() => validateAppendix(doc), /Appendix is incomplete or invalid/);
  assert.throws(() => validateAppendix(markdown, []), /verified live Jira options/);
  const options = [
    { id: "11515", value: "Refactor or add 1 generic function" },
    { id: "11516", value: "Refactor generic function unit test" },
  ];
  assert.equal(validateAppendix(markdown, options).length, 1);
  assert.throws(
    () =>
      validateAppendix(
        markdown,
        options.map((o) => ({ ...o, disabled: true })),
      ),
    /verified live Jira options/,
  );
  assert.deepEqual(
    appendixOptions([
      {
        type: "text",
        text: JSON.stringify({
          fields: [{ fieldId: "customfield_11543", allowedValues: options }],
        }),
      },
    ]),
    options,
  );
});

test("file import accepts only Markdown inside the authorized temporary directory", async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "devquest Markdown "));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const allowed = path.join(dir, "artifacts");
  await mkdir(allowed);
  const file = path.join(allowed, "jira appendix.md");
  await writeFile(file, markdown);
  assert.equal(await importAppendixFile(file, allowed), markdown);
  const outside = path.join(dir, "outside.md");
  await writeFile(outside, markdown);
  const link = path.join(allowed, "escape.md");
  await symlink(outside, link);
  await assert.rejects(importAppendixFile(outside, allowed), /outside the authorized/);
  await assert.rejects(importAppendixFile(link, allowed), /outside the authorized/);
  await assert.rejects(importAppendixFile(file), /authorized temporary/);
});

test("project validation accepts FFE and FCAD without paid calls, but rejects mismatched Epics", () => {
  let calls = 0;
  const skill = new SkillRunner({ runtime: { start: () => calls++ } });
  for (const project of ["FFE", "FCAD"]) {
    const input = { skillPaths: { upload: "installed.md" }, quest: { jiraContext: { project, epic: `${project}-1` } } };
    assert.doesNotThrow(() => skill.validateUpload(input));
    input.quest.jiraContext.epic = "OTHER-1";
    assert.throws(() => skill.validateUpload(input), /must belong to the selected project/);
  }
  assert.equal(calls, 0);
});

test('regeneration retains stable task IDs or explicit removed placeholders', () => {
  assert.throws(() => validateAppendix(markdown.replace('#### T1.1 —', '#### T1.2 —'), undefined, markdown), /missing stable task ID T1.1/);
  assert.equal(validateAppendix(markdown.replace('#### T1.1 —', '#### T1.2 —') .replace('## 4. Grand total', '#### T1.1 — (removed)\n\n## 4. Grand total'), undefined, markdown).length, 1);
});

test('native explanatory text before a waiting-input marker is not mistaken for a missing appendix', () => {
  const text='Status: live Jira metadata is available.\n\nDEVQUEST_WAITING_INPUT\n{"waitingInput":true,"question":"Provide the matching backend weight reference."}';
  assert.deepEqual(decodeAppendix(text), { waitingInput:true, question:'Provide the matching backend weight reference.' });
  assert.deepEqual(decodeAppendix(JSON.stringify({type:'result',result:text})), {waitingInput:true,question:'Provide the matching backend weight reference.'});
});

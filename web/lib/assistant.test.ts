import assert from "node:assert/strict";
import { test } from "node:test";
import { citationHref, previewText, sourcesOf, splitAnswer, type Citation } from "./assistant.ts";

const doc: Citation = { ref: "doc:README.md#agenttrace", ok: true, kind: "doc", id: "README.md#agenttrace", label: "README.md: AgentTrace", text: "A debugger." };
const step: Citation = { ref: `run:${"a".repeat(32)}#3`, ok: true, kind: "run", id: `${"a".repeat(32)}#3`, label: "writer, step 3", text: null };
const experiment: Citation = { ref: `experiment:${"e".repeat(32)}`, ok: true, kind: "experiment", id: "e".repeat(32), label: "experiment eeeeeeee", text: null };

test("an answer is cut at its source marks, and a repeated source keeps its number", () => {
  const answer = `It is a debugger [${doc.ref}]. The writer said 10 [${step.ref}], same as before [${doc.ref}].`;
  const segments = splitAnswer(answer, [doc, step]);
  assert.deepEqual(
    segments.map((s) => (s.type === "text" ? s.text : `#${s.n}`)),
    ["It is a debugger ", "#1", ". The writer said 10 ", "#2", ", same as before ", "#1", "."],
  );
  assert.deepEqual(sourcesOf(segments).map((s) => [s.n, s.citation.ref]), [[1, doc.ref], [2, step.ref]]);
});

test("an answer with no marks is one piece of text", () => {
  assert.deepEqual(splitAnswer("I could not find that.", []), [{ type: "text", text: "I could not find that." }]);
  assert.deepEqual(sourcesOf(splitAnswer("I could not find that.", [])), []);
});

test("a mark the API did not return as a citation stays as text", () => {
  const segments = splitAnswer(`Seen [doc:other.md#x] and [${doc.ref}]`, [doc]);
  assert.deepEqual(segments.map((s) => s.type), ["text", "cite"]);
  assert.equal((segments[0] as { text: string }).text, "Seen [doc:other.md#x] and ");
});

test("a run step opens its run, an experiment opens its page, and a doc passage has no page", () => {
  assert.equal(citationHref(step), `/runs/${"a".repeat(32)}`);
  assert.equal(citationHref(experiment), `/experiments/${"e".repeat(32)}`);
  assert.equal(citationHref(doc), null);
});

test("a preview hides the source marks so they do not flash by as raw text", () => {
  assert.equal(previewText(`Add a webhook [${doc.ref}] and it posts.`), "Add a webhook and it posts.");
  assert.equal(previewText("No marks here."), "No marks here.");
  assert.equal(previewText("Add a webhook [doc:docs/integ"), "Add a webhook "); // a mark still being written
});

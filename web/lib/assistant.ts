// Ask AgentTrace: the shapes the assistant route returns, and turning an answer with [doc:...] / [run:...] marks into
// pieces the panel can draw (text, and numbered source marks).

export type Citation = {
  ref: string; // as written in the answer, e.g. "doc:docs/self-host.md#steps" or "run:<id>#3"
  ok: boolean; // false only if the API could not match it to a source (a shown answer has none like that)
  kind: "doc" | "run" | "experiment";
  id: string;
  label: string;
  text: string | null; // the passage, for a doc
};

export type AskResponse = {
  answer: string;
  rejected: boolean; // the answer could not be backed by sources, so `answer` is an explanation, not a result
  citations: Citation[];
  tool_calls: number;
  tokens_in: number;
  tokens_out: number;
  model: string;
};

export const GENERAL_QUESTIONS = [
  "How do I connect my own agents?",
  "How do I get an alert when a run fails?",
  "How do I fork an agent that runs on my own machine?",
];

export const RUN_QUESTIONS = [
  "What went wrong in this run?",
  "Has a failure like this been seen before?",
  "Which agent should I look at first?",
];

export type Segment = { type: "text"; text: string } | { type: "cite"; n: number; citation: Citation };

const CITE = /\[((?:doc|run|experiment):[^\]\s]+)\]/g;

/** Cut the answer at its source marks. A mark gets a number by first appearance, and the same source keeps its number. A mark
 * the API did not return as a citation stays as plain text. */
export function splitAnswer(answer: string, citations: Citation[]): Segment[] {
  const byRef = new Map(citations.map((c) => [c.ref, c]));
  const numbers = new Map<string, number>();
  const out: Segment[] = [];
  let last = 0;
  for (const match of answer.matchAll(CITE)) {
    const citation = byRef.get(match[1]);
    if (!citation) continue;
    const at = match.index ?? 0;
    if (at > last) out.push({ type: "text", text: answer.slice(last, at) });
    if (!numbers.has(citation.ref)) numbers.set(citation.ref, numbers.size + 1);
    out.push({ type: "cite", n: numbers.get(citation.ref)!, citation });
    last = at + match[0].length;
  }
  if (last < answer.length) out.push({ type: "text", text: answer.slice(last) });
  return out;
}

/** The sources an answer used, once each, in the order of their numbers. */
export function sourcesOf(segments: Segment[]): { n: number; citation: Citation }[] {
  const seen = new Map<number, Citation>();
  for (const s of segments) if (s.type === "cite" && !seen.has(s.n)) seen.set(s.n, s.citation);
  return [...seen.entries()].sort(([a], [b]) => a - b).map(([n, citation]) => ({ n, citation }));
}

/** Where a source opens. A step of a run opens its run; a doc passage has no page, so the panel shows its text instead. */
export function citationHref(c: Citation): string | null {
  if (c.kind === "run") return `/runs/${c.id.split("#")[0]}`;
  if (c.kind === "experiment") return `/experiments/${c.id}`;
  return null;
}

/** The text of an answer that is still being written, without its source marks (the numbered marks appear when the answer is final). */
export function previewText(text: string): string {
  // A mark still being written ("[doc:docs/integ") is hidden too.
  return text.replace(CITE, "").replace(/\[(?:doc|run|experiment):[^\]]*$/, "").replace(/[ \t]{2,}/g, " ");
}

import assert from "node:assert/strict";
import { test } from "node:test";
import { agentCards, brief, callsLabel, describeChange } from "./story.ts";
import type { Step } from "./types.ts";

const step = (over: Partial<Step>): Step => ({
  run: "r", idx: 1, node_run_idx: 1, agent: "planner", kind: "llm", origin: "recorded", model: "m", params: {},
  input: null, output: null, tool_name: null, tool_args: null, tool_result: null, side_effect: null,
  state_after: null, reads: [], writes: [], tokens_in: 0, tokens_out: 0, latency_ms: 0, redactions: [], ...over,
});

const steps: Step[] = [
  step({ idx: 1, node_run_idx: 1, writes: ["plan"], state_after: { request: "x", plan: { filter: ["solved"] } } }),
  step({ idx: 2, node_run_idx: 2, agent: "researcher", kind: "tool", tool_name: "zendesk" }),
  step({ idx: 3, node_run_idx: 2, agent: "researcher", kind: "tool", tool_name: "salesforce" }),
  step({
    idx: 4, node_run_idx: 2, agent: "researcher", writes: ["findings"],
    state_after: { request: "x", plan: { filter: ["solved"] }, findings: { n: 1 } },
  }),
];

test("one card per agent run, with what it called and what it changed", () => {
  const cards = agentCards(steps);
  assert.deepEqual(cards.map((c) => c.agent), ["planner", "researcher"]);
  assert.equal(cards[1].toolCalls, 2);
  assert.equal(cards[1].modelCalls, 1);
  assert.deepEqual(cards[1].tools, ["zendesk", "salesforce"]);
  assert.deepEqual(cards[0].changes.map((c) => c.path), ["plan.filter"]);
  assert.deepEqual(cards[1].changes.map((c) => c.path), ["findings.n"]);
});

test("brief keeps one line, cuts long values and shows the first line of text", () => {
  assert.equal(brief("## Title\nmore text"), "## Title");
  assert.equal(brief("x".repeat(100), 10), "xxxxxxxxx…");
  assert.equal(brief({ a: 1 }), '{"a":1}');
});

test("a change reads as the last two path parts and its new value", () => {
  assert.equal(describeChange({ path: "plan.ticket_filter.status", kind: "added", after: ["solved"] }), 'ticket_filter.status = ["solved"]');
  assert.equal(describeChange({ path: "a", kind: "removed", before: 1 }), "a removed");
});

test("calls are summarised in plain words", () => {
  assert.equal(callsLabel({ toolCalls: 2, modelCalls: 1 }), "2 tool calls, 1 model call");
  assert.equal(callsLabel({ toolCalls: 0, modelCalls: 1 }), "1 model call");
});

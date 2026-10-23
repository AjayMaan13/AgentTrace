import assert from "node:assert/strict";
import { test } from "node:test";
import { buildGraph, pos } from "./graph.ts";
import type { Experiment, Step } from "./types.ts";

const step = (over: Partial<Step>): Step => ({
  run: "r", idx: 1, node_run_idx: 1, agent: "planner", kind: "llm", origin: "recorded", model: "m", params: {},
  input: null, output: null, tool_name: null, tool_args: null, tool_result: null, side_effect: null,
  state_after: null, reads: [], writes: [], tokens_in: 0, tokens_out: 0, latency_ms: 0, redactions: [], ...over,
});
const steps = ["planner", "researcher", "writer", "critic"].map((agent, i) =>
  step({ idx: i + 1, node_run_idx: i + 1, agent, writes: ["k" + i], state_after: { ["k" + i]: i } }),
);
const exp = (over: Partial<Experiment>): Experiment => ({
  id: "e1", status: "done", parent_run: "r", fork_node_run_idx: 1, n: 8, edit_patch: {}, control: { pass: 0, total: 8 },
  treatment: { pass: 8, total: 8 }, tiles: [], stats: { fisher_p: 0.0001, wilson: { control: null, treatment: null }, label: "directional" },
  tokens_used: 0, token_ceiling: 1, error: null, ...over,
});

test("a run with no forks is one line: start, each agent in order, and the answer", () => {
  const g = buildGraph(steps, { outcome: "fail" });
  assert.equal(g.lanes.length, 1);
  assert.deepEqual(g.nodes.map((n) => n.label), ["Request", "planner", "researcher", "writer", "critic", "Wrong answer"]);
  assert.deepEqual(g.nodes.map((n) => n.col), [0, 1, 2, 3, 4, 5]);
  assert.equal(g.edges.length, 5);
  assert.equal(g.nodes.at(-1)?.tone, "bad");
});

test("a fork opens a new lane that leaves the line just before the changed agent", () => {
  const g = buildGraph(steps, { experiments: [exp({ fork_node_run_idx: 3 })], outcome: "fail" });
  assert.equal(g.lanes.length, 2);
  const spawn = g.edges.find((e) => e.kind === "spawn")!;
  assert.equal(spawn.from, "a2"); // the researcher, which ran just before the writer
  assert.equal(spawn.to, "e1:edit");
  const branch = g.nodes.filter((n) => n.lane === 1);
  assert.deepEqual(branch.map((n) => n.label), ["writer", "critic", "8 of 8 right"]);
  assert.deepEqual(branch.map((n) => n.col), [3, 4, 5]); // same columns as the original line
});

test("a fork at the first agent leaves the request itself", () => {
  const g = buildGraph(steps, { experiments: [exp({ fork_node_run_idx: 1 })] });
  assert.equal(g.edges.find((e) => e.kind === "spawn")!.from, "start");
  assert.equal(g.nodes.filter((n) => n.lane === 1).length, 5); // edited planner + 3 live + result
});

test("the branch says plainly whether the change worked", () => {
  const helped = buildGraph(steps, { experiments: [exp({})] });
  assert.equal(helped.lanes[1].tone, "good");
  const nothing = buildGraph(steps, {
    experiments: [exp({ control: { pass: 0, total: 5 }, treatment: { pass: 0, total: 5 }, stats: { fisher_p: 1, wilson: { control: null, treatment: null }, label: "d" } })],
  });
  assert.equal(nothing.lanes[1].tone, "bad");
});

test("a running fork shows progress, not a result", () => {
  const running = exp({ status: "running", tiles: [{ arm: "control", i: 0, status: "done", run_id: null, outcome: "fail" }, { arm: "treatment", i: 0, status: "running", run_id: null, outcome: null }] });
  const g = buildGraph(steps, { experiments: [running] });
  const end = g.nodes.find((n) => n.id === "e1:end")!;
  assert.equal(end.label, "Running…");
  assert.equal(end.sub, "1 of 2 runs done");
  assert.equal(end.tone, "neutral");
});

test("several forks stack as lanes, and a fork of an unknown agent is skipped", () => {
  const g = buildGraph(steps, { experiments: [exp({ id: "a", fork_node_run_idx: 1 }), exp({ id: "b", fork_node_run_idx: 4 }), exp({ id: "c", fork_node_run_idx: 99 })] });
  assert.deepEqual(g.lanes.map((l) => l.index), [0, 1, 2]);
  assert.match(g.lanes[2].label, /Fork 2: critic changed/);
});

test("positions grow to the right with the column and down with the lane", () => {
  assert.ok(pos({ lane: 0, col: 2 }).x > pos({ lane: 0, col: 1 }).x);
  assert.ok(pos({ lane: 1, col: 1 }).y > pos({ lane: 0, col: 1 }).y);
});

test("the edited node shows what was changed, before and after", () => {
  const g = buildGraph(steps, { experiments: [exp({ fork_node_run_idx: 2, edit_patch: { k1: "new" } })] });
  const edited = g.nodes.find((n) => n.id === "e1:edit")!;
  assert.equal(edited.sub, "k1: 1 → new");
  assert.deepEqual(edited.change, ["k1: 1 → new"]);
});

test("an edit that changes nothing falls back to plain words", () => {
  const g = buildGraph(steps, { experiments: [exp({ fork_node_run_idx: 2, edit_patch: { k1: 1 } })] });
  assert.equal(g.nodes.find((n) => n.id === "e1:edit")!.sub, "with your change");
});

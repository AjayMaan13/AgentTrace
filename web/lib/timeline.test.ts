import assert from "node:assert/strict";
import { test } from "node:test";
import { buildTimeline } from "./timeline.ts";
import type { Experiment, RunSummary } from "./types.ts";

const run = (id: string, at: string, over: Partial<RunSummary> = {}): RunSummary => ({ id, workflow: "wf", kind: "recorded", status: "ok", outcome: "fail", started_at: at, ...over });
const exp = (id: string, parent: string, at: string, over: Partial<Experiment> = {}): Experiment => ({
  id, status: "done", parent_run: parent, fork_node_run_idx: 1, n: 5, edit_patch: {}, control: { pass: 0, total: 5 }, treatment: { pass: 5, total: 5 },
  tiles: [], stats: { fisher_p: 0.008, wilson: { control: null, treatment: null }, label: "d" }, tokens_used: 0, token_ceiling: 1, error: null, created_at: at, ...over,
});

test("runs sit on one line in the order they happened, oldest at the left", () => {
  const t = buildTimeline([run("b", "2026-01-02T00:00:00Z"), run("a", "2026-01-01T00:00:00Z")], []);
  assert.deepEqual(t.nodes.map((n) => n.id), ["a", "b"]);
  assert.deepEqual(t.nodes.map((n) => n.col), [0, 1]);
  assert.equal(t.edges.length, 1);
  assert.equal(t.lanes, 1);
});

test("a fork appears where it was started and branches down from its run", () => {
  const t = buildTimeline(
    [run("a", "2026-01-01T00:00:00Z"), run("b", "2026-01-03T00:00:00Z")],
    [exp("e1", "a", "2026-01-02T00:00:00Z")],
  );
  assert.deepEqual(t.nodes.map((n) => n.id), ["a", "fork:e1", "b"]);
  const fork = t.nodes.find((n) => n.id === "fork:e1")!;
  assert.equal(fork.lane, 1);
  assert.equal(fork.col, 1); // between the two runs, because that is when it happened
  assert.equal(t.edges.find((e) => e.kind === "spawn")!.from, "a");
  assert.equal(fork.href, "/runs/a?fork=e1");
  assert.equal(fork.tone, "good");
});

test("several forks of one run stack in their own lanes", () => {
  const t = buildTimeline([run("a", "2026-01-01T00:00:00Z")], [exp("e1", "a", "2026-01-02T00:00:00Z"), exp("e2", "a", "2026-01-03T00:00:00Z")]);
  assert.deepEqual(t.nodes.filter((n) => n.kind === "fork").map((n) => n.lane), [1, 2]);
  assert.equal(t.lanes, 3);
});

test("a fork's own attempts and forks of runs we do not have are left out", () => {
  const t = buildTimeline([run("a", "2026-01-01T00:00:00Z"), run("f1", "2026-01-01T01:00:00Z", { kind: "fork" })], [exp("e9", "missing", "2026-01-02T00:00:00Z")]);
  assert.deepEqual(t.nodes.map((n) => n.id), ["a"]);
});

test("a fork still running says so", () => {
  const t = buildTimeline([run("a", "2026-01-01T00:00:00Z")], [exp("e1", "a", "2026-01-02T00:00:00Z", { status: "running" })]);
  const fork = t.nodes.find((n) => n.kind === "fork")!;
  assert.equal(fork.label, "Running…");
  assert.equal(fork.tone, "neutral");
});

test("an empty project is an empty line, not an error", () => {
  const t = buildTimeline([], []);
  assert.equal(t.nodes.length, 0);
  assert.ok(t.width > 0);
});

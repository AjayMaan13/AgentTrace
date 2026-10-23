import { diffState } from "./diff.ts";
import { nodeRuns } from "./runs.ts";
import { agentCards, brief, callsLabel, type Mark } from "./story.ts";
import { verdictFor } from "./verdict.ts";
import type { Experiment, Step } from "./types";

/** The run as a line. One lane is one path through the workflow: lane 0 is the original run, and every
 * fork (an experiment) opens a new lane that leaves the line where the change was made. Columns are
 * the order things ran in, so a node further right ran later. */

export const COL_W = 146;
export const LANE_H = 132;
export const PAD_X = 36;
export const PAD_Y = 56;

export type NodeKind = "start" | "agent" | "edited" | "live" | "result";
export type Tone = "neutral" | "good" | "bad";

export type GNode = {
  id: string;
  lane: number;
  col: number;
  kind: NodeKind;
  label: string; // the agent's name, or the result
  sub: string; // one plain line under it
  mark?: Mark;
  tone: Tone;
  nodeRun?: number; // which agent run this is, for the original line
  experiment?: string; // which fork a branch node belongs to
  draft?: boolean; // part of a fork that has not been started yet
  change?: string[]; // on an edited node: each value that was changed, "name: before → after"
};

export type GEdge = { id: string; from: string; to: string; kind: "line" | "spawn"; lane: number };
export type GLane = { index: number; label: string; experiment?: string; tone: Tone };
export type Graph = { lanes: GLane[]; nodes: GNode[]; edges: GEdge[]; cols: number; width: number; height: number };

const LIVE = "ran live in every run";

export function buildGraph(
  steps: Step[], opts: { marks?: Map<number, Mark>; experiments?: Experiment[]; outcome?: string; resultText?: string; draft?: { nodeRun: number } | null },
): Graph {
  const cards = agentCards(steps);
  const marks = opts.marks ?? new Map<number, Mark>();
  const nodes: GNode[] = [{ id: "start", lane: 0, col: 0, kind: "start", label: "Request", sub: "the question", tone: "neutral" }];
  const edges: GEdge[] = [];
  const lanes: GLane[] = [{ index: 0, label: "Original run", tone: "neutral" }];

  cards.forEach((c, i) => {
    nodes.push({
      id: `a${c.idx}`, lane: 0, col: i + 1, kind: "agent", label: c.agent, sub: callsLabel(c),
      mark: marks.get(c.idx), tone: "neutral", nodeRun: c.idx,
    });
  });
  const end = cards.length + 1;
  const wrong = opts.outcome === "fail" || opts.outcome === "error";
  nodes.push({
    id: "end", lane: 0, col: end, kind: "result", label: wrong ? "Wrong answer" : opts.outcome === "pass" ? "Right answer" : "Finished",
    sub: opts.resultText ?? "", tone: wrong ? "bad" : opts.outcome === "pass" ? "good" : "neutral",
  });
  chain(edges, nodes.filter((n) => n.lane === 0), 0);

  (opts.experiments ?? []).forEach((e, k) => {
    const forkAt = cards.findIndex((c) => c.idx === e.fork_node_run_idx);
    if (forkAt < 0) return;
    const lane = lanes.length;
    const agent = cards[forkAt].agent;
    const verdict = verdictFor(e.control, e.treatment, e.stats.fisher_p);
    const done = !["queued", "running"].includes(e.status);
    const tone: Tone = !done || !verdict ? "neutral" : verdict.tone === "good" ? "good" : verdict.tone === "bad" ? "bad" : "neutral";
    lanes.push({ index: lane, label: `Fork ${k + 1}: ${agent} changed`, experiment: e.id, tone });

    const change = describeEdit(steps, e.fork_node_run_idx, e.edit_patch);
    const branch: GNode[] = [
      { id: `${e.id}:edit`, lane, col: forkAt + 1, kind: "edited", label: agent, sub: change.short ?? "with your change", tone: "neutral", experiment: e.id, change: change.lines },
    ];
    cards.slice(forkAt + 1).forEach((c, j) => {
      branch.push({
        id: `${e.id}:${c.idx}`, lane, col: forkAt + 2 + j, kind: "live", label: c.agent, sub: `${LIVE} (${e.n}×)`, tone: "neutral", experiment: e.id,
      });
    });
    branch.push({
      id: `${e.id}:end`, lane, col: end, kind: "result",
      label: done ? `${e.treatment.pass} of ${e.treatment.total} right` : "Running…",
      sub: done ? `without the change: ${e.control.pass} of ${e.control.total}` : `${e.tiles.filter((t) => t.status === "done").length} of ${e.tiles.length} runs done`,
      tone, experiment: e.id,
    });
    nodes.push(...branch);
    chain(edges, branch, lane);
    // The new line leaves the original line just before the agent that was changed.
    edges.push({ id: `${e.id}:spawn`, from: forkAt === 0 ? "start" : `a${cards[forkAt - 1].idx}`, to: branch[0].id, kind: "spawn", lane });
  });

  // A fork the person is setting up: the new line is there at once, drawn as not started.
  const at = opts.draft ? cards.findIndex((c) => c.idx === opts.draft!.nodeRun) : -1;
  if (opts.draft && at >= 0) {
    const lane = lanes.length;
    lanes.push({ index: lane, label: "New fork, not started", experiment: "draft", tone: "neutral" });
    const draft: GNode[] = [
      { id: "draft:edit", lane, col: at + 1, kind: "edited", label: cards[at].agent, sub: "your change goes here", tone: "neutral", experiment: "draft", draft: true },
      ...cards.slice(at + 1).map((c, j): GNode => ({ id: `draft:${c.idx}`, lane, col: at + 2 + j, kind: "live", label: c.agent, sub: "will run live", tone: "neutral", experiment: "draft", draft: true })),
      { id: "draft:end", lane, col: end, kind: "result", label: "Not run yet", sub: "make the change below", tone: "neutral", experiment: "draft", draft: true },
    ];
    nodes.push(...draft);
    chain(edges, draft, lane);
    edges.push({ id: "draft:spawn", from: at === 0 ? "start" : `a${cards[at - 1].idx}`, to: "draft:edit", kind: "spawn", lane });
  }

  return {
    lanes, nodes, edges, cols: end + 1,
    width: PAD_X * 2 + (end + 1) * COL_W, height: PAD_Y * 2 + lanes.length * LANE_H - (LANE_H - 96),
  };
}

/** What a fork changed, in words: each value that differs from the recording, before and after. */
export function describeEdit(steps: Step[], nodeRun: number, patch: Record<string, unknown>): { lines: string[]; short: string | null } {
  const after = nodeRuns(steps).find((r) => r.idx === nodeRun)?.stateAfter ?? {};
  const before = Object.fromEntries(Object.keys(patch).map((k) => [k, after[k]]));
  const changes = diffState(before, patch);
  const leaf = (path: string) => path.split(".").slice(-1)[0];
  const lines = changes.map((c) => `${c.path}: ${c.kind === "added" ? "nothing" : brief(c.before, 60)} → ${c.kind === "removed" ? "nothing" : brief(c.after, 60)}`);
  const first = changes[0];
  const short = first
    ? `${leaf(first.path)}: ${first.kind === "added" ? "nothing" : brief(first.before, 16)} → ${first.kind === "removed" ? "nothing" : brief(first.after, 16)}${changes.length > 1 ? ` (+${changes.length - 1})` : ""}`
    : null;
  return { lines, short };
}

function chain(edges: GEdge[], line: GNode[], lane: number) {
  for (let i = 0; i < line.length - 1; i++) edges.push({ id: `${line[i].id}>${line[i + 1].id}`, from: line[i].id, to: line[i + 1].id, kind: "line", lane });
}

/** Where a node's centre sits, in pixels. */
export const pos = (n: Pick<GNode, "lane" | "col">) => ({ x: PAD_X + n.col * COL_W + COL_W / 2, y: PAD_Y + n.lane * LANE_H + 40 });

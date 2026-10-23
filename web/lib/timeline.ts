import { verdictFor } from "./verdict.ts";
import type { Experiment, RunSummary } from "./types";

/** Every run in a project on one line of time, left to right, newest at the right. A fork is drawn
 * where it was started, branching down from the run it was made from. */

export const T_COL_W = 132;
export const T_LANE_H = 104;
export const T_PAD_X = 40;
export const T_PAD_Y = 36;

export type TNode = {
  id: string;
  lane: number;
  col: number;
  kind: "run" | "fork";
  label: string;
  sub: string;
  tone: "neutral" | "good" | "bad";
  href: string;
};
export type TEdge = { id: string; from: string; to: string; kind: "line" | "spawn" };
export type Timeline = { nodes: TNode[]; edges: TEdge[]; lanes: number; width: number; height: number };

const shortDate = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
};

export function buildTimeline(runs: RunSummary[], experiments: Experiment[]): Timeline {
  // Forks have their own runs (one per attempt); the project line shows the experiment instead.
  const recorded = runs.filter((r) => r.kind !== "fork");
  const known = new Set(recorded.map((r) => r.id));
  type Event = { at: string; run?: RunSummary; exp?: Experiment };
  const events: Event[] = [
    ...recorded.map((run) => ({ at: run.started_at, run })),
    ...experiments.filter((e) => known.has(e.parent_run)).map((exp) => ({ at: exp.created_at ?? "", exp })),
  ].sort((a, b) => a.at.localeCompare(b.at));

  const nodes: TNode[] = [];
  const edges: TEdge[] = [];
  const forksOf = new Map<string, number>();
  let last: string | null = null;
  events.forEach((ev, col) => {
    if (ev.run) {
      const r = ev.run;
      nodes.push({
        id: r.id, lane: 0, col, kind: "run", label: r.workflow,
        sub: `${r.outcome === "fail" ? "wrong answer" : r.outcome === "pass" ? "right answer" : "no result"} · ${shortDate(r.started_at)}`,
        tone: r.outcome === "fail" ? "bad" : r.outcome === "pass" ? "good" : "neutral", href: `/runs/${r.id}`,
      });
      if (last) edges.push({ id: `${last}>${r.id}`, from: last, to: r.id, kind: "line" });
      last = r.id;
    } else if (ev.exp) {
      const e = ev.exp;
      const n = (forksOf.get(e.parent_run) ?? 0) + 1;
      forksOf.set(e.parent_run, n);
      const done = !["queued", "running"].includes(e.status);
      const verdict = done ? verdictFor(e.control, e.treatment, e.stats.fisher_p) : null;
      nodes.push({
        id: `fork:${e.id}`, lane: n, col, kind: "fork",
        label: done ? `${e.treatment.pass} of ${e.treatment.total} right` : "Running…",
        sub: done ? `fork · without the change ${e.control.pass} of ${e.control.total}` : "fork in progress",
        tone: !verdict ? "neutral" : verdict.tone === "good" ? "good" : verdict.tone === "bad" ? "bad" : "neutral",
        href: `/runs/${e.parent_run}?fork=${e.id}`,
      });
      edges.push({ id: `fork:${e.id}:spawn`, from: e.parent_run, to: `fork:${e.id}`, kind: "spawn" });
    }
  });
  const lanes = Math.max(1, ...nodes.map((n) => n.lane + 1));
  return { nodes, edges, lanes, width: T_PAD_X * 2 + Math.max(1, events.length) * T_COL_W, height: T_PAD_Y * 2 + (lanes - 1) * T_LANE_H + 70 };
}

export const tpos = (n: Pick<TNode, "lane" | "col">) => ({ x: T_PAD_X + n.col * T_COL_W + T_COL_W / 2, y: T_PAD_Y + n.lane * T_LANE_H + 22 });

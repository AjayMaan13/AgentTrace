"use client";

import { useMemo } from "react";
import { buildGraph, COL_W, type GEdge, type GNode, LANE_H, pos, type Tone } from "@/lib/graph";
import type { Mark } from "@/lib/story";
import type { Experiment, Step } from "@/lib/types";

const R = 22; // node radius
const TONE_TEXT: Record<Tone, string> = { neutral: "text-ink", good: "text-good", bad: "text-bad" };

/** The run as one continuous line, left to right, in the order things ran. Every fork opens a new line
 * below it that leaves the original where the change was made. Select a node to see what it is. */
export function FlowGraph({
  steps, marks, experiments = [], outcome, resultText, selected, onSelect, draft = null,
}: {
  draft?: { nodeRun: number } | null;
  steps: Step[];
  marks: Map<number, Mark>;
  experiments?: Experiment[];
  outcome?: string;
  resultText?: string;
  selected: string | null;
  onSelect: (node: GNode) => void;
}) {
  const graph = useMemo(() => buildGraph(steps, { marks, experiments, outcome, resultText, draft }), [steps, marks, experiments, outcome, resultText, draft]);
  const byId = useMemo(() => new Map(graph.nodes.map((n) => [n.id, n])), [graph]);

  return (
    <div className="graph-scroll card overflow-x-auto" role="group" aria-label="The run as a line of agents. Select a node for details.">
      <div className="relative" style={{ width: graph.width, height: graph.height }}>
        <svg className="absolute inset-0" width={graph.width} height={graph.height} aria-hidden>
          <defs>
            <marker id="tip" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
              <path d="M0 0 L8 4 L0 8 z" fill="#9d998e" />
            </marker>
          </defs>
          {graph.edges.map((e) => <Edge key={e.id} edge={e} byId={byId} tone={graph.lanes[e.lane].tone} />)}
        </svg>

        {graph.lanes.map((lane) => (
          <p
            key={lane.index}
            className={`absolute text-[0.8125rem] leading-snug text-muted ${lane.index === 0 ? "" : "w-[104px]"}`}
            style={lane.index === 0 ? { left: 36, top: 56 - 36 } : { left: 16, top: 56 + lane.index * LANE_H + 40 - 16 }}
          >
            <span className={`mr-2 inline-block h-2 w-2 rounded-full ${lane.index === 0 ? "bg-muted" : lane.tone === "good" ? "bg-good" : lane.tone === "bad" ? "bg-bad" : "bg-muted"}`} aria-hidden />
            {lane.label}
          </p>
        ))}

        {graph.nodes.map((n) => <Node key={n.id} node={n} selected={selected === n.id} onSelect={onSelect} />)}
      </div>
    </div>
  );
}

function Edge({ edge, byId, tone }: { edge: GEdge; byId: Map<string, GNode>; tone: Tone }) {
  const a = byId.get(edge.from)!;
  const b = byId.get(edge.to)!;
  const p = pos(a);
  const q = pos(b);
  const stroke = edge.lane === 0 ? "#6b675f" : tone === "good" ? "#4fa874" : tone === "bad" ? "#c9695d" : "#9d998e";
  if (edge.kind === "spawn") {
    // The new line peels away from the original and settles into its own lane.
    const d = `M ${p.x + R} ${p.y} C ${p.x + R + 70} ${p.y}, ${q.x - R - 70} ${q.y}, ${q.x - R} ${q.y}`;
    return <path d={d} fill="none" stroke={stroke} strokeWidth={2} className="draw" style={{ ["--len" as string]: 420 }} markerEnd="url(#tip)" />;
  }
  return <line x1={p.x + R} y1={p.y} x2={q.x - R} y2={q.y} stroke={stroke} strokeWidth={2} className={edge.lane === 0 ? "" : "draw"} style={{ ["--len" as string]: COL_W }} markerEnd="url(#tip)" />;
}

function Node({ node: n, selected, onSelect }: { node: GNode; selected: boolean; onSelect: (n: GNode) => void }) {
  const { x, y } = pos(n);
  const ring =
    n.draft ? "border-dashed border-muted" : n.origin === "replayed" ? "border-line" : n.origin === "live" ? "border-muted" : n.mark?.kind === "cause" ? "border-bad" : n.mark?.kind === "carried" ? "border-warn" : n.kind === "edited" ? "border-dashed border-ink" : n.kind === "live" ? "border-muted" : "border-line";
  const fill = n.mark?.kind === "cause" ? "bg-bad-tint" : n.mark?.kind === "carried" ? "bg-warn-tint" : "bg-sheet";
  const label = n.kind === "result"
    ? <span className={`rounded-full border px-3 py-1 text-[0.9375rem] font-medium ${n.tone === "bad" ? "border-bad/40 bg-bad-tint text-bad" : n.tone === "good" ? "border-good/40 bg-good-tint text-good" : "border-line bg-tile text-ink"}`}>{n.label}</span>
    : <span className={`text-[0.9375rem] font-medium capitalize ${TONE_TEXT[n.tone]}`}>{n.label}</span>;

  return (
    <button
      type="button"
      onClick={() => onSelect(n)}
      aria-pressed={selected}
      aria-label={`${n.label}. ${n.sub}`}
      className={`arrive absolute flex w-[138px] flex-col items-center gap-1.5 text-center ${n.draft ? "opacity-70" : ""}`}
      style={{ left: x - 69, top: y - R }}
    >
      {n.kind === "result" ? (
        <span className="flex h-11 items-center">{label}</span>
      ) : n.kind === "start" ? (
        <span className={`mt-3.5 h-4 w-4 rounded-full border-2 bg-frame ${selected ? "border-accent" : "border-muted"}`} />
      ) : (
        <span className={`flex h-11 w-11 items-center justify-center rounded-full border-2 ${ring} ${fill} ${selected ? "ring-2 ring-accent ring-offset-2 ring-offset-sheet" : "hover:border-ink"}`}>
          <span className={`h-2.5 w-2.5 rounded-full ${n.kind === "edited" ? "bg-ink" : n.mark?.kind === "cause" ? "bg-bad" : n.mark?.kind === "carried" ? "bg-warn" : "bg-muted"}`} />
        </span>
      )}
      {n.kind !== "result" && label}
      <span className="max-w-[134px] text-[0.8125rem] leading-snug text-muted">
        {n.mark?.kind === "cause" ? <span className="text-bad">Likely cause · {Math.round(n.mark.confidence * 100)}%</span> : n.mark?.kind === "carried" ? <span className="text-warn">Passed the mistake on</span> : n.sub}
      </span>
    </button>
  );
}

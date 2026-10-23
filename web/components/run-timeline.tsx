"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef } from "react";
import { buildTimeline, T_COL_W, tpos, type TEdge, type TNode } from "@/lib/timeline";
import type { Experiment, RunSummary } from "@/lib/types";

const R = 14;
const STROKE = { neutral: "#6b675f", good: "#4fa874", bad: "#c9695d" } as const;

/** Every run in the project on one line of time. Forks branch down from the run they were made from,
 * at the moment they were started. The newest is at the right; select any node to open it. */
export function RunTimeline({ runs, experiments }: { runs: RunSummary[]; experiments: Experiment[] }) {
  const t = useMemo(() => buildTimeline(runs, experiments), [runs, experiments]);
  const byId = useMemo(() => new Map(t.nodes.map((n) => [n.id, n])), [t]);
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // Start at the newest end: that is where the work is happening.
    if (scroller.current) scroller.current.scrollLeft = scroller.current.scrollWidth;
  }, [t.width]);

  return (
    <div ref={scroller} className="graph-scroll card overflow-x-auto" role="group" aria-label="Every run in this project, oldest to newest">
      <div className="relative" style={{ width: t.width, height: t.height }}>
        <svg className="absolute inset-0" width={t.width} height={t.height} aria-hidden>
          <defs>
            <marker id="ttip" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0 L8 4 L0 8 z" fill="#9d998e" /></marker>
          </defs>
          {t.edges.map((e) => <Edge key={e.id} edge={e} byId={byId} />)}
        </svg>
        {t.nodes.map((n) => <Node key={n.id} node={n} />)}
        <p className="absolute text-[0.8125rem] text-muted" style={{ left: 14, top: 6 }}>Older</p>
        <p className="absolute text-[0.8125rem] text-muted" style={{ right: 14, top: 6 }}>Newer</p>
      </div>
    </div>
  );
}

function Edge({ edge, byId }: { edge: TEdge; byId: Map<string, TNode> }) {
  const a = byId.get(edge.from);
  const b = byId.get(edge.to);
  if (!a || !b) return null;
  const p = tpos(a);
  const q = tpos(b);
  if (edge.kind === "spawn") {
    return <path d={`M ${p.x} ${p.y + R} C ${p.x} ${q.y - 10}, ${q.x - 50} ${q.y}, ${q.x - 18} ${q.y}`} fill="none" stroke={STROKE[b.tone]} strokeWidth={2} markerEnd="url(#ttip)" />;
  }
  return <line x1={p.x + R} y1={p.y} x2={q.x - R} y2={q.y} stroke="#6b675f" strokeWidth={2} markerEnd="url(#ttip)" />;
}

function Node({ node: n }: { node: TNode }) {
  const { x, y } = tpos(n);
  const tone = n.tone === "bad" ? "border-bad bg-bad-tint" : n.tone === "good" ? "border-good bg-good-tint" : "border-line bg-sheet";
  return (
    <Link
      href={n.href}
      aria-label={`${n.kind === "fork" ? "Fork" : "Run"}: ${n.label}. ${n.sub}`}
      className="absolute flex flex-col items-center gap-1 text-center hover:opacity-90"
      style={{ left: x - (T_COL_W - 8) / 2, top: y - R, width: T_COL_W - 8 }}
    >
      {n.kind === "run" ? (
        <span className={`flex h-7 w-7 items-center justify-center rounded-full border-2 ${tone}`}><span className="h-2 w-2 rounded-full bg-ink/80" /></span>
      ) : (
        <span className={`rounded-full border px-2.5 py-0.5 text-[0.8125rem] font-medium ${n.tone === "bad" ? "border-bad/40 bg-bad-tint text-bad" : n.tone === "good" ? "border-good/40 bg-good-tint text-good" : "border-line bg-tile"}`}>{n.label}</span>
      )}
      {n.kind === "run" && <span className="max-w-full truncate text-[0.8125rem] font-medium">{n.label}</span>}
      <span className="text-[0.75rem] leading-snug text-muted">{n.sub}</span>
    </Link>
  );
}


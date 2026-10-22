import { ORIGINS, OriginBadge } from "@/components/badges";
import { agentOrder, nodeRuns } from "@/lib/runs";
import type { Origin, Step } from "@/lib/types";

const LABEL_COL = "8rem";
const CHIP_COL = "minmax(3.75rem, 1fr)"; // stretch to fill the width, never narrower than a label

/** One horizontal lane per agent; one chip per step, left to right in the order they ran.
 * Node-run headers sit above the chips; chip outline shows each step's origin. */
export function Lanes({
  steps, selected, onSelect,
}: { steps: Step[]; selected: number | null; onSelect: (idx: number) => void }) {
  const ordered = [...steps].sort((a, b) => a.idx - b.idx);
  const agents = agentOrder(steps);
  const runs = nodeRuns(steps);
  const column = (idx: number) => ordered.findIndex((s) => s.idx === idx) + 2; // col 1 = lane labels

  return (
    <section aria-label="Agent lanes">
      <div className="overflow-x-auto rounded-lg border border-zinc-300 p-3 dark:border-zinc-700">
        <div
          className="relative grid items-center gap-y-2"
          style={{ gridTemplateColumns: `${LABEL_COL} repeat(${ordered.length}, ${CHIP_COL})` }}
        >
          {runs.map((r) => (
            <div
              key={`nr-${r.idx}`}
              className="whitespace-nowrap border-l border-zinc-400 pl-1 text-[11px] leading-tight text-zinc-600 dark:text-zinc-400"
              style={{ gridRow: 1, gridColumn: `${column(r.steps[0].idx)} / span ${r.steps.length}` }}
            >
              node run {r.idx}
            </div>
          ))}
          {agents.map((agent, lane) => (
            <div key={agent} className="contents">
              <div
                className="sticky left-0 z-20 bg-background pr-2 text-sm font-medium"
                style={{ gridRow: lane + 2, gridColumn: 1 }}
              >
                {agent}
              </div>
              <div
                aria-hidden
                className="z-0 border-t border-dashed border-zinc-300 dark:border-zinc-700"
                style={{ gridRow: lane + 2, gridColumn: "2 / -1" }}
              />
            </div>
          ))}
          {ordered.map((s) => {
            const isSelected = s.idx === selected;
            return (
              <button
                key={s.idx}
                type="button"
                onClick={() => onSelect(s.idx)}
                aria-pressed={isSelected}
                aria-label={`Step ${s.idx}, ${s.agent}, ${s.kind}${s.tool_name ? ` ${s.tool_name}` : ""}, ${s.origin}`}
                title={`${s.agent} · ${s.kind}${s.tool_name ? ` · ${s.tool_name}` : ""} · ${s.origin}`}
                className={`z-10 mx-auto flex h-11 w-11 flex-col items-center justify-center rounded-md border-2 bg-background text-sm font-semibold leading-none transition-shadow focus-visible:outline-2 focus-visible:outline-offset-2 ${
                  ORIGINS[s.origin].chip
                } ${isSelected ? "ring-2 ring-zinc-900 ring-offset-2 dark:ring-zinc-100 dark:ring-offset-zinc-950" : "hover:shadow-md"}`}
                style={{ gridRow: agents.indexOf(s.agent) + 2, gridColumn: column(s.idx) }}
              >
                {s.idx}
                <span className="mt-0.5 text-[10px] font-normal text-zinc-600 dark:text-zinc-400">
                  {s.kind === "llm" ? "llm" : "tool"}
                </span>
              </button>
            );
          })}
        </div>
      </div>
      <Legend />
    </section>
  );
}

function Legend() {
  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-zinc-700 dark:text-zinc-300">
      {(Object.keys(ORIGINS) as Origin[]).map((origin) => (
        <span key={origin} className="flex items-center gap-1.5">
          <OriginBadge origin={origin} />
          <span className="text-zinc-600 dark:text-zinc-400">{ORIGINS[origin].meaning}</span>
        </span>
      ))}
    </div>
  );
}

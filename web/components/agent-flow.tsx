import { agentCards, callsLabel, describeChange, type AgentCard, type Mark } from "@/lib/story";
import type { Step } from "@/lib/types";

const STYLE = {
  cause: "border-rose-400/70 bg-rose-500/[0.07]",
  carried: "border-amber-400/50 bg-amber-400/[0.05]",
  none: "border-white/10 bg-white/[0.03]",
} as const;

/** The agents of a run as cards, in the order they ran, each saying what it did.
 * The likely cause is marked, and so are the agents that passed its mistake along.
 * Without `onSelect` the cards are plain, for places that only show the picture. */
export function AgentFlow({
  steps, marks = new Map(), selected = null, onSelect,
}: {
  steps: Step[];
  marks?: Map<number, Mark>;
  selected?: number | null;
  onSelect?: (idx: number) => void;
}) {
  const cards = agentCards(steps);
  return (
    <ol className="flex flex-col gap-1 lg:flex-row lg:items-stretch lg:gap-0" aria-label="Agents, in the order they ran">
      {cards.map((card, i) => (
        <li key={card.idx} className="flex min-w-0 flex-col items-stretch lg:flex-1 lg:flex-row">
          <Card card={card} position={i + 1} mark={marks.get(card.idx)} selected={selected === card.idx} onSelect={onSelect} />
          {i < cards.length - 1 && (
            <span aria-hidden className="select-none self-center py-1 text-lg text-zinc-600 lg:px-1.5 lg:py-0">
              <span className="lg:hidden">↓</span>
              <span className="hidden lg:inline">→</span>
            </span>
          )}
        </li>
      ))}
    </ol>
  );
}

function Card({
  card, position, mark, selected, onSelect,
}: { card: AgentCard; position: number; mark?: Mark; selected: boolean; onSelect?: (idx: number) => void }) {
  const style = STYLE[mark?.kind ?? "none"];
  const shown = card.changes.slice(0, 4);
  const body = (
    <span className="flex h-full w-full flex-col items-start justify-start text-left">
      <span className="flex items-center gap-2 text-xs text-zinc-400">
        <span className="font-mono">{String(position).padStart(2, "0")}</span>
        <span>{callsLabel(card)}</span>
      </span>
      <span className="mt-1 block text-lg font-semibold capitalize">{card.agent}</span>
      {mark?.kind === "cause" && (
        <span className="mt-1 inline-block rounded-full bg-rose-400 px-2 py-0.5 text-xs font-semibold text-zinc-950">
          Likely cause · {Math.round(mark.confidence * 100)}%
        </span>
      )}
      {mark?.kind === "carried" && (
        <span className="mt-1 inline-block rounded-full border border-amber-400/60 px-2 py-0.5 text-xs font-medium text-amber-200">
          Passed the mistake on
        </span>
      )}
      <span className="mt-3 block space-y-1 font-mono text-xs text-zinc-300">
        {shown.length === 0 ? (
          <span className="text-zinc-500">Changed nothing</span>
        ) : (
          shown.map((c) => (
            <span key={c.path} className="block break-all">
              {describeChange(c)}
            </span>
          ))
        )}
        {card.changes.length > shown.length && (
          <span className="block text-zinc-500">+{card.changes.length - shown.length} more</span>
        )}
      </span>
    </span>
  );
  const base = `block h-full min-w-0 flex-1 rounded-xl border p-4 text-left ${style}`;
  if (!onSelect) return <div className={base}>{body}</div>;
  return (
    <button
      type="button"
      onClick={() => onSelect(card.idx)}
      aria-pressed={selected}
      aria-label={`${card.agent}: ${callsLabel(card)}. Open its details`}
      className={`${base} transition-colors hover:bg-white/[0.07] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white ${
        selected ? "ring-2 ring-white" : ""
      }`}
    >
      {body}
    </button>
  );
}

import type { Origin, Outcome } from "@/lib/types";

const OUTCOME: Record<Outcome, { label: string; className: string }> = {
  pass: { label: "PASS", className: "bg-green-700 text-white" },
  fail: { label: "FAIL", className: "bg-red-700 text-white" },
  error: { label: "ERROR", className: "bg-orange-700 text-white" },
};

export function OutcomeBadge({ outcome, status }: { outcome?: Outcome; status?: string }) {
  const style = outcome ? OUTCOME[outcome] : null;
  return (
    <span
      className={`inline-block rounded px-2 py-0.5 text-xs font-semibold tracking-wide ${
        style?.className ?? "bg-zinc-200 text-zinc-800 dark:bg-zinc-700 dark:text-zinc-100"
      }`}
    >
      {style?.label ?? (status ?? "unknown").toUpperCase()}
    </span>
  );
}

// Origin is how the UI tells the truth about replay: recorded/replayed steps come from the
// stored recording; live steps ran against Claude and are sampled, never deterministic.
export const ORIGINS: Record<Origin, { label: string; badge: string; chip: string; meaning: string }> = {
  recorded: {
    label: "recorded",
    badge: "border-zinc-500 text-zinc-800 dark:border-zinc-400 dark:text-zinc-200",
    chip: "border-zinc-500 dark:border-zinc-400",
    meaning: "captured from the original run",
  },
  replayed: {
    label: "replayed",
    badge: "border-sky-600 text-sky-800 dark:border-sky-400 dark:text-sky-200",
    chip: "border-sky-600 dark:border-sky-400",
    meaning: "copied exactly from the recording, no API calls",
  },
  edited: {
    label: "edited",
    badge: "border-amber-600 text-amber-800 dark:border-amber-400 dark:text-amber-200",
    chip: "border-amber-600 border-dashed dark:border-amber-400",
    meaning: "your edit replaces the recorded output",
  },
  live: {
    label: "live",
    badge: "border-violet-600 text-violet-800 dark:border-violet-400 dark:text-violet-200",
    chip: "border-violet-600 dark:border-violet-400",
    meaning: "re-run against Claude: sampled, not deterministic",
  },
};

export function OriginBadge({ origin }: { origin: Origin }) {
  return (
    <span className={`inline-block rounded border px-1.5 py-0.5 text-xs font-medium ${ORIGINS[origin].badge}`}>
      {ORIGINS[origin].label}
    </span>
  );
}

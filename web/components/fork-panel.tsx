"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { ApiError, useApi } from "@/lib/api";
import { changedKeys, forkPrefill, nodeRuns, parseEdit } from "@/lib/runs";
import type { Run, State } from "@/lib/types";

const N_CHOICES = [3, 5, 8];

/** Edit what one node run wrote, then run the same fork twice, N times each: control keeps
 * the recorded output, treatment applies the edit. */
export function ForkPanel({
  run, request,
}: { run: Run; request?: { nodeRunIdx: number; patch: State } | null }) {
  const router = useRouter();
  const api = useApi();
  const forkable = useMemo(() => nodeRuns(run.steps).filter((r) => r.stateAfter && r.writes.length > 0), [run.steps]);
  // A request (from "Test this" in the root-cause panel) opens the panel at that node run with
  // the proposed patch applied on top of the recorded output.
  const startRun = forkable.find((r) => r.idx === request?.nodeRunIdx) ?? forkable[0];
  const [idx, setIdx] = useState(startRun?.idx ?? 1);
  const selected = forkable.find((r) => r.idx === idx) ?? forkable[0];
  const prefill = useMemo(() => (selected ? forkPrefill(selected) : {}), [selected]);
  const [text, setText] = useState(() =>
    JSON.stringify({ ...(startRun ? forkPrefill(startRun) : {}), ...(request?.patch ?? {}) }, null, 2),
  );
  const [n, setN] = useState(5);
  const [submitting, setSubmitting] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);

  if (!selected) {
    return <p className="rounded-lg border border-zinc-300 p-4 text-sm dark:border-zinc-700">This run has no node run to fork.</p>;
  }

  const parsed = parseEdit(text);
  const edit = parsed.ok ? changedKeys(prefill, parsed.value) : {};
  const notWritten = Object.keys(edit).filter((k) => !selected.writes.includes(k));
  const problem = !parsed.ok
    ? parsed.error
    : notWritten.length > 0
      ? `Not editable here: ${notWritten.join(", ")}. This node run writes ${selected.writes.join(", ")}.`
      : Object.keys(edit).length === 0
        ? "Change a value to create a treatment: with no change, treatment equals control."
        : null;

  function choose(next: number) {
    const target = forkable.find((r) => r.idx === next);
    if (!target) return;
    setIdx(next);
    setText(JSON.stringify(forkPrefill(target), null, 2));
    setApiError(null);
  }

  async function launch() {
    setSubmitting(true);
    setApiError(null);
    try {
      const { id } = await api<{ id: string }>("/v1/experiments", {
        method: "POST",
        body: JSON.stringify({ run_id: run.id, fork_node_run_idx: selected.idx, edit, n }),
      });
      router.push(`/experiments/${id}`);
    } catch (err) {
      setApiError(err instanceof ApiError || err instanceof Error ? err.message : "Request failed");
      setSubmitting(false);
    }
  }

  const error = problem ?? apiError;
  return (
    <section id="fork-panel" tabIndex={-1} aria-label="Fork this run" className="flex flex-col gap-3 rounded-lg border border-zinc-300 p-4 dark:border-zinc-700">
      <h2 className="text-lg font-semibold">Fork this run</h2>
      <p className="text-sm text-zinc-700 dark:text-zinc-300">
        Edit what a node run wrote. AgentTrace runs the same fork twice, {n} times each: <b>control</b> keeps
        the recorded output, <b>treatment</b> applies your edit. Steps before the fork replay exactly from the
        recording; everything after runs live against Claude, so results are sampled, not deterministic.
      </p>

      <label className="flex flex-col gap-1 text-sm font-medium">
        Fork at
        <select
          value={selected.idx}
          onChange={(e) => choose(Number(e.target.value))}
          className="rounded-md border border-zinc-400 bg-background px-2 py-2 font-normal dark:border-zinc-600"
        >
          {forkable.map((r) => (
            <option key={r.idx} value={r.idx}>
              node run {r.idx}: {r.agent} (writes {r.writes.join(", ")})
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1 text-sm font-medium">
        Recorded output (edit the values you want to change)
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          spellCheck={false}
          rows={12}
          aria-invalid={error !== null}
          aria-describedby="fork-error"
          className="rounded-md border border-zinc-400 bg-background p-2 font-mono text-xs leading-relaxed dark:border-zinc-600"
        />
      </label>

      <fieldset className="flex flex-wrap items-center gap-3 text-sm">
        <legend className="mb-1 font-medium">Runs per arm (N)</legend>
        {N_CHOICES.map((choice) => (
          <label key={choice} className="flex items-center gap-1.5">
            <input type="radio" name="n" checked={n === choice} onChange={() => setN(choice)} />
            {choice}
          </label>
        ))}
        <span className="text-xs text-zinc-600 dark:text-zinc-400">= {2 * n} live runs, 3 at a time</span>
      </fieldset>

      <p id="fork-error" role="alert" className="min-h-5 text-sm text-red-800 dark:text-red-300">
        {error}
      </p>
      <button
        type="button"
        onClick={launch}
        disabled={problem !== null || submitting}
        className="rounded-md bg-zinc-900 px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900"
      >
        {submitting ? "Starting…" : `Run experiment (N=${n})`}
      </button>
    </section>
  );
}

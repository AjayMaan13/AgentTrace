"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { ApiError, useApi } from "@/lib/api";
import { diffState } from "@/lib/diff";
import { forkPrefill, nodeRuns } from "@/lib/runs";
import { brief } from "@/lib/story";
import type { Run, State } from "@/lib/types";

const N_CHOICES = [3, 5, 8];

const asText = (v: unknown) => JSON.stringify(v, null, 2);

/** Change what one agent wrote, then run everything after it again, N times with your change
 * and N times without. Earlier steps replay exactly from the recording; later ones run live. */
export function TestFixPanel({
  run, request,
}: { run: Run; request?: { nodeRunIdx: number; patch: State } | null }) {
  const router = useRouter();
  const api = useApi();
  const forkable = useMemo(() => nodeRuns(run.steps).filter((r) => r.stateAfter && r.writes.length > 0), [run.steps]);
  const start = forkable.find((r) => r.idx === request?.nodeRunIdx) ?? forkable[0];
  const [idx, setIdx] = useState(start?.idx ?? 1);
  const selected = forkable.find((r) => r.idx === idx) ?? forkable[0];
  const prefill = useMemo(() => (selected ? forkPrefill(selected) : {}), [selected]);
  // One editor per value the agent wrote. A suggested fix arrives pre-applied.
  const [texts, setTexts] = useState<Record<string, string>>(() => {
    const base = start ? forkPrefill(start) : {};
    return Object.fromEntries(Object.entries(base).map(([k, v]) => [k, asText(request?.patch?.[k] ?? v)]));
  });
  const [n, setN] = useState(5);
  const [submitting, setSubmitting] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);

  if (!selected) {
    return <p className="rounded-xl border border-white/10 p-4 text-sm text-zinc-400">This run has no agent whose output can be changed.</p>;
  }

  const parsed = Object.keys(prefill).map((key) => {
    try {
      return { key, value: JSON.parse(texts[key] ?? asText(prefill[key])) as unknown, error: null };
    } catch {
      return { key, value: undefined, error: "This is not valid JSON yet." };
    }
  });
  const edit: State = Object.fromEntries(
    parsed.filter((p) => !p.error && JSON.stringify(p.value) !== JSON.stringify(prefill[p.key])).map((p) => [p.key, p.value]),
  );
  const lines = Object.keys(edit).flatMap((key) =>
    diffState({ [key]: prefill[key] }, { [key]: edit[key] }).map((c) => ({
      id: `${key}:${c.path}`,
      path: c.path.split(".").slice(-2).join("."),
      before: c.kind === "added" ? "nothing" : brief(c.before, 50),
      after: c.kind === "removed" ? "nothing" : brief(c.after, 50),
    })),
  );
  const invalid = parsed.find((p) => p.error);
  const problem = invalid ? `Fix the JSON in "${invalid.key}" first.` : lines.length === 0 ? "Change a value above to see what it does." : null;

  function choose(next: number) {
    const target = forkable.find((r) => r.idx === next);
    if (!target) return;
    setIdx(next);
    setTexts(Object.fromEntries(Object.entries(forkPrefill(target)).map(([k, v]) => [k, asText(v)])));
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

  const error = apiError;
  return (
    <section id="test-fix" tabIndex={-1} aria-label="Test a fix" className="flex flex-col gap-5">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight">Test a fix</h2>
        <p className="mt-1 max-w-prose text-zinc-400">
          Change what one agent decided, then run everything after it again. We count how often the answer comes out
          right with your change and without it.
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor="agent" className="font-medium">1. Which agent should have decided differently?</label>
        <select
          id="agent"
          value={selected.idx}
          onChange={(e) => choose(Number(e.target.value))}
          className="max-w-md rounded-lg border border-white/20 bg-background px-3 py-2.5"
        >
          {forkable.map((r) => (
            <option key={r.idx} value={r.idx}>
              {r.agent.charAt(0).toUpperCase() + r.agent.slice(1)} (wrote {r.writes.join(", ")})
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-3">
        <p className="font-medium">2. What should it have written?</p>
        {Object.keys(prefill).map((key) => {
          const p = parsed.find((x) => x.key === key);
          return (
            <div key={key} className="flex flex-col gap-1">
              <label htmlFor={`edit-${key}`} className="font-mono text-sm text-zinc-400">{key}</label>
              <textarea
                id={`edit-${key}`}
                value={texts[key] ?? ""}
                onChange={(e) => setTexts((t) => ({ ...t, [key]: e.target.value }))}
                spellCheck={false}
                rows={Math.min(12, Math.max(4, (texts[key] ?? "").split("\n").length + 1))}
                aria-invalid={!!p?.error}
                className="rounded-lg border border-white/20 bg-white/[0.03] p-3 font-mono text-xs leading-relaxed"
              />
              {p?.error && <p role="alert" className="text-sm text-rose-300">{p.error}</p>}
            </div>
          );
        })}
        {lines.length > 0 && (
          <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3" aria-live="polite">
            <p className="text-sm font-medium">Your change</p>
            <ul className="mt-1 space-y-1 font-mono text-xs">
              {lines.map((l) => (
                <li key={l.id} className="break-all">
                  <span className="text-zinc-300">{l.path}: </span>
                  <span className="text-rose-300 line-through decoration-rose-300/60">{l.before}</span>
                  <span aria-hidden className="text-zinc-500"> → </span>
                  <span className="sr-only"> became </span>
                  <span className="text-emerald-300">{l.after}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <p className="font-medium" id="runs-label">3. How many runs?</p>
        <div role="group" aria-labelledby="runs-label" className="flex flex-wrap items-center gap-2">
          {N_CHOICES.map((choice) => (
            <button
              key={choice}
              type="button"
              onClick={() => setN(choice)}
              aria-pressed={n === choice}
              className={`rounded-lg border px-4 py-2 font-medium tabular-nums ${
                n === choice ? "border-white bg-white text-zinc-950" : "border-white/20 hover:bg-white/5"
              }`}
            >
              {choice}
            </button>
          ))}
          <span className="text-sm text-zinc-400">
            {n} without your change + {n} with it = {2 * n} runs
          </span>
        </div>
        <p className="max-w-prose text-xs text-zinc-500">
          Everything before this agent is replayed exactly from the recording. Everything after it runs live against
          Claude, so results can vary from run to run. That is why we repeat it.
        </p>
      </div>

      <div className="flex flex-col items-start gap-2">
        <button
          type="button"
          onClick={launch}
          disabled={problem !== null || submitting}
          className="accent-bg rounded-lg px-6 py-3 font-semibold hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {submitting ? "Starting…" : `Run the test (${2 * n} runs)`}
        </button>
        <p role="alert" className="min-h-5 text-sm text-zinc-400">
          {error ? <span className="text-rose-300">{error}</span> : problem}
        </p>
      </div>
    </section>
  );
}

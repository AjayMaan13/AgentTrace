"use client";

import { useMemo, useState } from "react";
import { ApiError, useApi } from "@/lib/api";
import { askedOf } from "@/components/inspector";
import { diffState } from "@/lib/diff";
import { forkPrefill, nodeRuns } from "@/lib/runs";
import { brief } from "@/lib/story";
import type { Run, State } from "@/lib/types";

const N_CHOICES = [3, 5, 8];

const asText = (v: unknown) => JSON.stringify(v, null, 2);

/** Change what one agent wrote, then run everything after it again, N times with your change
 * and N times without. Earlier steps replay exactly from the recording; later ones run live. */
export function TestFixPanel({
  run, request, onLaunched, baseLabel,
}: { run: Run; request?: { nodeRunIdx: number; patch: State } | null; onLaunched: (experimentId: string) => void; baseLabel?: string }) {
  const api = useApi();
  const forkable = useMemo(() => nodeRuns(run.steps).filter((r) => r.stateAfter && r.writes.length > 0), [run.steps]);
  // The agent to change is the one that was selected on the line. There is no second place to choose it.
  const selected = forkable.find((r) => r.idx === request?.nodeRunIdx);
  const start = selected;
  const prefill = useMemo(() => (selected ? forkPrefill(selected) : {}), [selected]);
  // One editor per value the agent wrote. A suggested fix arrives pre-applied.
  const [texts, setTexts] = useState<Record<string, string>>(() => {
    const base = start ? forkPrefill(start) : {};
    return Object.fromEntries(Object.entries(base).map(([k, v]) => [k, asText(request?.patch?.[k] ?? v)]));
  });
  const [n, setN] = useState(5);
  const [submitting, setSubmitting] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);

  if (!request) {
    return (
      <section id="test-fix" tabIndex={-1} aria-label="Fork this run" className="card flex flex-col gap-1 p-5">
        <h2 className="font-serif text-xl">Fork this run</h2>
        <p className="max-w-[60ch] text-muted">Select an agent on the line above, then click <b className="font-medium text-ink">Fork here</b>. The form for changing it opens here.</p>
      </section>
    );
  }
  if (!selected) {
    return (
      <section id="test-fix" tabIndex={-1} aria-label="Fork this run" className="card flex flex-col gap-1 p-5">
        <h2 className="font-serif text-xl">Nothing to change here</h2>
        <p className="max-w-[60ch] text-muted">This agent did not write any value the next agent uses, so there is nothing to change. Select a different agent on the line above and click Fork here.</p>
      </section>
    );
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

  const forkAt = selected.idx;
  async function launch() {
    setSubmitting(true);
    setApiError(null);
    try {
      const { id } = await api<{ id: string }>("/v1/experiments", {
        method: "POST",
        body: JSON.stringify({ run_id: run.id, fork_node_run_idx: forkAt, edit, n }),
      });
      setSubmitting(false);
      onLaunched(id);
    } catch (err) {
      setApiError(err instanceof ApiError || err instanceof Error ? err.message : "Request failed");
      setSubmitting(false);
    }
  }

  // What went into this agent, read only, so you can decide what should have come out.
  const first = run.steps.filter((s) => s.node_run_idx === selected.idx).sort((a, b) => a.idx - b.idx)[0];
  const wentIn = first ? (first.kind === "tool" ? JSON.stringify(first.tool_args ?? {}, null, 2) : askedOf(first)) : null;
  const error = apiError;
  return (
    <section id="test-fix" tabIndex={-1} aria-label="Test a fix" className="flex flex-col gap-5">
      <div>
        <h2 className="font-serif text-2xl">Fork at the <span className="capitalize">{selected.agent}</span></h2>
        <p className="mt-1 text-[0.8125rem] text-muted">Agent {forkable.findIndex((r) => r.idx === selected.idx) + 1} of {forkable.length} that can be changed. To fork somewhere else, select another agent on the line above.</p>
        <p className="mt-1 max-w-prose text-muted">
          Everything before this agent stays exactly as recorded. You change what this agent <b className="font-medium text-ink">produced</b>,
          using what went into it as your guide. Then everything after it runs again, with your change and without it, and a new
          line opens on the graph above.
        </p>
        {baseLabel && (
          <p className="mt-2 max-w-prose rounded-lg border border-line bg-tile px-3 py-2">
            This fork starts from one run of <b className="font-medium">{baseLabel}</b>, with that fork&apos;s change already applied. Everything
            before the agent you pick is copied from that run.
          </p>
        )}
        <p className="mt-2 max-w-prose text-[0.8125rem] text-muted">
          You can change any value this agent wrote for the next agent. You cannot yet change its instructions and run the agent
          itself again, because that needs your workflow code.
        </p>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
      <div className="flex flex-col gap-2">
        <p className="font-medium">What went in</p>
        <p className="text-[0.8125rem] text-muted">Read only. This is what the agent was given.</p>
        <pre tabIndex={0} className="max-h-80 overflow-auto whitespace-pre-wrap rounded-lg bg-tile p-3 text-[0.875rem] leading-relaxed [overflow-wrap:anywhere]">
          {wentIn ?? "No input was recorded for this agent."}
        </pre>
      </div>
      <div className="flex flex-col gap-3">
        <div>
          <p className="font-medium">What came out. Change it here.</p>
          <p className="text-[0.8125rem] text-muted">These are the values it wrote for the next agent. Edit the one that was wrong.</p>
        </div>
        {Object.keys(prefill).map((key) => {
          const p = parsed.find((x) => x.key === key);
          return (
            <div key={key} className="flex flex-col gap-1">
              <label htmlFor={`edit-${key}`} className="font-mono text-sm text-muted">{key}</label>
              <textarea
                id={`edit-${key}`}
                value={texts[key] ?? ""}
                onChange={(e) => setTexts((t) => ({ ...t, [key]: e.target.value }))}
                spellCheck={false}
                rows={Math.min(12, Math.max(4, (texts[key] ?? "").split("\n").length + 1))}
                aria-invalid={!!p?.error}
                className="rounded-lg border border-ink/30 bg-frame p-3 font-mono text-xs leading-relaxed"
              />
              {p?.error && <p role="alert" className="text-sm text-bad">{p.error}</p>}
            </div>
          );
        })}
        {lines.length > 0 && (
          <div className="rounded-lg border border-line bg-frame p-3" aria-live="polite">
            <p className="text-sm font-medium">Your change</p>
            <ul className="mt-1 space-y-1 font-mono text-xs">
              {lines.map((l) => (
                <li key={l.id} className="break-all">
                  <span className="text-ink">{l.path}: </span>
                  <span className="text-bad line-through decoration-bad/60">{l.before}</span>
                  <span aria-hidden className="text-muted"> → </span>
                  <span className="sr-only"> became </span>
                  <span className="text-good">{l.after}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      </div>

      <div className="flex flex-col gap-2">
        <p className="font-medium" id="runs-label">How many runs?</p>
        <div role="group" aria-labelledby="runs-label" className="flex flex-wrap items-center gap-2">
          {N_CHOICES.map((choice) => (
            <button
              key={choice}
              type="button"
              onClick={() => setN(choice)}
              aria-pressed={n === choice}
              className={`rounded-lg border px-4 py-2 font-medium tabular-nums ${
                n === choice ? "border-ink bg-ink text-white" : "border-ink/30 hover:bg-ink/5"
              }`}
            >
              {choice}
            </button>
          ))}
          <span className="text-sm text-muted">
            {n} without your change + {n} with it = {2 * n} runs
          </span>
        </div>
        <p className="max-w-prose text-xs text-muted">
          Everything before this agent is replayed exactly from the recording. Everything after it runs live against
          Claude, so results can vary from run to run. That is why we repeat it.
        </p>
      </div>

      <div className="flex flex-col items-start gap-2">
        <button
          type="button"
          onClick={launch}
          disabled={problem !== null || submitting}
          className="btn btn-primary rounded-lg px-6 py-3 font-semibold hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {submitting ? "Opening the new line…" : `Fork and run (${2 * n} runs)`}
        </button>
        <p role="alert" className="min-h-5 text-sm text-muted">
          {error ? <span className="text-bad">{error}</span> : problem}
        </p>
      </div>
    </section>
  );
}

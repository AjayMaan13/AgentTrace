import type { Candidate, RcaReport } from "@/lib/types";

/** Root-cause candidates, ranked. The agent proposes; experiments decide. */
export function RcaView({
  report, agentOf, canRun, busy, error, onFind, onTest,
}: {
  report: RcaReport | null;
  agentOf: (nodeRunIdx: number) => string;
  canRun: boolean;
  busy: boolean;
  error: string | null;
  onFind: () => void;
  onTest: (candidate: Candidate) => void;
}) {
  return (
    <section aria-label="Root cause" className="flex flex-col gap-3 rounded-lg border border-zinc-300 p-4 dark:border-zinc-700">
      <h2 className="text-lg font-semibold">Root cause</h2>
      <p className="text-sm text-zinc-700 dark:text-zinc-300">
        An AI agent reads the trace and follows the data back from the wrong answer. It ranks hypotheses; it does
        not decide. Use <b>Test this</b> to run an experiment with a control arm.
      </p>

      <button
        type="button"
        onClick={onFind}
        disabled={!canRun || busy}
        className="self-start rounded-md bg-zinc-900 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900"
      >
        {busy ? "Analysing the trace…" : report ? "Analyse again" : "Find root cause"}
      </button>
      {!canRun && (
        <p className="text-xs text-zinc-600 dark:text-zinc-400">Root-cause analysis is for runs that failed the oracle.</p>
      )}
      <p role="alert" className="min-h-4 text-sm text-red-800 dark:text-red-300">
        {error}
      </p>

      {report && (
        <>
          <p className="text-xs text-zinc-600 dark:text-zinc-400">
            Data path to the wrong answer: {report.lineage.map((i) => `${agentOf(i)} (node run ${i})`).join(" → ")} ·{" "}
            {report.model}
          </p>
          <ol className="flex flex-col gap-3">
            {report.candidates.map((c, i) => (
              <li key={`${c.node_run_idx}-${c.step_idx}`} className="rounded-md border border-zinc-300 p-3 dark:border-zinc-700">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded bg-zinc-900 px-2 py-0.5 text-xs font-bold text-white dark:bg-zinc-100 dark:text-zinc-900">
                    #{i + 1}
                  </span>
                  <span className="text-sm font-semibold">
                    {agentOf(c.node_run_idx)} · node run {c.node_run_idx} · step {c.step_idx}
                  </span>
                  <span className="ml-auto text-sm tabular-nums">{Math.round(c.confidence * 100)}% confidence</span>
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded bg-zinc-200 dark:bg-zinc-800" aria-hidden>
                  <div className="h-full bg-zinc-900 dark:bg-zinc-100" style={{ width: `${c.confidence * 100}%` }} />
                </div>
                <p className="mt-2 text-sm">{c.hypothesis}</p>
                {c.evidence_quotes.length > 0 && (
                  <div className="mt-2">
                    <p className="text-xs font-semibold uppercase tracking-wide text-zinc-600 dark:text-zinc-400">
                      Evidence (verbatim from the trace)
                    </p>
                    <ul className="mt-1 flex flex-col gap-1">
                      {c.evidence_quotes.map((q) => (
                        <li key={q} className="break-words border-l-2 border-zinc-400 pl-2 font-mono text-xs">
                          {q}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {c.proposed_edit ? (
                  <button
                    type="button"
                    onClick={() => onTest(c)}
                    className="mt-3 rounded-md border-2 border-zinc-900 px-3 py-1.5 text-sm font-semibold hover:bg-zinc-100 dark:border-zinc-100 dark:hover:bg-zinc-900"
                  >
                    Test this: edit {Object.keys(c.proposed_edit.patch).join(", ")}
                  </button>
                ) : (
                  <p className="mt-3 text-xs text-zinc-600 dark:text-zinc-400">
                    No concrete edit proposed for this candidate.
                  </p>
                )}
              </li>
            ))}
          </ol>
        </>
      )}
    </section>
  );
}

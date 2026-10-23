import Link from "next/link";
import type { Candidate, RcaReport, VerificationItem } from "@/lib/types";

/** Root-cause candidates, ranked. The agent proposes; experiments decide. */
export function RcaView({
  report, agentOf, canRun, busy, error, onFind, onTest, readOnly = false,
  experimentHref = () => null, onVerify, verifyBusy = false,
}: {
  report: RcaReport | null;
  agentOf: (nodeRunIdx: number) => string;
  canRun: boolean;
  busy: boolean;
  error: string | null;
  onFind: () => void;
  onTest: (candidate: Candidate) => void;
  readOnly?: boolean; // the public demo shows a saved report: nothing to run or test
  experimentHref?: (experimentId: string) => string | null; // where experiment links point; null = no link
  onVerify?: () => void; // start auto-verify (omit in read-only views)
  verifyBusy?: boolean;
}) {
  const verification = report?.verification ?? null;
  const running = verification?.status === "running";
  const order = verification?.ranking ?? report?.candidates.map((_, i) => i) ?? [];
  const canVerify = !!report && report.candidates.some((c) => c.proposed_edit);
  return (
    <section aria-label="Root cause" className="flex flex-col gap-3 rounded-lg border border-zinc-300 p-4 dark:border-zinc-700">
      <h2 className="text-lg font-semibold">Root cause</h2>
      <p className="text-sm text-zinc-700 dark:text-zinc-300">
        An AI agent reads the trace and follows the data back from the wrong answer. It ranks hypotheses; it does
        not decide.{" "}
        {readOnly ? "The experiments below test its proposals." : <>Use <b>Test this</b> to run an experiment with a control arm.</>}
      </p>

      {!readOnly && <button
        type="button"
        onClick={onFind}
        disabled={!canRun || busy}
        className="self-start rounded-md bg-zinc-900 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900"
      >
        {busy ? "Analysing the trace…" : report ? "Analyse again" : "Find root cause"}
      </button>}
      {!readOnly && !canRun && (
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
          {!readOnly && onVerify && (
            <div className="flex flex-col gap-1">
              <button
                type="button"
                onClick={onVerify}
                disabled={!canVerify || running || verifyBusy}
                className="self-start rounded-md border-2 border-zinc-900 px-3 py-1.5 text-sm font-semibold hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-100 dark:hover:bg-zinc-900"
              >
                {running || verifyBusy ? "Testing the top candidates…" : verification ? "Verify again" : "Verify the top 2 by experiment"}
              </button>
              <p className="text-xs text-zinc-600 dark:text-zinc-400">
                Runs up to 2 experiments (control vs treatment, 3 live runs each) and re-ranks the candidates by what was
                measured, not by the agent&apos;s confidence.
              </p>
            </div>
          )}
          {verification?.status === "done" && (
            <p className="rounded-md border border-zinc-300 p-2 text-sm font-medium dark:border-zinc-700">
              {report.verdict_idx !== null
                ? `Auto-verdict: ${agentOf(report.candidates[report.verdict_idx].node_run_idx)} (node run ${report.candidates[report.verdict_idx].node_run_idx}), verified by experiment. Re-ranked by measured effect.`
                : "No candidate beat its control, so none is verified. The ranking below is still the agent's opinion."}
            </p>
          )}
          {verification?.status === "error" && (
            <p role="alert" className="text-sm text-red-800 dark:text-red-300">Verification failed ({verification.error ?? "unknown error"}).</p>
          )}
          <ol className="flex flex-col gap-3">
            {order.map((ci, i) => {
              const c = report.candidates[ci];
              const item = verification?.items.find((it) => it.candidate_idx === ci);
              return (
              <li key={`${c.node_run_idx}-${c.step_idx}`} className="rounded-md border border-zinc-300 p-3 dark:border-zinc-700">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded bg-zinc-900 px-2 py-0.5 text-xs font-bold text-white dark:bg-zinc-100 dark:text-zinc-900">
                    #{i + 1}
                  </span>
                  <span className="text-sm font-semibold">
                    {agentOf(c.node_run_idx)} · node run {c.node_run_idx} · step {c.step_idx}
                  </span>
                  {report.verdict_idx === ci && (
                    <span className="rounded-full bg-green-700 px-2 py-0.5 text-xs font-semibold text-white">Verified cause</span>
                  )}
                  <span className="ml-auto text-sm tabular-nums">{Math.round(c.confidence * 100)}% confidence</span>
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded bg-zinc-200 dark:bg-zinc-800" aria-hidden>
                  <div className="h-full bg-zinc-900 dark:bg-zinc-100" style={{ width: `${c.confidence * 100}%` }} />
                </div>
                {c.matches_past_pattern && (
                  <SeenBefore
                    experimentId={c.matches_past_pattern}
                    text={report.recalled.find((r) => r.experiment === c.matches_past_pattern)?.text}
                    href={experimentHref(c.matches_past_pattern)}
                  />
                )}
                <p className="mt-2 text-sm">{c.hypothesis}</p>
                {verification && (
                  <Measurement item={item} running={running} href={item?.experiment_id ? experimentHref(item.experiment_id) : null} n={verification.n} />
                )}
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
                {readOnly ? (
                  c.proposed_edit && (
                    <p className="mt-3 text-xs text-zinc-600 dark:text-zinc-400">
                      Proposed edit: change {Object.keys(c.proposed_edit.patch).join(", ")}
                    </p>
                  )
                ) : c.proposed_edit ? (
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
              );
            })}
          </ol>
        </>
      )}
    </section>
  );
}

/** The candidate matches a root cause that an earlier experiment in this workspace verified. */
function SeenBefore({ experimentId, text, href }: { experimentId: string; text?: string; href: string | null }) {
  const chip = (
    <span className="inline-flex items-center gap-1 rounded-full border border-violet-600 px-2 py-0.5 text-xs font-semibold text-violet-800 dark:border-violet-400 dark:text-violet-200">
      <span aria-hidden>↺</span> Seen before
    </span>
  );
  return (
    <div className="mt-2 flex flex-col gap-1">
      {href ? (
        <Link href={href} aria-label={`Seen before: open the experiment ${experimentId.slice(0, 8)} that verified it`} className="self-start hover:opacity-80">
          {chip}
        </Link>
      ) : (
        <span className="self-start">{chip}</span>
      )}
      {text && (
        <p className="text-xs text-zinc-600 dark:text-zinc-400">
          An earlier experiment in this workspace verified a similar root cause: {text}
        </p>
      )}
    </div>
  );
}

/** What the experiment for one candidate measured. */
function Measurement({ item, running, href, n }: { item?: VerificationItem; running: boolean; href: string | null; n: number }) {
  const box = "mt-2 rounded border border-zinc-300 px-2 py-1.5 text-xs dark:border-zinc-700";
  if (!item) return <p className={box}>Not tested: no concrete edit to try.</p>;
  if (item.error) return <p className={box}>Could not be tested: {item.error}</p>;
  if (running || !item.control || !item.treatment) {
    return <p className={`${box} animate-pulse`}>Testing: control vs treatment, {n} live runs each…</p>;
  }
  const points = item.delta === null || item.delta === undefined ? "n/a" : `${item.delta >= 0 ? "+" : ""}${Math.round(item.delta * 100)} pts`;
  return (
    <p className={box}>
      <b>Measured</b> (N={n}): control {item.control.pass}/{item.control.total} → treatment {item.treatment.pass}/{item.treatment.total},
      change {points}. {item.verified ? "Verified: the edit helped." : "Not verified: the edit did not help enough."}{" "}
      {href && (
        <Link href={href} className="font-semibold underline underline-offset-2">
          Open experiment
        </Link>
      )}
    </p>
  );
}

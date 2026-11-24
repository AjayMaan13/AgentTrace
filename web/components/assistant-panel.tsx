"use client";

import Link from "next/link";
import { useId, useState } from "react";
import { ApiError, useApi } from "@/lib/api";
import { GENERAL_QUESTIONS, RUN_QUESTIONS, citationHref, sourcesOf, splitAnswer, type AskResponse } from "@/lib/assistant";

/** Ask AgentTrace: a question about how it works or about this run, answered from the documentation and your own runs.
 * A numbered mark in the answer points to its source: a passage of the docs, or a run or experiment you can open. */
export function AssistantPanel({ runId }: { runId?: string }) {
  const api = useApi();
  const inputId = useId();
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shown, setShown] = useState<{ question: string; result: AskResponse } | null>(null);

  async function ask(text: string) {
    const q = text.trim();
    if (!q || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api<AskResponse>("/v1/assistant/ask", { method: "POST", body: JSON.stringify({ question: q, run_id: runId ?? null }) });
      setShown({ question: q, result });
    } catch (err) {
      setError(err instanceof ApiError || err instanceof Error ? err.message : "Request failed");
    } finally {
      setBusy(false);
    }
  }

  const examples = runId ? [...RUN_QUESTIONS, ...GENERAL_QUESTIONS.slice(0, 1)] : GENERAL_QUESTIONS;
  const segments = shown && !shown.result.rejected ? splitAnswer(shown.result.answer, shown.result.citations) : [];
  const sources = sourcesOf(segments);

  return (
    <section className="card flex flex-col gap-3 p-5" aria-label="Ask AgentTrace">
      <div>
        <h2 className="font-serif text-xl">Ask AgentTrace</h2>
        <p className="mt-1 max-w-[62ch] text-muted">
          Ask how something works, or what happened in {runId ? "this run" : "a run"}. Answers come from the documentation and your own
          runs, and each one lists the sources it used.
        </p>
      </div>

      <form
        className="flex flex-col gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void ask(question);
        }}
      >
        <label htmlFor={inputId} className="sr-only">Your question</label>
        <textarea
          id={inputId} value={question} onChange={(e) => setQuestion(e.target.value)} maxLength={1000} rows={2}
          placeholder="For example: why did the writer say 10 open tickets?"
          className="rounded-lg border border-ink/30 bg-frame p-3 leading-relaxed"
        />
        <div className="flex flex-wrap items-center gap-2">
          <button type="submit" className="btn btn-primary" disabled={busy || question.trim() === ""}>{busy ? "Looking…" : "Ask"}</button>
          {examples.map((q) => (
            <button key={q} type="button" className="btn" disabled={busy} onClick={() => { setQuestion(q); void ask(q); }}>{q}</button>
          ))}
        </div>
      </form>

      <div aria-live="polite" className="flex flex-col gap-3">
        {error && <p role="alert" className="text-bad">{error}</p>}
        {shown && (
          <div className="flex flex-col gap-3 rounded-lg bg-tile p-4">
            <p className="text-muted">You asked: {shown.question}</p>
            {shown.result.rejected ? (
              <p>{shown.result.answer}</p>
            ) : (
              <p className="whitespace-pre-wrap leading-relaxed">
                {segments.map((s, i) =>
                  s.type === "text" ? (
                    <span key={i}>{s.text}</span>
                  ) : (
                    <a key={i} href={`#source-${s.n}`} className="align-super text-xs font-medium underline underline-offset-2" aria-label={`Source ${s.n}`}>[{s.n}]</a>
                  ),
                )}
              </p>
            )}
            {sources.length > 0 && (
              <ol className="flex flex-col gap-2 border-t border-line pt-3">
                {sources.map(({ n, citation }) => {
                  const href = citationHref(citation);
                  return (
                    <li key={n} id={`source-${n}`} className="flex gap-2">
                      <span className="font-mono text-xs text-muted">[{n}]</span>
                      {href ? (
                        <Link href={href} className="underline underline-offset-4">{citation.label}</Link>
                      ) : (
                        <details>
                          <summary className="cursor-pointer">{citation.label}</summary>
                          <blockquote className="mt-2 whitespace-pre-wrap border-l-2 border-line pl-3 text-muted">{citation.text}</blockquote>
                        </details>
                      )}
                    </li>
                  );
                })}
              </ol>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

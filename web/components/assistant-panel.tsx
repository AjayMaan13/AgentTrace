"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { ApiError, useApiStream } from "@/lib/api";
import { GENERAL_QUESTIONS, RUN_QUESTIONS, citationHref, previewText, sourcesOf, splitAnswer, type AskResponse } from "@/lib/assistant";

/** Ask AgentTrace: a question about how it works or about this run, answered from the documentation and your own runs.
 * A numbered mark in the answer points to its source: a passage of the docs, or a run or experiment you can open. */
export function AssistantPanel({ runId }: { runId?: string }) {
  const stream = useApiStream();
  const inputId = useId();
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shown, setShown] = useState<{ question: string; result: AskResponse } | null>(null);
  const [status, setStatus] = useState<string | null>(null); // what the assistant is doing right now
  const [preview, setPreview] = useState(""); // the answer as it is written; the checked answer replaces it
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []); // leaving the page stops the stream

  async function ask(text: string) {
    const q = text.trim();
    if (!q || busy) return;
    controller.current = new AbortController();
    setBusy(true);
    setError(null);
    setStatus("Thinking");
    setPreview("");
    let answered = false;
    try {
      await stream("/v1/assistant/ask/stream", { question: q, run_id: runId ?? null }, ({ event, data }) => {
        const d = data as { message?: string; delta?: string; detail?: string };
        if (event === "status") {
          setStatus(d.message ?? "Working"); // the text so far was before a tool ran or before a redo: drop it
          setPreview("");
        } else if (event === "text") {
          setPreview((p) => p + (d.delta ?? ""));
        } else if (event === "result") {
          answered = true;
          setShown({ question: q, result: data as AskResponse });
        } else if (event === "error") {
          answered = true;
          setError(d.detail ?? "The assistant failed");
        }
      }, controller.current.signal);
      if (!answered) setError("The answer was cut off. Try again.");
    } catch (err) {
      if (!(err instanceof DOMException && err.name === "AbortError")) setError(err instanceof ApiError || err instanceof Error ? err.message : "Request failed");
    } finally {
      setBusy(false);
      setStatus(null);
      setPreview("");
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
        {busy && (
          <div className="rounded-lg bg-tile p-4">
            <p className="text-muted">{status ?? "Thinking"}…</p>
            {preview && <p className="mt-2 whitespace-pre-wrap leading-relaxed text-muted">{previewText(preview)}</p>}
          </div>
        )}
        {shown && !busy && (
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

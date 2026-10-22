import { OriginBadge } from "@/components/badges";
import { JsonBlock } from "@/components/json-block";
import { diffState } from "@/lib/diff";
import { formatTokens } from "@/lib/format";
import { nodeRuns, stateBefore } from "@/lib/runs";
import type { Step } from "@/lib/types";

const show = (v: unknown) => (typeof v === "string" ? v : JSON.stringify(v));

/** Everything about one step: where it came from, what it saw and said, and how the workflow
 * state changed during its node run. */
export function Inspector({ step, steps }: { step: Step | null; steps: Step[] }) {
  if (!step) {
    return (
      <p className="rounded-lg border border-zinc-300 p-4 text-sm text-zinc-700 dark:border-zinc-700 dark:text-zinc-300">
        Select a step above to inspect its prompt, tool payload, and the state change.
      </p>
    );
  }
  const runs = nodeRuns(steps);
  const run = runs.find((r) => r.idx === step.node_run_idx);
  const changes = run ? diffState(stateBefore(runs, run.idx), run.stateAfter) : [];
  const lastIdx = run?.steps[run.steps.length - 1].idx;
  const input = step.input as { system?: unknown; messages?: unknown; tools?: unknown } | null;

  return (
    <section aria-label="Step inspector" className="flex flex-col gap-4 rounded-lg border border-zinc-300 p-4 dark:border-zinc-700">
      <header className="flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-semibold">
          Step {step.idx} · {step.agent}
        </h2>
        <span className="rounded bg-zinc-200 px-1.5 py-0.5 text-xs dark:bg-zinc-800">
          {step.kind === "tool" ? `tool ${step.tool_name ?? ""}` : "llm"}
        </span>
        <OriginBadge origin={step.origin} />
      </header>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
        <Fact label="Node run" value={String(step.node_run_idx)} />
        <Fact label="Model" value={step.model ?? "n/a"} />
        <Fact label="Tokens in / out" value={`${formatTokens(step.tokens_in)} / ${formatTokens(step.tokens_out)}`} />
        <Fact label="Latency" value={`${step.latency_ms} ms`} />
      </dl>

      <div>
        <h3 className="mb-1 text-sm font-semibold">State change in node run {step.node_run_idx}</h3>
        {step.state_after === null && lastIdx !== undefined && (
          <p className="mb-1 text-xs text-zinc-600 dark:text-zinc-400">
            State is saved on the last step of a node run (step {lastIdx}); this is the change it made.
          </p>
        )}
        {changes.length === 0 ? (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">No state change recorded.</p>
        ) : (
          <ul className="divide-y divide-zinc-200 rounded-md border border-zinc-300 font-mono text-xs dark:divide-zinc-800 dark:border-zinc-700">
            {changes.map((c) => (
              <li key={c.path} className="flex flex-col gap-0.5 px-3 py-2">
                <span className="font-semibold">
                  <span aria-hidden>{c.kind === "added" ? "+ " : c.kind === "removed" ? "− " : "~ "}</span>
                  <span className="sr-only">{c.kind}: </span>
                  {c.path}
                </span>
                {c.kind !== "added" && <span className="break-all text-red-800 dark:text-red-300">was {show(c.before)}</span>}
                {c.kind !== "removed" && <span className="break-all text-green-800 dark:text-green-300">now {show(c.after)}</span>}
              </li>
            ))}
          </ul>
        )}
      </div>

      {step.kind === "llm" ? (
        <>
          {typeof input?.system === "string" && <JsonBlock label="System prompt" value={input.system} />}
          {input?.messages !== undefined && <JsonBlock label="Messages" value={input.messages} />}
          <JsonBlock label="Output" value={step.output} />
        </>
      ) : (
        <>
          <JsonBlock label="Tool arguments" value={step.tool_args} />
          <JsonBlock label={`Tool result${step.side_effect ? " (has side effects)" : " (read-only)"}`} value={step.tool_result} />
        </>
      )}
      {step.origin === "edited" && <JsonBlock label="Your edit" value={step.output} />}

      <p className="text-xs text-zinc-600 dark:text-zinc-400">
        Reads: {step.reads.join(", ") || "none"} · Writes: {step.writes.join(", ") || "none"}
        {step.redactions.length > 0 && ` · ${step.redactions.length} value(s) redacted before storage`}
      </p>
    </section>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-zinc-600 dark:text-zinc-400">{label}</dt>
      <dd className="break-words font-medium">{value}</dd>
    </div>
  );
}

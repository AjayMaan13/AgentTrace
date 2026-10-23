import { ORIGINS, OriginBadge } from "@/components/badges";
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
    <section aria-label="Step inspector" className="flex flex-col gap-5 rounded-xl border border-white/10 bg-white/[0.02] p-5">
      <header className="flex flex-wrap items-center gap-2">
        <h3 className="text-lg font-semibold capitalize">
          {step.agent}: {step.kind === "tool" ? `tool call to ${step.tool_name ?? "a tool"}` : "model call"}
        </h3>
        <OriginBadge origin={step.origin} />
      </header>
      <p className="-mt-3 text-xs text-zinc-500">
        This step is {step.origin === "live" ? "re-run live and sampled" : `${step.origin}: ${ORIGINS[step.origin].meaning}`}.
      </p>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-3">
        <Fact label="Model" value={step.model ?? "none (tool)"} />
        <Fact label="Tokens in / out" value={`${formatTokens(step.tokens_in)} / ${formatTokens(step.tokens_out)}`} />
        <Fact label="Latency" value={`${step.latency_ms} ms`} />
      </dl>

      <div>
        <h4 className="mb-1 text-sm font-semibold">What this agent changed</h4>
        {step.state_after === null && lastIdx !== undefined && (
          <p className="mb-1 text-xs text-zinc-600 dark:text-zinc-400">
            The change is saved on this agent&apos;s last step (step {lastIdx}); this is what the agent changed overall.
          </p>
        )}
        {changes.length === 0 ? (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">It did not change anything.</p>
        ) : (
          <ul className="divide-y divide-zinc-200 rounded-md border border-zinc-300 font-mono text-xs dark:divide-zinc-800 dark:border-zinc-700">
            {changes.map((c) => (
              <li key={c.path} className="flex flex-col gap-0.5 px-3 py-2">
                <span className="font-semibold">
                  <span aria-hidden>{c.kind === "added" ? "+ " : c.kind === "removed" ? "− " : "~ "}</span>
                  <span className="sr-only">{c.kind}: </span>
                  {c.path}
                </span>
                {c.kind !== "added" && <span className="break-all text-rose-300">was {show(c.before)}</span>}
                {c.kind !== "removed" && <span className="break-all text-emerald-300">now {show(c.after)}</span>}
              </li>
            ))}
          </ul>
        )}
      </div>

      {step.kind === "llm" ? (
        <>
          {typeof input?.system === "string" && <JsonBlock label="Instructions it was given" value={input.system} />}
          {input?.messages !== undefined && <JsonBlock label="What it was asked" value={input.messages} />}
          <JsonBlock label="What it said" value={step.output} />
        </>
      ) : (
        <>
          <JsonBlock label="What it asked for" value={step.tool_args} />
          <JsonBlock label={`What came back${step.side_effect ? " (this tool has side effects)" : " (read-only tool)"}`} value={step.tool_result} />
        </>
      )}
      {step.origin === "edited" && <JsonBlock label="Your edit" value={step.output} />}

      <p className="text-xs text-zinc-600 dark:text-zinc-400">
        Read from the shared state: {step.reads.join(", ") || "nothing"} · Wrote: {step.writes.join(", ") || "nothing"}
        {step.redactions.length > 0 && ` · ${step.redactions.length} secret value(s) were removed before storage`}
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

"use client";

import { AgentFlow } from "@/components/agent-flow";
import { marksFromReport } from "@/lib/story";
import { usePublicData } from "@/lib/use-public-data";
import type { Experiment, RcaReport, Run } from "@/lib/types";

type Demo = {
  run: Run;
  rca: RcaReport | null;
  experiments: (Experiment & { role: "decoy" | "hero" | null })[];
};

/** The real saved demo run, drawn as the agents that produced it with the likely cause marked,
 * and the measured result of fixing it. Everything here is read from the stored demo, so the
 * landing page cannot show a number the demo does not. */
export function HeroFlow() {
  const state = usePublicData<Demo>("/v1/public/demo");
  if (state.status === "error") return null;
  if (state.status === "loading") {
    return <div className="h-56 animate-pulse rounded-2xl bg-white/5" aria-label="Loading a saved run" />;
  }
  const { run, rca, experiments } = state.data;
  const hero = experiments.find((e) => e.role === "hero");
  const got = run.oracle_detail?.footer?.open_tickets;
  const want = run.oracle_detail?.truth?.open_tickets;
  const marks = marksFromReport(rca);
  const cause = rca?.candidates[(rca.verification?.ranking ?? [0])[0]];
  const causeAgent = cause ? run.steps.find((s) => s.node_run_idx === cause.node_run_idx)?.agent : null;
  return (
    <div className="flex flex-col gap-5">
      <AgentFlow steps={run.steps} marks={marks} />
      <div className="grid gap-4 text-sm sm:grid-cols-2">
        <p className="rounded-xl border border-white/10 p-4 text-zinc-300">
          <span className="block text-xs uppercase tracking-wide text-zinc-500">The answer</span>
          {got !== undefined && want !== undefined
            ? `The brief said ${got} open tickets. The real number is ${want}.`
            : "The final answer was wrong."}
        </p>
        {hero && (
          <p className="rounded-xl border border-white/10 p-4 text-zinc-300">
            <span className="block text-xs uppercase tracking-wide text-zinc-500">
              {causeAgent ? `After fixing the ${causeAgent}` : "After the fix"}
            </span>
            Right answer in {hero.control.pass} of {hero.control.total} runs without the fix, and in {hero.treatment.pass} of{" "}
            {hero.treatment.total} with it.
          </p>
        )}
      </div>
    </div>
  );
}

"use client";

import Link from "next/link";
import { LoadState } from "@/components/load-state";
import { OutcomeBadge } from "@/components/badges";
import { RunTimeline } from "@/components/run-timeline";
import { SampleRunButton } from "@/components/sample-run-button";
import { formatTime, formatTokens } from "@/lib/format";
import type { Experiment, RunSummary } from "@/lib/types";
import { useApiData } from "@/lib/use-api-data";

export function RunsList() {
  // Recorded runs only: every fork also records a run per attempt, and they would bury the real ones.
  // Both lists refresh on their own, so a run recorded or a fork started elsewhere shows up here.
  const state = useApiData<RunSummary[]>("/v1/runs?kind=recorded&limit=200", () => 5000);
  const forks = useApiData<Experiment[]>("/v1/experiments", (list) => (list.some((e) => ["queued", "running"].includes(e.status)) ? 2000 : 5000));

  return (
    <LoadState state={state}>
      {(runs) =>
        runs.length === 0 ? (
          <div className="card flex flex-col gap-3 p-6">
            <h2 className="font-serif text-xl">No runs yet</h2>
            <p className="max-w-[60ch] text-muted">
              The quickest way to see AgentTrace work is to add the saved example to this workspace. You can then open its line
              and fork it. Or connect your own agents.
            </p>
            <div className="flex flex-wrap items-start gap-3">
              <SampleRunButton />
              <Link href="/connect" className="btn">Connect your agents</Link>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-8">
            <section aria-label="Timeline" className="flex flex-col gap-3">
              <div>
                <h2 className="font-serif text-2xl">Timeline</h2>
                <p className="text-muted">Every run in this project, oldest to newest. A fork branches down from the run it was made from.</p>
              </div>
              <RunTimeline runs={runs} experiments={forks.status === "ok" ? forks.data : []} />
            </section>
            <section aria-label="All runs" className="flex flex-col gap-3">
              <h2 className="font-serif text-2xl">All runs</h2>
              <ul className="card divide-y divide-line">
                {runs.map((run) => (
                  <li key={run.id}>
                    <Link href={`/runs/${run.id}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-4 hover:bg-tile/60 focus-visible:bg-tile/60">
                      <OutcomeBadge outcome={run.outcome} status={run.status} />
                      <span className="font-medium">{run.workflow}</span>
                      <span className="text-muted">
                        {run.outcome === "fail" ? "Gave a wrong answer" : run.outcome === "pass" ? "Gave the right answer" : "Did not finish"}
                      </span>
                                            <span className="ml-auto text-[0.8125rem] text-muted">
                        {formatTime(run.started_at)}
                        {run.tokens_in !== undefined && ` · ${formatTokens((run.tokens_in ?? 0) + (run.tokens_out ?? 0))} tokens`}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          </div>
        )
      }
    </LoadState>
  );
}

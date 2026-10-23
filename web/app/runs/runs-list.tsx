"use client";

import Link from "next/link";
import { LoadState } from "@/components/load-state";
import { OutcomeBadge } from "@/components/badges";
import { RunTimeline } from "@/components/run-timeline";
import { formatTime, formatTokens } from "@/lib/format";
import type { Experiment, RunSummary } from "@/lib/types";
import { useApiData } from "@/lib/use-api-data";

export function RunsList() {
  const state = useApiData<RunSummary[]>("/v1/runs");
  const forks = useApiData<Experiment[]>("/v1/experiments", (list) => (list.some((e) => ["queued", "running"].includes(e.status)) ? 2000 : null));

  return (
    <LoadState state={state}>
      {(runs) =>
        runs.length === 0 ? (
          <div className="card flex flex-col gap-3 p-6">
            <h2 className="font-serif text-xl">No runs yet</h2>
            <p className="max-w-[60ch] text-muted">
              Connect your agents and every run appears here as a line. Or bring runs you already have.
            </p>
            <div className="flex flex-wrap gap-3">
              <Link href="/connect" className="btn btn-primary">Connect your agents</Link>
              <Link href="/demo" className="btn">Look at a saved example first</Link>
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
                      {run.kind === "fork" && <span className="rounded-full border border-line px-2 text-[0.8125rem] text-muted">fork attempt</span>}
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

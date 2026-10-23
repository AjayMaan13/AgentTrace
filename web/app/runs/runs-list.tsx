"use client";

import { useAuth } from "@clerk/nextjs";
import Link from "next/link";
import { LoadState } from "@/components/load-state";
import { OutcomeBadge } from "@/components/badges";
import { formatTime, formatTokens } from "@/lib/format";
import type { RunSummary } from "@/lib/types";
import { useApiData } from "@/lib/use-api-data";

export function RunsList() {
  const { orgId } = useAuth();
  const state = useApiData<RunSummary[]>("/v1/runs");

  return (
    <LoadState state={state}>
      {(runs) =>
        runs.length === 0 ? (
          <div className="flex flex-col gap-3 rounded-xl border border-line bg-frame p-6">
            <h2 className="text-xl font-semibold">No runs yet</h2>
            <p className="max-w-prose text-ink">
              Runs appear here when your agents are recorded with the AgentTrace recorder. Record one into this
              workspace with:
            </p>
            <pre className="overflow-x-auto rounded-lg bg-frame p-3 font-mono text-xs leading-relaxed">
{`python scripts/create_workspace_key.py --workspace ${orgId} --force
python scripts/record_demo.py`}
            </pre>
            <Link href="/demo" className="text-sm underline underline-offset-4">
              Or look at a saved example first
            </Link>
          </div>
        ) : (
          <ul className="divide-y divide-line rounded-xl border border-line">
            {runs.map((run) => (
              <li key={run.id}>
                <Link
                  href={`/runs/${run.id}`}
                  className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-4 hover:bg-ink/5 focus-visible:bg-ink/5"
                >
                  <OutcomeBadge outcome={run.outcome} status={run.status} />
                  <span className="font-medium">{run.workflow}</span>
                  <span className="text-sm text-muted">
                    {run.outcome === "fail" ? "Gave a wrong answer" : run.outcome === "pass" ? "Gave the right answer" : "Did not finish"}
                  </span>
                  {run.kind === "fork" && <span className="rounded-full border border-ink/30 px-2 text-xs text-ink">test run</span>}
                  <span className="ml-auto text-xs text-muted">
                    {formatTime(run.started_at)}
                    {run.tokens_in !== undefined && ` · ${formatTokens((run.tokens_in ?? 0) + (run.tokens_out ?? 0))} tokens`}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )
      }
    </LoadState>
  );
}

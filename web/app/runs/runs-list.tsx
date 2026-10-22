"use client";

import { useAuth } from "@clerk/nextjs";
import Link from "next/link";
import { LoadState } from "@/components/load-state";
import { OutcomeBadge } from "@/components/badges";
import { formatTime, formatTokens, shortId } from "@/lib/format";
import type { RunSummary } from "@/lib/types";
import { useApiData } from "@/lib/use-api-data";

export function RunsList() {
  const { orgId } = useAuth();
  const state = useApiData<RunSummary[]>("/v1/runs");

  return (
    <LoadState state={state}>
      {(runs) =>
        runs.length === 0 ? (
          <p className="rounded-lg border border-zinc-300 p-4 text-sm dark:border-zinc-700">
            No runs in this workspace (<code className="font-mono">{orgId}</code>) yet. Mint an ingest key
            for it with{" "}
            <code className="font-mono">scripts/create_workspace_key.py --workspace {orgId} --force</code>,
            then record a run.
          </p>
        ) : (
          <ul className="divide-y divide-zinc-200 rounded-lg border border-zinc-300 dark:divide-zinc-800 dark:border-zinc-700">
            {runs.map((run) => (
              <li key={run.id}>
                <Link
                  href={`/runs/${run.id}`}
                  className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 hover:bg-zinc-100 focus-visible:bg-zinc-100 dark:hover:bg-zinc-900 dark:focus-visible:bg-zinc-900"
                >
                  <span className="font-mono text-sm font-medium">{shortId(run.id)}</span>
                  <OutcomeBadge outcome={run.outcome} status={run.status} />
                  <span className="text-sm">{run.workflow}</span>
                  {run.kind === "fork" && (
                    <span className="rounded border border-violet-600 px-1.5 text-xs text-violet-800 dark:border-violet-400 dark:text-violet-200">
                      fork
                    </span>
                  )}
                  <span className="ml-auto text-xs text-zinc-600 dark:text-zinc-400">
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

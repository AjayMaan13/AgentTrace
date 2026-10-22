"use client";

import { useAuth } from "@clerk/nextjs";
import { useEffect, useState } from "react";
import { ApiError, useApi } from "@/lib/api";

type Run = { id: string; workflow: string; status: string; outcome?: string; started_at: string };
type State =
  | { status: "loading" }
  | { status: "ok"; runs: Run[] }
  | { status: "error"; code: number; message: string };

// Phase 7 proof page: the list comes from the API, scoped to the active organization.
// Phase 8 replaces it with the real run view.
export function RunsList() {
  const { orgId, isLoaded } = useAuth();
  const api = useApi();
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    if (!isLoaded) return;
    let cancelled = false;
    api<Run[]>("/v1/runs")
      .then((runs) => !cancelled && setState({ status: "ok", runs }))
      .catch((err: unknown) => {
        if (cancelled) return;
        const code = err instanceof ApiError ? err.status : 0;
        setState({ status: "error", code, message: err instanceof Error ? err.message : "Request failed" });
      });
    return () => {
      cancelled = true;
    };
    // Refetch when the organization changes: a different org is a different workspace.
  }, [api, isLoaded, orgId]);

  if (state.status === "loading") return <p className="font-mono text-sm">Loading…</p>;
  if (state.status === "error") {
    return (
      <p role="alert" className="rounded-lg border border-red-300 p-4 text-sm text-red-700 dark:text-red-400">
        {state.code === 403
          ? "Pick or create an organization with the switcher above: each organization is a workspace."
          : `Could not load runs (${state.code || "network"}): ${state.message}`}
      </p>
    );
  }
  return (
    <>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        Workspace <code className="font-mono">{orgId}</code>: {state.runs.length} run
        {state.runs.length === 1 ? "" : "s"}
      </p>
      {state.runs.length === 0 ? (
        <p className="rounded-lg border border-zinc-300 p-4 text-sm dark:border-zinc-700">
          No runs in this workspace yet. Mint an ingest key for it with{" "}
          <code className="font-mono">scripts/create_workspace_key.py --workspace {orgId}</code>, then
          record a run.
        </p>
      ) : (
        <ul className="divide-y divide-zinc-200 rounded-lg border border-zinc-300 dark:divide-zinc-800 dark:border-zinc-700">
          {state.runs.map((run) => (
            <li key={run.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
              <span className="font-mono text-sm">{run.id.slice(0, 8)}</span>
              <span className="text-sm">{run.workflow}</span>
              <span className="text-sm">{run.outcome ?? run.status}</span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

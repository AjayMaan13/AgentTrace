"use client";

import { useState } from "react";
import { ForkPanel } from "@/components/fork-panel";
import { Inspector } from "@/components/inspector";
import { Lanes } from "@/components/lanes";
import { OutcomeBadge } from "@/components/badges";
import { formatTime, formatTokens, shortId } from "@/lib/format";
import type { OracleDetail, Run } from "@/lib/types";

export function RunView({ run }: { run: Run }) {
  const [selected, setSelected] = useState<number | null>(run.steps.length ? Math.min(...run.steps.map((s) => s.idx)) : null);
  const step = run.steps.find((s) => s.idx === selected) ?? null;

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">Run {shortId(run.id)}</h1>
          <OutcomeBadge outcome={run.outcome} status={run.status} />
          {run.kind === "fork" && (
            <span className="rounded border border-violet-600 px-1.5 py-0.5 text-xs text-violet-800 dark:border-violet-400 dark:text-violet-200">
              fork
            </span>
          )}
        </div>
        <p className="text-sm text-zinc-700 dark:text-zinc-300">
          {run.workflow} · {formatTime(run.started_at)} · {run.steps.length} steps ·{" "}
          {formatTokens((run.tokens_in ?? 0) + (run.tokens_out ?? 0))} tokens
        </p>
        {run.oracle_detail && <Oracle detail={run.oracle_detail} outcome={run.outcome} />}
      </header>

      <Lanes steps={run.steps} selected={selected} onSelect={setSelected} />

      {/* grid-cols-1 + min-w-0: without them one long unbroken line in the inspector (a prompt,
          a draft) stretches the implicit column far past the screen on a phone. */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-5">
        <div className="min-w-0 lg:col-span-3">
          <Inspector step={step} steps={run.steps} />
        </div>
        <div className="min-w-0 lg:col-span-2">
          <ForkPanel key={run.id} run={run} />
        </div>
      </div>
    </div>
  );
}

const mark = (ok?: boolean) => (ok ? "✓" : "✗");

/** The oracle is code, not an LLM: it compares the writer's footer with the real data. */
function Oracle({ detail, outcome }: { detail: OracleDetail; outcome?: string }) {
  const got = detail.footer?.open_tickets;
  const want = detail.truth?.open_tickets;
  return (
    <p
      className={`rounded-md border px-3 py-2 text-sm ${
        outcome === "pass"
          ? "border-green-700 text-green-900 dark:text-green-200"
          : "border-red-700 text-red-900 dark:text-red-200"
      }`}
    >
      <b>Oracle (checked in code against the data):</b> open tickets reported{" "}
      <b>{got ?? "none (no valid footer)"}</b>, expected <b>{want ?? "?"}</b> {mark(detail.open_tickets_ok)} · pipeline{" "}
      {mark(detail.pipeline_ok)} · critic loop {mark(detail.critic_loop_ok)}
    </p>
  );
}

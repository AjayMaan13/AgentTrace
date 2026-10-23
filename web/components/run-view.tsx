"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { AgentFlow } from "@/components/agent-flow";
import { DeleteRun } from "@/components/delete-run";
import { Inspector } from "@/components/inspector";
import { RcaPanel } from "@/components/rca-panel";
import { RcaView } from "@/components/rca-view";
import { TestFixPanel } from "@/components/test-fix-panel";
import { formatTime, formatTokens } from "@/lib/format";
import { marksFromReport } from "@/lib/story";
import type { Candidate, OracleDetail, RcaReport, Run, State } from "@/lib/types";

/** The run as a story, top to bottom: what went wrong, which agent did what, why it probably
 * failed, and a way to test a fix. `mode="demo"` is the public read-only view. */
export function RunView({
  run, mode = "app", report = null, titleLevel = 1, demoExtra = null,
}: { run: Run; mode?: "app" | "demo"; report?: RcaReport | null; titleLevel?: 1 | 2; demoExtra?: React.ReactNode }) {
  const Title = titleLevel === 1 ? "h1" : "h2";
  const agents = useMemo(() => new Map(run.steps.map((s) => [s.node_run_idx, s.agent])), [run.steps]);
  const [selected, setSelected] = useState<number | null>(null);
  const [stepPick, setStepPick] = useState(0); // which step of the selected agent to show
  const [saved, setSaved] = useState<RcaReport | null>(null); // the app panel reports what it loaded
  const [fix, setFix] = useState<{ nodeRunIdx: number; patch: State; nonce: number } | null>(null);
  const known = report ?? saved;

  const marks = useMemo(() => marksFromReport(known), [known]);
  const agentSteps = selected === null ? [] : run.steps.filter((s) => s.node_run_idx === selected).sort((a, b) => a.idx - b.idx);
  const step = agentSteps[Math.min(stepPick, agentSteps.length - 1)] ?? null;
  const failed = run.outcome === "fail" || run.outcome === "error";

  function testCandidate(c: Candidate) {
    if (!c.proposed_edit) return;
    setFix((prev) => ({ nodeRunIdx: c.node_run_idx, patch: c.proposed_edit!.patch, nonce: (prev?.nonce ?? 0) + 1 }));
    setTimeout(() => {
      const panel = document.getElementById("test-fix");
      panel?.scrollIntoView({ behavior: "smooth", block: "start" });
      panel?.focus({ preventScroll: true });
    }, 50);
  }

  return (
    <div className="flex flex-col gap-12">
      <header className="flex flex-col gap-3">
        <Title className="max-w-3xl text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">
          <Headline run={run} failed={failed} />
        </Title>
        {run.oracle_detail && <Checks detail={run.oracle_detail} />}
        <p className="text-sm text-zinc-400">
          {run.workflow} · {formatTime(run.started_at)} · {run.steps.length} steps ·{" "}
          {formatTokens((run.tokens_in ?? 0) + (run.tokens_out ?? 0))} tokens
          {run.kind === "fork" && " · this run is part of an experiment"}
        </p>
        {mode === "app" && <DeleteRun runId={run.id} />}
      </header>

      <section aria-label="What each agent did" className="flex flex-col gap-4">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">What each agent did</h2>
          <p className="mt-1 max-w-prose text-zinc-400">
            In the order they ran. Each card shows what that agent changed. Select one to see exactly what it received
            and said.
          </p>
        </div>
        <AgentFlow steps={run.steps} marks={marks} selected={selected} onSelect={(i) => { setStepPick(0); setSelected((s) => (s === i ? null : i)); }} />
        {step && (
          <div className="flex flex-col gap-3">
            {agentSteps.length > 1 && (
              <div role="group" aria-label="Steps of this agent" className="flex flex-wrap gap-2">
                {agentSteps.map((s, i) => (
                  <button
                    key={s.idx}
                    type="button"
                    onClick={() => setStepPick(i)}
                    aria-pressed={step.idx === s.idx}
                    className={`rounded-lg border px-3 py-1.5 text-sm ${
                      step.idx === s.idx ? "border-white bg-white text-zinc-950" : "border-white/20 hover:bg-white/5"
                    }`}
                  >
                    {s.kind === "tool" ? `Tool: ${s.tool_name ?? "call"}` : "Model call"}
                  </button>
                ))}
              </div>
            )}
            <Inspector step={step} steps={run.steps} />
          </div>
        )}
      </section>

      {mode === "app" ? (
        <>
          <RcaPanel run={run} onTest={testCandidate} onReport={setSaved} />
          <TestFixPanel key={`${run.id}-${fix?.nonce ?? 0}`} run={run} request={fix} />
        </>
      ) : (
        <>
          {report && (
            <RcaView report={report} agentOf={(i) => agents.get(i) ?? "?"} canRun={false} busy={false}
              error={null} onFind={() => {}} onTest={() => {}} readOnly />
          )}
          {demoExtra}
          <section className="rounded-xl border border-white/10 bg-white/[0.03] p-5">
            <h2 className="text-lg font-semibold">Test a fix on your own runs</h2>
            <p className="mt-1 text-zinc-400">This demo is read-only. Sign in to change an agent&apos;s output and run your own test.</p>
            <Link href="/sign-in" className="accent-bg mt-3 inline-block rounded-lg px-4 py-2 font-semibold hover:opacity-90">
              Sign in
            </Link>
          </section>
        </>
      )}
    </div>
  );
}

/** The first thing a person should read: did it work, and what is wrong. */
function Headline({ run, failed }: { run: Run; failed: boolean }) {
  if (!failed) return <>This run gave the right answer.</>;
  const got = run.oracle_detail?.footer?.open_tickets;
  const want = run.oracle_detail?.truth?.open_tickets;
  if (got !== undefined && want !== undefined) {
    return (
      <>
        The brief says <span className="text-rose-300">{got} open tickets</span>. The real number is {want}.
      </>
    );
  }
  return <>This run gave a wrong answer.</>;
}

const mark = (ok?: boolean) => (ok ? "passed" : "failed");

/** The code check behind the verdict: plain chips, not an LLM's opinion. */
function Checks({ detail }: { detail: OracleDetail }) {
  const items = [
    ["Open tickets", detail.open_tickets_ok],
    ["Pipeline total", detail.pipeline_ok],
    ["Review loop", detail.critic_loop_ok],
  ] as const;
  return (
    <ul className="flex flex-wrap gap-2" aria-label="Checks run in code against the real data">
      {items.map(([label, ok]) => (
        <li
          key={label}
          className={`rounded-full border px-3 py-1 text-sm ${
            ok ? "border-emerald-400/40 text-emerald-200" : "border-rose-400/50 text-rose-200"
          }`}
        >
          <span aria-hidden>{ok ? "✓" : "✗"} </span>
          {label} <span className="sr-only">{mark(ok)}</span>
        </li>
      ))}
    </ul>
  );
}

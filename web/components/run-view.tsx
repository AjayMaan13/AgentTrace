"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { BenchmarkTable } from "@/components/benchmark-table";
import { Checks } from "@/components/checks";
import { DeleteRun } from "@/components/delete-run";
import { isFinished } from "@/components/experiment-view";
import { FlowGraph } from "@/components/flow-graph";
import { NodePanel } from "@/components/node-panel";
import { RcaPanel } from "@/components/rca-panel";
import { RcaView } from "@/components/rca-view";
import { TestFixPanel } from "@/components/test-fix-panel";
import { useApi } from "@/lib/api";
import { formatTime, formatTokens } from "@/lib/format";
import { buildGraph } from "@/lib/graph";
import { marksFromReport } from "@/lib/story";
import type { Candidate, Experiment, RcaReport, Run, State } from "@/lib/types";
import { useApiData } from "@/lib/use-api-data";

/** A run as a story: the answer, the line of agents that produced it (with every fork as a branch),
 * why it probably failed, and a way to fork it. `mode="demo"` is the public read-only view. */
export function RunView({
  run, mode = "app", report = null, experiments = [], titleLevel = 1, extra = null,
}: {
  run: Run; mode?: "app" | "demo"; report?: RcaReport | null; experiments?: Experiment[]; titleLevel?: 1 | 2; extra?: React.ReactNode;
}) {
  return mode === "app" ? <AppRun run={run} titleLevel={titleLevel} /> : (
    <RunBody run={run} mode="demo" report={report} experiments={experiments} titleLevel={titleLevel} extra={extra} />
  );
}

/** The signed-in run: its forks are read from the API, and polled while any is still running. */
function AppRun({ run, titleLevel }: { run: Run; titleLevel: 1 | 2 }) {
  const fork = useSearchParams().get("fork"); // the project timeline links here with a fork to show
  const [tick, setTick] = useState(0); // bumping it asks for the list again, right after a fork starts
  const state = useApiData<Experiment[]>(`/v1/runs/${run.id}/experiments?k=${tick}`, (list) => (list.some((e) => !isFinished(e)) ? 1500 : null));
  const experiments = state.status === "ok" ? state.data : [];
  const forksError = state.status === "error" ? state.message : null;
  return <RunBody run={run} mode="app" report={null} experiments={experiments} forksError={forksError} titleLevel={titleLevel} onForked={() => setTick((t) => t + 1)} initialSelected={fork ? `${fork}:end` : null} />;
}

function RunBody({
  run, mode, report, experiments, titleLevel, onForked, extra = null, initialSelected = null, forksError = null,
}: {
  initialSelected?: string | null;
  forksError?: string | null;
  run: Run; mode: "app" | "demo"; report: RcaReport | null; experiments: Experiment[]; titleLevel: 1 | 2;
  onForked?: (experimentId: string) => void; extra?: React.ReactNode;
}) {
  const Title = titleLevel === 1 ? "h1" : "h2";
  const agents = useMemo(() => new Map(run.steps.map((s) => [s.node_run_idx, s.agent])), [run.steps]);
  const [saved, setSaved] = useState<RcaReport | null>(null); // what the signed-in RCA panel loaded
  const known = report ?? saved;
  const marks = useMemo(() => marksFromReport(known), [known]);
  const [selected, setSelected] = useState<string | null>(initialSelected);
  const [fix, setFix] = useState<{ nodeRunIdx: number; patch: State; nonce: number } | null>(null);
  // The fork being set up: which agent, and (when it is made inside another fork) which fork. Its line is drawn at once.
  const [draft, setDraft] = useState<{ nodeRun: number; fromExperiment: string | null } | null>(null);
  // When forking inside a fork, the fork starts from one real run of that fork, so the form needs that run.
  const [base, setBase] = useState<{ experimentId: string; runId: string } | null>(null);
  const [loaded, setLoaded] = useState<{ id: string; run: Run } | null>(null);
  const baseRun = base && loaded?.id === base.runId ? loaded.run : null;
  const [forkNote, setForkNote] = useState<string | null>(null);
  const api = useApi();
  useEffect(() => {
    if (!base) return;
    let off = false;
    api<Run>(`/v1/runs/${base.runId}`)
      .then((r) => !off && setLoaded({ id: base.runId, run: r }))
      .catch(() => !off && setForkNote("Could not load that fork's run, so it cannot be forked from here."));
    return () => { off = true; };
  }, [base, api]);

  const failed = run.outcome === "fail" || run.outcome === "error";
  const got = run.oracle_detail?.footer?.open_tickets;
  const want = run.oracle_detail?.truth?.open_tickets;
  const resultText = got !== undefined && want !== undefined ? `${got} open tickets, not ${want}` : undefined;
  // Rebuilt from the current data, so a fork that finishes updates the node you are looking at.
  const graph = useMemo(
    () => buildGraph(run.steps, { marks, experiments, outcome: run.outcome, resultText, draft }),
    [run.steps, run.outcome, marks, experiments, resultText, draft],
  );
  const node = selected ? graph.nodes.find((n) => n.id === selected) ?? null : null;

  function scrollToForm() {
    setTimeout(() => {
      const panel = document.getElementById("test-fix");
      panel?.scrollIntoView({ behavior: "smooth", block: "start" });
      panel?.focus({ preventScroll: true });
    }, 50);
  }
  function startFork(nodeRunIdx: number, patch: State = {}) {
    setBase(null);
    setForkNote(null);
    setDraft({ nodeRun: nodeRunIdx, fromExperiment: null });
    setFix((prev) => ({ nodeRunIdx, patch, nonce: (prev?.nonce ?? 0) + 1 }));
    scrollToForm();
  }
  /** Fork inside a fork: start from one finished run of that fork (its change already applied). */
  function startForkInside(experimentId: string, nodeRunIdx: number) {
    const exp = experiments.find((e) => e.id === experimentId);
    const runId = exp?.tiles.find((t) => t.arm === "treatment" && t.run_id)?.run_id;
    if (!runId) {
      setForkNote("That fork has no finished run yet, so there is nothing to fork from. Wait for a run to finish, then try again.");
      return;
    }
    setForkNote(null);
    setBase({ experimentId, runId });
    setDraft({ nodeRun: nodeRunIdx, fromExperiment: experimentId });
    setFix((prev) => ({ nodeRunIdx, patch: {}, nonce: (prev?.nonce ?? 0) + 1 }));
    scrollToForm();
  }
  function testCandidate(c: Candidate) {
    if (c.proposed_edit) startFork(c.node_run_idx, c.proposed_edit.patch);
  }
  const canFork = mode === "app" && run.forkable !== false;
  const benchmark = experiments.find((e) => e.benchmark)?.benchmark ?? null;

  return (
    <div className="flex flex-col gap-10">
      <header className="flex flex-col gap-3">
        <Title className="max-w-3xl font-serif text-[1.75rem] leading-tight sm:text-[2.25rem]">
          {!failed ? "This run gave the right answer." : got !== undefined && want !== undefined ? `The brief says ${got} open tickets, not ${want}.` : "This run gave a wrong answer."}
        </Title>
        {run.oracle_detail && <Checks detail={run.oracle_detail} />}
        <p className="text-muted">
          {mode === "demo" && "Saved example. "}{run.workflow} · {formatTime(run.started_at)} · {run.steps.length} steps ·{" "}
          {formatTokens((run.tokens_in ?? 0) + (run.tokens_out ?? 0))} tokens
          {run.kind === "fork" && " · this run is part of a fork"}
        </p>
        {mode === "app" && <DeleteRun runId={run.id} />}
      </header>

      <section id="run-graph" aria-label="The run as a line" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <h2 className="font-serif text-2xl">How the run went</h2>
          <p className="text-muted">Left to right, in the order things ran. A fork opens a new line. <span className="sm:hidden">Swipe sideways to follow it.</span></p>
        </div>
        <FlowGraph
          steps={run.steps} marks={marks} experiments={experiments} outcome={run.outcome} resultText={resultText}
          selected={selected} onSelect={(n) => setSelected((s) => (s === n.id ? null : n.id))}
          draft={draft}
        />
        {forkNote && <p role="alert" className="rounded-lg border border-bad/30 bg-bad-tint px-3 py-2 text-bad">{forkNote}</p>}
        {forksError && (
          <p role="alert" className="rounded-lg border border-bad/30 bg-bad-tint px-3 py-2 text-bad">
            Could not load this run&apos;s forks ({forksError}). A fork you start will still run, but it will not show here until this loads. If you just updated the app, restart the API.
          </p>
        )}
        {run.steps.some((s) => s.origin !== "recorded") && (
          <p className="text-[0.8125rem] text-muted">
            This run was made by a fork. <b className="font-medium text-ink">Replayed</b> steps are copied exactly from the recording and call no model.{" "}
            <b className="font-medium text-ink">Live</b> steps ran again against Claude, so they are sampled and can differ from run to run.
          </p>
        )}
        <p className="text-[0.8125rem] text-muted">
          In this workflow each agent waits for the one before it, so the line has no side-by-side agents. AgentTrace records the
          order steps ran in, not their start times, so it cannot yet draw agents that ran at the same time.
        </p>
        <NodePanel
          node={node} run={run} report={known} experiments={experiments} mode={mode}
          runHref={(id) => (mode === "demo" ? `/demo/runs/${id}` : `/runs/${id}`)}
          experimentHref={(id) => (mode === "demo" ? null : `/experiments/${id}`)}
          onFork={(n) => (n === 0 ? scrollToForm() : startFork(n))} onForkBranch={startForkInside} canFork={canFork}
        />
      </section>

      {mode === "app" && !canFork ? (
        <section className="card p-5">
          <h2 className="font-serif text-xl">This run is view only</h2>
          <p className="mt-1 max-w-[60ch] text-muted">
            You can read every step on the line above. Forking and finding the cause run your agents again, so they need this
            workflow connected to a replay worker. That is not available yet, so runs you record or import yourself stay view only.
          </p>
        </section>
      ) : mode === "app" ? (
        <>
          <RcaPanel run={run} onTest={testCandidate} onReport={setSaved} />
          {base && !baseRun ? (
            <p id="test-fix" tabIndex={-1} className="card p-5 text-muted">Loading that fork&apos;s run…</p>
          ) : (
          <TestFixPanel
            key={`${base?.runId ?? run.id}-${fix?.nonce ?? 0}`} run={base && baseRun ? baseRun : run} request={fix}
            baseLabel={base ? graph.lanes.find((l) => l.experiment === base.experimentId)?.label.split(":")[0] : undefined}
            onLaunched={(id) => {
              onForked?.(id);
              setDraft(null);
              setBase(null);
              setSelected(`${id}:end`);
              document.getElementById("run-graph")?.scrollIntoView({ behavior: "smooth", block: "start" });
            }}
          />
          )}
        </>
      ) : (
        <>
          {report && (
            <RcaView report={report} agentOf={(i) => agents.get(i) ?? "?"} canRun={false} busy={false}
              error={null} onFind={() => {}} onTest={() => {}} readOnly />
          )}
          {benchmark && <BenchmarkTable benchmark={benchmark} />}
          {extra}
          <section className="card p-5">
            <h2 className="font-serif text-xl">Fork a run of your own</h2>
            <p className="mt-1 text-muted">This example is read-only. Sign in to change what an agent decided and watch a new line open.</p>
            <Link href="/sign-in" className="btn btn-primary mt-3">Sign in</Link>
          </section>
        </>
      )}
    </div>
  );
}

"use client";

import Link from "next/link";
import { ExperimentView } from "@/components/experiment-view";
import { LoadState } from "@/components/load-state";
import { RunView } from "@/components/run-view";
import { usePublicData } from "@/lib/use-public-data";
import type { Experiment, RcaReport, Run } from "@/lib/types";

type Demo = {
  run: Run;
  rca: RcaReport | null;
  experiments: (Experiment & { role: "decoy" | "hero" | null })[];
};

const demoRun = (id: string) => `/demo/runs/${id}`;

const COPY = {
  decoy: {
    title: "Test the obvious fix: make the critic stricter",
    blurb:
      "The wrong number reached the reviewer and was approved, so the tempting fix is a stricter critic. The same fork " +
      "twice: control keeps the recorded critic output, treatment tells the critic to verify the count against the raw data.",
  },
  hero: {
    title: "Test the root cause: fix the planner's ticket filter",
    blurb:
      "Same fork point twice, at the planner: control keeps its recorded plan, treatment applies the fix the root-cause " +
      "agent proposed. Each run is checked in code against the real data, not by an LLM's opinion.",
  },
} as const;

export function DemoLoader() {
  const state = usePublicData<Demo>("/v1/public/demo");
  return (
    <LoadState state={state} notFound="The demo is not available yet.">
      {(demo) => {
        const truth = demo.run.oracle_detail?.truth?.open_tickets;
        const got = demo.run.oracle_detail?.footer?.open_tickets;
        return (
          <div className="flex flex-col gap-10">
            <header className="flex flex-col gap-3">
              <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">A wrong answer, and the step that caused it</h1>
              <p className="max-w-3xl text-base text-zinc-700 dark:text-zinc-300">
                A four-agent workflow (planner → researcher → writer ⇄ critic) wrote a renewal-risk brief for a
                customer account. It reported <b>{got ?? "the wrong number of"} open tickets</b>; the real data has{" "}
                <b>{truth ?? "more"}</b>. A trace shows what happened. AgentTrace shows what <i>caused</i> it, and proves
                the fix with a control arm. Everything below is a saved, real run against a simulated company.
              </p>
            </header>

            <section className="flex flex-col gap-3" aria-label="The failing run">
              <h2 className="text-2xl font-semibold tracking-tight">1. The failing run, and where it went wrong</h2>
              <RunView run={demo.run} mode="demo" report={demo.rca} titleLevel={2} />
            </section>

            {demo.experiments.map((e, i) => {
              const copy = COPY[e.role ?? "hero"];
              return (
                <section key={e.id} aria-label={copy.title}>
                  <ExperimentView experiment={e} title={`${i + 2}. ${copy.title}`} blurb={copy.blurb} runHref={demoRun} level={2} />
                </section>
              );
            })}

            <footer className="rounded-lg border border-zinc-300 p-4 text-sm dark:border-zinc-700">
              <p>
                Recorded steps replay exactly from the stored recording. Steps after a fork re-run live against Claude,
                so they are sampled, not deterministic. That is why every arm runs N times and results are shown as
                k/N with a Fisher p-value, as directional evidence.
              </p>
              <p className="mt-2">
                <Link href="/sign-in" className="font-semibold underline underline-offset-4">
                  Sign in to try it on your own runs
                </Link>
              </p>
            </footer>
          </div>
        );
      }}
    </LoadState>
  );
}

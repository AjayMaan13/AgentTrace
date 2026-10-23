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
  decoy: { title: "Try the obvious fix", blurb: "Make the critic stricter and re-run. Does anything change?" },
  hero: { title: "Test the real cause", blurb: "Fix the planner's ticket filter, with a no-edit control to compare against." },
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
              <h1 className="text-4xl font-semibold leading-tight tracking-tight sm:text-5xl">
                The brief says <span className="accent-text">{got ?? "the wrong number of"} open tickets</span>.
                <br />
                The truth is {truth ?? "more"}.
              </h1>
              <p className="max-w-2xl text-lg text-zinc-300">
                A saved run of four AI agents. Follow it from the failure to a proven fix.
              </p>
            </header>

            <section className="flex flex-col gap-3" aria-label="The failing run">
              <h2 className="text-2xl font-semibold tracking-tight">
                <span className="mr-2 font-mono text-zinc-500">1</span>See the failure
              </h2>
              <p className="-mt-1 text-zinc-400">Click any step. The root-cause agent ranks the suspects on the right.</p>
              <RunView run={demo.run} mode="demo" report={demo.rca} titleLevel={2} />
            </section>

            {demo.experiments.map((e, i) => {
              const copy = COPY[e.role ?? "hero"];
              return (
                <section key={e.id} aria-label={copy.title}>
                  <ExperimentView experiment={e} title={`${i + 2}  ${copy.title}`} blurb={copy.blurb} runHref={demoRun} level={2} />
                </section>
              );
            })}

            <footer className="flex flex-col items-start gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-6">
              <p className="text-xl font-semibold">Try it on your own runs</p>
              <Link href="/sign-in" className="accent-bg rounded-lg px-5 py-2.5 font-semibold hover:opacity-90">
                Sign in
              </Link>
              <p className="text-sm text-zinc-400">
                Recorded steps replay exactly. Steps after a fork re-run live, so every arm runs N times and results
                are directional.
              </p>
            </footer>
          </div>
        );
      }}
    </LoadState>
  );
}

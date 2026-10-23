"use client";

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
  decoy: { title: "The obvious fix: a stricter reviewer", blurb: "The wrong answer was approved, so we told the critic to check harder and re-ran." },
  hero: { title: "The likely cause: the planner", blurb: "We fixed which tickets the planner asks for, and re-ran with and without that change." },
} as const;

export function DemoLoader() {
  const state = usePublicData<Demo>("/v1/public/demo");
  return (
    <LoadState state={state} notFound="The demo is not available yet.">
      {(demo) => (
        <div className="flex flex-col gap-8">
          <p className="-mb-4 text-sm font-medium uppercase tracking-widest text-zinc-500">
            Saved example: four AI agents write a customer renewal brief
          </p>
          <RunView
            run={demo.run}
            mode="demo"
            report={demo.rca}
            titleLevel={1}
            demoExtra={
              <section aria-label="Tested fixes" className="flex flex-col gap-10">
                <div>
                  <h2 className="text-2xl font-semibold tracking-tight">Testing two fixes</h2>
                  <p className="mt-1 max-w-prose text-zinc-400">
                    Each test runs the workflow again from the changed agent, with and without the change, and counts
                    how often the answer is right.
                  </p>
                </div>
                {demo.experiments.map((e) => {
                  const copy = COPY[e.role ?? "hero"];
                  return (
                    <section key={e.id} aria-label={copy.title}>
                      <ExperimentView experiment={e} title={copy.title} blurb={copy.blurb} runHref={demoRun} level={2} />
                    </section>
                  );
                })}
              </section>
            }
          />
        </div>
      )}
    </LoadState>
  );
}

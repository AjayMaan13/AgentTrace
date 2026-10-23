"use client";

import { usePublicData } from "@/lib/use-public-data";
import type { Experiment } from "@/lib/types";

type Demo = { experiments: (Experiment & { role: "decoy" | "hero" | null })[] };

/** The saved hero experiment from the public demo: the one number that explains the product.
 * It reads the stored result, so the landing page can never show a figure the demo does not. */
export function HeroResult() {
  const state = usePublicData<Demo>("/v1/public/demo");
  const hero = state.status === "ok" ? state.data.experiments.find((e) => e.role === "hero") : undefined;
  if (state.status === "error") return null;
  return (
    <div className="glow rounded-2xl border border-white/10 bg-white/[0.03] p-5 sm:p-8" aria-label="A saved experiment">
      {!hero ? (
        <div className="h-44 animate-pulse rounded-lg bg-white/5" aria-label="Loading the saved experiment" />
      ) : (
        <>
          <p className="text-xs font-medium uppercase tracking-widest text-zinc-400">Same run, with and without the fix</p>
          <div className="mt-4 grid grid-cols-2 gap-4 sm:gap-8">
            {(["control", "treatment"] as const).map((arm) => (
              <div key={arm}>
                <p className="text-sm text-zinc-400">{arm === "control" ? "Without the fix" : "With the fix"}</p>
                <p className={`mt-1 text-5xl font-bold tabular-nums sm:text-7xl ${arm === "treatment" ? "accent-text" : ""}`}>
                  {hero[arm].pass}/{hero[arm].total}
                </p>
                <ul className="mt-3 flex flex-wrap gap-1.5" aria-hidden>
                  {hero.tiles.filter((t) => t.arm === arm).map((t) => (
                    <li
                      key={t.i}
                      className={`h-3 w-3 rounded-sm sm:h-4 sm:w-4 ${t.outcome === "pass" ? "bg-emerald-400" : "bg-rose-500"}`}
                    />
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <p className="mt-5 text-xs text-zinc-400">
            Runs that passed a code check against the real data. A saved result from the demo: directional, not proof.
          </p>
        </>
      )}
    </div>
  );
}

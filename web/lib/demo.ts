import type { Benchmark, Experiment, RcaReport, Run } from "./types";

/** What GET /v1/public/demo returns: the saved failing run, its report and the featured experiments. */
export type Demo = {
  run: Run;
  rca: RcaReport | null;
  experiments: (Experiment & { role: "decoy" | "hero" | null; benchmark?: Benchmark | null })[];
};

const API_URL = process.env.NEXT_PUBLIC_API_URL;

/** The saved demo, read on the server so the first paint already holds the real run and results.
 * If the API is down or slow the page still renders, with its fallback wording. */
export async function loadDemo(): Promise<Demo | null> {
  // The API opens its database connection on first use, which can take several seconds. One retry.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(`${API_URL}/v1/public/demo`, { signal: AbortSignal.timeout(15000) });
      if (res.ok) return (await res.json()) as Demo;
    } catch {
      // try again
    }
  }
  return null;
}

import Link from "next/link";
import { BenchmarkTable } from "@/components/benchmark-table";
import { JsonBlock } from "@/components/json-block";
import { formatP, formatTokens, percent, shortId } from "@/lib/format";
import type { Experiment, Tile } from "@/lib/types";

export const isFinished = (e: Experiment) => !["queued", "running"].includes(e.status);

export function ExperimentView({
  experiment: e, title, blurb, runHref = (id) => `/runs/${id}`, level = 1,
}: {
  experiment: Experiment;
  title?: string;
  blurb?: string;
  runHref?: (runId: string) => string; // where a run link points (the demo has its own public pages)
  level?: 1 | 2;
}) {
  const Heading = level === 1 ? "h1" : "h2";
  const finished = e.tiles.filter((t) => t.status === "done" || t.status === "skipped").length;
  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <Heading className="text-2xl font-semibold tracking-tight">{title ?? `Experiment ${shortId(e.id)}`}</Heading>
        {blurb && <p className="text-zinc-400">{blurb}</p>}
        <p className="text-sm text-zinc-700 dark:text-zinc-300">
          Forked from{" "}
          <Link href={runHref(e.parent_run)} className="font-mono underline underline-offset-4">
            run {shortId(e.parent_run)}
          </Link>{" "}
          at node run {e.fork_node_run_idx} · {e.n} runs per arm
        </p>
      </header>

      <ResultCard experiment={e} finished={finished} />

      <section aria-label="Runs">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-zinc-600 dark:text-zinc-400">Runs</h2>
        <div className="flex flex-col gap-3">
          {(["control", "treatment"] as const).map((arm) => (
            <div key={arm} className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <span className="w-24 shrink-0 text-sm font-medium capitalize">{arm}</span>
              <ul className="flex flex-wrap gap-2">
                {e.tiles.filter((t) => t.arm === arm).map((t) => (
                  <li key={`${t.arm}-${t.i}`}>
                    <TileCell tile={t} runHref={runHref} />
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs text-zinc-600 dark:text-zinc-400">
          Green passed · red failed · orange errored. Select a tile to open its run.
        </p>
      </section>

      {e.benchmark && <BenchmarkTable benchmark={e.benchmark} />}

      <details className="rounded-lg border border-zinc-300 p-3 dark:border-zinc-700">
        <summary className="cursor-pointer text-sm font-medium">The edit applied to the treatment arm</summary>
        <div className="mt-3">
          <JsonBlock label="Edit (top-level state keys)" value={e.edit_patch} />
        </div>
      </details>
    </div>
  );
}

function ResultCard({ experiment: e, finished }: { experiment: Experiment; finished: number }) {
  const running = !isFinished(e);
  const { control: c, treatment: t, stats } = e;
  return (
    <section
      aria-live="polite"
      aria-label="Result"
      className="rounded-xl border-2 border-zinc-900 p-5 sm:p-8 dark:border-zinc-100"
    >
      <p className="text-sm uppercase tracking-wide text-zinc-700 dark:text-zinc-300">Success rate by arm</p>
      <p className="mt-2 text-3xl font-bold tabular-nums sm:text-5xl lg:text-6xl">
        Control {c.pass}/{c.total}
        <span aria-hidden> → </span>
        <span className="sr-only"> then </span>
        Treatment {t.pass}/{t.total}
      </p>
      <p className="mt-3 text-base sm:text-lg">
        {stats.fisher_p === null ? (
          "Fisher p-value appears once both arms have finished a run"
        ) : (
          <>
            Fisher exact p {stats.fisher_p < 0.001 ? "" : "≈ "}
            <b>{formatP(stats.fisher_p)}</b> · {stats.label}
          </>
        )}
      </p>
      {stats.wilson.control && stats.wilson.treatment && (
        <p className="mt-1 text-sm text-zinc-700 dark:text-zinc-300">
          95% intervals: control {percent(stats.wilson.control[0])}–{percent(stats.wilson.control[1])}, treatment{" "}
          {percent(stats.wilson.treatment[0])}–{percent(stats.wilson.treatment[1])}. Small N shows direction, not proof.
        </p>
      )}

      {running && (
        <div className="mt-4">
          <p className="text-sm font-medium">
            Running: {finished} of {e.tiles.length} runs finished
          </p>
          <div className="mt-1 h-2 overflow-hidden rounded bg-zinc-200 dark:bg-zinc-800">
            <div className="h-full bg-zinc-900 transition-all dark:bg-zinc-100" style={{ width: `${(finished / e.tiles.length) * 100}%` }} />
          </div>
        </div>
      )}
      {e.status === "capped" && (
        <p className="mt-4 text-sm font-medium text-orange-800 dark:text-orange-300">
          Stopped early at the token ceiling ({formatTokens(e.token_ceiling)}); only finished runs are counted.
        </p>
      )}
      {e.status === "error" && (
        <p role="alert" className="mt-4 text-sm font-medium text-red-800 dark:text-red-300">
          The experiment failed{e.error ? ` (${e.error})` : ""}. Counts show the runs that finished.
        </p>
      )}
      <p className="mt-4 text-xs text-zinc-600 dark:text-zinc-400">
        Earlier steps replay exactly from the recording. Later steps ran live and are sampled, so each arm runs N
        times. {formatTokens(e.tokens_used)} tokens.
      </p>
    </section>
  );
}

const TILE_BASE = "flex h-10 w-10 items-center justify-center rounded-md text-base font-bold";

function TileCell({ tile, runHref }: { tile: Tile; runHref: (runId: string) => string }) {
  let className = `${TILE_BASE} bg-zinc-200 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400`;
  let glyph = "";
  let label = "queued";
  if (tile.status === "running") {
    className = `${TILE_BASE} animate-pulse bg-sky-300 text-sky-950`;
    glyph = "…";
    label = "running";
  } else if (tile.status === "skipped") {
    className = `${TILE_BASE} border-2 border-dashed border-zinc-500 text-zinc-600 dark:text-zinc-400`;
    glyph = "–";
    label = "skipped";
  } else if (tile.status === "done") {
    const map = {
      pass: ["bg-green-700 text-white", "✓", "passed"],
      fail: ["bg-red-700 text-white", "✗", "failed"],
      error: ["bg-orange-700 text-white", "!", "errored"],
    } as const;
    const [cls, g, l] = map[tile.outcome ?? "error"];
    className = `${TILE_BASE} ${cls}`;
    glyph = g;
    label = l;
  }
  const full = `${tile.arm} run ${tile.i}: ${label}`;
  return tile.run_id ? (
    <Link href={runHref(tile.run_id)} className={`${className} hover:ring-2 hover:ring-zinc-900 dark:hover:ring-zinc-100`} aria-label={`${full}, open run`} title={full}>
      {glyph}
    </Link>
  ) : (
    <span className={className} aria-label={full} title={full}>
      {glyph}
    </span>
  );
}

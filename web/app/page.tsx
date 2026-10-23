import Link from "next/link";
import { HeroResult } from "@/components/hero-result";

const STEPS = [
  ["Record", "Capture every prompt, tool call and state change of a multi-agent run."],
  ["Fork", "Change one step. Earlier steps replay exactly; later steps re-run live."],
  ["Measure", "Run it again and again, with and without your change. Code checks every answer."],
] as const;

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-20 px-4 py-12 sm:px-6 sm:py-20">
      <section className="grid items-center gap-12 lg:grid-cols-2">
        <div className="flex flex-col gap-6">
          <p className="text-sm font-medium uppercase tracking-widest text-zinc-400">Debugger for multi-agent AI</p>
          <h1 className="text-4xl font-semibold leading-[1.1] tracking-tight sm:text-6xl">
            Find the step that broke your agents. <span className="accent-text">Prove the fix.</span>
          </h1>
          <p className="max-w-md text-lg text-zinc-300">
            Fork a failed run, change one step, and replay it live with and without your change.
          </p>
          <div className="flex flex-wrap gap-3">
            <Link href="/demo" className="accent-bg rounded-lg px-6 py-3 text-base font-semibold hover:opacity-90">
              See the live demo
            </Link>
            <Link
              href="/sign-in"
              className="rounded-lg border border-white/20 px-6 py-3 text-base font-semibold hover:bg-white/5"
            >
              Sign in
            </Link>
          </div>
        </div>
        <HeroResult />
      </section>

      <section aria-label="How it works">
        <ol className="grid gap-4 sm:grid-cols-3">
          {STEPS.map(([title, text], i) => (
            <li key={title} className="rounded-xl border border-white/10 bg-white/[0.03] p-6">
              <p className="font-mono text-sm text-zinc-500">0{i + 1}</p>
              <h2 className="mt-2 text-2xl font-semibold">{title}</h2>
              <p className="mt-2 text-zinc-300">{text}</p>
            </li>
          ))}
        </ol>
      </section>

      <footer className="flex flex-col gap-2 border-t border-white/10 pt-8 text-sm text-zinc-400">
        <p>Built with Claude, SurrealDB, Clerk and Era on Render.</p>
        <p>Results are shown as passes out of N per arm with a Fisher exact p-value, as directional evidence.</p>
      </footer>
    </main>
  );
}

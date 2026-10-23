import Link from "next/link";
import { HeroFlow } from "@/components/hero-flow";

const STEPS = [
  ["Record", "Add the Python recorder to your agents. Secrets are removed before anything leaves your machine."],
  ["Find the cause", "Open a run that went wrong. Each agent is a card, and the likely cause is marked."],
  ["Test the fix", "Change what one agent decided and run the rest again. See how often the answer comes out right."],
] as const;

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-24 px-4 py-12 sm:px-6 sm:py-20">
      <section className="flex flex-col gap-10">
        <div className="flex max-w-3xl flex-col gap-6">
          <h1 className="text-4xl font-semibold leading-[1.1] tracking-tight sm:text-5xl lg:text-6xl">
            Your agents ran. The answer is wrong. Which one broke it?
          </h1>
          <p className="max-w-xl text-lg text-zinc-300">
            AgentTrace records a multi-agent run, points at the agent that most likely caused the mistake, and lets you
            test a fix before you ship it.
          </p>
          <div className="flex flex-wrap gap-3">
            <Link href="/demo" className="accent-bg rounded-lg px-6 py-3 text-base font-semibold hover:opacity-90">
              See a real example
            </Link>
            <Link href="/sign-in" className="rounded-lg border border-white/20 px-6 py-3 text-base font-semibold hover:bg-white/5">
              Sign in
            </Link>
          </div>
        </div>
        <HeroFlow />
      </section>

      <section aria-label="How you use it" className="grid gap-x-12 gap-y-10 lg:grid-cols-[1fr_2fr]">
        <h2 className="text-3xl font-semibold tracking-tight">How you use it</h2>
        <ol className="divide-y divide-white/10 border-y border-white/10">
          {STEPS.map(([title, text], i) => (
            <li key={title} className="grid gap-1 py-6 sm:grid-cols-[3rem_1fr]">
              <span className="font-mono text-zinc-500">0{i + 1}</span>
              <div>
                <h3 className="text-xl font-semibold">{title}</h3>
                <p className="mt-1 max-w-prose text-zinc-300">{text}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <footer className="flex flex-col gap-2 border-t border-white/10 pt-8 text-sm text-zinc-400">
        <p>Built with Claude, SurrealDB, Clerk and Era, hosted on Render.</p>
        <p>Steps before a change replay exactly from the recording. Steps after it run live, so results are directional.</p>
      </footer>
    </main>
  );
}

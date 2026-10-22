import Link from "next/link";

const STEPS = [
  ["Record", "Wrap a multi-agent workflow with the SDK. Every prompt, tool call and state change is captured, with secrets redacted before anything leaves your process."],
  ["Fork", "Edit one step and fork. Steps before it replay exactly from the recording; steps after it re-run live against Claude."],
  ["Measure", "Run the fork N times in a control arm (no edit) and a treatment arm (your edit). See 0/5 become 4/5, with a code-checked oracle, not an LLM judge."],
] as const;

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-10 px-4 py-10 sm:px-6 sm:py-16">
      <header className="flex flex-col gap-4">
        <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
          Find which step broke your multi-agent run, and prove the fix.
        </h1>
        <p className="max-w-2xl text-lg text-zinc-700 dark:text-zinc-300">
          AgentTrace is a debugger for multi-agent LLM workflows. Traces show what happened. AgentTrace tests what
          caused it: fork a recorded run at any step, and measure whether your edit changes the outcome.
        </p>
        <div className="flex flex-wrap gap-3">
          <Link
            href="/demo"
            className="rounded-md bg-zinc-900 px-5 py-3 text-base font-semibold text-white dark:bg-zinc-100 dark:text-zinc-900"
          >
            See the live demo
          </Link>
          <Link href="/sign-in" className="rounded-md border-2 border-zinc-900 px-5 py-3 text-base font-semibold dark:border-zinc-100">
            Sign in
          </Link>
        </div>
      </header>

      <section aria-label="How it works">
        <ol className="grid gap-4 sm:grid-cols-3">
          {STEPS.map(([title, text], i) => (
            <li key={title} className="rounded-lg border border-zinc-300 p-4 dark:border-zinc-700">
              <p className="text-sm font-semibold text-zinc-600 dark:text-zinc-400">Step {i + 1}</p>
              <h2 className="text-xl font-semibold">{title}</h2>
              <p className="mt-2 text-sm text-zinc-700 dark:text-zinc-300">{text}</p>
            </li>
          ))}
        </ol>
      </section>

      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        Recorded steps replay exactly. Forked steps re-run live and are sampled, never deterministic, so results are
        shown as k/N per arm with a Fisher p-value and labelled directional.
      </p>
    </main>
  );
}

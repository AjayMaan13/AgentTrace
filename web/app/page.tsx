import { HealthCard } from "./health-card";

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-4 py-16 sm:px-6">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">AgentTrace</h1>
        <p className="mt-2 text-zinc-600 dark:text-zinc-400">
          Record a multi-agent run, fork one step, and measure whether the edit changes the
          outcome. Phase 0: skeleton and deploy check.
        </p>
      </header>
      <HealthCard />
    </main>
  );
}

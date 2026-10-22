import { RunsList } from "./runs-list";

export default function RunsPage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-4 px-4 py-8 sm:px-6">
      <h1 className="text-2xl font-semibold tracking-tight">Runs</h1>
      <RunsList />
    </main>
  );
}

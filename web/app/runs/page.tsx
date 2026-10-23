import { Shell } from "@/components/shell";
import { RunsList } from "./runs-list";

export default function RunsPage() {
  return (
    <Shell>
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-5 py-8 sm:px-8">
      <h1 className="text-2xl font-semibold tracking-tight">Runs</h1>
      <RunsList />
    </main>
    </Shell>
  );
}

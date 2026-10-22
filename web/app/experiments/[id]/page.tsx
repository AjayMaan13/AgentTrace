import Link from "next/link";
import { Suspense } from "react";
import { ExperimentLoader } from "./experiment-loader";

export default function ExperimentPage() {
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-4 px-4 py-6 sm:px-6">
      <Link href="/runs" className="text-sm underline-offset-4 hover:underline">
        ← All runs
      </Link>
      <Suspense fallback={<p className="font-mono text-sm">Loading…</p>}>
        <ExperimentLoader />
      </Suspense>
    </main>
  );
}

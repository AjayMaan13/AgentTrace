import Link from "next/link";
import { Suspense } from "react";
import { RunLoader } from "./run-loader";

export default function RunPage() {
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-4 px-4 py-6 sm:px-6">
      <Link href="/runs" className="text-sm underline-offset-4 hover:underline">
        ← All runs
      </Link>
      {/* The route param is read on the client, which Cache Components needs inside Suspense. */}
      <Suspense fallback={<p className="font-mono text-sm">Loading…</p>}>
        <RunLoader />
      </Suspense>
    </main>
  );
}

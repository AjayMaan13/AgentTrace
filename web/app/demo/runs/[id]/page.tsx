import Link from "next/link";
import { Suspense } from "react";
import { DemoRunLoader } from "./run-loader";

export default function DemoRunPage() {
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-4 px-4 py-6 sm:px-6">
      <Link href="/demo" className="text-sm underline-offset-4 hover:underline">
        ← Back to the demo
      </Link>
      <Suspense fallback={<p className="font-mono text-sm">Loading…</p>}>
        <DemoRunLoader />
      </Suspense>
    </main>
  );
}

import { Suspense } from "react";
import { DemoLoader } from "./demo-loader";

export default function DemoPage() {
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-4 px-4 py-6 sm:px-6">
      <Suspense fallback={<p className="font-mono text-sm">Loading…</p>}>
        <DemoLoader />
      </Suspense>
    </main>
  );
}

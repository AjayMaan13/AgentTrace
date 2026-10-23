import { Shell } from "@/components/shell";
import { Suspense } from "react";
import { loadDemo } from "@/lib/demo";
import { DemoView } from "./demo-loader";

export const metadata = { title: "Saved example" };

async function Content() {
  return <DemoView demo={await loadDemo()} />;
}

export default function DemoPage() {
  return (
    <Shell>
      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-5 py-8 sm:px-8">
        <Suspense fallback={<p className="text-muted">Loading the saved run…</p>}>
          <Content />
        </Suspense>
      </main>
    </Shell>
  );
}

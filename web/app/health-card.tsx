"use client";

import { useEffect, useState } from "react";

const API_URL = process.env.NEXT_PUBLIC_API_URL;

type State =
  | { status: "loading" }
  | { status: "ok"; body: unknown }
  | { status: "error"; message: string };

export function HealthCard() {
  const [state, setState] = useState<State>(
    API_URL
      ? { status: "loading" }
      : { status: "error", message: "NEXT_PUBLIC_API_URL is not set" },
  );

  useEffect(() => {
    if (!API_URL) return;
    const ctrl = new AbortController();
    fetch(`${API_URL}/health`, { signal: ctrl.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error(`API returned HTTP ${res.status}`);
        setState({ status: "ok", body: await res.json() });
      })
      .catch((err: unknown) => {
        if (ctrl.signal.aborted) return;
        // A blocked CORS request surfaces here as a generic network error.
        setState({
          status: "error",
          message: err instanceof Error ? err.message : "Request failed",
        });
      });
    return () => ctrl.abort();
  }, []);

  return (
    <section
      aria-live="polite"
      className="w-full rounded-lg border border-zinc-300 p-4 dark:border-zinc-700"
    >
      <h2 className="text-sm font-medium text-zinc-600 dark:text-zinc-400">
        GET {API_URL ?? "(unset)"}/health
      </h2>
      {state.status === "loading" && <p className="mt-2 font-mono text-sm">Loading…</p>}
      {state.status === "ok" && (
        <pre className="mt-2 overflow-x-auto font-mono text-sm">
          {JSON.stringify(state.body, null, 2)}
        </pre>
      )}
      {state.status === "error" && (
        <p role="alert" className="mt-2 font-mono text-sm text-red-700 dark:text-red-400">
          {state.message}
        </p>
      )}
    </section>
  );
}

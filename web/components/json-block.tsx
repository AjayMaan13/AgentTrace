export function JsonBlock({ value, label }: { value: unknown; label: string }) {
  return (
    <div>
      <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-600 dark:text-zinc-400">
        {label}
      </h4>
      <pre
        tabIndex={0}
        className="max-h-72 overflow-auto rounded-md border border-zinc-300 bg-zinc-50 p-3 font-mono text-xs leading-relaxed dark:border-zinc-700 dark:bg-zinc-900"
      >
        {typeof value === "string" ? value : JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}

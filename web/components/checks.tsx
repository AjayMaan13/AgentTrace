import type { OracleDetail } from "@/lib/types";

/** The code check behind the verdict, as plain chips: code against the real data, not an AI's opinion. */
export function Checks({ detail }: { detail: OracleDetail }) {
  const items = [
    ["Open tickets", detail.open_tickets_ok],
    ["Pipeline total", detail.pipeline_ok],
    ["Review loop", detail.critic_loop_ok],
  ] as const;
  return (
    <ul className="flex flex-wrap gap-2" aria-label="Checks run in code against the real data">
      {items.map(([label, ok]) => (
        <li
          key={label}
          className={`rounded-full border px-3 py-1 text-sm ${ok ? "border-good/30 bg-good-tint text-good" : "border-bad/30 bg-bad-tint text-bad"}`}
        >
          {label}: {ok ? "right" : "wrong"}
        </li>
      ))}
    </ul>
  );
}

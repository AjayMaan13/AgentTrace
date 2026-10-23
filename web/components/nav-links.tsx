"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/** Sidebar links; the current page is a filled row, everything else is quiet text. */
export function NavLinks({ items }: { items: { href: string; label: string }[] }) {
  const path = usePathname();
  return (
    <ul className="flex flex-col gap-0.5">
      {items.map((i) => {
        const on = path === i.href || path.startsWith(`${i.href}/`);
        return (
          <li key={i.href}>
            <Link
              href={i.href}
              aria-current={on ? "page" : undefined}
              className={`block rounded-lg px-3 py-2 ${on ? "bg-tile text-ink" : "text-muted hover:bg-tile/60 hover:text-ink"}`}
            >
              {i.label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

import Link from "next/link";

/** The windows Trends offers. Lives here because RangeTabs is its only reader. */
export const RANGES = [30, 90, 180, 365] as const;

/**
 * Trends' window picker. Was the smallest control on the surface at 10px —
 * below the floor, and in light mode it rendered white-on-white along with
 * everything else on this page.
 */
export function RangeTabs({
  active,
  ranges,
  href,
}: {
  active: number;
  ranges: readonly number[];
  href: (over: { range?: number }) => string;
}) {
  return (
    <div className="mb-3 flex justify-end gap-1">
      {ranges.map((r) => (
        <Link
          key={r}
          href={href({ range: r })}
          aria-current={r === active ? "true" : undefined}
          className={`rounded-full px-2.5 py-1 text-label font-bold transition-colors ${
            r === active
              ? "bg-surface-overlay text-ink-primary"
              : "bg-surface-raised text-ink-muted hover:text-ink-secondary"
          }`}
        >
          {r}d
        </Link>
      ))}
    </div>
  );
}

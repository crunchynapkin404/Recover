import Link from "next/link";
import type { LogHref } from "./view-tabs";

const RANGES = [30, 90, 180, 365] as const;

/** Day-range pills for a trend panel (PMC or Wellness Trends). No client JS. */
export function RangeTabs({
  active,
  view,
  href,
}: {
  active: number;
  view: "training" | "wellness";
  href: LogHref;
}) {
  return (
    <div className="flex gap-1">
      {RANGES.map((r) => (
        <Link
          key={r}
          // `panel=` just round-trips which trend panel's range was last
          // touched; it's cosmetic only, so it's appended here rather than
          // threaded through the shared href builder's signature.
          href={`${href({ range: r })}&panel=${view}`}
          aria-current={active === r ? "true" : undefined}
          className={`rounded-full px-2.5 py-1 text-[10px] font-bold ${
            active === r
              ? "bg-emerald-500/20 text-emerald-400"
              : "text-white/40"
          }`}
        >
          {r}d
        </Link>
      ))}
    </div>
  );
}

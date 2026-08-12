import Link from "next/link";
import type { LogHref } from "@/lib/log-href";

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
          className={`rounded-full px-2.5 py-1 text-label font-bold ${
            active === r ? "bg-accent/20 text-accent" : "text-ink-muted"
          }`}
        >
          {/* One string child, not `{r}d`: React inserts a hydration
              boundary comment between two adjacent expression/text
              children, which would render "30<!-- -->d" and split the
              range label across two text nodes for no visual reason. */}
          {`${r}d`}
        </Link>
      ))}
    </div>
  );
}

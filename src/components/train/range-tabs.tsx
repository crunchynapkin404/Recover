import { RANGES, type LogHref } from "@/lib/log-href";
import { SegmentedTabs } from "@/components/ui/segmented-tabs";

/**
 * Day-range pills for a trend panel (PMC or Wellness Trends). No client JS.
 *
 * These used to paint their active pill `bg-accent/20 text-accent` while the
 * other three tab rows used the surface treatment. That was not a decision:
 * 00534a5 translated the `bg-emerald-500/20 text-emerald-400` this shipped
 * with straight onto tokens, and the surface treatment arrived later
 * everywhere else. Rendering `SegmentedTabs` settles it on the majority
 * treatment — a visible change to this row, and the point of the exercise.
 */
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
    <SegmentedTabs
      size="pill"
      active={active}
      items={RANGES.map((r) => ({
        key: r,
        label: `${r}d`,
        // `panel=` just round-trips which trend panel's range was last
        // touched; it's cosmetic only, so it's appended here rather than
        // threaded through the shared href builder's signature.
        href: `${href({ range: r })}&panel=${view}`,
      }))}
    />
  );
}

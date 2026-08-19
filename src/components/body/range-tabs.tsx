import { SegmentedTabs } from "@/components/ui/segmented-tabs";

/**
 * Trends' window picker. Was the smallest control on the surface at 10px —
 * below the floor, and in light mode it rendered white-on-white along with
 * everything else on this page. It now renders `SegmentedTabs` at `pill`
 * size, which owns the type scale, so neither can recur here alone.
 *
 * Unlabelled on purpose: this filters the page it is already on, so it is a
 * plain row with `aria-current="true"` rather than a second `<nav>` landmark
 * claiming `page`.
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
    <SegmentedTabs
      size="pill"
      className="mb-3 justify-end"
      active={active}
      items={ranges.map((r) => ({
        key: r,
        label: `${r}d`,
        href: href({ range: r }),
      }))}
    />
  );
}

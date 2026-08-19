import { BODY_TABS, type BodyTab } from "@/lib/log-href";
import { SegmentedTabs } from "@/components/ui/segmented-tabs";

const LABEL: Record<BodyTab, string> = {
  trends: "Trends",
  sleep: "Sleep",
  journal: "Journal",
  labs: "Labs",
};

/**
 * Body's segmented control. Its treatment used to be kept identical to
 * TrainTabs by hand — "two sibling surfaces whose tab rows looked alike by
 * accident and drifted apart by accident too", as this comment previously
 * put it. Both now render `SegmentedTabs`, so the likeness is structural.
 *
 * What stays here is Body's vocabulary and href builder: every segment
 * carries the rest of the filter state with it (see buildBodyHref).
 */
export function BodyTabs({
  active,
  href,
}: {
  active: BodyTab;
  href: (over: { tab?: BodyTab }) => string;
}) {
  return (
    <SegmentedTabs
      navLabel="Body sections"
      className="flex-wrap"
      active={active}
      items={BODY_TABS.map((t) => ({
        key: t,
        label: LABEL[t],
        href: href({ tab: t }),
      }))}
    />
  );
}

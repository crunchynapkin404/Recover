import { TRAIN_TABS, type TrainHref, type TrainTab } from "@/lib/log-href";
import { SegmentedTabs } from "@/components/ui/segmented-tabs";

const LABEL: Record<TrainTab, string> = {
  week: "Week",
  history: "History",
  season: "Season",
  fitness: "Fitness",
};

/**
 * Train's segmented control (1c/1d/1e). The row itself is `SegmentedTabs`;
 * what belongs here is Train's vocabulary and its href builder — every
 * segment carries the rest of the filter state with it (see buildTrainHref),
 * so the browser's back button walks the athlete's actual path.
 */
export function TrainTabs({
  active,
  href,
}: {
  active: TrainTab;
  href: TrainHref;
}) {
  return (
    <SegmentedTabs
      navLabel="Train sections"
      className="mb-5"
      active={active}
      items={TRAIN_TABS.map((t) => ({
        key: t,
        label: LABEL[t],
        href: href({ tab: t }),
      }))}
    />
  );
}

import Link from "next/link";
import { TRAIN_TABS, type TrainHref, type TrainTab } from "@/lib/log-href";

const LABEL: Record<TrainTab, string> = {
  week: "Week",
  history: "History",
  season: "Season",
  fitness: "Fitness",
};

/**
 * Train's segmented control (1c/1d/1e). Links, not state — every segment
 * carries the rest of the filter state with it (see buildTrainHref), so
 * the browser's back button walks the athlete's actual path.
 */
export function TrainTabs({
  active,
  href,
}: {
  active: TrainTab;
  href: TrainHref;
}) {
  return (
    <nav aria-label="Train sections" className="mb-5 flex gap-1.5">
      {TRAIN_TABS.map((t) => (
        <Link
          key={t}
          href={href({ tab: t })}
          aria-current={t === active ? "page" : undefined}
          className={`rounded-full px-4 py-1.5 text-label font-bold transition-colors ${
            t === active
              ? "bg-surface-overlay text-ink-primary"
              : "bg-surface-raised text-ink-muted hover:text-ink-secondary"
          }`}
        >
          {LABEL[t]}
        </Link>
      ))}
    </nav>
  );
}

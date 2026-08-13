import Link from "next/link";
import { BODY_TABS, type BodyTab } from "@/lib/log-href";

const LABEL: Record<BodyTab, string> = {
  trends: "Trends",
  sleep: "Sleep",
  journal: "Journal",
  labs: "Labs",
};

/**
 * Body's segmented control. Links, not state — every segment carries the rest
 * of the filter state with it (see buildBodyHref), so the browser's back
 * button walks the athlete's actual path. Deliberately identical in treatment
 * to TrainTabs: two sibling surfaces whose tab rows looked alike by accident
 * and drifted apart by accident too.
 */
export function BodyTabs({
  active,
  href,
}: {
  active: BodyTab;
  href: (over: { tab?: BodyTab }) => string;
}) {
  return (
    <nav aria-label="Body sections" className="flex flex-wrap gap-1.5">
      {BODY_TABS.map((t) => (
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

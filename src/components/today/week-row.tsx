import Link from "next/link";
import { WeekStrip } from "@/components/week/week-strip";
import { fmt } from "@/components/week/week-rationale";
import type { DaySlot } from "@/lib/week-plan/types";

/**
 * Desktop-only week row (3a): the week strip plus this week's volume against
 * the athlete's own target. Hidden below lg, where the week belongs to Train
 * and Today stays a single column.
 *
 * `hoursTarget` is the same derived, race/ceiling-aware figure /train's
 * WeekRationale shows (both come from assembleWeeklyTarget — final-review
 * Finding I5), not the plan's raw typed hoursPerWeek. When there is no
 * active plan or no open week, the caller passes null and the row shows the
 * hours done and claims no target rather than inventing a denominator.
 */
export function WeekRow({
  days,
  hoursDone,
  hoursTarget,
}: {
  days: DaySlot[] | null;
  hoursDone: number;
  hoursTarget: number | null;
}) {
  if (!days || days.length === 0) return null;

  const onTrack =
    hoursTarget != null && hoursTarget > 0
      ? hoursDone >= hoursTarget * 0.9
      : null;

  return (
    <section className="hidden items-center gap-5 rounded-[20px] border border-hairline bg-surface-raised px-5 py-3 lg:flex">
      <span className="shrink-0 text-label font-bold uppercase tracking-[0.14em] text-ink-muted">
        This week
      </span>

      <div className="min-w-0 flex-1">
        <WeekStrip days={days} />
      </div>

      <span className="shrink-0 text-caption text-ink-secondary">
        <strong className="font-numeric font-bold text-ink-primary">
          {hoursDone.toFixed(1)}h
        </strong>
        {hoursTarget != null && ` of ${fmt(hoursTarget)} target`}
        {onTrack != null && (
          <span
            className={`ml-1.5 font-bold ${onTrack ? "text-chart-2" : "text-chart-3"}`}
          >
            · {onTrack ? "on track" : "behind"}
          </span>
        )}
        <Link
          href="/train?tab=week"
          className="ml-2 font-bold text-accent hover:text-ink-primary"
        >
          Train →
        </Link>
      </span>
    </section>
  );
}

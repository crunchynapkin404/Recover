import Link from "next/link";
import { WeekStrip } from "@/components/week/week-strip";
import { fmt } from "@/components/week/week-rationale";
import type { DaySlot } from "@/lib/week-plan/types";

/**
 * Desktop-only week row (3a): the week strip plus this week's volume against
 * the athlete's own target. Hidden below lg, where the week belongs to Train
 * and Today stays a single column.
 *
 * STACKED, NOT SIDE BY SIDE, and that is measured rather than taste. This
 * row lives in the 7fr half of Today's morning grid, inside a max-w-6xl
 * container behind a 216px sidebar, so its inner width tops out at 572px and
 * shrinks to 373px at lg (1024px). One line needs 84px of label + 215px of
 * strip (its min-content: seven "Mo"…"Su" columns, their gaps, and the
 * bubble's own padding) + 243px of summary + 40px of gaps = 582px — over
 * budget at EVERY desktop width, by 10px at 1440 and by 209px at 1024.
 * The strip was the flex-1, so it absorbed the whole deficit: at 1024 its
 * bordered bubble rendered 42px wide with 0px of content box while the seven
 * days spanned 173px, spilling 152px past its own right border and over the
 * volume summary. Giving the strip its own full-width line is the only
 * layout that fits the days inside their bubble at 1024, and it leaves the
 * summary 277px on the header line where it needs 243px.
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

  const hasTarget = hoursTarget != null && hoursTarget > 0;
  const onTrack = hasTarget ? hoursDone >= hoursTarget * 0.9 : null;

  return (
    <section className="hidden flex-col gap-3 rounded-[20px] glass glass-no-hover px-5 py-4 lg:flex">
      <div className="flex items-baseline justify-between gap-4">
        <span className="shrink-0 text-label font-bold uppercase tracking-[0.14em] text-ink-muted">
          This week
        </span>

        <span className="text-right text-caption text-ink-secondary">
          <strong className="font-numeric font-bold text-ink-primary">
            {hoursDone.toFixed(1)}h
          </strong>
          {hasTarget && ` of ${fmt(hoursTarget)} target`}
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
      </div>

      <WeekStrip days={days} />
    </section>
  );
}

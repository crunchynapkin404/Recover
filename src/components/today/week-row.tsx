import Link from "next/link";
import { WeekStrip } from "@/components/plan/week-strip";
import type { DaySlot } from "@/lib/week-plan/types";

/**
 * Desktop-only week row (3a): the week strip plus this week's volume against
 * the athlete's own target. Hidden below lg, where the week belongs to Train
 * and Today stays a single column.
 *
 * The target is the plan's stated hours per week; when the plan doesn't
 * state one, the row shows the hours done and claims no target rather than
 * inventing a denominator.
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
    <section className="mb-6 hidden items-center gap-5 rounded-[20px] border border-white/[0.08] bg-white/[0.03] px-5 py-3 lg:flex">
      <span className="shrink-0 text-[9.5px] font-bold uppercase tracking-[0.15em] text-white/40">
        This week
      </span>

      <div className="min-w-0 flex-1">
        <WeekStrip days={days} />
      </div>

      <span className="shrink-0 text-[11px] text-white/50">
        <strong className="font-bold text-white/85">
          {hoursDone.toFixed(1)}h
        </strong>
        {hoursTarget != null && ` of ${hoursTarget}h target`}
        {onTrack != null && (
          <span
            className={`ml-1.5 font-bold ${onTrack ? "text-emerald-400" : "text-amber-400"}`}
          >
            · {onTrack ? "on track" : "behind"}
          </span>
        )}
        <Link
          href="/train?tab=week"
          className="ml-2 font-bold text-white/60 hover:text-white"
        >
          Train →
        </Link>
      </span>
    </section>
  );
}

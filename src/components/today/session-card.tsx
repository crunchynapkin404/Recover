import type { DaySlot } from "@/lib/week-plan/types";
import {
  DayActions,
  type DayActionsOtherDay,
} from "@/components/plan/day-actions";
import { MarkDoneButton } from "./mark-done-button";

interface Props {
  /** Today's slot from the open week; null → render nothing. */
  slot: DaySlot | null;
  /** Latest adjustment reason, quoted verbatim; null → no note. */
  adjustmentReason: string | null;
  /** Other days in the open week, for the move/swap targets. */
  otherDays: DayActionsOtherDay[];
}

/**
 * Today's session (2a) — restyled from TodayCard to the tighter rounded-[20px]
 * surface. The action row is "Mark done" plus the real DayActions server
 * actions (move / swap / skip). The mockup's "Shrink" still has no backing
 * action — adaptDay owns scaling, and there is no athlete-facing one — so it
 * is intentionally not faked here.
 */
export function SessionCard({ slot, adjustmentReason, otherDays }: Props) {
  if (!slot) return null;
  const w = slot.workout;
  return (
    <section className="mb-6 rounded-[20px] border border-white/10 bg-white/5 p-4">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/40">
          Today&apos;s session
        </span>
        {w != null && (
          <span className="rounded-full border border-white/10 px-3 py-1 text-[10.5px] font-bold text-white/80">
            {w.intensity}
          </span>
        )}
      </div>

      {w != null ? (
        <>
          <p className="text-[18px] font-bold text-white">
            {`${w.type} · ${w.durationMins} min`}
          </p>
          {w.description && (
            <p className="mt-1 text-[12.5px] text-white/60">{w.description}</p>
          )}
        </>
      ) : (
        <p className="text-[18px] font-bold text-white/50">Rest</p>
      )}

      {adjustmentReason != null && (
        <div data-adjustment className="mt-3 rounded-xl bg-white/[0.04] p-2">
          <p className="text-[11.5px] leading-snug text-amber-400/85">
            ↻ {adjustmentReason}
          </p>
        </div>
      )}

      {w != null &&
        (slot.status === "completed" ? (
          <p className="mt-3 border-t border-white/5 pt-3 text-[11px] font-bold text-emerald-400">
            ✓ Done
          </p>
        ) : (
          <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-white/5 pt-3">
            <MarkDoneButton date={slot.date} />
            <DayActions
              day={{ date: slot.date, hasWorkout: true }}
              otherDays={otherDays}
              bare
            />
          </div>
        ))}
    </section>
  );
}

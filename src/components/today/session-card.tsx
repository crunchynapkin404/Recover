import type { DaySlot } from "@/lib/week-plan/types";
import {
  DayActions,
  type DayActionsOtherDay,
} from "@/components/plan/day-actions";

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
 * surface. The action row reuses the real DayActions server actions
 * (move / swap / skip); the mockup's "Mark done" / "Shrink" have no backing
 * server action in v0.20, so they are intentionally not faked here.
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

      {w != null && (
        <DayActions
          day={{ date: slot.date, hasWorkout: true }}
          otherDays={otherDays}
        />
      )}
    </section>
  );
}

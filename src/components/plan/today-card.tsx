import type { DaySlot } from "@/lib/week-plan/types";

interface Props {
  /** Today's slot from the open week; null → render nothing. */
  slot: DaySlot | null;
  /** Today's latest adjustment reason, quoted verbatim; null → no footer. */
  adjustmentReason: string | null;
}

export function TodayCard({ slot, adjustmentReason }: Props) {
  if (!slot) return null;
  const w = slot.workout;
  return (
    <div className="glass rounded-[2rem] p-7">
      <div className="mb-4 flex items-center justify-between">
        <span className="label-micro">Today</span>
        {w != null && (
          <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] font-bold text-white/80">
            {w.intensity}
          </span>
        )}
      </div>

      {w != null ? (
        <>
          <p className="text-xl font-bold text-white">
            {`${w.type} · ${w.durationMins} min`}
          </p>
          <p className="mt-1 text-[13px] text-white/60">{w.description}</p>
        </>
      ) : (
        <p className="text-xl font-bold text-white">Rest</p>
      )}

      {adjustmentReason != null && (
        <div
          data-adjustment
          className="mt-4 rounded-2xl border border-white/5 bg-white/5 p-3"
        >
          <p className="text-[12px] text-white/60">↻ {adjustmentReason}</p>
        </div>
      )}
    </div>
  );
}

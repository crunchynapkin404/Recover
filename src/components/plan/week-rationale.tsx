/**
 * Why this week looks the way it does.
 *
 * Every reason here was already being written to `plan_adjustments` — the
 * engine has always logged its own arithmetic accurately. It was simply never
 * shown, which is why an unexpectedly small week reads as a bug instead of a
 * recovery week following a missed one.
 */
interface Props {
  reasons: string[];
  targetHours: number | null;
  plannedHours: number | null;
  /** From weeklyTargetHours: set when availability capped the target. */
  shortfall: { wantedHours: number; offeredHours: number } | null;
  /** Name of the event being trained for, for the shortfall sentence. */
  raceName: string | null;
}

function fmt(hours: number): string {
  return Number.isInteger(hours) ? `${hours}h` : `${hours.toFixed(1)}h`;
}

/** "a 6h target" but "an 11h target". */
function article(hours: number): string {
  return fmt(hours).startsWith("8") || fmt(hours).startsWith("11") ? "an" : "a";
}

export function WeekRationale({
  reasons,
  targetHours,
  plannedHours,
  shortfall,
  raceName,
}: Props) {
  if (reasons.length === 0 && targetHours == null && shortfall == null) {
    return null;
  }

  return (
    <div className="glass mt-4 rounded-[1.5rem] p-5">
      <p className="label-micro mb-2">Why this week</p>
      {plannedHours != null && targetHours != null && (
        <p className="mb-2 text-[12.5px] text-white/70">
          {`${fmt(plannedHours)} planned against ${article(targetHours)} ${fmt(
            targetHours
          )} target.`}
        </p>
      )}
      {shortfall && (
        <p className="mb-2 text-[12.5px] text-white/70">
          {`${raceName ?? "Your event"} asks about ${fmt(
            shortfall.wantedHours
          )} a week. Your calendar offers ${fmt(
            shortfall.offeredHours
          )} — enough to ride it, not race it.`}
        </p>
      )}
      <ul className="space-y-1">
        {reasons.map((reason) => (
          <li
            key={reason}
            className="text-[11.5px] leading-relaxed text-white/55"
          >
            {reason}
          </li>
        ))}
      </ul>
    </div>
  );
}

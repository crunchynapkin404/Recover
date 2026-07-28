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

/**
 * "a 6h target" but "an 11h target" — English reads the number's leading
 * digits as a word, and picks the article off that word's sound, not off the
 * digit itself. "8" ("eight"), "11" ("eleven") and "18" ("eighteen") all
 * start with a vowel sound; `startsWith("18")` also covers 180-189 ("a
 * hundred eighty-…") for the same reason, and `startsWith("8")` already
 * covers 80-89 ("eighty-…") and `startsWith("11")` already covers 110-119
 * ("a hundred eleven-…"). A realistic stage race lands 15-19h/week (see
 * race/demand.test.ts) — squarely the range this component exists to show —
 * so 18 is not a contrived case.
 */
function article(hours: number): string {
  const s = fmt(hours);
  return s.startsWith("8") || s.startsWith("11") || s.startsWith("18")
    ? "an"
    : "a";
}

/** Below this, "the calendar offers Xh" reads as a real number instead of a
 * rounding artifact of zero, so the honest "no time at all" wording applies. */
const NO_AVAILABILITY_EPSILON = 0.05;

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
          {shortfall.offeredHours < NO_AVAILABILITY_EPSILON
            ? `${raceName ?? "Your event"} asks about ${fmt(
                shortfall.wantedHours
              )} a week. Your calendar offered no time at all this week.`
            : `${raceName ?? "Your event"} asks about ${fmt(
                shortfall.wantedHours
              )} a week. Your calendar offers ${fmt(
                shortfall.offeredHours
              )} — enough to ride it, not race it.`}
        </p>
      )}
      <ul className="space-y-1">
        {reasons.map((reason, i) => (
          <li key={i} className="text-[11.5px] leading-relaxed text-white/55">
            {reason}
          </li>
        ))}
      </ul>
    </div>
  );
}

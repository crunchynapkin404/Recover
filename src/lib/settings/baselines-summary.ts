/**
 * The badge on the collapsed "Your baselines" section.
 *
 * Built from what IS set AND what is missing, which is the whole change.
 * The old version listed `wakeTime · maxHr · ftpWatts` only, so an athlete
 * with FTP set and no threshold pace read "FTP 250" and stopped looking —
 * and counted in production on 2026-09-02 that was every user there, because
 * nobody has ever set a threshold pace. A summary that can only list present
 * values can never say "not here", which is exactly the answer that saves
 * opening six drawers one at a time. That is the IA inventory's own
 * diagnosis: "the accordion labels do not predict their contents well enough
 * to open only one" (docs/2026-08-26-ia-inventory.md).
 *
 * Wake time and max HR are NOT reported as missing, and the asymmetry is
 * deliberate. They degrade gracefully — no bedtime is shown, unlabelled
 * sessions count as easy time. The two anchors do not: without them every
 * race figure is Low by construction, which is a different kind of absence.
 *
 * Lives outside page.tsx so it can be tested without mocking Postgres — the
 * same reasoning section-order.test.ts gives for reading source instead of
 * rendering an async server component.
 */
export interface BaselinesRow {
  wakeTime: string | null;
  maxHr: number | null;
  ftpWatts: number | null;
  thresholdPaceSecPerKm: number | null;
}

/** Seconds per km → the mm:ss/km a runner actually reads. */
export function formatPace(secPerKm: number): string {
  const mins = Math.floor(secPerKm / 60);
  const secs = Math.round(secPerKm % 60);
  return `${mins}:${String(secs).padStart(2, "0")}/km`;
}

export function baselinesSummary(
  row: BaselinesRow | null | undefined
): string {
  const set = [
    row?.wakeTime ? `wake ${row.wakeTime}` : null,
    row?.maxHr ? `max HR ${row.maxHr}` : null,
    row?.ftpWatts ? `FTP ${row.ftpWatts}` : null,
    row?.thresholdPaceSecPerKm
      ? `pace ${formatPace(row.thresholdPaceSecPerKm)}`
      : null,
  ].filter((p): p is string => p !== null);

  // Nothing at all set is "not set". Listing two absences on an empty
  // account states a gap the athlete has not yet had a chance to fill.
  if (set.length === 0) return "not set";

  const missing = [
    row?.ftpWatts ? null : "no FTP",
    row?.thresholdPaceSecPerKm ? null : "no run pace",
  ].filter((p): p is string => p !== null);

  return [...set, ...missing].join(" · ");
}

/**
 * One vocabulary for sport, across two that disagree.
 *
 * The planner speaks in `Bike` / `Run` / `Swim` — the values
 * `generateWorkouts` stamps onto a `PlannedWorkout`. Providers speak their own
 * discipline names: Strava and intervals.icu both store a bike ride as `Ride`
 * (or `VirtualRide`, `GravelRide`, …). Nothing translated between them, so the
 * completion matcher in `week-plan/service.ts` compared `"Bike"` to `"Ride"`
 * with `eq()` and never matched — across 219 live rides, not one planned
 * cycling session was ever recorded as done. Every week therefore closed with
 * `actualLoad` 0, `effectiveWeekLoad` read that as "fully missed", and restarted
 * the next week at 60% of its skeleton target. Compounding weekly.
 *
 * Runners were unaffected (`"Run"` === `"Run"`), which is why it survived
 * review: the bug is invisible unless you ride.
 *
 * Pure and dependency-free so both the matcher and its tests can use it.
 */

/** Provider discipline → the planner's sport. Lower-cased keys. */
const CANONICAL: Record<string, string> = {
  // Cycling
  ride: "Bike",
  virtualride: "Bike",
  gravelride: "Bike",
  mountainbikeride: "Bike",
  ebikeride: "Bike",
  handcycle: "Bike",
  velomobile: "Bike",
  bike: "Bike",
  cycling: "Bike",
  // Running
  run: "Run",
  virtualrun: "Run",
  trailrun: "Run",
  running: "Run",
  // Swimming
  swim: "Swim",
  openwaterswim: "Swim",
  swimming: "Swim",
};

/**
 * The planner's name for a sport, given any provider's name for it.
 *
 * Unknown disciplines pass through unchanged rather than being forced into the
 * nearest training sport: the live table also holds `Workout`, `Walk` and
 * `Tennis`, and booking a tennis match as a completed ride would be worse than
 * booking nothing. An unmapped sport simply never matches a planned session,
 * which is the honest outcome.
 */
export function canonicalSport(raw: string | null | undefined): string {
  if (!raw) return "";
  const key = raw.trim().toLowerCase();
  return CANONICAL[key] ?? raw.trim();
}

/**
 * Does this activity satisfy a session planned for `plannedSport`?
 *
 * Both sides are canonicalised, so the comparison is between two planner
 * sports — never between a planner sport and a provider one. Empty/missing on
 * either side is never a match: "we don't know what this was" must not
 * complete a session.
 */
/**
 * Every lower-cased provider discipline that counts as `plannedSport`.
 *
 * The completion matcher filters activities in SQL, where it cannot call
 * `sportMatches` per row — it compares `lower(activities.sport)` against this
 * list instead. Derived from the same table, so the two can never drift; a test
 * asserts every alias returned here also satisfies `sportMatches`.
 *
 * An empty result means "match nothing", which is what an unknown or missing
 * planned sport should do.
 */
export function providerSportAliases(
  plannedSport: string | null | undefined
): string[] {
  const canonical = canonicalSport(plannedSport);
  if (canonical === "") return [];
  const aliases = Object.entries(CANONICAL)
    .filter(([, target]) => target === canonical)
    .map(([raw]) => raw);
  // A sport with no entries in the table (e.g. "Tennis") still matches itself.
  return aliases.length > 0 ? aliases : [canonical.toLowerCase()];
}

export function sportMatches(
  plannedSport: string | null | undefined,
  activitySport: string | null | undefined
): boolean {
  const planned = canonicalSport(plannedSport);
  const actual = canonicalSport(activitySport);
  if (planned === "" || actual === "") return false;
  return planned === actual;
}

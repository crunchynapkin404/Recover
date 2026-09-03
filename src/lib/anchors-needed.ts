/**
 * Which anchors is this athlete missing, that they actually need?
 *
 * A SECOND predicate beside isFirstRun(), deliberately not a widening of it.
 * isFirstRun() answers "has this athlete got nothing at all", and returns
 * false the moment a connection goes active — correct for its own question,
 * and exactly why nobody is ever asked for a number. Counted in production
 * on 2026-09-02: one user of three has a body_prefs row, and NOBODY has a
 * threshold pace, so every run figure is Low by construction. One of those
 * users has two active connections and 18 activities and has never been
 * shown the first-run treatment, because they connected something.
 *
 * Widening isFirstRun() to demand anchors would put "Connect a device to
 * begin" in front of an athlete with 64 rides. Two questions, two resolvers
 * — the same "one resolver, not two" reasoning first-run.ts's header gives,
 * applied per question rather than per topic.
 *
 * SPORT IS GATED, and that is the point rather than a refinement. Asking a
 * pure cyclist for a threshold pace is the same class of error as inventing
 * a wake time, which body_prefs' own schema comment records v0.9.0 removing:
 * "a guessed wake time would put an invented bedtime on the dashboard".
 */
import { db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";
import { canonicalSport } from "@/lib/canonical-sport";

export interface MissingAnchors {
  /** Rides, and no athlete-set OUTDOOR FTP. */
  ftp: boolean;
  /** Runs, and no threshold pace. */
  pace: boolean;
  /** Has said "not now" — the prompt stops, the badge does not. */
  dismissed: boolean;
}

/** Nothing missing. Named so callers can express "don't ask" explicitly. */
export const NO_ANCHORS_MISSING: MissingAnchors = {
  ftp: false,
  pace: false,
  dismissed: false,
};

export async function missingAnchors(userId: string): Promise<MissingAnchors> {
  const [prefs, activities] = await Promise.all([
    db.query.bodyPrefs.findFirst({
      where: eq(schema.bodyPrefs.userId, userId),
      columns: {
        ftpWatts: true,
        thresholdPaceSecPerKm: true,
        anchorPromptDismissedAt: true,
      },
    }),
    // Sport only, and not windowed. The question is "does this athlete ride
    // or run at all", so history counts for ever — the same "ever, not
    // recently" reading isFirstRun() settled on, for the same reason: an
    // athlete who ran all last year and is building back still needs a
    // threshold pace before their figures stop saying Low.
    db.query.activities.findMany({
      where: eq(schema.activities.userId, userId),
      columns: { sport: true },
    }),
  ]);

  // NEVER compare `a.sport` directly. Providers store their own discipline
  // names — a ride is "Ride", "VirtualRide" or "GravelRide", never "Bike" —
  // and a raw comparison against the planner's vocabulary matches nothing.
  // See canonical-sport.ts: that mismatch cost 219 live rides, and was
  // invisible in review because runners were unaffected.
  const sports = new Set(activities.map((a) => canonicalSport(a.sport)));

  return {
    // ftpWattsIndoor deliberately does NOT satisfy this. Its schema comment
    // is explicit that it is a fallback anchor and "can never mean 'use it
    // for race day' directly" — which is the figure the prompt is about.
    ftp: sports.has("Bike") && prefs?.ftpWatts == null,
    pace: sports.has("Run") && prefs?.thresholdPaceSecPerKm == null,
    dismissed: prefs?.anchorPromptDismissedAt != null,
  };
}

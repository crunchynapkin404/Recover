import { describe, expect, it } from "vitest";
import {
  longestRideHoursOf,
  weeklyHoursByWeek,
} from "@/lib/week-plan/volume-inputs";

// weeklyHoursByWeek is the pure half of this module and is exported for
// exactly this reason: the DB half needs a database, this does not.
describe("weeklyHoursByWeek", () => {
  const iso = (d: string) => new Date(d + "T10:00:00Z");

  it("buckets activities into Monday-first weeks, oldest first", () => {
    const out = weeklyHoursByWeek(
      [
        { provider: "strava", startDate: iso("2026-07-20"), durationS: 3600 },
        { provider: "strava", startDate: iso("2026-07-21"), durationS: 3600 },
        { provider: "strava", startDate: iso("2026-07-27"), durationS: 7200 },
      ],
      new Date("2026-08-02T10:00:00Z"),
      2
    );
    expect(out).toEqual([2, 2]);
  });

  it("counts a ride synced by two providers once", () => {
    const out = weeklyHoursByWeek(
      [
        {
          provider: "intervals_icu",
          startDate: iso("2026-07-27"),
          durationS: 7200,
        },
        { provider: "strava", startDate: iso("2026-07-27"), durationS: 7200 },
      ],
      new Date("2026-08-02T10:00:00Z"),
      1
    );
    expect(out).toEqual([2]);
  });

  it("emits a zero for a week with no activity, never a gap", () => {
    const out = weeklyHoursByWeek(
      [{ provider: "strava", startDate: iso("2026-07-27"), durationS: 3600 }],
      new Date("2026-08-02T10:00:00Z"),
      3
    );
    expect(out).toHaveLength(3);
    expect(out[0]).toBe(0);
    expect(out[2]).toBe(1);
  });
});

// longestRideHoursOf is the other half of the pure, DB-free surface — same
// dedup contract as weeklyHoursByWeek, but reducing to a max instead of a
// per-week sum.
describe("longestRideHoursOf", () => {
  const iso = (d: string) => new Date(d + "T10:00:00Z");

  it("the longest ride wins", () => {
    const out = longestRideHoursOf([
      { provider: "strava", startDate: iso("2026-07-01"), durationS: 3600 },
      { provider: "strava", startDate: iso("2026-07-15"), durationS: 10800 },
      { provider: "strava", startDate: iso("2026-07-20"), durationS: 7200 },
    ]);
    expect(out).toBe(3);
  });

  it("returns null for an empty history", () => {
    expect(longestRideHoursOf([])).toBeNull();
  });

  it("does not let a cross-provider duplicate be mistaken for a second, longer ride", () => {
    // Same physical ride, synced by two providers at the same instant with
    // slightly different reported durations (within dedupeActivities'
    // DEDUP_DURATION_TOLERANCE) — a real GPS-sync discrepancy, not two
    // rides. dedupeActivities prefers intervals_icu over strava, so the
    // surviving duration is intervals_icu's 7100s (1.9722h), NOT strava's
    // longer 7200s (2h). A version that skipped deduplication would see
    // three raw activities and hand back strava's 7200s as "the longest
    // ride," silently treating the duplicate sync as an independent, longer
    // ride than the one that actually happened.
    const dupStart = iso("2026-07-20");
    const out = longestRideHoursOf([
      { provider: "intervals_icu", startDate: dupStart, durationS: 7100 },
      { provider: "strava", startDate: dupStart, durationS: 7200 },
      // Genuinely distinct, shorter ride — confirms the duplicate pair, not
      // this one, drives the result.
      { provider: "strava", startDate: iso("2026-06-01"), durationS: 3600 },
    ]);
    expect(out).toBe(7100 / 3600);
  });
});

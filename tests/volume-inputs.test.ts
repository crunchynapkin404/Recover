import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  longestRideHoursOf,
  weeklyHoursByWeek,
} from "@/lib/week-plan/volume-inputs";
import { athleteLevel } from "@/lib/athlete-level";
import { weeklyTargetHours } from "@/lib/week-plan/volume";

const hasDb =
  !!process.env.DATABASE_URL && process.env.DATABASE_DRIVER === "pg";

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

  // Final-review CRITICAL: weeklyHoursByWeek([], ...) never returns [] — it
  // fills a full-length array of zeros, same as the CTL bucket loop in
  // assembleVolumeInputs. Every prior null-ceiling test in athlete-level.test
  // and volume.test.ts supplied `[]` or `null` by hand, a shape the real
  // producer can never emit, so the "no measured ceiling suppresses race
  // demand" guard in weeklyTargetHours was never actually exercised by
  // anything resembling production data. This test drives the real producer
  // and follows its output through athleteLevel into weeklyTargetHours to
  // prove the whole chain: a no-history athlete with an upcoming race must
  // get the plan's fallback hours, not a target of 0.
  it("feeds a no-history athlete's real output into weeklyTargetHours and gets the fallback, not 0", () => {
    const now = new Date("2026-08-02T10:00:00Z");
    const hours = weeklyHoursByWeek([], now, 12);
    expect(hours).toHaveLength(12);
    expect(hours.every((h) => h === 0)).toBe(true);

    const level = athleteLevel({
      weeklyHoursByWeek: hours,
      ctlByWeek: new Array(12).fill(0),
      override: null,
    });
    expect(level.ceilingHours).toBeNull();
    expect(level.floorHours).toBeNull();

    const target = weeklyTargetHours({
      // An upcoming race with a distance on file — the exact combination
      // that, with a measured ceiling, would drive the target off race
      // demand instead.
      raceDemandHours: 11,
      ceilingHours: level.ceilingHours,
      floorHours: level.floorHours,
      availabilityHours: 12.5,
      fallbackHours: 10, // the plan's own hoursPerWeek
    });
    expect(target.hours).toBe(10);
    expect(target.source).toBe("fallback");
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

// assembleWeeklyTarget is the shared producer added for final-review Finding
// I5: before it existed, the dashboard's WeekRow showed the plan's raw typed
// constraints.hoursPerWeek while /train's WeekRationale showed the derived,
// race/ceiling-aware figure — same athlete, same week, two different
// numbers. Both surfaces now call this one function, so this suite pins its
// actual DB-backed behaviour (not a literal) rather than trusting the two
// call sites to independently reimplement the same arithmetic correctly.
describe.skipIf(!hasDb)("assembleWeeklyTarget", () => {
  const USER = "test-volume-inputs-weekly-target-user";

  async function cleanup() {
    const { db, schema } = await import("@/lib/db");
    await db.delete(schema.users).where(eq(schema.users.id, USER));
  }

  beforeAll(async () => {
    await cleanup();
    const { db, schema } = await import("@/lib/db");
    await db.insert(schema.users).values({
      id: USER,
      name: "WeeklyTargetTest",
      email: `${USER}@example.invalid`,
      role: "member",
    });

    // A single 10h ride inside the rolling peak window gives peakHours=10,
    // so ceilingHours = 10 * HEADROOM(1.3) = 13 — comfortably above the 9h
    // race demand seeded below, so the target is race-driven rather than
    // ceiling-clamped.
    await db.insert(schema.activities).values({
      userId: USER,
      provider: "intervals_icu",
      externalId: "weekly-target-peak-ride",
      sport: "Ride",
      startDate: new Date(),
      durationS: 10 * 3600,
    });

    // eventDemand refuses to compute anything without an FTP.
    await db.insert(schema.bodyPrefs).values({
      userId: USER,
      ftpWatts: 200,
    });

    const raceDate = new Date();
    raceDate.setDate(raceDate.getDate() + 60);
    await db.insert(schema.races).values({
      userId: USER,
      name: "Weekly Target Test Race",
      raceType: "gran fondo",
      date: raceDate.toISOString().slice(0, 10),
      priority: "A",
      status: "upcoming",
      eventDays: 1,
      distanceKm: 150,
      elevationM: 2000,
      // The override pins weeklyHours to an exact, hand-verifiable figure —
      // sidesteps estimateRidingHours' FTP/mass physics so the expected
      // value here isn't a second copy of that formula.
      demandHoursOverride: 9,
    });
  });

  afterAll(cleanup);

  it("derives the target from race demand, never the plan's raw hoursPerWeek — the number both / and /train must show", async () => {
    const { assembleWeeklyTarget } =
      await import("@/lib/week-plan/volume-inputs");

    const planHoursPerWeek = 5; // distinct from the 9h the race asks for
    const availabilityHours = 15; // above 9h, so no shortfall clamp

    const result = await assembleWeeklyTarget(USER, new Date(), {
      availabilityHours,
      planHoursPerWeek,
    });

    expect(result.target.hours).toBe(9);
    expect(result.target.source).toBe("race");
    expect(result.target.shortfall).toBeNull();
    // The whole point of Finding I5: this must NOT be the plan's typed
    // figure — that was the dashboard's pre-fix behaviour.
    expect(result.target.hours).not.toBe(planHoursPerWeek);
    expect(result.targetRace?.name).toBe("Weekly Target Test Race");
  });

  it("is deterministic across independent calls with the same inputs — the guarantee that lets / and /train call it separately and never disagree", async () => {
    const { assembleWeeklyTarget } =
      await import("@/lib/week-plan/volume-inputs");
    const input = { availabilityHours: 15, planHoursPerWeek: 5 };
    const now = new Date();

    // Simulates the dashboard's call...
    const fromDashboard = await assembleWeeklyTarget(USER, now, input);
    // ...and /train's independent call in the same request cycle.
    const fromTrainPage = await assembleWeeklyTarget(USER, now, input);

    expect(fromTrainPage.target).toEqual(fromDashboard.target);
  });

  it("still falls back to the plan's hoursPerWeek when there is no race demand or ceiling — unchanged pre-branch behaviour", async () => {
    const { assembleWeeklyTarget } =
      await import("@/lib/week-plan/volume-inputs");
    const { db, schema } = await import("@/lib/db");

    // A second user with no activities and no races: no ceiling, no demand.
    const NO_HISTORY_USER = "test-volume-inputs-weekly-target-no-history";
    await db.delete(schema.users).where(eq(schema.users.id, NO_HISTORY_USER));
    await db.insert(schema.users).values({
      id: NO_HISTORY_USER,
      name: "NoHistoryTest",
      email: `${NO_HISTORY_USER}@example.invalid`,
      role: "member",
    });

    try {
      const result = await assembleWeeklyTarget(NO_HISTORY_USER, new Date(), {
        availabilityHours: 10,
        planHoursPerWeek: 7,
      });
      expect(result.target.hours).toBe(7);
      expect(result.target.source).toBe("fallback");
    } finally {
      await db.delete(schema.users).where(eq(schema.users.id, NO_HISTORY_USER));
    }
  });
});

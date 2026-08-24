import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { assembleVolumeInputs, longestSessionHoursOf } from "./volume-inputs";

// requires Postgres; skips without DATABASE_URL.
const hasDb =
  !!process.env.DATABASE_URL && process.env.DATABASE_DRIVER === "pg";

describe("longestSessionHoursOf", () => {
  const act = (sport: string, hours: number, day: number) => ({
    provider: "intervals_icu",
    sport,
    startDate: new Date(2026, 6, day),
    durationS: hours * 3600,
  });

  it("ignores sessions outside the race's disciplines", () => {
    // F3b: before v0.46 this returned the longest activity of ANY kind, so a
    // triathlete's marathon readiness was answered by their longest bike ride.
    const longest = longestSessionHoursOf(
      [act("Ride", 6, 1), act("Run", 2, 2)],
      ["Run"]
    );
    expect(longest).toBe(2);
  });

  it("counts every discipline of a triathlon", () => {
    expect(
      longestSessionHoursOf(
        [act("Ride", 6, 1), act("Run", 2, 2), act("Swim", 1, 3)],
        ["Swim", "Bike", "Run"]
      )
    ).toBe(6);
  });

  it("canonicalises the provider's word before comparing", () => {
    // "Bike".includes("Ride") is false for every cyclist who has ever used
    // this app — the mistake plan-sport.ts:166-173 already warns about.
    expect(longestSessionHoursOf([act("Ride", 6, 1)], ["Bike"])).toBe(6);
  });

  it("returns null when no session matches, rather than zero", () => {
    expect(longestSessionHoursOf([act("Ride", 6, 1)], ["Run"])).toBeNull();
  });
});

// v0.92 Part 1: a manual-only athlete (no intervals.icu connection) has real,
// computed daily_metrics.ctl but empty wellness_daily.ctl — wellness_daily is
// provider-only (see metrics.ts:43-45). Before the fix, ctlBuckets read
// wellness_daily, so this athlete's CTL history looked like an all-zero
// window, peakOf() correctly refused to call that a measurement, and
// athleteLevel() stayed "calibrating" forever despite Recover having known
// their CTL the whole time.
describe.skipIf(!hasDb)("assembleVolumeInputs — CTL source (v0.92)", () => {
  const USER = "test-volume-inputs-manual-only-user";

  // Fixed reference date so the test is deterministic regardless of when it
  // runs, and comfortably inside the 12-week (84-day) PEAK_WINDOW.
  const now = new Date(2026, 7, 10);
  const daysAgo = (n: number) => {
    const d = new Date(now);
    d.setDate(d.getDate() - n);
    return d;
  };
  const ymd = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

  beforeAll(async () => {
    await db
      .insert(schema.users)
      .values({
        id: USER,
        name: "Volume Inputs Manual-Only Test",
        email: `${USER}@example.test`,
      })
      .onConflictDoNothing();

    // Real training hours, spread across three distinct weeks inside the
    // 12-week window, so peakHours resolves to a real (non-null) value.
    await db.insert(schema.activities).values(
      [42, 28, 14].map((n, i) => ({
        userId: USER,
        provider: "manual" as const,
        externalId: `volume-inputs-manual-only-act-${i}`,
        sport: "Ride",
        startDate: daysAgo(n),
        startDateLocal: daysAgo(n),
        durationS: 5 * 3600,
      }))
    );

    // The resolved authority: real, computed CTL — this is what an athlete
    // with no provider connection still has, because Recover's native
    // engine fills the gap (metrics.ts:43-45).
    await db.insert(schema.dailyMetrics).values(
      [42, 28, 14].map((n, i) => ({
        userId: USER,
        date: ymd(daysAgo(n)),
        ctl: 40 + i * 5, // 40, 45, 50 — peak 50, inside the CTL_BANDS "amateur" band
        atl: 20 + i * 2,
        loadSource: "computed" as const,
      }))
    );

    // wellness_daily rows EXIST for the same days (e.g. from a manual body-
    // weight entry) but carry no ctl/atl — exactly what a no-connection
    // athlete's provider-only columns look like: present rows, empty load
    // fields, never populated because there is no intervals.icu sync.
    await db.insert(schema.wellnessDaily).values(
      [42, 28, 14].map((n) => ({
        userId: USER,
        date: ymd(daysAgo(n)),
        ctl: null,
        atl: null,
      }))
    );
  });

  afterAll(async () => {
    await db
      .delete(schema.activities)
      .where(eq(schema.activities.userId, USER));
    await db
      .delete(schema.dailyMetrics)
      .where(eq(schema.dailyMetrics.userId, USER));
    await db
      .delete(schema.wellnessDaily)
      .where(eq(schema.wellnessDaily.userId, USER));
    await db.delete(schema.users).where(eq(schema.users.id, USER));
  });

  it("levels a manual-only athlete from daily_metrics.ctl, not the empty wellness_daily.ctl", async () => {
    const result = await assembleVolumeInputs(USER, now);

    // Before the fix: source is "calibrating" and level is null, because
    // ctlBuckets read wellness_daily (all null) and peakOf() treats an
    // all-zero window as "no measurement" — not this athlete's true state.
    expect(result.level.source).not.toBe("calibrating");
    expect(result.level.level).not.toBeNull();
    expect(result.level.source).toBe("computed");
  });
});

describe.skipIf(!hasDb)("assembleVolumeInputs — indoor FTP fallback", () => {
  const USER = "test-volume-inputs-indoor-ftp-user";
  const now = new Date(2026, 7, 1);

  beforeAll(async () => {
    await db
      .insert(schema.users)
      .values({
        id: USER,
        name: "Volume Inputs Indoor FTP Test",
        email: `${USER}@example.test`,
      })
      .onConflictDoNothing();
    await db.insert(schema.races).values({
      userId: USER,
      name: "Test Gran Fondo",
      raceType: "gran_fondo",
      sport: "Bike",
      date: "2026-12-01",
      priority: "A",
      distanceKm: 130,
      elevationM: 4000,
    });
    await db.insert(schema.bodyPrefs).values({
      userId: USER,
      ftpWatts: null,
      ftpWattsIndoor: 235,
    });
  });

  afterAll(async () => {
    await db.delete(schema.races).where(eq(schema.races.userId, USER));
    await db.delete(schema.bodyPrefs).where(eq(schema.bodyPrefs.userId, USER));
    await db.delete(schema.users).where(eq(schema.users.id, USER));
  });

  it("uses indoor FTP for demand when outdoor is unset", async () => {
    const result = await assembleVolumeInputs(USER, now);
    expect(result.demand?.available).toBe(true);
    if (!result.demand?.available) return;
    expect(result.demand.confidence).toBe("low");
    expect(result.demand.confidenceReason).toMatch(/indoor/i);
  });
});

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { getRacesTool } from "./get-races";

// requires Postgres; skips without DATABASE_URL.
const hasDb =
  !!process.env.DATABASE_URL && process.env.DATABASE_DRIVER === "pg";

const USER = "test-get-races-demand-user";
const USER_NO_HISTORY = "test-get-races-no-anchor-user";
const USER_BIKE_SET = "test-get-races-bike-athlete-set-user";
const USER_TRI_SET = "test-get-races-tri-athlete-set-user";

describe.skipIf(!hasDb)("get_races demand provenance", () => {
  beforeAll(async () => {
    // Seed the user, a marathon 20 weeks out, and enough recent running to
    // derive a pace anchor but no body_prefs threshold pace — the "low
    // confidence" path.
    await db
      .insert(schema.users)
      .values({
        id: USER,
        name: "Get Races Demand Test",
        email: `${USER}@example.test`,
      })
      .onConflictDoNothing();

    const raceDate = new Date();
    raceDate.setDate(raceDate.getDate() + 20 * 7);
    const raceDateYmd = raceDate.toISOString().slice(0, 10);

    await db.insert(schema.races).values({
      userId: USER,
      name: "Get Races Demand Marathon",
      raceType: "marathon",
      sport: "Run",
      date: raceDateYmd,
      priority: "A",
      status: "upcoming",
      distanceKm: 42.2,
    });

    await db.insert(schema.activities).values({
      userId: USER,
      provider: "manual",
      externalId: `get-races-demand-anchor-${Date.now()}`,
      sport: "Run",
      startDate: new Date(Date.now() - 14 * 24 * 3600 * 1000),
      distanceM: 10_000,
      durationS: 2700, // 45:00 for 10 km — a usable Riegel reference.
    });

    // A SECOND user with the same race shape but zero running history.
    await db
      .insert(schema.users)
      .values({
        id: USER_NO_HISTORY,
        name: "Get Races No Anchor Test",
        email: `${USER_NO_HISTORY}@example.test`,
      })
      .onConflictDoNothing();

    await db.insert(schema.races).values({
      userId: USER_NO_HISTORY,
      name: "Get Races No Anchor Marathon",
      raceType: "marathon",
      sport: "Run",
      date: raceDateYmd,
      priority: "A",
      status: "upcoming",
      distanceKm: 42.2,
    });

    // A THIRD user with a Bike race and an athlete-SET FTP (body_prefs, not
    // synced/derived) — the "medium confidence" path. Its own user because
    // asserting a third outcome against USER or USER_NO_HISTORY's seed would
    // hit the same one-seed-two-assertions trap the comment above names.
    await db
      .insert(schema.users)
      .values({
        id: USER_BIKE_SET,
        name: "Get Races Bike Athlete-Set Test",
        email: `${USER_BIKE_SET}@example.test`,
      })
      .onConflictDoNothing();

    await db.insert(schema.races).values({
      userId: USER_BIKE_SET,
      name: "Get Races Gran Fondo",
      raceType: "granfondo",
      sport: "Bike",
      date: raceDateYmd,
      priority: "A",
      status: "upcoming",
      distanceKm: 160,
    });

    await db.insert(schema.bodyPrefs).values({
      userId: USER_BIKE_SET,
      ftpWatts: 250,
    });

    await db.insert(schema.wellnessDaily).values({
      userId: USER_BIKE_SET,
      date: new Date().toISOString().slice(0, 10),
      weightKg: 72,
    });

    // A FOURTH user: a triathlete who has configured every athlete-set anchor
    // this codebase has — FTP, threshold pace, weight, AND enough recent swim
    // history to derive a swim pace. See the comment on the test below for
    // why this still reads "low".
    await db
      .insert(schema.users)
      .values({
        id: USER_TRI_SET,
        name: "Get Races Triathlon Athlete-Set Test",
        email: `${USER_TRI_SET}@example.test`,
      })
      .onConflictDoNothing();

    await db.insert(schema.races).values({
      userId: USER_TRI_SET,
      name: "Get Races Ironman",
      raceType: "ironman",
      sport: "Triathlon",
      date: raceDateYmd,
      priority: "A",
      status: "upcoming",
      distanceKm: 226,
    });

    await db.insert(schema.bodyPrefs).values({
      userId: USER_TRI_SET,
      ftpWatts: 250,
      thresholdPaceSecPerKm: 240,
    });

    await db.insert(schema.wellnessDaily).values({
      userId: USER_TRI_SET,
      date: new Date().toISOString().slice(0, 10),
      weightKg: 68,
    });

    await db.insert(schema.activities).values({
      userId: USER_TRI_SET,
      provider: "manual",
      externalId: `get-races-tri-swim-anchor-${Date.now()}`,
      sport: "Swim",
      startDate: new Date(Date.now() - 14 * 24 * 3600 * 1000),
      distanceM: 2000,
      durationS: 2400, // 40:00 for 2000 m — a usable swim-pace reference.
    });
  });

  afterAll(async () => {
    await db.delete(schema.races).where(eq(schema.races.userId, USER));
    await db
      .delete(schema.activities)
      .where(eq(schema.activities.userId, USER));
    await db.delete(schema.users).where(eq(schema.users.id, USER));

    await db
      .delete(schema.races)
      .where(eq(schema.races.userId, USER_NO_HISTORY));
    await db.delete(schema.users).where(eq(schema.users.id, USER_NO_HISTORY));

    await db.delete(schema.races).where(eq(schema.races.userId, USER_BIKE_SET));
    await db
      .delete(schema.bodyPrefs)
      .where(eq(schema.bodyPrefs.userId, USER_BIKE_SET));
    await db
      .delete(schema.wellnessDaily)
      .where(eq(schema.wellnessDaily.userId, USER_BIKE_SET));
    await db.delete(schema.users).where(eq(schema.users.id, USER_BIKE_SET));

    await db.delete(schema.races).where(eq(schema.races.userId, USER_TRI_SET));
    await db
      .delete(schema.bodyPrefs)
      .where(eq(schema.bodyPrefs.userId, USER_TRI_SET));
    await db
      .delete(schema.wellnessDaily)
      .where(eq(schema.wellnessDaily.userId, USER_TRI_SET));
    await db
      .delete(schema.activities)
      .where(eq(schema.activities.userId, USER_TRI_SET));
    await db.delete(schema.users).where(eq(schema.users.id, USER_TRI_SET));
  });

  it("hands the coach the same sentence the athlete's screen shows", async () => {
    // One string, one source. If the coach re-derived this, the two surfaces
    // could describe the same number differently — the exact failure
    // assembleWeeklyTarget exists to prevent for the hours figure.
    const result = (await getRacesTool.execute(
      { status: "upcoming" },
      { userId: USER, db }
    )) as { races: Array<{ demandConfidence: unknown; demandNote: unknown }> };
    const race = result.races[0];
    expect(race.demandConfidence).toBe("low");
    expect(race.demandNote).toMatch(/recent runs/i);
  });

  it("tells the coach WHY there is no figure, rather than going quiet", async () => {
    // A SECOND user with the same race and NO running history at all, so the
    // two cases differ by their seed rather than by call order. Seeding one
    // user and asserting two different outcomes from the same call cannot
    // work — both `it` blocks would run against identical state.
    const result = (await getRacesTool.execute(
      { status: "upcoming" },
      { userId: USER_NO_HISTORY, db }
    )) as { races: Array<{ demandConfidence: unknown; demandNote: unknown }> };
    const race = result.races[0];
    expect(race.demandConfidence).toBeNull();
    expect(race.demandNote).toMatch(/threshold pace/i);
  });

  it("credits an athlete-set FTP with medium confidence, not just low", async () => {
    // A THIRD user whose FTP came from body_prefs, not a synced eftp — the
    // `athleteSet: true` branch volume-inputs.ts's FTP mapping takes. Nothing
    // before this test exercised it: both USER and USER_NO_HISTORY have no
    // set anchors at all, so a regression that always mapped FTP to
    // `athleteSet: false` (or dropped athleteSet from the mapping entirely)
    // would still pass every other test in this file.
    const result = (await getRacesTool.execute(
      { status: "upcoming" },
      { userId: USER_BIKE_SET, db }
    )) as { races: Array<{ demandConfidence: unknown; demandNote: unknown }> };
    const race = result.races[0];
    expect(race.demandConfidence).toBe("medium");
    expect(race.demandNote).toMatch(/your FTP/i);
  });

  it("pins a triathlon at low confidence even when the athlete has set everything settable", async () => {
    // This FOURTH user has done everything the app lets a triathlete do: an
    // athlete-set FTP, an athlete-set threshold pace, a logged weight, and
    // enough recent swim history for swimPaceFromHistory() to derive a pace.
    // It still reads "low", by design — allAnchorsAthleteSet for a triathlon
    // requires swimPace.athleteSet, and there is no athlete-set swim pace
    // anywhere in this codebase: no body_prefs column beside ftpWatts and
    // thresholdPaceSecPerKm, no Settings control, and volume-inputs.ts
    // supplies swim pace only from swimPaceFromHistory() with
    // `athleteSet: false`. See the comment on ANCHOR_SET_COPY in
    // src/lib/race/demand.ts for the full account of why "medium" is
    // currently unreachable for this sport. This test exists so that if a
    // swim anchor is ever added, the confidence consequence is a deliberate
    // decision made at that time, rather than a silent side effect nobody
    // noticed.
    const result = (await getRacesTool.execute(
      { status: "upcoming" },
      { userId: USER_TRI_SET, db }
    )) as { races: Array<{ demandConfidence: unknown; demandNote: unknown }> };
    const race = result.races[0];
    expect(race.demandConfidence).toBe("low");
    expect(race.demandNote).toMatch(/swim/i);
  });
});

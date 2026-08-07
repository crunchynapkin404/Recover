import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { getRacesTool } from "./get-races";

// requires Postgres; skips without DATABASE_URL.
const hasDb =
  !!process.env.DATABASE_URL && process.env.DATABASE_DRIVER === "pg";

const USER = "test-get-races-demand-user";
const USER_NO_HISTORY = "test-get-races-no-anchor-user";

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
});

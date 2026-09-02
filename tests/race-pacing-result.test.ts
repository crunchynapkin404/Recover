/**
 * The read path for ROADMAP Phase 7's first item: `races.resultActivityId`
 * turned into a comparison against the pacing target.
 *
 * The judgements are unit-tested in `src/lib/race/pacing-result.test.ts`.
 * What can only be tested against a real database is here: which race is
 * picked, which activity is read, and — the one that matters — WHICH ANCHORS
 * the target is recomputed from.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

const hasDb =
  !!process.env.DATABASE_URL && process.env.DATABASE_DRIVER === "pg";
const USER = "test-race-pacing-result-user";

function ymdOffset(base: Date, days: number): string {
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

async function cleanup() {
  const { db, schema } = await import("@/lib/db");
  await db.delete(schema.races).where(eq(schema.races.userId, USER));
  await db.delete(schema.activities).where(eq(schema.activities.userId, USER));
  await db
    .delete(schema.wellnessDaily)
    .where(eq(schema.wellnessDaily.userId, USER));
  await db.delete(schema.bodyPrefs).where(eq(schema.bodyPrefs.userId, USER));
  await db.delete(schema.users).where(eq(schema.users.id, USER));
}

/** One raced race with its result linked, as the debrief would leave it. */
async function seedRacedRace(opts: {
  date: string;
  name: string;
  sport: "Bike" | "Run";
  distanceKm: number;
  provider?: "intervals_icu" | "strava" | "manual";
  avgPower?: number | null;
  durationS?: number;
  distanceM?: number;
  externalId: string;
}) {
  const { db, schema } = await import("@/lib/db");
  const [activity] = await db
    .insert(schema.activities)
    .values({
      userId: USER,
      provider: opts.provider ?? "intervals_icu",
      externalId: opts.externalId,
      sport: opts.sport === "Bike" ? "Ride" : "Run",
      startDate: new Date(opts.date + "T09:00:00"),
      durationS: opts.durationS ?? 11_000,
      distanceM: opts.distanceM ?? opts.distanceKm * 1000,
      avgPower: opts.avgPower === undefined ? 200 : opts.avgPower,
    })
    .returning();
  const [race] = await db
    .insert(schema.races)
    .values({
      userId: USER,
      name: opts.name,
      raceType: "road",
      sport: opts.sport,
      date: opts.date,
      priority: "A",
      status: "completed",
      distanceKm: opts.distanceKm,
      elevationM: 900,
      resultActivityId: activity.id,
    })
    .returning();
  return { race, activity };
}

describe.skipIf(!hasDb)("race pacing result", () => {
  const now = new Date();

  beforeAll(async () => {
    await cleanup();
    const { db, schema } = await import("@/lib/db");
    await db.insert(schema.users).values({
      id: USER,
      name: "Racer",
      email: "race-pacing-result@example.invalid",
    });
    // The FTP anchor is athlete-set, so `ftpSource` is "outdoor" and no
    // eFTP history is involved. Weight lives on wellnessDaily, not bodyPrefs.
    await db.insert(schema.bodyPrefs).values({ userId: USER, ftpWatts: 250 });
    await db.insert(schema.wellnessDaily).values({
      userId: USER,
      date: ymdOffset(now, -60),
      weightKg: 72,
    });
  });
  afterAll(cleanup);

  it("compares the athlete's most recent raced race by default", async () => {
    const { racePacingResult } = await import("@/lib/race/service");
    await seedRacedRace({
      date: ymdOffset(now, -40),
      name: "Old Gran Fondo",
      sport: "Bike",
      distanceKm: 90,
      externalId: "pr-old",
    });
    const { race: recent } = await seedRacedRace({
      date: ymdOffset(now, -3),
      name: "Recent Gran Fondo",
      sport: "Bike",
      distanceKm: 90,
      avgPower: 205,
      externalId: "pr-recent",
    });

    const result = await racePacingResult(USER);
    expect(result?.race.id).toBe(recent.id);
    expect(result?.comparison.available).toBe(true);
    if (!result?.comparison.available) return;
    if (result.comparison.value.sport !== "Bike") return;
    expect(result.comparison.value.actualWatts).toBe(205);
    expect(result.comparison.value.targetWatts).toBeGreaterThan(0);
    expect(result.comparison.value.deltaWatts).toBe(
      205 - result.comparison.value.targetWatts
    );
  });

  it("compares a named race instead when race_id is given", async () => {
    const { racePacingResult } = await import("@/lib/race/service");
    const { db, schema } = await import("@/lib/db");
    const old = await db.query.races.findFirst({
      where: eq(schema.races.name, "Old Gran Fondo"),
    });
    const result = await racePacingResult(USER, old!.id);
    expect(result?.race.name).toBe("Old Gran Fondo");
  });

  it("returns null when the athlete has never raced with a result", async () => {
    const { racePacingResult } = await import("@/lib/race/service");
    expect(await racePacingResult("nobody-at-all")).toBeNull();
  });

  it("says why rather than going quiet when the result is a Strava activity", async () => {
    const { racePacingResult } = await import("@/lib/race/service");
    const { race } = await seedRacedRace({
      date: ymdOffset(now, -2),
      name: "Strava Fondo",
      sport: "Bike",
      distanceKm: 90,
      provider: "strava",
      externalId: "pr-strava",
    });
    const result = await racePacingResult(USER, race.id);
    // The race comes back — a race with a result must not read as one
    // without. Only the numbers are refused, and by name.
    expect(result?.race.id).toBe(race.id);
    expect(result?.comparison.available).toBe(false);
    if (result?.comparison.available !== false) return;
    if (result.comparison.kind !== "not_applicable") return;
    expect(result.comparison.why).toMatch(/Strava/i);
  });

  /**
   * The tool, not the function under it. A service-level test proves the
   * comparison is right; it cannot prove the tool hands the coach the right
   * thing — RELEASING.md step 4's rule, and the reason `get_race_pacing`
   * shipped with the same pairing.
   */
  it("serves the comparison over the tool surface", async () => {
    const { db, schema } = await import("@/lib/db");
    const { getRaceResultPacingTool } =
      await import("@/lib/tools/get-race-result-pacing");
    // Addressed by id, not by the no-arg default: the Strava race seeded
    // above is more recent. The default's "latest raced race" rule is
    // covered at the service level, where it cannot be knocked over by the
    // order the fixtures in this file happen to run in.
    const recent = await db.query.races.findFirst({
      where: eq(schema.races.name, "Recent Gran Fondo"),
    });
    const out = (await getRaceResultPacingTool.execute(
      { race_id: recent!.id },
      { userId: USER, db }
    )) as {
      available: boolean;
      race: { name: string };
      actualWatts: number;
      verdict: string;
      confidence: string;
      why: string;
    };
    expect(out.available).toBe(true);
    expect(out.race.name).toBe("Recent Gran Fondo");
    expect(out.actualWatts).toBe(205);
    expect(["harder", "inside", "easier"]).toContain(out.verdict);
    expect(out.confidence).toBeTruthy();
    // The assumption travels with the number, or the coach will state the
    // target as though it had been recorded before the start.
    expect(out.why).toMatch(/not recorded|before the start/i);
  });

  it("tells the coach WHY over the tool surface too, not just that it can't", async () => {
    const { db, schema } = await import("@/lib/db");
    const { getRaceResultPacingTool } =
      await import("@/lib/tools/get-race-result-pacing");
    const strava = await db.query.races.findFirst({
      where: eq(schema.races.name, "Strava Fondo"),
    });
    const out = (await getRaceResultPacingTool.execute(
      { race_id: strava!.id },
      { userId: USER, db }
    )) as { available: boolean; reason: string; why: string | null };
    expect(out.available).toBe(false);
    expect(out.reason).toBe("not_applicable");
    expect(out.why).toMatch(/Strava/i);
  });

  it("refuses a race whose result never landed", async () => {
    const { db, schema } = await import("@/lib/db");
    const { racePacingResult } = await import("@/lib/race/service");
    const [race] = await db
      .insert(schema.races)
      .values({
        userId: USER,
        name: "Unraced Fondo",
        raceType: "road",
        sport: "Bike",
        date: ymdOffset(now, 30),
        priority: "B",
        distanceKm: 90,
        elevationM: 900,
      })
      .returning();
    const result = await racePacingResult(USER, race.id);
    expect(result?.comparison.available).toBe(false);
    if (result?.comparison.available !== false) return;
    if (result.comparison.kind !== "missing_input") return;
    expect(result.comparison.needs).toMatch(/result/i);
  });
});

/**
 * THE TEST THIS FILE EXISTS FOR.
 *
 * The target is recomputed after the fact, and a hard race routinely raises
 * the athlete's synced eFTP. Recomputing from TODAY's anchors would score the
 * race against a target its own result inflated — the athlete reads "you held
 * 8% under target" for a personal best. `pacingAnchors(userId, raceDayStart)`
 * is what prevents that, and nothing else in the suite would notice if the
 * `asOf` argument were dropped.
 */
describe.skipIf(!hasDb)("race pacing result — anchors as of race day", () => {
  const USER2 = `${USER}-asof`;
  const now = new Date();
  const raceDate = ymdOffset(now, -5);

  async function cleanup2() {
    const { db, schema } = await import("@/lib/db");
    await db.delete(schema.races).where(eq(schema.races.userId, USER2));
    await db
      .delete(schema.activities)
      .where(eq(schema.activities.userId, USER2));
    await db
      .delete(schema.wellnessDaily)
      .where(eq(schema.wellnessDaily.userId, USER2));
    await db.delete(schema.bodyPrefs).where(eq(schema.bodyPrefs.userId, USER2));
    await db.delete(schema.users).where(eq(schema.users.id, USER2));
  }

  beforeAll(async () => {
    await cleanup2();
    const { db, schema } = await import("@/lib/db");
    await db.insert(schema.users).values({
      id: USER2,
      name: "Synced Racer",
      email: "race-pacing-asof@example.invalid",
    });
    // No athlete-set FTP: the anchor is the SYNCED eFTP, which is the one
    // that moves after a race.
    await db.insert(schema.wellnessDaily).values([
      { userId: USER2, date: ymdOffset(now, -10), eftp: 250, weightKg: 72 },
      // The bump the race itself produced, two days after it.
      { userId: USER2, date: ymdOffset(now, -3), eftp: 285, weightKg: 72 },
    ]);
    const [activity] = await db
      .insert(schema.activities)
      .values({
        userId: USER2,
        provider: "intervals_icu",
        externalId: "asof-result",
        sport: "Ride",
        startDate: new Date(raceDate + "T09:00:00"),
        durationS: 11_000,
        distanceM: 90_000,
        avgPower: 200,
      })
      .returning();
    await db.insert(schema.races).values({
      userId: USER2,
      name: "PB Fondo",
      raceType: "road",
      sport: "Bike",
      date: raceDate,
      priority: "A",
      status: "completed",
      distanceKm: 90,
      elevationM: 900,
      resultActivityId: activity.id,
    });
  });
  afterAll(cleanup2);

  it("predicts from the eFTP on file on race day, not the one the race raised", async () => {
    const { racePacingResult, pacingAnchors } =
      await import("@/lib/race/service");
    // Today's anchor really has moved — otherwise this test proves nothing.
    expect((await pacingAnchors(USER2)).ftpWatts).toBe(285);
    expect(
      (await pacingAnchors(USER2, new Date(raceDate + "T00:00:00"))).ftpWatts
    ).toBe(250);

    const result = await racePacingResult(USER2);
    if (!result?.comparison.available) throw new Error("expected a comparison");
    if (result.comparison.value.sport !== "Bike") return;
    const { racePacing } = await import("@/lib/race/pacing");
    const asRaceDay = racePacing({
      sport: "Bike",
      distanceKm: 90,
      elevationM: 900,
      eventDays: 1,
      ftpWatts: 250,
      massKg: 80,
      thresholdPaceSecPerKm: null,
      ftpSource: "synced",
    });
    if (!asRaceDay.available || asRaceDay.value.sport !== "Bike") {
      throw new Error("fixture prediction unavailable");
    }
    expect(result.comparison.value.targetWatts).toBe(
      asRaceDay.value.targetWatts
    );
    // And the direction of the error this guards: the raised eFTP would have
    // produced a strictly harder target, turning a fair result into a miss.
    expect(asRaceDay.value.targetWatts).toBeLessThan(285 * 0.85);
  });

  it("keeps today's anchors when no asOf is given — the existing callers are untouched", async () => {
    const { pacingAnchors } = await import("@/lib/race/service");
    const anchors = await pacingAnchors(USER2);
    expect(anchors.ftpWatts).toBe(285);
    expect(anchors.ftpSource).toBe("synced");
  });
});

/**
 * The run anchor's version of the same trap, and the sharper one.
 *
 * With no athlete-set threshold pace, `thresholdPaceFromHistory` takes the
 * FASTEST qualifying run on file — which, for a runner who just raced, is
 * the race. Derive the target from the race and then score the race against
 * it and the model is marking its own homework: the answer is always "about
 * right", for any performance whatsoever. The exclusive upper bound on the
 * anchor window is the only thing standing between this feature and that.
 */
describe.skipIf(!hasDb)(
  "race pacing result — the anchor window excludes the race",
  () => {
    const USER3 = `${USER}-run`;
    const now = new Date();
    const raceDate = ymdOffset(now, -5);

    async function cleanup3() {
      const { db, schema } = await import("@/lib/db");
      await db.delete(schema.races).where(eq(schema.races.userId, USER3));
      await db
        .delete(schema.activities)
        .where(eq(schema.activities.userId, USER3));
      await db
        .delete(schema.bodyPrefs)
        .where(eq(schema.bodyPrefs.userId, USER3));
      await db.delete(schema.users).where(eq(schema.users.id, USER3));
    }

    beforeAll(async () => {
      await cleanup3();
      const { db, schema } = await import("@/lib/db");
      await db.insert(schema.users).values({
        id: USER3,
        name: "Runner",
        email: "race-pacing-run@example.invalid",
      });
      // No bodyPrefs row at all: the threshold pace can only be derived.
      await db.insert(schema.activities).values({
        userId: USER3,
        provider: "manual",
        externalId: "run-anchor-training",
        sport: "Run",
        startDate: new Date(ymdOffset(now, -30) + "T07:00:00"),
        // A 10 km training run at 5:00/km.
        durationS: 3000,
        distanceM: 10_000,
      });
      const [result] = await db
        .insert(schema.activities)
        .values({
          userId: USER3,
          provider: "manual",
          externalId: "run-anchor-race",
          sport: "Run",
          startDate: new Date(raceDate + "T09:00:00"),
          // The half itself, at 4:10/km — far faster than anything before it.
          durationS: 5275,
          distanceM: 21_100,
        })
        .returning();
      await db.insert(schema.races).values({
        userId: USER3,
        name: "Breakthrough Half",
        raceType: "half",
        sport: "Run",
        date: raceDate,
        priority: "A",
        status: "completed",
        distanceKm: 21.1,
        elevationM: 0,
        resultActivityId: result.id,
      });
    });
    afterAll(cleanup3);

    it("derives the threshold pace from training, not from the race being scored", async () => {
      const { pacingAnchors, racePacingResult } =
        await import("@/lib/race/service");
      const today = await pacingAnchors(USER3);
      const onRaceDay = await pacingAnchors(
        USER3,
        new Date(raceDate + "T00:00:00")
      );
      // Today's anchor HAS been pulled faster by the race. If these two are
      // ever equal, this test has stopped testing anything.
      expect(today.thresholdPaceSecPerKm).toBeLessThan(
        onRaceDay.thresholdPaceSecPerKm!
      );

      const result = await racePacingResult(USER3);
      if (!result?.comparison.available)
        throw new Error("expected a comparison");
      if (result.comparison.value.sport !== "Run") return;

      const { racePacing } = await import("@/lib/race/pacing");
      const fromTraining = racePacing({
        sport: "Run",
        distanceKm: 21.1,
        elevationM: 0,
        eventDays: 1,
        ftpWatts: null,
        massKg: null,
        thresholdPaceSecPerKm: onRaceDay.thresholdPaceSecPerKm,
        runPaceAthleteSet: false,
      });
      if (!fromTraining.available || fromTraining.value.sport !== "Run") {
        throw new Error("fixture prediction unavailable");
      }
      expect(result.comparison.value.targetSecPerKm).toBe(
        fromTraining.value.targetSecPerKm
      );
      // And the athlete is told they raced above the band — which is the whole
      // point. Anchored on the race itself, the model would have predicted
      // roughly the pace that was run and called a breakthrough unremarkable.
      expect(result.comparison.value.verdict).toBe("harder");
      expect(result.comparison.value.deltaSecPerKm).toBeLessThan(0);
    });
  }
);

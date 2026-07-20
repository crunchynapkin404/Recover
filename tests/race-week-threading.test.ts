// tests/race-week-threading.test.ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

const hasDb =
  !!process.env.DATABASE_URL && process.env.DATABASE_DRIVER === "pg";
const USER = "test-race-threading-user";

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function nextSunday(from = new Date()): Date {
  // Sunday of the week containing `from` (Mon..Sun), matching the week
  // rolloverWeekPlan materializes. Deliberately no `|| 7` fallback: when
  // `from` is itself a Sunday it must resolve to *today*, not next week's
  // Sunday, or the race would fall outside the just-rolled week.
  const d = new Date(from);
  d.setDate(d.getDate() + ((7 - d.getDay()) % 7));
  return d;
}

async function cleanup() {
  const { db, schema } = await import("@/lib/db");
  for (const t of [
    schema.planAdjustments, // via weekPlans cascade normally; direct for safety
  ])
    void t;
  await db.delete(schema.weekPlans).where(eq(schema.weekPlans.userId, USER));
  await db
    .delete(schema.trainingPlans)
    .where(eq(schema.trainingPlans.userId, USER));
  await db.delete(schema.races).where(eq(schema.races.userId, USER));
  await db
    .delete(schema.dailyMetrics)
    .where(eq(schema.dailyMetrics.userId, USER));
  await db.delete(schema.users).where(eq(schema.users.id, USER));
}

describe.skipIf(!hasDb)("race threading into the living week", () => {
  beforeAll(async () => {
    await cleanup();
    const { db, schema } = await import("@/lib/db");
    await db.insert(schema.users).values({
      id: USER,
      name: "Threader",
      email: "race-threading@example.invalid",
    });
  });
  afterAll(cleanup);

  it("a C race this week appears as a race slot after rollover", async () => {
    const { generateTrainingPlan } = await import("@/lib/training-plan");
    const { createRace } = await import("@/lib/race/service");
    const { getOpenWeekPlan } = await import("@/lib/week-plan/service");

    const raceDay = nextSunday();
    const cRace = await createRace(USER, {
      name: "Weekend parkrun",
      raceType: "5k",
      date: ymd(raceDay),
      priority: "C",
    });
    expect("race" in cRace).toBe(true);

    const far = new Date();
    far.setDate(far.getDate() + 70);
    await generateTrainingPlan({
      userId: USER,
      raceType: "10k",
      raceDate: ymd(far),
    }); // triggers rolloverWeekPlan internally

    const week = await getOpenWeekPlan(USER);
    const slot = week?.days.find((d) => d.date === ymd(raceDay));
    expect(slot?.status).toBe("race");
    expect(slot?.raceName).toBe("Weekend parkrun");
  });

  it("plan generation creates and links an implicit A race", async () => {
    const { db, schema } = await import("@/lib/db");
    const { listRaces } = await import("@/lib/race/service");
    const { eq, and } = await import("drizzle-orm");
    const plan = await db.query.trainingPlans.findFirst({
      where: and(
        eq(schema.trainingPlans.userId, USER),
        eq(schema.trainingPlans.status, "active")
      ),
    });
    expect(plan?.raceId).toBeTruthy();
    const aRaces = await listRaces(USER, { priority: "A" });
    expect(aRaces.some((r) => r.id === plan!.raceId)).toBe(true);
    expect(aRaces[0].raceType).toBe("10k");
  });

  it("racesForWeek breaks same-date, same-priority ties by createdAt, not row-storage order", async () => {
    const { createRace, racesForWeek, deleteRace, listRaces } =
      await import("@/lib/race/service");
    const { db, schema } = await import("@/lib/db");
    const { eq } = await import("drizzle-orm");

    const weekStart = ymd(new Date());
    const tieDay = new Date();
    tieDay.setDate(tieDay.getDate() + 10); // inside the 27-day lookahead
    const tieDate = ymd(tieDay);

    // Insert "B" physically first, "A" physically second, then force A's
    // createdAt earlier than B's — decoupling insertion/storage order from
    // createdAt order so the test can't pass by incidental row order.
    const b = await createRace(USER, {
      name: "Threading Tiebreak B",
      raceType: "half-marathon",
      date: tieDate,
      priority: "A",
    });
    const a = await createRace(USER, {
      name: "Threading Tiebreak A",
      raceType: "half-marathon",
      date: tieDate,
      priority: "A",
    });
    expect("race" in a && "race" in b).toBe(true);
    if (!("race" in a) || !("race" in b)) throw new Error("setup");

    const earlier = new Date(b.race.createdAt.getTime() - 60_000);
    await db
      .update(schema.races)
      .set({ createdAt: earlier })
      .where(eq(schema.races.id, a.race.id));

    const week = await racesForWeek(USER, weekStart);
    const tied = week.filter((r) => r.date === tieDate);
    expect(tied).toHaveLength(2);
    // materializeWeek treats the first entry as primary — must be the
    // earlier-createdAt race, not storage-order luck.
    expect(tied[0].name).toBe("Threading Tiebreak A");
    expect(week[0].name).toBe("Threading Tiebreak A");

    await deleteRace(USER, a.race.id);
    await deleteRace(USER, b.race.id);
    expect(await listRaces(USER, { priority: "A" })).toHaveLength(1); // implicit 10k A race remains
  });
});

// Fix 1 seam regression: rolloverWeekPlan must persist materializeWeek's
// effectiveLoad (the taper-reshaped target), and the week-closing adherence
// math must read it back — not trainingBlocks.targetLoadTotal, which stays
// the un-tapered skeleton value and would otherwise score a
// perfectly-executed taper week at ~30% adherence.
describe.skipIf(!hasDb)(
  "taper effective target persists through rollover",
  () => {
    const TAPER_USER = "test-race-threading-taper-user";

    function mondayOf(d: Date): string {
      const day = (d.getDay() + 6) % 7; // Mon=0
      const m = new Date(d);
      m.setDate(d.getDate() - day);
      return ymd(m);
    }
    function addDaysYmd(ymdStr: string, n: number): string {
      const d = new Date(ymdStr + "T00:00:00");
      d.setDate(d.getDate() + n);
      return ymd(d);
    }

    async function cleanupTaperUser() {
      const { db, schema } = await import("@/lib/db");
      await db
        .delete(schema.weekPlans)
        .where(eq(schema.weekPlans.userId, TAPER_USER));
      await db
        .delete(schema.trainingPlans)
        .where(eq(schema.trainingPlans.userId, TAPER_USER));
      await db.delete(schema.races).where(eq(schema.races.userId, TAPER_USER));
      await db
        .delete(schema.dailyMetrics)
        .where(eq(schema.dailyMetrics.userId, TAPER_USER));
      await db.delete(schema.users).where(eq(schema.users.id, TAPER_USER));
    }

    beforeAll(async () => {
      await cleanupTaperUser();
      const { db, schema } = await import("@/lib/db");
      await db.insert(schema.users).values({
        id: TAPER_USER,
        name: "Taper Threader",
        email: "race-threading-taper@example.invalid",
      });
    });
    afterAll(cleanupTaperUser);

    it("a taper week's persisted effectiveTarget (not the skeleton block) drives week-close adherence", async () => {
      const { db, schema } = await import("@/lib/db");
      const { createRace } = await import("@/lib/race/service");
      const { rolloverWeekPlan } = await import("@/lib/week-plan/service");
      const { TAPER_FRACTION_RACE_WEEK } = await import("@/lib/race/taper");

      // Pick a week comfortably in the future so createRace's past-date guard
      // (compared against the real clock) never trips, independent of when
      // this test happens to run.
      const far = new Date();
      far.setDate(far.getDate() + 70);
      const week2Start = mondayOf(far);
      const week1Start = addDaysYmd(week2Start, -7);
      const raceDate = addDaysYmd(week2Start, 2); // Wed of week2: d=2<=6, race week

      const [plan] = await db
        .insert(schema.trainingPlans)
        .values({
          userId: TAPER_USER,
          title: "Taper effective-target test",
          raceType: "10k",
          raceDate,
          startDate: week1Start,
          weeksTotal: 4,
          currentWeek: 2,
          status: "active",
          constraints: { daysPerWeek: 5, hoursPerWeek: 8, sports: ["Run"] },
        })
        .returning();
      // week2's skeleton keeps a big un-tapered target (300) — the bug this
      // test guards against is adherence computed against this stale number.
      await db.insert(schema.trainingBlocks).values([
        {
          planId: plan.id,
          weekNumber: 1,
          phase: "build",
          targetLoadTotal: 250,
          targetSessions: 5,
          workouts: [],
        },
        {
          planId: plan.id,
          weekNumber: 2,
          phase: "build",
          targetLoadTotal: 300,
          targetSessions: 5,
          workouts: [],
        },
      ]);

      // Last week: fully executed, actualLoad 200 — this becomes the taper
      // base (materializeWeek's taperBase = prevWeek.actualLoad).
      const PREV_ACTUAL = 200;
      const week1Days = Array.from({ length: 7 }, (_, i) => {
        const date = addDaysYmd(week1Start, i);
        if (i === 0) {
          return {
            date,
            availableMins: 120,
            workout: {
              day: 0,
              sport: "Run",
              type: "Endurance",
              durationMins: 90,
              intensity: "Z1-Z2",
              description: "Long run",
            },
            status: "completed" as const,
            actualLoad: PREV_ACTUAL,
          };
        }
        return {
          date,
          availableMins: 120,
          workout: null,
          status: "rest" as const,
        };
      });
      await db.insert(schema.weekPlans).values({
        userId: TAPER_USER,
        planId: plan.id,
        weekStart: week1Start,
        skeletonWeek: 1,
        days: week1Days,
        status: "open",
      });

      const raceResult = await createRace(TAPER_USER, {
        name: "Taper Target 10K",
        raceType: "10k",
        date: raceDate,
        priority: "A",
      });
      expect("race" in raceResult).toBe(true);

      // Rollover closes week1 (actualLoad 200) and materializes week2 as a
      // taper/race week from that actual.
      const rolled = await rolloverWeekPlan(
        TAPER_USER,
        new Date(week2Start + "T08:00:00")
      );
      expect(rolled).toBe("rolled");

      const { and } = await import("drizzle-orm");
      const expectedTaperTarget = Math.round(
        PREV_ACTUAL * TAPER_FRACTION_RACE_WEEK
      );
      const week2Row = await db.query.weekPlans.findFirst({
        where: and(
          eq(schema.weekPlans.userId, TAPER_USER),
          eq(schema.weekPlans.weekStart, week2Start)
        ),
      });
      // Persisted effective target is the taper target, not the skeleton's 300.
      expect(week2Row?.effectiveTarget).toBe(expectedTaperTarget);
      expect(week2Row?.effectiveTarget).not.toBe(300);

      // Athlete executes the taper exactly as planned.
      const closingDays = Array.from({ length: 7 }, (_, i) => {
        const date = addDaysYmd(week2Start, i);
        if (i === 0) {
          return {
            date,
            availableMins: 120,
            workout: null,
            status: "completed" as const,
            actualLoad: expectedTaperTarget,
          };
        }
        return {
          date,
          availableMins: 120,
          workout: null,
          status: "rest" as const,
        };
      });
      await db
        .update(schema.weekPlans)
        .set({ days: closingDays })
        .where(eq(schema.weekPlans.id, week2Row!.id));

      // Roll into week3 to close week2 and write its adherence back.
      const week3Start = addDaysYmd(week2Start, 7);
      const rolled2 = await rolloverWeekPlan(
        TAPER_USER,
        new Date(week3Start + "T08:00:00")
      );
      expect(rolled2).toBe("rolled");

      const closedWeek2 = await db.query.weekPlans.findFirst({
        where: eq(schema.weekPlans.id, week2Row!.id),
      });
      expect(closedWeek2?.status).toBe("closed");

      const block2 = await db.query.trainingBlocks.findFirst({
        where: and(
          eq(schema.trainingBlocks.planId, plan.id),
          eq(schema.trainingBlocks.weekNumber, 2)
        ),
      });
      // A perfectly-executed taper reads as ~100% adherence — not the ~30%
      // (90/300) the un-tapered skeleton target would have produced.
      expect(block2?.adherencePct).toBe(100);
    });
  }
);

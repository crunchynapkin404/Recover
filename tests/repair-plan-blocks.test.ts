import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { asc, eq } from "drizzle-orm";

/**
 * v0.45 Task 9 — scripts/repair-plan-blocks.ts recomputes an active plan's
 * un-started training_blocks from the fixed periodize() (Tasks 3-5). The
 * one property that matters more than any other: it must never touch a
 * week at or before plan.currentWeek — that block backs closed history (or,
 * for the current week, an OPEN week_plans row whose frozen effectiveTarget
 * gates the low-adherence safety rail in materialize.ts). See the script's
 * module doc.
 */

const hasDb =
  !!process.env.DATABASE_URL && process.env.DATABASE_DRIVER === "pg";

const USER = "test-repair-plan-blocks-user";
const OTHER_USER = "test-repair-plan-blocks-other-user";

// Deliberately wrong stored values, guaranteed to differ from whatever a
// fresh periodize() call actually derives for any week of this plan
// (targetLoad is driven by startingCtl*7=280ish and climbs from there,
// phase for an early/mid week of a 12-week plan is base/build, sessions
// track daysPerWeek=5) — so a real mismatch, and therefore a real
// candidate change, is guaranteed for every seeded block regardless of the
// exact PLAN_CONSTANTS in effect.
const STALE = {
  phase: "recovery" as const,
  targetLoadTotal: 1,
  targetSessions: 1,
  workouts: [] as unknown[],
};

const PLAN_INPUT = {
  weeksTotal: 12,
  startingCtl: 40,
  daysPerWeek: 5,
  hoursPerWeek: 8,
  sport: "Run" as const,
};

async function cleanup() {
  const { db, schema } = await import("@/lib/db");
  // Cascades to training_plans -> training_blocks (both onDelete: cascade).
  await db.delete(schema.users).where(eq(schema.users.id, USER));
  await db.delete(schema.users).where(eq(schema.users.id, OTHER_USER));
}

async function seedPlan(userId: string, currentWeek: number) {
  const { db, schema } = await import("@/lib/db");
  await db
    .insert(schema.users)
    .values({
      id: userId,
      name: "Repair Plan Blocks Test",
      email: `${userId}@example.invalid`,
    })
    .onConflictDoNothing();

  const raceDate = new Date(Date.now() + 90 * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const [plan] = await db
    .insert(schema.trainingPlans)
    .values({
      userId,
      title: "Repair blocks test plan",
      raceType: "marathon",
      raceDate,
      startDate: raceDate,
      weeksTotal: PLAN_INPUT.weeksTotal,
      currentWeek,
      startingCtl: PLAN_INPUT.startingCtl,
      status: "active",
      constraints: {
        daysPerWeek: PLAN_INPUT.daysPerWeek,
        hoursPerWeek: PLAN_INPUT.hoursPerWeek,
        sports: [PLAN_INPUT.sport],
      },
    })
    .returning();

  // Weeks 4, 5, 6 — straddling currentWeek=5: one before, one AT
  // currentWeek, one strictly after.
  await db.insert(schema.trainingBlocks).values(
    [4, 5, 6].map((weekNumber) => ({
      planId: plan.id,
      weekNumber,
      ...STALE,
    }))
  );

  return plan;
}

async function blocksFor(planId: string) {
  const { db, schema } = await import("@/lib/db");
  return db.query.trainingBlocks.findMany({
    where: eq(schema.trainingBlocks.planId, planId),
    orderBy: asc(schema.trainingBlocks.weekNumber),
  });
}

describe.skipIf(!hasDb)("repairPlanBlocks", () => {
  beforeEach(cleanup);
  afterAll(cleanup);

  it("touches only the week strictly after currentWeek; dry run writes nothing; apply corrects exactly that week to periodize()'s output", async () => {
    const { periodize } = await import("@/lib/training-plan");
    const { repairPlanBlocks } = await import("../scripts/repair-plan-blocks");

    const plan = await seedPlan(USER, /* currentWeek */ 5);
    const expected = periodize({
      weeksTotal: PLAN_INPUT.weeksTotal,
      startingCtl: PLAN_INPUT.startingCtl,
      daysPerWeek: PLAN_INPUT.daysPerWeek,
      hoursPerWeek: PLAN_INPUT.hoursPerWeek,
      sport: PLAN_INPUT.sport,
    }).find((b) => b.weekNumber === 6)!;
    // Sanity: the fixture's staleness assumption actually holds for this
    // engine run, or the rest of the test would prove nothing.
    expect(expected.targetLoad).not.toBe(STALE.targetLoadTotal);

    const before = await blocksFor(plan.id);
    expect(
      before.map((b) => [b.weekNumber, b.phase, b.targetLoadTotal])
    ).toEqual([
      [4, STALE.phase, STALE.targetLoadTotal],
      [5, STALE.phase, STALE.targetLoadTotal],
      [6, STALE.phase, STALE.targetLoadTotal],
    ]);

    // --- Dry run: reports the one candidate change, writes nothing. -----
    const dry = await repairPlanBlocks({ dryRun: true, userId: USER });
    expect(dry.changes.map((c) => c.weekNumber)).toEqual([6]);

    const afterDry = await blocksFor(plan.id);
    expect(afterDry).toEqual(before); // byte-identical: dry run wrote nothing.

    // --- Apply: writes week 6 only. --------------------------------------
    const applied = await repairPlanBlocks({ dryRun: false, userId: USER });
    expect(applied.changes.map((c) => c.weekNumber)).toEqual([6]);

    const afterApply = await blocksFor(plan.id);
    const [w4, w5, w6] = afterApply;

    // THE BOUNDARY: week 5 (== currentWeek) and week 4 (< currentWeek) are
    // untouched byte-for-byte, even though their stored values are just as
    // stale as week 6's and periodize() would happily "correct" them too.
    // This is the assertion that protects a real athlete's frozen
    // effectiveTarget / recorded adherence.
    expect(w4).toEqual(before[0]);
    expect(w5).toEqual(before[1]);

    // Week 6 (> currentWeek) now matches the fresh periodize() output.
    expect(w6.phase).toBe(expected.phase);
    expect(w6.targetLoadTotal).toBe(expected.targetLoad);
    expect(w6.targetSessions).toBe(expected.targetSessions);

    // Idempotent: running again finds nothing left to change.
    const second = await repairPlanBlocks({ dryRun: false, userId: USER });
    expect(second.changes).toEqual([]);
  });

  it("scopes to userId: a real run for USER never touches OTHER_USER's rows", async () => {
    const { repairPlanBlocks } = await import("../scripts/repair-plan-blocks");

    const mine = await seedPlan(USER, 5);
    const theirs = await seedPlan(OTHER_USER, 5);

    const beforeTheirs = await blocksFor(theirs.id);

    const result = await repairPlanBlocks({ dryRun: false, userId: USER });
    expect(result.changes.every((c) => c.userId === USER)).toBe(true);
    expect(result.changes.some((c) => c.planId === mine.id)).toBe(true);
    expect(result.changes.some((c) => c.planId === theirs.id)).toBe(false);

    const afterTheirs = await blocksFor(theirs.id);
    expect(afterTheirs).toEqual(beforeTheirs);
  });

  // Important 1 from review: every other test passes an explicit userId, so
  // the whole-table branch at repairPlanBlocks's `opts.userId ? ... :
  // eq(status, "active")` — the exact DB-wide shape the module doc warns
  // put fabricated rows into real accounts before — was never exercised.
  // Covered here in dry-run only, never with --apply: a dry run writes
  // nothing by construction (db.transaction sits inside the
  // `!opts.dryRun` guard), so calling repairPlanBlocks with `userId`
  // omitted is safe even though it spans every active plan in the
  // database — including any left over from unrelated fixtures elsewhere,
  // which is exactly why this must never write.
  it("--all (userId omitted): dry run spans every active plan, including more than one test user, and still writes nothing", async () => {
    const { repairPlanBlocks } = await import("../scripts/repair-plan-blocks");

    const mine = await seedPlan(USER, 5);
    const theirs = await seedPlan(OTHER_USER, 5);
    const beforeMine = await blocksFor(mine.id);
    const beforeTheirs = await blocksFor(theirs.id);

    // No userId — the unscoped, whole-table call `--all` maps to.
    const dry = await repairPlanBlocks({ dryRun: true });

    // Proves the unscoped query really does span users, not just the one
    // most-recently-seeded plan: both fixture plans' week-6 change shows
    // up in the same dry-run result.
    const plansWithChanges = new Set(dry.changes.map((c) => c.planId));
    expect(plansWithChanges.has(mine.id)).toBe(true);
    expect(plansWithChanges.has(theirs.id)).toBe(true);
    expect(
      dry.changes.filter((c) => c.planId === mine.id).map((c) => c.weekNumber)
    ).toEqual([6]);
    expect(
      dry.changes.filter((c) => c.planId === theirs.id).map((c) => c.weekNumber)
    ).toEqual([6]);

    // And nothing was written — full row snapshots for both plans,
    // byte-identical.
    expect(await blocksFor(mine.id)).toEqual(beforeMine);
    expect(await blocksFor(theirs.id)).toEqual(beforeTheirs);
  });

  // FIX 4: periodize() was converted to an options object (v0.114 Task 1)
  // and gained an optional `firstRace` (v0.114 Task 4/5) so a two-race plan
  // composes arc + recovery + arc, but this script's own periodize() call
  // never gained it. --apply on an active two-race plan therefore recomputes
  // its future training_blocks as a single flattened arc: materialization
  // still uses freshly-derived two-arc blocks (so the athlete's actual
  // weeks stay right), but the STORED blocks this script writes — what
  // /train's phase label and get_training_plan's block list read — become
  // a lie.
  it("derives a two-race plan's repaired blocks with firstRace, not a flattened single arc", async () => {
    const TWO_RACE_USER = "test-repair-plan-blocks-two-race-user";
    const { db, schema } = await import("@/lib/db");
    const { periodize } = await import("@/lib/training-plan");
    const { repairPlanBlocks } = await import("../scripts/repair-plan-blocks");
    const { addDaysYmd } = await import("@/lib/week-plan/service");

    try {
      await db
        .insert(schema.users)
        .values({
          id: TWO_RACE_USER,
          name: "Repair Plan Blocks Two-Race Test",
          email: `${TWO_RACE_USER}@example.invalid`,
        })
        .onConflictDoNothing();

      // A longer plan than PLAN_INPUT.weeksTotal (12) — long enough for a
      // real recovery + rebuild + taper arc two after race one, and for
      // week 20 (below) to fall inside it rather than past the plan's end.
      const TWO_RACE_WEEKS_TOTAL = 30;
      const startDate = new Date(Date.now() + 90 * 86_400_000)
        .toISOString()
        .slice(0, 10);
      // planWeekOf(startDate, firstRaceDate) = floor(77/7)+1 = 12.
      const firstRaceDate = addDaysYmd(startDate, 77);
      const finalRaceDate = addDaysYmd(startDate, 200);

      const [firstRaceRow] = await db
        .insert(schema.races)
        .values({
          userId: TWO_RACE_USER,
          name: "Race one",
          raceType: "marathon",
          sport: "Run",
          date: firstRaceDate,
          priority: "A",
          status: "upcoming",
        })
        .returning();

      const [plan] = await db
        .insert(schema.trainingPlans)
        .values({
          userId: TWO_RACE_USER,
          title: "Two-race repair test plan",
          raceType: "marathon",
          raceDate: finalRaceDate,
          startDate,
          weeksTotal: TWO_RACE_WEEKS_TOTAL,
          currentWeek: 1,
          startingCtl: PLAN_INPUT.startingCtl,
          status: "active",
          firstRaceId: firstRaceRow.id,
          firstRaceDate,
          firstRaceType: "marathon",
          constraints: {
            daysPerWeek: PLAN_INPUT.daysPerWeek,
            hoursPerWeek: PLAN_INPUT.hoursPerWeek,
            sports: [PLAN_INPUT.sport],
          },
        })
        .returning();

      // Week 20 sits well inside arc two (past firstRaceWeek=12 plus
      // marathon's recovery weeks), where a two-arc periodize() output
      // diverges from a single flattened 30-week arc.
      await db.insert(schema.trainingBlocks).values({
        planId: plan.id,
        weekNumber: 20,
        ...STALE,
      });

      const singleArcWeek20 = periodize({
        weeksTotal: TWO_RACE_WEEKS_TOTAL,
        startingCtl: PLAN_INPUT.startingCtl,
        daysPerWeek: PLAN_INPUT.daysPerWeek,
        hoursPerWeek: PLAN_INPUT.hoursPerWeek,
        sport: PLAN_INPUT.sport,
      }).find((b) => b.weekNumber === 20)!;
      const twoArcWeek20 = periodize({
        weeksTotal: TWO_RACE_WEEKS_TOTAL,
        startingCtl: PLAN_INPUT.startingCtl,
        daysPerWeek: PLAN_INPUT.daysPerWeek,
        hoursPerWeek: PLAN_INPUT.hoursPerWeek,
        sport: PLAN_INPUT.sport,
        firstRace: { weekNumber: 12, raceType: "marathon" },
      }).find((b) => b.weekNumber === 20)!;
      // Sanity: the fixture's divergence assumption actually holds for this
      // engine run, or the rest of the test proves nothing.
      expect(twoArcWeek20.phase).not.toBe(singleArcWeek20.phase);

      const applied = await repairPlanBlocks({
        dryRun: false,
        userId: TWO_RACE_USER,
      });
      expect(applied.changes.map((c) => c.weekNumber)).toEqual([20]);

      const after = await blocksFor(plan.id);
      expect(after).toHaveLength(1);
      // Correct: matches the two-arc derivation.
      expect(after[0].phase).toBe(twoArcWeek20.phase);
      expect(after[0].targetLoadTotal).toBe(twoArcWeek20.targetLoad);
      // Wrong (pre-fix): must NOT match the flattened single-arc derivation.
      expect(after[0].phase).not.toBe(singleArcWeek20.phase);
    } finally {
      await db.delete(schema.users).where(eq(schema.users.id, TWO_RACE_USER));
    }
  });
});

import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

/**
 * v0.114.0 — `scripts/repair-plan-sport.ts` regenerates an active plan whose
 * stored blocks disagree with its race's sport. Its regeneration path goes
 * through `generateTrainingPlan()`, which carries only
 * `raceType`/`raceDate`/`raceId` and has no way to express a SECOND target —
 * so running it against a two-A-race plan would flatten the two-arc season
 * into one arc and silently discard the bridge.
 *
 * The script refuses instead, and this is the test that the refusal actually
 * fires. The whole-branch review flagged it as the one thing in that fix
 * verified by reading rather than by execution.
 */

const hasDb =
  !!process.env.DATABASE_URL && process.env.DATABASE_DRIVER === "pg";

const USER = "test-repair-plan-sport-user";

async function cleanup() {
  const { db, schema } = await import("@/lib/db");
  // Cascades to races and training_plans (both onDelete: cascade).
  await db.delete(schema.users).where(eq(schema.users.id, USER));
}

/** An ACTIVE plan; `repairPlanSport` only ever looks at active ones. */
async function seedTwoRacePlan(): Promise<{ planId: string }> {
  const { db, schema } = await import("@/lib/db");
  await db
    .insert(schema.users)
    .values({
      id: USER,
      name: "Repair Plan Sport Test",
      email: `${USER}@example.invalid`,
    })
    .onConflictDoNothing();

  const ymd = (offsetDays: number) =>
    new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);

  const [first] = await db
    .insert(schema.races)
    .values({
      userId: USER,
      name: "First A",
      raceType: "marathon",
      sport: "Run",
      date: ymd(84),
      priority: "A",
      status: "upcoming",
    })
    .returning();
  const [final] = await db
    .insert(schema.races)
    .values({
      userId: USER,
      name: "Final A",
      raceType: "marathon",
      sport: "Run",
      date: ymd(147),
      priority: "A",
      status: "upcoming",
    })
    .returning();

  const [plan] = await db
    .insert(schema.trainingPlans)
    .values({
      userId: USER,
      title: "Two-race season",
      raceType: "marathon",
      raceDate: ymd(147),
      startDate: ymd(0),
      weeksTotal: 21,
      currentWeek: 1,
      startingCtl: 40,
      status: "active",
      raceId: final.id,
      firstRaceId: first.id,
      firstRaceDate: ymd(84),
      firstRaceType: "marathon",
      constraints: { daysPerWeek: 5, hoursPerWeek: 8, sports: ["Run"] },
    })
    .returning();

  return { planId: plan.id };
}

describe.skipIf(!hasDb)("repair-plan-sport refuses a two-A-race plan", () => {
  beforeEach(cleanup);
  afterAll(cleanup);

  it("reports refused_two_race rather than regenerating it", async () => {
    const { planId } = await seedTwoRacePlan();
    const { repairPlanSport } = await import("@/../scripts/repair-plan-sport");

    // --apply, deliberately: a dry run refusing proves nothing, since a dry
    // run changes nothing either way. The refusal has to hold on the path
    // that would otherwise write.
    const result = await repairPlanSport({ apply: true });

    const mine = result.outcomes.filter((o) => o.planId === planId);
    expect(mine).toHaveLength(1);
    expect(mine[0].kind).toBe("refused_two_race");
  });

  it("leaves the plan's two-race identity untouched", async () => {
    const { planId } = await seedTwoRacePlan();
    const { db, schema } = await import("@/lib/db");
    const { repairPlanSport } = await import("@/../scripts/repair-plan-sport");

    const before = await db.query.trainingPlans.findFirst({
      where: eq(schema.trainingPlans.id, planId),
    });
    await repairPlanSport({ apply: true });
    const after = await db.query.trainingPlans.findFirst({
      where: eq(schema.trainingPlans.id, planId),
    });

    // The columns that carry the second arc. If the script had regenerated
    // this plan, firstRaceId is exactly what it would have dropped.
    expect(after?.firstRaceId).toBe(before?.firstRaceId);
    expect(after?.firstRaceDate).toBe(before?.firstRaceDate);
    expect(after?.firstRaceType).toBe(before?.firstRaceType);
    expect(after?.weeksTotal).toBe(before?.weeksTotal);
  });
});

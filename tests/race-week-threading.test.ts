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
});

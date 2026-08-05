import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";

const hasDb =
  !!process.env.DATABASE_URL && process.env.DATABASE_DRIVER === "pg";

describe.skipIf(!hasDb)("draft training plans are invisible (v0.43)", () => {
  let db: typeof import("@/lib/db").db;
  let schema: typeof import("@/lib/db").schema;
  let getActivePlan: typeof import("@/lib/active-plan").getActivePlan;
  const userId = `draft-status-${Date.now()}`;

  beforeAll(async () => {
    ({ db, schema } = await import("@/lib/db"));
    ({ getActivePlan } = await import("@/lib/active-plan"));
    await db.insert(schema.users).values({
      id: userId,
      name: "Draft Test",
      email: `${userId}@example.invalid`,
    });
  });

  afterAll(async () => {
    await db.delete(schema.users).where(eq(schema.users.id, userId));
  });

  it("a draft plan is not the active plan", async () => {
    await db.insert(schema.trainingPlans).values({
      userId,
      title: "draft plan",
      raceType: "gran_fondo",
      raceDate: "2026-12-01",
      startDate: "2026-08-05",
      weeksTotal: 12,
      status: "draft",
    });

    expect(await getActivePlan(userId)).toBeNull();
  });

  it("a draft alongside an active plan does not win", async () => {
    const [active] = await db
      .insert(schema.trainingPlans)
      .values({
        userId,
        title: "active plan",
        raceType: "gran_fondo",
        raceDate: "2026-12-01",
        startDate: "2026-08-05",
        weeksTotal: 12,
        status: "active",
      })
      .returning();

    const found = await getActivePlan(userId);
    expect(found?.id).toBe(active.id);
  });
});

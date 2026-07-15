import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

// get_training_load_summary weekly buckets (v0.4c). Requires Postgres.
const hasDb =
  !!process.env.DATABASE_URL && process.env.DATABASE_DRIVER === "pg";

const USER = "test-load-summary-user";

async function cleanup() {
  const { db, schema } = await import("@/lib/db");
  await db.delete(schema.activities).where(eq(schema.activities.userId, USER));
  await db
    .delete(schema.wellnessDaily)
    .where(eq(schema.wellnessDaily.userId, USER));
  await db.delete(schema.users).where(eq(schema.users.id, USER));
}

describe.skipIf(!hasDb)("get_training_load_summary weekly buckets", () => {
  beforeAll(async () => {
    await cleanup();
    const { db, schema } = await import("@/lib/db");
    await db
      .insert(schema.users)
      .values({ id: USER, name: "Load", email: "load-summary@example.invalid" })
      .onConflictDoNothing();
    const now = new Date();
    await db.insert(schema.activities).values([
      {
        userId: USER,
        provider: "intervals_icu",
        externalId: "a1",
        startDate: now,
        sport: "Ride",
        load: 80,
        durationS: 7200,
        distanceM: 60000,
      },
      {
        userId: USER,
        provider: "strava", // must be EXCLUDED from buckets
        externalId: "s1",
        startDate: now,
        sport: "Ride",
        load: 500,
        durationS: 7200,
        distanceM: 60000,
      },
    ]);
    await db.insert(schema.wellnessDaily).values({
      userId: USER,
      date: now.toISOString().slice(0, 10),
      ctl: 60,
      atl: 45,
      source: "intervals_icu",
    });
  });

  afterAll(cleanup);

  it("returns weekly buckets excluding Strava, plus CTL/ATL/TSB", async () => {
    const { allTools } = await import("@/lib/tools/registry");
    const { db } = await import("@/lib/db");
    const tool = allTools.find((t) => t.name === "get_training_load_summary")!;

    expect(tool.parameters.safeParse({}).success).toBe(true);
    expect(tool.parameters.safeParse({ weeks: 4 }).success).toBe(true);
    expect(tool.parameters.safeParse({ weeks: 5 }).success).toBe(false);

    const result = (await tool.execute({ weeks: 4 }, { userId: USER, db })) as {
      weeks: Array<{
        week_start: string;
        load: number;
        hours: number;
        distance_km: number;
        sessions: number;
      }>;
      current: {
        ctl_fitness: number | null;
        atl_fatigue: number | null;
        tsb_form: number | null;
      };
    };

    expect(result.weeks).toHaveLength(4);
    const thisWeek = result.weeks.at(-1)!;
    expect(thisWeek.load).toBe(80); // Strava's 500 excluded
    expect(thisWeek.hours).toBe(2);
    expect(thisWeek.distance_km).toBe(60);
    expect(thisWeek.sessions).toBe(1);
    expect(result.current).toMatchObject({
      ctl_fitness: 60,
      atl_fatigue: 45,
      tsb_form: 15,
    });
  });
});

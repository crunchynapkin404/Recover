import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

const hasDb =
  !!process.env.DATABASE_URL && process.env.DATABASE_DRIVER === "pg";
const USER = "test-race-debrief-user";

function ymdOffset(base: Date, days: number): string {
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

async function cleanup() {
  const { db, schema } = await import("@/lib/db");
  const threads = await db.query.chatThreads.findMany({
    where: eq(schema.chatThreads.userId, USER),
  });
  for (const t of threads)
    await db
      .delete(schema.chatMessages)
      .where(eq(schema.chatMessages.threadId, t.id));
  await db
    .delete(schema.chatThreads)
    .where(eq(schema.chatThreads.userId, USER));
  await db.delete(schema.activities).where(eq(schema.activities.userId, USER));
  await db.delete(schema.races).where(eq(schema.races.userId, USER));
  await db.delete(schema.users).where(eq(schema.users.id, USER));
}

describe.skipIf(!hasDb)("post-race debrief", () => {
  const now = new Date();
  beforeAll(async () => {
    await cleanup();
    const { db, schema } = await import("@/lib/db");
    await db.insert(schema.users).values({
      id: USER,
      name: "Debriefee",
      email: "race-debrief@example.invalid",
    });
  });
  afterAll(cleanup);

  it("debriefs a raced race exactly once", async () => {
    const { db, schema } = await import("@/lib/db");
    const raceDate = ymdOffset(now, -1);
    const [race] = await db
      .insert(schema.races)
      .values({
        userId: USER,
        name: "Yesterday 10k",
        raceType: "10k",
        date: raceDate,
        priority: "A",
      })
      .returning();
    await db.insert(schema.activities).values({
      userId: USER,
      provider: "manual",
      externalId: "debrief-act-1",
      sport: "Run",
      startDate: new Date(raceDate + "T09:00:00"),
      durationS: 2500,
      load: 95,
    });
    const { runRaceDebriefs } = await import("@/lib/race/debrief");
    const first = await runRaceDebriefs(USER, {
      llm: async () => "Great race — recover well.",
    });
    expect(first).toBe("posted");
    const updated = await db.query.races.findFirst({
      where: eq(schema.races.id, race.id),
    });
    expect(updated?.status).toBe("completed");
    expect(updated?.resultActivityId).toBeTruthy();
    expect(updated?.debriefedAt).toBeTruthy();

    expect(await runRaceDebriefs(USER)).toBe("skipped");
  });

  it("waits 48h before the no-data message, then posts it once", async () => {
    const { db, schema } = await import("@/lib/db");
    const raceDate = ymdOffset(now, -1);
    await db.insert(schema.races).values({
      userId: USER,
      name: "Ghost race",
      raceType: "5k",
      date: raceDate,
      priority: "C",
    });
    const { runRaceDebriefs, DEBRIEF_NO_DATA_HOURS } =
      await import("@/lib/race/debrief");
    // within the window: skipped, race untouched
    expect(await runRaceDebriefs(USER)).toBe("skipped");
    // past the window:
    const later = new Date(
      new Date(raceDate + "T00:00:00").getTime() +
        (DEBRIEF_NO_DATA_HOURS + 1) * 3_600_000
    );
    const r = await runRaceDebriefs(USER, { now: later });
    expect(r).toBe("posted");
    const ghost = await db.query.races.findFirst({
      where: eq(schema.races.name, "Ghost race"),
    });
    expect(ghost?.status).toBe("upcoming"); // the user decides
    expect(ghost?.debriefedAt).toBeTruthy();
    expect(await runRaceDebriefs(USER, { now: later })).toBe("skipped");
  });

  it("strava result links but its stats stay out of the narrative", async () => {
    const { db, schema } = await import("@/lib/db");
    const raceDate = ymdOffset(now, -2);
    await db.insert(schema.races).values({
      userId: USER,
      name: "Strava race",
      raceType: "10k",
      date: raceDate,
      priority: "B",
    });
    await db.insert(schema.activities).values({
      userId: USER,
      provider: "strava",
      externalId: "debrief-strava-1",
      sport: "Run",
      startDate: new Date(raceDate + "T09:00:00"),
      durationS: 2400,
      load: 90,
    });
    let prompt = "";
    const { runRaceDebriefs } = await import("@/lib/race/debrief");
    const r = await runRaceDebriefs(USER, {
      llm: async (p) => {
        prompt = p;
        return "Linked without stats.";
      },
    });
    expect(r).toBe("posted");
    expect(prompt).not.toContain("2400");
    expect(prompt).not.toContain("90");
    expect(prompt.toLowerCase()).toContain("strava");
  });
});

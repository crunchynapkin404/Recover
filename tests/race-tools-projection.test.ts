// tests/race-tools-projection.test.ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

/**
 * v0.41 — the coach can see the race. A separate file from
 * tests/race-tools.test.ts on purpose: that suite's final test deletes every
 * race belonging to its user and asserts the registry tool count, so cases
 * added there are order-fragile.
 */

const hasDb =
  !!process.env.DATABASE_URL && process.env.DATABASE_DRIVER === "pg";
const USER = "test-race-projection-user";

function ymd(daysFromNow: number): string {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

async function cleanup() {
  const { db, schema } = await import("@/lib/db");
  await db.delete(schema.races).where(eq(schema.races.userId, USER));
  await db.delete(schema.users).where(eq(schema.users.id, USER));
}

describe.skipIf(!hasDb)("get_races projects the whole race", () => {
  // Fixtures live in beforeAll, not in the first test: several cases below
  // read "Alpine Tour", and a test that only passes because an earlier test
  // inserted its data is a test that passes for the wrong reason.
  beforeAll(async () => {
    await cleanup();
    const { db, schema } = await import("@/lib/db");
    await db.insert(schema.users).values({
      id: USER,
      name: "ProjectionUser",
      email: "race-projection@example.invalid",
    });
    // A 4-day event with totals but NO per-day stage rows — the ambiguous
    // case the tool description has to keep the coach from misreading.
    await db.insert(schema.races).values({
      userId: USER,
      name: "Alpine Tour",
      raceType: "gran fondo",
      sport: "Ride",
      date: ymd(30),
      priority: "A",
      goalNote: "finish every stage",
      eventDays: 4,
      distanceKm: 480,
      elevationM: 9000,
      demandHoursOverride: 14,
    });
  });
  afterAll(cleanup);

  it("returns the demand columns v0.28 added, not just the original nine", async () => {
    const { db } = await import("@/lib/db");
    const { getRacesTool } = await import("@/lib/tools/get-races");
    const listed = (await getRacesTool.execute({}, { userId: USER, db })) as {
      races: {
        name: string;
        eventDays: number;
        distanceKm: number | null;
        elevationM: number | null;
        demandHoursOverride: number | null;
        resultActivityId: string | null;
        daysToRace: number;
      }[];
    };

    const race = listed.races.find((r) => r.name === "Alpine Tour")!;
    expect(race.eventDays).toBe(4);
    expect(race.distanceKm).toBe(480);
    expect(race.elevationM).toBe(9000);
    expect(race.demandHoursOverride).toBe(14);
    expect(race.resultActivityId).toBeNull();
    expect(race.daysToRace).toBe(30);
  });

  it("withholds the server-side and bookkeeping columns", async () => {
    const { db } = await import("@/lib/db");
    const { getRacesTool } = await import("@/lib/tools/get-races");
    const listed = (await getRacesTool.execute({}, { userId: USER, db })) as {
      races: Record<string, unknown>[];
    };
    const race = listed.races.find((r) => r.name === "Alpine Tour")!;
    for (const withheld of [
      "userId",
      "debriefedAt",
      "createdAt",
      "updatedAt",
    ]) {
      expect(race).not.toHaveProperty(withheld);
    }
  });
});

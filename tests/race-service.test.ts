// tests/race-service.test.ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

const hasDb =
  !!process.env.DATABASE_URL && process.env.DATABASE_DRIVER === "pg";

const USER = "test-race-service-user";

async function cleanup() {
  const { db, schema } = await import("@/lib/db");
  await db.delete(schema.races).where(eq(schema.races.userId, USER));
  await db.delete(schema.users).where(eq(schema.users.id, USER));
}

function ymd(daysFromNow: number): string {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

describe.skipIf(!hasDb)("race service CRUD", () => {
  beforeAll(async () => {
    await cleanup();
    const { db, schema } = await import("@/lib/db");
    await db.insert(schema.users).values({
      id: USER,
      name: "Racer",
      email: "race-service@example.invalid",
    });
  });
  afterAll(cleanup);

  it("creates a race and lists it", async () => {
    const { createRace, listRaces } = await import("@/lib/race/service");
    const r = await createRace(USER, {
      name: "City Marathon",
      raceType: "marathon",
      date: ymd(56),
      priority: "A",
      goalNote: "sub 3:30",
    });
    expect("race" in r && r.race.priority).toBe("A");
    const all = await listRaces(USER);
    expect(all).toHaveLength(1);
    expect(all[0].name).toBe("City Marathon");
  });

  it("rejects a past date", async () => {
    const { createRace } = await import("@/lib/race/service");
    const r = await createRace(USER, {
      name: "Yesterday 5k",
      raceType: "5k",
      date: ymd(-1),
      priority: "C",
    });
    expect(r).toEqual({ error: "past_date" });
  });

  it("upserts on (user, date, name) instead of duplicating", async () => {
    const { createRace, listRaces } = await import("@/lib/race/service");
    const again = await createRace(USER, {
      name: "City Marathon",
      raceType: "marathon",
      date: ymd(56),
      priority: "B",
    });
    expect("race" in again && again.race.priority).toBe("B");
    expect(await listRaces(USER)).toHaveLength(1);
  });

  it("nextUpcomingRace returns the earliest upcoming race", async () => {
    const { createRace, nextUpcomingRace } = await import("@/lib/race/service");
    await createRace(USER, {
      name: "Tune-up 10k",
      raceType: "10k",
      date: ymd(14),
      priority: "C",
    });
    const next = await nextUpcomingRace(USER);
    expect(next?.name).toBe("Tune-up 10k");
  });

  it("update patches fields; delete removes", async () => {
    const { listRaces, updateRace, deleteRace } =
      await import("@/lib/race/service");
    const [tuneUp] = await listRaces(USER, { priority: "C" });
    const updated = await updateRace(USER, tuneUp.id, { status: "skipped" });
    expect("status" in updated && updated.status).toBe("skipped");
    expect(await deleteRace(USER, tuneUp.id)).toBe(true);
    expect(await listRaces(USER)).toHaveLength(1);
  });

  it("nextUpcomingRace breaks same-date ties by createdAt, not row-storage order", async () => {
    const { createRace, nextUpcomingRace, deleteRace, listRaces } =
      await import("@/lib/race/service");
    const { db, schema } = await import("@/lib/db");
    const { eq } = await import("drizzle-orm");
    // Same future date, two A-priority races — the scenario Task 11's
    // implicit-A-race creation makes possible. Earlier than "City Marathon"
    // (day 56) so it's unambiguously the *next* race.
    const tieDate = ymd(30);
    // Insert "B" physically first, "A" physically second, then force A's
    // createdAt to be earlier than B's. Without an explicit ORDER BY on
    // createdAt, Postgres tends to return rows in physical/insertion order
    // — i.e. B — so this decouples insertion order from createdAt order
    // and proves the sort genuinely keys off the column, not storage luck.
    const b = await createRace(USER, {
      name: "Tiebreak Marathon B",
      raceType: "marathon",
      date: tieDate,
      priority: "A",
    });
    const a = await createRace(USER, {
      name: "Tiebreak Marathon A",
      raceType: "marathon",
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

    const next = await nextUpcomingRace(USER);
    expect(next?.name).toBe("Tiebreak Marathon A");
    expect(next?.id).toBe(a.race.id);

    await deleteRace(USER, a.race.id);
    await deleteRace(USER, b.race.id);
    expect(await listRaces(USER, { priority: "A" })).toHaveLength(0);
  });
});

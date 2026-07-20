import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

const hasDb =
  !!process.env.DATABASE_URL && process.env.DATABASE_DRIVER === "pg";

const USER = "test-activity-poll-user";

// 10:00 local on a fixed day — inside the poll window.
const NOW = new Date(2026, 6, 20, 10, 0, 0);

async function cleanup() {
  const { db, schema } = await import("@/lib/db");
  await db.delete(schema.activities).where(eq(schema.activities.userId, USER));
  await db
    .delete(schema.connections)
    .where(eq(schema.connections.userId, USER));
  await db
    .delete(schema.notificationPrefs)
    .where(eq(schema.notificationPrefs.userId, USER));
  await db
    .delete(schema.dailyMetrics)
    .where(eq(schema.dailyMetrics.userId, USER));
  await db
    .delete(schema.wellnessDaily)
    .where(eq(schema.wellnessDaily.userId, USER));
  await db.delete(schema.users).where(eq(schema.users.id, USER));
}

describe("pollWindowOpen", () => {
  it("is closed 23:00–06:00 and open otherwise", async () => {
    const { pollWindowOpen } = await import("@/lib/sync/activity-poll");
    expect(pollWindowOpen(new Date(2026, 6, 20, 5, 59))).toBe(false);
    expect(pollWindowOpen(new Date(2026, 6, 20, 6, 0))).toBe(true);
    expect(pollWindowOpen(new Date(2026, 6, 20, 22, 59))).toBe(true);
    expect(pollWindowOpen(new Date(2026, 6, 20, 23, 0))).toBe(false);
  });
});

describe.skipIf(!hasDb)("runActivityPolls", () => {
  beforeAll(async () => {
    await cleanup();
    const { db, schema } = await import("@/lib/db");
    const { encrypt } = await import("@/lib/crypto");
    await db.insert(schema.users).values({
      id: USER,
      name: "Poll",
      email: "activity-poll@example.invalid",
    });
    await db.insert(schema.connections).values({
      userId: USER,
      provider: "intervals_icu",
      encryptedAccessToken: encrypt("fake-key"),
      externalAthleteId: "i12345",
      status: "active",
    });
  });

  afterAll(cleanup);

  // This DB is shared with a live app instance (docs/PLAN.md) — other
  // active intervals_icu connections legitimately exist for real users.
  // runActivityPolls' query is deliberately global in production (that's
  // the whole point of a scheduler sweep), so every call here passes
  // `userIds: [USER]` to restrict the query itself to this fixture's own
  // connection — no real row is ever matched, fetched for, or written to,
  // not even a cursor-timestamp touch. (A prior version of this test
  // scoped only the mock fetcher's *output* by athlete id instead of the
  // query; that still let the query match real connections and stamp
  // their poll cursor, and it briefly wrote fabricated "poll-ride-1"
  // activity rows into two real accounts before this fix — see the git
  // history. Query-level scoping is the actual fix; do not remove it.)
  it("ingests fresh activities, stamps the cursor, then throttles", async () => {
    const { db, schema } = await import("@/lib/db");
    const { runActivityPolls } = await import("@/lib/sync/activity-poll");
    const fetcher = async () => [
      {
        externalId: "poll-ride-1",
        startDate: new Date(NOW.getTime() - 60 * 60_000),
        sport: "Ride",
        name: "Lunch ride",
        durationS: 3600,
        distanceM: 30000,
        load: 55,
        avgHr: 140,
        avgPower: 180,
        elevationM: 200,
        raw: { icu_rpe: 7, feel: 2 },
      },
    ];
    const polled = await runActivityPolls({
      now: NOW,
      fetcher,
      userIds: [USER],
    });
    expect(polled).toBe(1);
    const row = await db.query.activities.findFirst({
      where: eq(schema.activities.externalId, "poll-ride-1"),
    });
    expect(row).toBeTruthy();
    expect(row?.userId).toBe(USER);
    const conn = await db.query.connections.findFirst({
      where: eq(schema.connections.userId, USER),
    });
    expect(conn?.lastActivityPollAt?.getTime()).toBe(NOW.getTime());
    // Same instant again: inside the 15-min throttle → nobody polled.
    expect(await runActivityPolls({ now: NOW, fetcher, userIds: [USER] })).toBe(
      0
    );
    // 16 minutes later: due again.
    const later = new Date(NOW.getTime() + 16 * 60_000);
    expect(
      await runActivityPolls({ now: later, fetcher, userIds: [USER] })
    ).toBe(1);
  });

  it("skips users who turned ride debriefs off", async () => {
    const { db, schema } = await import("@/lib/db");
    const { runActivityPolls } = await import("@/lib/sync/activity-poll");
    await db
      .insert(schema.notificationPrefs)
      .values({ userId: USER, rideDebriefsEnabled: false })
      .onConflictDoUpdate({
        target: schema.notificationPrefs.userId,
        set: { rideDebriefsEnabled: false },
      });
    const later = new Date(NOW.getTime() + 60 * 60_000);
    const polled = await runActivityPolls({
      now: later,
      fetcher: async () => [],
      userIds: [USER],
    });
    expect(polled).toBe(0);
  });
});

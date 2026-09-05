/**
 * The debrief QUEUE — what happens to the second, third and fourth ride of a
 * day.
 *
 * The spec allows one pending debrief per user and says a second ride the
 * same day "stays unmarked and is promoted to `pending` by a later scheduler
 * tick once the first resolves"
 * (docs/specs/2026-07-19-v0.15-coach-remembers-design.md). It was not: the
 * queue leaked rides at both ends. Promotion filtered on `startDate` against
 * NOW, so a ride that waited its turn aged out of its own queue and was never
 * promoted, never expired and never reviewed — permanently invisible. And
 * expiry keyed on the ACTIVITY's date rather than the card's, so a ride that
 * did get promoted the next morning was expired by the very next 15-minute
 * tick, after a push had already gone out for it.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

const hasDb =
  !!process.env.DATABASE_URL && process.env.DATABASE_DRIVER === "pg";

vi.mock("web-push", async (importOriginal) => {
  const real = await importOriginal<typeof import("web-push")>();
  const mod = (real as unknown as { default?: typeof real }).default ?? real;
  return {
    default: {
      generateVAPIDKeys: mod.generateVAPIDKeys,
      sendNotification: () => {},
    },
  };
});

const USER = "test-debrief-queue-user";
const llm = async () => "review";

vi.mock("@/lib/session", () => ({
  requireUser: async () => ({ id: USER, email: `${USER}@example.invalid` }),
  requireSession: async () => ({ user: { id: USER } }),
}));

// Framework plumbing stub, not the logic under test — the convention every
// server-action test in this repo follows (tests/backfill-action.test.ts).
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

async function cleanup() {
  const { db, schema } = await import("@/lib/db");
  await db
    .delete(schema.chatThreads)
    .where(eq(schema.chatThreads.userId, USER));
  await db.delete(schema.activities).where(eq(schema.activities.userId, USER));
  await db
    .delete(schema.notificationPrefs)
    .where(eq(schema.notificationPrefs.userId, USER));
  await db.delete(schema.users).where(eq(schema.users.id, USER));
}

/** A Saturday ride at `hour`, ingested the moment it happened. */
async function ride(
  hour: number,
  name: string,
  over: Record<string, unknown> = {}
) {
  const { db, schema } = await import("@/lib/db");
  const at = new Date(2026, 6, 18, hour, 0, 0);
  const [a] = await db
    .insert(schema.activities)
    .values({
      userId: USER,
      provider: "intervals_icu",
      externalId: `q-${name}-${Math.random().toString(36).slice(2)}`,
      startDate: at,
      startDateLocal: at,
      createdAt: at,
      sport: "Ride",
      name,
      durationS: 3600,
      load: 50,
      ...over,
    })
    .returning();
  return a;
}

async function stateOf(id: string) {
  const { db, schema } = await import("@/lib/db");
  const row = await db.query.activities.findFirst({
    where: eq(schema.activities.id, id),
  });
  return { state: row!.debriefState, reviewed: row!.reviewedAt != null };
}

describe.skipIf(!hasDb)("the debrief queue", () => {
  beforeAll(async () => {
    const { db, schema } = await import("@/lib/db");
    await cleanup();
    await db.insert(schema.users).values({
      id: USER,
      name: "Queue",
      email: `${USER}@example.invalid`,
    });
  });
  afterAll(cleanup);

  it("gives a promoted card the day it was promoted, not the ride's own day", async () => {
    const { db, schema } = await import("@/lib/db");
    const { runDebriefLifecycle } = await import("@/lib/debrief/lifecycle");
    const morning = await ride(8, "morning");
    const noon = await ride(12, "noon");

    // Saturday: the morning ride takes the single pending slot.
    await runDebriefLifecycle(USER, { now: new Date(2026, 6, 18, 8, 30), llm });
    expect((await stateOf(morning.id)).state).toBe("pending");
    expect((await stateOf(noon.id)).state).toBe(null);

    // Sunday's first tick: the morning card expires unanswered, and the noon
    // ride finally gets its turn.
    await runDebriefLifecycle(USER, { now: new Date(2026, 6, 19, 8, 0), llm });
    expect((await stateOf(morning.id)).state).toBe("expired");
    expect((await stateOf(noon.id)).state).toBe("pending");

    // The next tick is fifteen minutes later. The athlete has had no chance
    // to answer, and a push has already gone out — the card must still be up.
    await runDebriefLifecycle(USER, { now: new Date(2026, 6, 19, 8, 15), llm });
    expect((await stateOf(noon.id)).state).toBe("pending");
    // ...all day.
    await runDebriefLifecycle(USER, { now: new Date(2026, 6, 19, 21, 0), llm });
    expect((await stateOf(noon.id)).state).toBe("pending");

    // And it expires on the day AFTER the one it was shown on.
    await runDebriefLifecycle(USER, { now: new Date(2026, 6, 20, 8, 0), llm });
    expect(await stateOf(noon.id)).toEqual({
      state: "expired",
      reviewed: true,
    });

    await db
      .delete(schema.activities)
      .where(eq(schema.activities.userId, USER));
  });

  it("still promotes a ride that waited past the freshness window", async () => {
    const { db, schema } = await import("@/lib/db");
    const { runDebriefLifecycle } = await import("@/lib/debrief/lifecycle");
    const morning = await ride(8, "morning");
    const evening = await ride(18, "evening");

    // One tick a day — the sparse case, and the one that lost rides outright.
    await runDebriefLifecycle(USER, { now: new Date(2026, 6, 18, 19, 0), llm });
    expect((await stateOf(morning.id)).state).toBe("pending");

    await runDebriefLifecycle(USER, { now: new Date(2026, 6, 19, 19, 0), llm });
    expect((await stateOf(morning.id)).state).toBe("expired");
    // 25 hours old by now, but it has been queued since it landed — it was
    // never a historical import, and it is the athlete's own ride from
    // yesterday. It must not vanish.
    expect((await stateOf(evening.id)).state).toBe("pending");

    await db
      .delete(schema.activities)
      .where(eq(schema.activities.userId, USER));
  });

  it("hands the slot to the next ride the moment one is answered", async () => {
    const { db, schema } = await import("@/lib/db");
    const { runDebriefLifecycle } = await import("@/lib/debrief/lifecycle");
    const { submitDebrief } = await import("@/app/activity/debrief-actions");
    // Real dates, not the fixed Saturday the other cases use: the action
    // calls the lifecycle on the real clock, which is the point of the test.
    const now = new Date();
    const hoursAgo = (h: number) => new Date(now.getTime() - h * 3_600_000);
    const morning = await ride(0, "morning", {
      startDate: hoursAgo(6),
      startDateLocal: hoursAgo(6),
      createdAt: hoursAgo(6),
    });
    const noon = await ride(0, "noon", {
      startDate: hoursAgo(3),
      startDateLocal: hoursAgo(3),
      createdAt: hoursAgo(3),
    });

    await runDebriefLifecycle(USER, { now, llm });
    expect((await stateOf(morning.id)).state).toBe("pending");

    // The athlete answers the first one on the same Saturday evening. The
    // second ride's card must come up NOW — waiting for the next scheduler
    // tick means it arrives the next morning at the earliest, by which time
    // the athlete is no longer thinking about either ride.
    const res = await submitDebrief(morning.id, {
      rpe: 7,
      feel: "normal",
      notes: null,
      wasPlanned: null,
    });
    expect(res.ok).toBe(true);
    expect((await stateOf(morning.id)).state).toBe("answered");
    expect((await stateOf(noon.id)).state).toBe("pending");

    await db
      .delete(schema.activities)
      .where(eq(schema.activities.userId, USER));
  });

  it("never promotes a ride that was already old when it was ingested", async () => {
    const { db, schema } = await import("@/lib/db");
    const { runDebriefLifecycle } = await import("@/lib/debrief/lifecycle");
    // A backfill: the row is created now, the ride is from 2019.
    const imported = await ride(8, "imported", {
      startDate: new Date(2019, 4, 1, 8, 0, 0),
      startDateLocal: new Date(2019, 4, 1, 8, 0, 0),
      createdAt: new Date(2026, 6, 18, 19, 0, 0),
    });

    await runDebriefLifecycle(USER, { now: new Date(2026, 6, 18, 19, 0), llm });
    expect((await stateOf(imported.id)).state).toBe(null);

    await db
      .delete(schema.activities)
      .where(eq(schema.activities.userId, USER));
  });
});

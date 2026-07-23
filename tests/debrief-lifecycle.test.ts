import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, isNull } from "drizzle-orm";

const hasDb =
  !!process.env.DATABASE_URL && process.env.DATABASE_DRIVER === "pg";

const USER = "test-debrief-lifecycle-user";
const NOW = new Date(2026, 6, 20, 10, 0, 0);

async function cleanup() {
  const { db, schema } = await import("@/lib/db");
  await db
    .delete(schema.chatThreads)
    .where(eq(schema.chatThreads.userId, USER));
  await db.delete(schema.races).where(eq(schema.races.userId, USER));
  await db.delete(schema.activities).where(eq(schema.activities.userId, USER));
  await db
    .delete(schema.notificationPrefs)
    .where(eq(schema.notificationPrefs.userId, USER));
  await db
    .delete(schema.dailyMetrics)
    .where(eq(schema.dailyMetrics.userId, USER));
  await db.delete(schema.users).where(eq(schema.users.id, USER));
}

async function makeActivity(over: Record<string, unknown> = {}) {
  const { db, schema } = await import("@/lib/db");
  const [a] = await db
    .insert(schema.activities)
    .values({
      userId: USER,
      provider: "intervals_icu",
      externalId: `dl-${Math.random().toString(36).slice(2)}`,
      startDate: new Date(NOW.getTime() - 2 * 3_600_000),
      sport: "Ride",
      name: "Lifecycle ride",
      durationS: 3600,
      load: 50,
      ...over,
    })
    .returning();
  return a;
}

describe("debriefEligible", () => {
  const base = {
    provider: "intervals_icu",
    durationS: 3600,
    startDate: new Date(NOW.getTime() - 3_600_000),
    debriefState: null as string | null,
  };
  it("accepts a fresh non-strava ride and rejects the rest", async () => {
    const { debriefEligible, DEBRIEF_MIN_DURATION_S } =
      await import("@/lib/debrief/lifecycle");
    expect(debriefEligible(base, NOW)).toBe(true);
    expect(debriefEligible({ ...base, provider: "strava" }, NOW)).toBe(false);
    expect(debriefEligible({ ...base, debriefState: "answered" }, NOW)).toBe(
      false
    );
    expect(
      debriefEligible({ ...base, durationS: DEBRIEF_MIN_DURATION_S - 1 }, NOW)
    ).toBe(false);
    expect(
      debriefEligible(
        { ...base, startDate: new Date(NOW.getTime() - 25 * 3_600_000) },
        NOW
      )
    ).toBe(false);
  });

  it("treats a null duration as eligible only when intervals.icu withheld it for being Strava-sourced", async () => {
    const { debriefEligible } = await import("@/lib/debrief/lifecycle");
    // intervals.icu's own "not available via the API" note for Strava-origin
    // activities — durationS is null not because sync hasn't finished, but
    // because it structurally never will.
    expect(
      debriefEligible(
        { ...base, durationS: null, raw: { source: "STRAVA" } },
        NOW
      )
    ).toBe(true);
    // A plain null duration (not yet synced, unrelated to Strava) still
    // waits its turn rather than being assumed eligible.
    expect(debriefEligible({ ...base, durationS: null }, NOW)).toBe(false);
    expect(
      debriefEligible(
        { ...base, durationS: null, raw: { source: "GARMIN_CONNECT" } },
        NOW
      )
    ).toBe(false);
  });
});

describe("intervals.icu prefills", () => {
  it("maps icu_rpe and feel (1=strong … 5=weak)", async () => {
    const { feelFromIcu, rpeFromRaw } = await import("@/lib/debrief/lifecycle");
    expect(feelFromIcu(1)).toBe("strong");
    expect(feelFromIcu(3)).toBe("normal");
    expect(feelFromIcu(5)).toBe("weak");
    expect(feelFromIcu(undefined)).toBe(null);
    expect(rpeFromRaw({ icu_rpe: 7 })).toBe(7);
    expect(rpeFromRaw({ icu_rpe: 99 })).toBe(null);
    expect(rpeFromRaw(null)).toBe(null);
  });
});

describe.skipIf(!hasDb)("runDebriefLifecycle", () => {
  beforeAll(async () => {
    await cleanup();
    const { db, schema } = await import("@/lib/db");
    await db.insert(schema.users).values({
      id: USER,
      name: "Lifecycle",
      email: "debrief-lifecycle@example.invalid",
    });
  });

  afterAll(cleanup);

  it("promotes exactly one eligible activity to pending", async () => {
    const { db, schema } = await import("@/lib/db");
    const { runDebriefLifecycle } = await import("@/lib/debrief/lifecycle");
    const first = await makeActivity();
    const second = await makeActivity({
      startDate: new Date(NOW.getTime() - 3_600_000),
    });
    await runDebriefLifecycle(USER, { now: NOW, llm: async () => "review" });
    const rows = await db.query.activities.findMany({
      where: and(
        eq(schema.activities.userId, USER),
        eq(schema.activities.debriefState, "pending")
      ),
    });
    expect(rows.length).toBe(1);
    // Oldest first: `first` started earlier.
    expect(rows[0].id).toBe(first.id);
    // Second run with one already pending promotes nothing new.
    await runDebriefLifecycle(USER, { now: NOW, llm: async () => "review" });
    const again = await db.query.activities.findMany({
      where: and(
        eq(schema.activities.userId, USER),
        eq(schema.activities.debriefState, "pending")
      ),
    });
    expect(again.length).toBe(1);
    expect(second.id).toBeTruthy();
  });

  it("expires a pending card from a previous day and reviews it data-only", async () => {
    const { db, schema } = await import("@/lib/db");
    const { runDebriefLifecycle } = await import("@/lib/debrief/lifecycle");
    // Reset: resolve current pending state first.
    await db
      .update(schema.activities)
      .set({ debriefState: "answered", reviewedAt: new Date() })
      .where(eq(schema.activities.userId, USER));
    const stale = await makeActivity({
      debriefState: "pending",
      startDate: new Date(2026, 6, 19, 18, 0, 0), // yesterday
    });
    await runDebriefLifecycle(USER, { now: NOW, llm: async () => "" });
    const updated = await db.query.activities.findFirst({
      where: eq(schema.activities.id, stale.id),
    });
    expect(updated?.debriefState).toBe("expired");
    expect(updated?.reviewedAt).toBeTruthy();
    const msg = await db.query.chatMessages.findFirst({
      where: eq(schema.chatMessages.threadId, updated!.debriefThreadId!),
    });
    expect(msg?.content).toContain("gave no feedback");
  });

  it("race debrief claims its result activity so the review loop never doubles up", async () => {
    // A ride can be promoted to `pending` before the race debrief claims it
    // as the race's result — the `reviewedAt` claim (src/lib/race/debrief.ts,
    // inside the same transaction that sets resultActivityId) must make the
    // later review generation a no-op either way.
    const { db, schema } = await import("@/lib/db");
    const { runRaceDebriefs } = await import("@/lib/race/debrief");
    const { generateRideReview } = await import("@/lib/debrief/ride-review");

    const raceDate = "2026-07-19";
    const [race] = await db
      .insert(schema.races)
      .values({
        userId: USER,
        name: "Claim test race",
        raceType: "10k",
        date: raceDate,
        priority: "B",
      })
      .returning();
    const resultActivity = await makeActivity({
      startDate: new Date(raceDate + "T09:00:00"),
      sport: "Run",
      // Simulates runDebriefLifecycle having already promoted this ride to
      // `pending` before the race debrief tick ran.
      debriefState: "pending",
    });

    await runRaceDebriefs(USER, { now: NOW, llm: async () => "Solid effort." });

    const claimedRace = await db.query.races.findFirst({
      where: eq(schema.races.id, race.id),
    });
    expect(claimedRace?.resultActivityId).toBe(resultActivity.id);
    expect(claimedRace?.status).toBe("completed");

    const claimedActivity = await db.query.activities.findFirst({
      where: eq(schema.activities.id, resultActivity.id),
    });
    expect(claimedActivity?.reviewedAt).toBeTruthy();

    // generateRideReview (and thus the lifecycle's retry step) must treat
    // the claimed activity as already reviewed — never post a second,
    // fabricated ride review on top of the race debrief.
    const outcome = await generateRideReview(resultActivity.id, {
      now: NOW,
      llm: async () => "should never run",
    });
    expect(outcome).toBe("skipped");
  });

  it("honors rideDebriefsEnabled: false as the whole loop's kill switch, even called directly (not via activity-poll)", async () => {
    const { db, schema } = await import("@/lib/db");
    const { runDebriefLifecycle } = await import("@/lib/debrief/lifecycle");

    // Clear any prior state on this user's activities so the eligible ride
    // below is the only candidate for promotion.
    await db
      .delete(schema.activities)
      .where(eq(schema.activities.userId, USER));
    await db.insert(schema.notificationPrefs).values({
      userId: USER,
      rideDebriefsEnabled: false,
    });

    const eligible = await makeActivity();
    await runDebriefLifecycle(USER, { now: NOW, llm: async () => "review" });

    const updated = await db.query.activities.findFirst({
      where: eq(schema.activities.id, eligible.id),
    });
    expect(updated?.debriefState).toBeNull();
  });
});

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

const hasDb =
  !!process.env.DATABASE_URL && process.env.DATABASE_DRIVER === "pg";

const USER = "test-ride-review-user";

async function cleanup() {
  const { db, schema } = await import("@/lib/db");
  await db
    .delete(schema.chatThreads)
    .where(eq(schema.chatThreads.userId, USER));
  await db.delete(schema.races).where(eq(schema.races.userId, USER));
  await db.delete(schema.activities).where(eq(schema.activities.userId, USER));
  await db
    .delete(schema.dailyMetrics)
    .where(eq(schema.dailyMetrics.userId, USER));
  await db.delete(schema.llmUsage).where(eq(schema.llmUsage.userId, USER));
  await db.delete(schema.users).where(eq(schema.users.id, USER));
}

function localYmd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

async function makeActivity(over: Record<string, unknown> = {}) {
  const { db, schema } = await import("@/lib/db");
  const [a] = await db
    .insert(schema.activities)
    .values({
      userId: USER,
      provider: "intervals_icu",
      externalId: `rr-${Math.random().toString(36).slice(2)}`,
      startDate: new Date(),
      sport: "Ride",
      name: "Test ride",
      durationS: 3600,
      load: 60,
      debriefState: "answered",
      perceivedExertion: 8,
      feel: "normal",
      debriefNotes: "legs were heavy on the last climb",
      ...over,
    })
    .returning();
  return a;
}

describe.skipIf(!hasDb)("generateRideReview", () => {
  beforeAll(async () => {
    await cleanup();
    const { db, schema } = await import("@/lib/db");
    await db.insert(schema.users).values({
      id: USER,
      name: "Reviewer",
      email: "ride-review@example.invalid",
    });
  });

  afterAll(cleanup);

  it("posts once into a debrief thread and is idempotent", async () => {
    const { db, schema } = await import("@/lib/db");
    const { generateRideReview } = await import("@/lib/debrief/ride-review");
    const a = await makeActivity();
    const first = await generateRideReview(a.id, {
      llm: async () => "Solid ride. RPE 8 matches the load.",
    });
    expect(first).toBe("posted");
    const updated = await db.query.activities.findFirst({
      where: eq(schema.activities.id, a.id),
    });
    expect(updated?.reviewedAt).toBeTruthy();
    expect(updated?.debriefThreadId).toBeTruthy();
    const thread = await db.query.chatThreads.findFirst({
      where: eq(schema.chatThreads.id, updated!.debriefThreadId!),
    });
    expect(thread?.kind).toBe("debrief");
    expect(await generateRideReview(a.id, { llm: async () => "again" })).toBe(
      "skipped"
    );
  });

  it("data-only review states the athlete gave no feedback", async () => {
    const { db, schema } = await import("@/lib/db");
    const { generateRideReview } = await import("@/lib/debrief/ride-review");
    const a = await makeActivity({
      debriefState: "skipped",
      perceivedExertion: null,
      feel: null,
      debriefNotes: null,
    });
    // Empty LLM output forces the deterministic template.
    await generateRideReview(a.id, { llm: async () => "" });
    const updated = await db.query.activities.findFirst({
      where: eq(schema.activities.id, a.id),
    });
    const msg = await db.query.chatMessages.findFirst({
      where: eq(schema.chatMessages.threadId, updated!.debriefThreadId!),
    });
    expect(msg?.content).toContain("gave no feedback");
  });

  it("never reviews strava or null-state activities", async () => {
    const { generateRideReview } = await import("@/lib/debrief/ride-review");
    const s = await makeActivity({ provider: "strava" });
    expect(await generateRideReview(s.id, { llm: async () => "x" })).toBe(
      "skipped"
    );
    const n = await makeActivity({ debriefState: null });
    expect(await generateRideReview(n.id, { llm: async () => "x" })).toBe(
      "skipped"
    );
  });

  it("defers to the race debrief when the activity is today's race result (real ordering: debrief card answered before runRaceDebriefs runs)", async () => {
    // Regression for the double-post found in the final whole-branch review:
    // race day, athlete answers the debrief card same-day (submitDebrief
    // calls generateRideReview inline, unconditionally) — this must NOT post
    // a standalone ride review, because runRaceDebriefs won't be eligible to
    // claim the activity until the day AFTER the race (lt(races.date, today)).
    const { db, schema } = await import("@/lib/db");
    const { generateRideReview } = await import("@/lib/debrief/ride-review");

    const raceDay = new Date(2026, 6, 20, 10, 0, 0);
    const nextDay = new Date(2026, 6, 21, 10, 0, 0);
    const today = localYmd(raceDay);
    await db.insert(schema.races).values({
      userId: USER,
      name: "Same-day race",
      raceType: "10k",
      date: today,
      priority: "A",
      status: "upcoming",
    });
    const raceResultActivity = await makeActivity({
      sport: "Run",
      startDate: raceDay,
      debriefState: "answered",
    });

    const outcome = await generateRideReview(raceResultActivity.id, {
      now: raceDay,
      llm: async () => "should never run",
    });
    expect(outcome).toBe("skipped");

    const updated = await db.query.activities.findFirst({
      where: eq(schema.activities.id, raceResultActivity.id),
    });
    expect(updated?.reviewedAt).toBeFalsy();
    expect(updated?.debriefThreadId).toBeFalsy();

    // Day 2 (the race is now in the past): runRaceDebriefs claims the
    // activity and posts the race debrief exactly once. This path is also
    // covered end-to-end by "race debrief claims its result activity so the
    // review loop never doubles up" in tests/debrief-lifecycle.test.ts.
    const { runRaceDebriefs } = await import("@/lib/race/debrief");
    await runRaceDebriefs(USER, {
      now: nextDay,
      llm: async () => "Solid 10k.",
    });
    const claimedActivity = await db.query.activities.findFirst({
      where: eq(schema.activities.id, raceResultActivity.id),
    });
    expect(claimedActivity?.reviewedAt).toBeTruthy();
    const claimedRace = await db.query.races.findFirst({
      where: eq(schema.races.name, "Same-day race"),
    });
    expect(claimedRace?.status).toBe("completed");
    expect(claimedRace?.resultActivityId).toBe(raceResultActivity.id);

    // With the race now claimed (reviewedAt set), a later retry correctly
    // no-ops instead of posting a second, independent review.
    expect(
      await generateRideReview(raceResultActivity.id, {
        now: nextDay,
        llm: async () => "should never run either",
      })
    ).toBe("skipped");
  });

  it("posts a failure note after the attempts cap", async () => {
    const { db, schema } = await import("@/lib/db");
    const { generateRideReview, REVIEW_MAX_ATTEMPTS } =
      await import("@/lib/debrief/ride-review");
    const a = await makeActivity({ reviewAttempts: REVIEW_MAX_ATTEMPTS });
    const res = await generateRideReview(a.id, { llm: async () => "unused" });
    expect(res).toBe("posted");
    const updated = await db.query.activities.findFirst({
      where: eq(schema.activities.id, a.id),
    });
    expect(updated?.reviewedAt).toBeTruthy();
    const msg = await db.query.chatMessages.findFirst({
      where: eq(schema.chatMessages.threadId, updated!.debriefThreadId!),
    });
    expect(msg?.content).toContain("couldn't be generated");
  });
});

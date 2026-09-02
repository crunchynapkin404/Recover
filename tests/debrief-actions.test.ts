import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

const hasDb =
  !!process.env.DATABASE_URL && process.env.DATABASE_DRIVER === "pg";

const USER = "test-debrief-answer-user";

async function cleanup() {
  const { db, schema } = await import("@/lib/db");
  await db
    .delete(schema.chatThreads)
    .where(eq(schema.chatThreads.userId, USER));
  await db.delete(schema.activities).where(eq(schema.activities.userId, USER));
  await db.delete(schema.users).where(eq(schema.users.id, USER));
}

describe.skipIf(!hasDb)("storeDebriefAnswer", () => {
  beforeAll(async () => {
    await cleanup();
    const { db, schema } = await import("@/lib/db");
    await db.insert(schema.users).values({
      id: USER,
      name: "Answer",
      email: "debrief-answer@example.invalid",
    });
  });

  afterAll(cleanup);

  async function makePending() {
    const { db, schema } = await import("@/lib/db");
    const [a] = await db
      .insert(schema.activities)
      .values({
        userId: USER,
        provider: "intervals_icu",
        externalId: `da-${Math.random().toString(36).slice(2)}`,
        startDate: new Date(),
        sport: "Ride",
        durationS: 3600,
        debriefState: "pending",
      })
      .returning();
    return a;
  }

  it("stores only provided fields and flips state to answered", async () => {
    const { db, schema } = await import("@/lib/db");
    const { storeDebriefAnswer } = await import("@/lib/debrief/answer");
    const a = await makePending();
    const res = await storeDebriefAnswer(USER, a.id, {
      rpe: 8,
      feel: null,
      notes: null,
      wasPlanned: null,
    });
    expect(res.ok).toBe(true);
    const row = await db.query.activities.findFirst({
      where: eq(schema.activities.id, a.id),
    });
    expect(row?.debriefState).toBe("answered");
    expect(row?.perceivedExertion).toBe(8);
    expect(row?.feel).toBeNull(); // untouched writes nothing
    expect(row?.debriefNotes).toBeNull();
  });

  it("rejects foreign users, non-pending states, and bad RPE", async () => {
    const { storeDebriefAnswer } = await import("@/lib/debrief/answer");
    const a = await makePending();
    expect(
      (
        await storeDebriefAnswer("someone-else", a.id, {
          rpe: 5,
          feel: null,
          notes: null,
          wasPlanned: null,
        })
      ).ok
    ).toBe(false);
    expect(
      (
        await storeDebriefAnswer(USER, a.id, {
          rpe: 11,
          feel: null,
          notes: null,
          wasPlanned: null,
        })
      ).ok
    ).toBe(false);
    await storeDebriefAnswer(USER, a.id, {
      rpe: 5,
      feel: null,
      notes: null,
      wasPlanned: null,
    });
    // Already answered → second submit refused.
    expect(
      (
        await storeDebriefAnswer(USER, a.id, {
          rpe: 5,
          feel: null,
          notes: null,
          wasPlanned: null,
        })
      ).ok
    ).toBe(false);
  });

  it("skip flips state to skipped without touching inputs", async () => {
    const { db, schema } = await import("@/lib/db");
    const { storeDebriefSkip } = await import("@/lib/debrief/answer");
    const a = await makePending();
    const res = await storeDebriefSkip(USER, a.id);
    expect(res.ok).toBe(true);
    const row = await db.query.activities.findFirst({
      where: eq(schema.activities.id, a.id),
    });
    expect(row?.debriefState).toBe("skipped");
    expect(row?.perceivedExertion).toBeNull();
  });

  it("a losing race on double-submit reports ok:false, not a silent no-op", async () => {
    const { db, schema } = await import("@/lib/db");
    const { storeDebriefAnswer } = await import("@/lib/debrief/answer");
    const a = await makePending();
    // First submit wins the race and transitions pending → answered.
    const first = await storeDebriefAnswer(USER, a.id, {
      rpe: 6,
      feel: "normal",
      notes: null,
      wasPlanned: null,
    });
    expect(first.ok).toBe(true);
    // Second submit races in right after — the row is no longer pending, so
    // its UPDATE...WHERE correctly touches 0 rows. The function must report
    // that honestly instead of claiming ok:true on a no-op.
    const second = await storeDebriefAnswer(USER, a.id, {
      rpe: 9,
      feel: "weak",
      notes: "should never be written",
      wasPlanned: null,
    });
    expect(second.ok).toBe(false);
    const row = await db.query.activities.findFirst({
      where: eq(schema.activities.id, a.id),
    });
    // Losing submit's data must never have landed.
    expect(row?.perceivedExertion).toBe(6);
    expect(row?.feel).toBe("normal");
    expect(row?.debriefNotes).toBeNull();
  });

  it("a losing race on double-skip reports ok:false, not a silent no-op", async () => {
    const { storeDebriefSkip } = await import("@/lib/debrief/answer");
    const a = await makePending();
    const first = await storeDebriefSkip(USER, a.id);
    expect(first.ok).toBe(true);
    const second = await storeDebriefSkip(USER, a.id);
    expect(second.ok).toBe(false);
  });
});

/**
 * The one-step completion. The behaviour that matters here is not that "yes"
 * completes the day — it is that a REFUSED completion never costs the athlete
 * the answers they just typed. That is why `markDayDoneForActivity` runs after
 * `storeDebriefAnswer` and outside its transaction, and it is the regression
 * that would actually hurt: an RPE and a note are not recoverable, a status is
 * one tap on Today.
 */
describe.skipIf(!hasDb)("marking the day done from the debrief", () => {
  const U = "test-debrief-oneshot-user";

  async function reset() {
    const { db, schema } = await import("@/lib/db");
    await db.delete(schema.weekPlans).where(eq(schema.weekPlans.userId, U));
    await db.delete(schema.activities).where(eq(schema.activities.userId, U));
    await db.delete(schema.users).where(eq(schema.users.id, U));
  }

  beforeAll(async () => {
    await reset();
    const { db, schema } = await import("@/lib/db");
    await db.insert(schema.users).values({
      id: U,
      name: "One Step",
      email: "debrief-oneshot@example.invalid",
    });
  });
  afterAll(reset);

  async function anActivity(day: string) {
    const { db, schema } = await import("@/lib/db");
    const [a] = await db
      .insert(schema.activities)
      .values({
        userId: U,
        provider: "manual",
        externalId: `oneshot-${day}-${Math.random()}`,
        sport: "Ride",
        startDate: new Date(day + "T09:00:00Z"),
        startDateLocal: new Date(day + "T09:00:00"),
        durationS: 3600,
        debriefState: "pending",
      })
      .returning();
    return a;
  }

  it("resolves the activity to its LOCAL day, not its UTC one", async () => {
    // startDateLocal is the athlete's wall clock, and the plan is written in
    // wall-clock days. A 23:00 ride is already TOMORROW in UTC, so a resolver
    // reading startDate completes the wrong session.
    //
    // Asserted on the resolver directly. The first version of this test called
    // markDayDoneForActivity and asserted "no_open_week", which is returned
    // whichever date it asks about — it could not tell the two apart, and the
    // mutation survived it.
    const { planDayOfActivity } =
      await import("@/lib/week-plan/complete-from-activity");
    expect(
      planDayOfActivity({
        startDate: new Date("2026-09-03T01:00:00Z"),
        startDateLocal: new Date("2026-09-02T23:00:00"),
      })
    ).toBe("2026-09-02");
  });

  it("falls back to startDate when startDateLocal was never backfilled", async () => {
    const { planDayOfActivity } =
      await import("@/lib/week-plan/complete-from-activity");
    const d = new Date("2026-09-02T09:00:00");
    expect(planDayOfActivity({ startDate: d, startDateLocal: null })).toBe(
      "2026-09-02"
    );
  });

  it("returns no_activity for an id that is not this athlete's", async () => {
    const { markDayDoneForActivity } =
      await import("@/lib/week-plan/complete-from-activity");
    const a = await anActivity("2026-09-02");
    expect(await markDayDoneForActivity("someone-else", a.id)).toBe(
      "no_activity"
    );
  });

  it("saves the answers even when the day cannot be completed", async () => {
    // THE REGRESSION THIS BLOCK EXISTS FOR. This athlete has no open week, so
    // the completion refuses — and the RPE, feel and note must survive it.
    const { db, schema } = await import("@/lib/db");
    const { storeDebriefAnswer } = await import("@/lib/debrief/answer");
    const { markDayDoneForActivity } =
      await import("@/lib/week-plan/complete-from-activity");
    const a = await anActivity("2026-09-02");

    const res = await storeDebriefAnswer(U, a.id, {
      rpe: 7,
      feel: "strong",
      notes: "felt good",
      wasPlanned: true,
    });
    expect(res.ok).toBe(true);
    expect(await markDayDoneForActivity(U, a.id)).toBe("no_open_week");

    const saved = await db.query.activities.findFirst({
      where: eq(schema.activities.id, a.id),
    });
    expect(saved?.perceivedExertion).toBe(7);
    expect(saved?.feel).toBe("strong");
    expect(saved?.debriefNotes).toBe("felt good");
    expect(saved?.wasPlannedSession).toBe(true);
  });

  it("records a No without completing anything", async () => {
    const { db, schema } = await import("@/lib/db");
    const { storeDebriefAnswer } = await import("@/lib/debrief/answer");
    const a = await anActivity("2026-09-01");
    await storeDebriefAnswer(U, a.id, {
      rpe: null,
      feel: null,
      notes: null,
      wasPlanned: false,
    });
    const saved = await db.query.activities.findFirst({
      where: eq(schema.activities.id, a.id),
    });
    // false, NOT null: "this was not my planned session" is an answer.
    expect(saved?.wasPlannedSession).toBe(false);
  });

  it("leaves the column null when the question went unanswered", async () => {
    const { db, schema } = await import("@/lib/db");
    const { storeDebriefAnswer } = await import("@/lib/debrief/answer");
    const a = await anActivity("2026-08-31");
    await storeDebriefAnswer(U, a.id, {
      rpe: 5,
      feel: null,
      notes: null,
      wasPlanned: null,
    });
    const saved = await db.query.activities.findFirst({
      where: eq(schema.activities.id, a.id),
    });
    // null means never asked, and must not collapse to false.
    expect(saved?.wasPlannedSession).toBeNull();
  });
});

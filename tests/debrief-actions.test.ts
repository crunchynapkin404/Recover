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
        })
      ).ok
    ).toBe(false);
    expect(
      (
        await storeDebriefAnswer(USER, a.id, {
          rpe: 11,
          feel: null,
          notes: null,
        })
      ).ok
    ).toBe(false);
    await storeDebriefAnswer(USER, a.id, { rpe: 5, feel: null, notes: null });
    // Already answered → second submit refused.
    expect(
      (
        await storeDebriefAnswer(USER, a.id, {
          rpe: 5,
          feel: null,
          notes: null,
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
    });
    expect(first.ok).toBe(true);
    // Second submit races in right after — the row is no longer pending, so
    // its UPDATE...WHERE correctly touches 0 rows. The function must report
    // that honestly instead of claiming ok:true on a no-op.
    const second = await storeDebriefAnswer(USER, a.id, {
      rpe: 9,
      feel: "weak",
      notes: "should never be written",
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

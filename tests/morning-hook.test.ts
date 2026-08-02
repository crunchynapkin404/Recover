import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

const hasDb =
  !!process.env.DATABASE_URL && process.env.DATABASE_DRIVER === "pg";

const maybeSend = vi.fn().mockResolvedValue(true);
vi.mock("@/lib/push", () => ({
  maybeSendMorningReadinessPush: (...args: unknown[]) => maybeSend(...args),
}));

const TEST_USER = "test-morning-hook-user";

describe.skipIf(!hasDb)("scheduler morning-push hook", () => {
  beforeAll(async () => {
    const { db, schema } = await import("@/lib/db");
    await db
      .insert(schema.users)
      .values({ id: TEST_USER, name: "Hook", email: "hook@example.invalid" })
      .onConflictDoNothing();
    await db
      .delete(schema.syncJobs)
      .where(eq(schema.syncJobs.userId, TEST_USER));
    await db.insert(schema.syncJobs).values({
      userId: TEST_USER,
      provider: "intervals_icu",
      kind: "incremental",
      runAfter: new Date(Date.now() - 1000),
    });
    // v0.25.17: the brief/push half of the post-sync hook is now gated on
    // last night's overnight measurement having actually arrived, so the
    // fixture needs a complete wellness row — a successful sync job alone
    // no longer implies a push. See brief-completeness.ts.
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    await db
      .insert(schema.wellnessDaily)
      .values({ userId: TEST_USER, date: today, hrvMs: 62, sleepSecs: 25000 })
      .onConflictDoNothing();
  });

  afterAll(async () => {
    const { db, schema } = await import("@/lib/db");
    await db.delete(schema.users).where(eq(schema.users.id, TEST_USER));
  });

  it("calls the morning push after a successful job", async () => {
    // The tick's post-job hook calls onWellnessDataChanged(userId) with no
    // `now`, so production's 04:00 floor (wellness-changed.ts) reads the real
    // clock and suppresses the push between 00:00-03:59 local — this test
    // failed for four hours a day until the clock was pinned here.
    //
    // Fake ONLY Date: setTimeout/setInterval must stay real or the pg driver
    // stalls. And keep today's real date, moving only the hour — beforeAll
    // seeded the completeness-gate wellness row under today's date, so a
    // different day would make the gate block the brief for a second reason.
    const at9 = new Date();
    at9.setHours(9, 0, 0, 0);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(at9);
    try {
      const { runSchedulerTick } = await import("@/lib/sync/scheduler");
      await runSchedulerTick(async () => {});
      expect(maybeSend).toHaveBeenCalledWith(TEST_USER, undefined);
    } finally {
      vi.useRealTimers();
    }
    // 20s, not the 5s default: runSchedulerTick runs the whole post-job hook
    // chain (weekly review, availability prompt, monthly report, race debrief,
    // debrief lifecycle), which takes ~5s against a populated database. It
    // previously fitted under the default only by luck, and pinning the clock
    // to 09:00 puts more of those once-per-period guards on their live path.
  }, 20_000);
});

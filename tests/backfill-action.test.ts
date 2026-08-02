import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { encrypt } from "@/lib/crypto";

const hasDb =
  !!process.env.DATABASE_URL && process.env.DATABASE_DRIVER === "pg";

const userId = "test-backfill-action-user";

vi.mock("@/lib/session", () => ({
  requireUser: async () => ({ id: userId, email: `${userId}@test.local` }),
  requireSession: async () => ({ user: { id: userId } }),
}));

// Framework plumbing stub, not the logic under test — matches
// tests/plan-start-week.test.ts and every other server-action test in this
// repo that calls revalidatePath outside a real request scope.
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

// MUST stay skipIf-guarded: CI has no DATABASE_URL, and an unguarded DB test
// crashes the whole `checks` job instead of skipping (how PR #20 went red).
describe.skipIf(!hasDb)("backfillHistory action (v0.36)", () => {
  beforeEach(async () => {
    await db.delete(schema.users).where(eq(schema.users.id, userId));
    await db.insert(schema.users).values({
      id: userId,
      name: "Action Test",
      email: `${userId}@test.local`,
    });
  });

  afterEach(async () => {
    await db.delete(schema.users).where(eq(schema.users.id, userId));
  });

  async function connect() {
    await db.insert(schema.connections).values({
      userId,
      provider: "intervals_icu",
      encryptedAccessToken: encrypt("test-api-key"),
      externalAthleteId: "i1",
      status: "active",
    });
  }

  it("refuses when intervals.icu is not connected", async () => {
    const { backfillHistory } = await import("@/app/settings/actions");
    const result = await backfillHistory();

    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/connect intervals\.icu/i);
  });

  it("queues exactly one backfill job", async () => {
    await connect();
    const { backfillHistory } = await import("@/app/settings/actions");

    const result = await backfillHistory();

    expect(result.ok).toBe(true);
    const jobs = await db.query.syncJobs.findMany({
      where: and(
        eq(schema.syncJobs.userId, userId),
        eq(schema.syncJobs.kind, "backfill")
      ),
    });
    expect(jobs).toHaveLength(1);
    expect(jobs[0].provider).toBe("intervals_icu");
    expect(jobs[0].status).toBe("pending");
  });

  it("refuses a second backfill while one is queued", async () => {
    await connect();
    const { backfillHistory } = await import("@/app/settings/actions");
    await backfillHistory();

    const second = await backfillHistory();

    expect(second.ok).toBe(false);
    expect(second.message).toMatch(/already/i);
    const jobs = await db.query.syncJobs.findMany({
      where: and(
        eq(schema.syncJobs.userId, userId),
        eq(schema.syncJobs.kind, "backfill")
      ),
    });
    expect(jobs).toHaveLength(1);
  });

  it("allows a new backfill once the previous one finished", async () => {
    await connect();
    const { backfillHistory } = await import("@/app/settings/actions");
    await backfillHistory();
    await db
      .update(schema.syncJobs)
      .set({ status: "done" })
      .where(eq(schema.syncJobs.userId, userId));

    const again = await backfillHistory();

    expect(again.ok).toBe(true);
  });
});

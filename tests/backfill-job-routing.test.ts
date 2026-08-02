import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";

// Typed against the real export so `.mock.calls[n][1]` and
// `mockImplementationOnce` below see the (userId, opts) signature instead of
// the zero-arg shape TS would otherwise infer from this implementation.
const runIntervalsBackfill = vi.fn<
  typeof import("@/lib/sync/intervals-backfill").runIntervalsBackfill
>(async () => ({
  remapped: 0,
  fetched: 0,
  earliestDate: null,
  truncated: false,
}));
const runIntervalsSync = vi.fn(async () => ({
  wellnessDays: 0,
  activities: 0,
  windowStart: "2026-01-01",
  windowEnd: "2026-01-02",
}));

vi.mock("@/lib/sync/intervals-backfill", () => ({ runIntervalsBackfill }));
vi.mock("@/lib/sync/intervals-sync", () => ({ runIntervalsSync }));

/** Minimal job row; defaultProcessor only reads these three fields. */
function job(overrides: Record<string, unknown> = {}) {
  return {
    id: "00000000-0000-0000-0000-000000000000",
    userId: "test-routing-user",
    provider: "intervals_icu",
    kind: "incremental",
    ...overrides,
  } as unknown as Parameters<
    typeof import("@/lib/sync/scheduler").defaultProcessor
  >[0];
}

describe("backfill job routing (v0.36)", () => {
  beforeEach(() => {
    runIntervalsBackfill.mockClear();
    runIntervalsSync.mockClear();
  });

  it("sends a backfill job to the backfill engine", async () => {
    const { defaultProcessor } = await import("@/lib/sync/scheduler");
    await defaultProcessor(job({ kind: "backfill" }));

    expect(runIntervalsBackfill).toHaveBeenCalledTimes(1);
    // The whole point: it must NOT quietly run an ordinary sync and report
    // success on work that never happened.
    expect(runIntervalsSync).not.toHaveBeenCalled();
  });

  it("still sends an incremental job to the daily sync", async () => {
    const { defaultProcessor } = await import("@/lib/sync/scheduler");
    await defaultProcessor(job({ kind: "incremental" }));

    expect(runIntervalsSync).toHaveBeenCalledTimes(1);
    expect(runIntervalsBackfill).not.toHaveBeenCalled();
  });

  it("throws rather than silently succeeding on a provider it cannot backfill", async () => {
    const { defaultProcessor } = await import("@/lib/sync/scheduler");

    await expect(
      defaultProcessor(job({ kind: "backfill", provider: "whoop" }))
    ).rejects.toThrow(/backfill/i);
    expect(runIntervalsBackfill).not.toHaveBeenCalled();
  });

  it("passes a heartbeat the engine can call", async () => {
    const { defaultProcessor } = await import("@/lib/sync/scheduler");
    await defaultProcessor(job({ kind: "backfill" }));

    const opts = runIntervalsBackfill.mock.calls[0]?.[1] as
      { onProgress?: () => Promise<void> } | undefined;
    expect(typeof opts?.onProgress).toBe("function");
  });
});

const hasDb =
  !!process.env.DATABASE_URL && process.env.DATABASE_DRIVER === "pg";

// MUST stay skipIf-guarded: CI has no DATABASE_URL, and an unguarded DB test
// crashes the whole `checks` job instead of skipping (how PR #20 went red).
describe.skipIf(!hasDb)("backfill heartbeat (v0.36)", () => {
  const userId = "test-backfill-heartbeat-user";

  beforeEach(async () => {
    await db.delete(schema.users).where(eq(schema.users.id, userId));
    await db.insert(schema.users).values({
      id: userId,
      name: "Heartbeat Test",
      email: `${userId}@test.local`,
    });
  });

  afterEach(async () => {
    await db.delete(schema.users).where(eq(schema.users.id, userId));
  });

  it("moves the job's updated_at forward, keeping it out of the stale window", async () => {
    const stale = new Date(Date.now() - 60 * 60_000);
    const [row] = await db
      .insert(schema.syncJobs)
      .values({
        userId,
        provider: "intervals_icu",
        kind: "backfill",
        status: "running",
        updatedAt: stale,
      })
      .returning();

    const { defaultProcessor } = await import("@/lib/sync/scheduler");
    runIntervalsBackfill.mockImplementationOnce(async (_userId, opts) => {
      await (opts as { onProgress: () => Promise<void> }).onProgress();
      return { remapped: 0, fetched: 0, earliestDate: null, truncated: false };
    });
    await defaultProcessor(job({ id: row.id, userId, kind: "backfill" }));

    const after = await db.query.syncJobs.findFirst({
      where: eq(schema.syncJobs.id, row.id),
    });
    expect(after!.updatedAt.getTime()).toBeGreaterThan(stale.getTime());
  });
});

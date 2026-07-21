import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { and, eq } from "drizzle-orm";

// requires Postgres; skips without DATABASE_URL (matches the rest of the
// suite — this repo has no separate test DB, so every row here is test-*
// scoped and every query below filters on it).
const hasDb =
  !!process.env.DATABASE_URL && process.env.DATABASE_DRIVER === "pg";

// The acting identities (owner vs. non-owner) never touch the DB — they're
// substituted via a mocked requireUser(), same as admin/page.tsx's guard
// just reads session.user.role. Only the job's *owning* user needs a real
// row, since sync_jobs.user_id is an FK.
const OWNER = { id: "test-sync-panel-owner", role: "owner" as const };
const MEMBER = { id: "test-sync-panel-member", role: "member" as const };
const JOB_USER = "test-sync-panel-jobuser";

const { requireUserMock } = vi.hoisted(() => ({ requireUserMock: vi.fn() }));
vi.mock("@/lib/session", () => ({
  requireUser: requireUserMock,
}));
// revalidatePath requires a real Next.js request/static-generation context,
// which a plain vitest unit test has none of — it throws otherwise. Mocking
// it here only affects this test process; the real action still calls the
// real revalidatePath when actually served by Next.js.
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

describe.skipIf(!hasDb)("sync-jobs admin actions", () => {
  beforeAll(async () => {
    const { db, schema } = await import("@/lib/db");
    await db
      .insert(schema.users)
      .values({
        id: JOB_USER,
        name: "Sync Panel Test User",
        email: "sync-panel-test@example.invalid",
      })
      .onConflictDoNothing();
  });

  afterAll(async () => {
    const { db, schema } = await import("@/lib/db");
    await db
      .delete(schema.syncJobs)
      .where(eq(schema.syncJobs.userId, JOB_USER));
    await db
      .delete(schema.connections)
      .where(eq(schema.connections.userId, JOB_USER));
    await db.delete(schema.users).where(eq(schema.users.id, JOB_USER));
  });

  beforeEach(async () => {
    requireUserMock.mockReset();
    const { db, schema } = await import("@/lib/db");
    await db
      .delete(schema.syncJobs)
      .where(eq(schema.syncJobs.userId, JOB_USER));
    await db
      .delete(schema.connections)
      .where(eq(schema.connections.userId, JOB_USER));
  });

  it("retrySyncJob resets a failed test-* job to pending, owner only", async () => {
    const { db, schema } = await import("@/lib/db");
    const [job] = await db
      .insert(schema.syncJobs)
      .values({
        userId: JOB_USER,
        provider: "intervals_icu",
        kind: "incremental",
        status: "failed",
        attempts: 3,
        lastError: "boom",
        // Backed off ~30min into the future, as the real failure path in
        // scheduler.ts would leave it — this is what makes "just flip
        // status" insufficient; see comment in actions.ts.
        runAfter: new Date(Date.now() + 30 * 60_000),
      })
      .returning();

    const { retrySyncJob } = await import("@/app/admin/actions");

    requireUserMock.mockResolvedValue(MEMBER);
    await expect(retrySyncJob(job.id)).rejects.toThrow(
      /owner access required/i
    );

    // Confirm the rejected non-owner call truly didn't mutate anything.
    const untouched = await db.query.syncJobs.findFirst({
      where: eq(schema.syncJobs.id, job.id),
    });
    expect(untouched?.status).toBe("failed");

    requireUserMock.mockResolvedValue(OWNER);
    await retrySyncJob(job.id);

    const retried = await db.query.syncJobs.findFirst({
      where: eq(schema.syncJobs.id, job.id),
    });
    expect(retried?.status).toBe("pending");
    expect(retried?.lastError).toBeNull();
    expect(retried?.attempts).toBe(3); // unchanged, per spec
    // Must be pulled back to "now" too, or the scheduler's
    // `run_after <= now()` filter ignores it until the old backoff elapses.
    expect(retried!.runAfter.getTime()).toBeLessThanOrEqual(Date.now());
  });

  it("retrySyncJob rejects a job that is not in failed state (even for the owner)", async () => {
    const { db, schema } = await import("@/lib/db");
    const [job] = await db
      .insert(schema.syncJobs)
      .values({
        userId: JOB_USER,
        provider: "intervals_icu",
        kind: "incremental",
        status: "pending",
        runAfter: new Date(),
      })
      .returning();

    const { retrySyncJob } = await import("@/app/admin/actions");
    requireUserMock.mockResolvedValue(OWNER);
    await expect(retrySyncJob(job.id)).rejects.toThrow(
      /not.*failed|failed state/i
    );
  });

  it("kickUserSync bumps a due-later job to now for the target user, owner only", async () => {
    const { db, schema } = await import("@/lib/db");
    await db.insert(schema.connections).values({
      userId: JOB_USER,
      provider: "intervals_icu",
      encryptedAccessToken: "x",
      externalAthleteId: "a1",
      status: "active",
    });
    const future = new Date(Date.now() + 6 * 3600_000);
    await db.insert(schema.syncJobs).values({
      userId: JOB_USER,
      provider: "intervals_icu",
      kind: "incremental",
      runAfter: future,
    });

    const { kickUserSync } = await import("@/app/admin/actions");

    requireUserMock.mockResolvedValue(MEMBER);
    await expect(kickUserSync(JOB_USER)).rejects.toThrow(
      /owner access required/i
    );

    // Confirm the rejected non-owner call didn't kick anything.
    const untouched = await db.query.syncJobs.findFirst({
      where: and(
        eq(schema.syncJobs.userId, JOB_USER),
        eq(schema.syncJobs.status, "pending")
      ),
    });
    expect(untouched?.runAfter.getTime()).toBe(future.getTime());

    requireUserMock.mockResolvedValue(OWNER);
    await kickUserSync(JOB_USER);

    const kicked = await db.query.syncJobs.findFirst({
      where: and(
        eq(schema.syncJobs.userId, JOB_USER),
        eq(schema.syncJobs.status, "pending")
      ),
    });
    expect(kicked?.runAfter.getTime()).toBeLessThanOrEqual(Date.now());
  });
});

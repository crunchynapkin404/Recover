import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";

const hasDb =
  !!process.env.DATABASE_URL && process.env.DATABASE_DRIVER === "pg";
const USER = "test-sync-overrides-week-user";

function blk(mins: number) {
  return {
    start: null,
    end: null,
    mins,
    energy: "full" as const,
    sports: null,
  };
}

describe.skipIf(!hasDb)("syncDateOverrides target week", () => {
  beforeAll(async () => {
    const { db, schema } = await import("@/lib/db");
    await db.delete(schema.users).where(eq(schema.users.id, USER));
    await db.insert(schema.users).values({
      id: USER,
      name: "SyncWeekUser",
      email: "sync-overrides-week@example.invalid",
      role: "member",
    });
  });
  afterAll(async () => {
    const { db, schema } = await import("@/lib/db");
    await db
      .delete(schema.availabilityOverrides)
      .where(eq(schema.availabilityOverrides.userId, USER));
    await db.delete(schema.users).where(eq(schema.users.id, USER));
  });

  it("writes overrides for a week with no week_plans row at all", async () => {
    const { syncDateOverrides } =
      await import("@/lib/availability/sync-overrides");
    const { db, schema } = await import("@/lib/db");

    // A Monday far enough out that no stored week could exist for it.
    const weekStart = "2027-03-01";
    const blocks = Array.from({ length: 7 }, (_, i) =>
      i === 2 ? [blk(120)] : []
    );

    await syncDateOverrides(USER, blocks, weekStart);

    const rows = await db.query.availabilityOverrides.findMany({
      where: and(
        eq(schema.availabilityOverrides.userId, USER),
        eq(schema.availabilityOverrides.date, "2027-03-03")
      ),
    });
    expect(rows).toHaveLength(1);
    expect((rows[0].blocks as { mins: number }[])[0].mins).toBe(120);
  });

  it("is a no-op for a future week when no open week exists and none is named", async () => {
    // Omitting weekStart must keep the old behaviour: scoped to the open
    // week, and this user has none.
    const { syncDateOverrides } =
      await import("@/lib/availability/sync-overrides");
    const { db, schema } = await import("@/lib/db");
    const before = await db.query.availabilityOverrides.findMany({
      where: eq(schema.availabilityOverrides.userId, USER),
    });
    await syncDateOverrides(
      USER,
      Array.from({ length: 7 }, () => [blk(60)])
    );
    const after = await db.query.availabilityOverrides.findMany({
      where: eq(schema.availabilityOverrides.userId, USER),
    });
    expect(after).toHaveLength(before.length);
  });
});

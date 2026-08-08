import { describe, expect, it, beforeAll, beforeEach, afterAll } from "vitest";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { localYmd } from "@/lib/charts";
import { recordSurfaceView, pruneSurfaceViews } from "./telemetry";

const TEST_USER = "test-telemetry-user";

// requires Postgres; skips without DATABASE_URL.
const hasDb =
  !!process.env.DATABASE_URL && process.env.DATABASE_DRIVER === "pg";

describe.skipIf(!hasDb)("recordSurfaceView", () => {
  // surfaceViews.userId is a real FK, so the test user must exist in `users`
  // or the insert throws 23503. Seed it, and delete it again in afterAll —
  // leaving test users behind is how two *.invalid rows ended up live.
  beforeAll(async () => {
    await db
      .insert(schema.users)
      .values({
        id: TEST_USER,
        name: "Test Telemetry User",
        email: `${TEST_USER}@example.invalid`,
      })
      .onConflictDoNothing();
  });

  afterAll(async () => {
    await db
      .delete(schema.surfaceViews)
      .where(eq(schema.surfaceViews.userId, TEST_USER));
    await db.delete(schema.users).where(eq(schema.users.id, TEST_USER));
  });

  beforeEach(async () => {
    await db
      .delete(schema.surfaceViews)
      .where(eq(schema.surfaceViews.userId, TEST_USER));
  });

  it("writes one row with count 1 on first view", async () => {
    await recordSurfaceView(TEST_USER, "today");

    const rows = await db.query.surfaceViews.findMany({
      where: eq(schema.surfaceViews.userId, TEST_USER),
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].surface).toBe("today");
    expect(rows[0].count).toBe(1);
    expect(rows[0].day).toBe(localYmd(new Date()));
  });

  it("increments in place rather than inserting a second row", async () => {
    await recordSurfaceView(TEST_USER, "train");
    await recordSurfaceView(TEST_USER, "train");
    await recordSurfaceView(TEST_USER, "train");

    const rows = await db.query.surfaceViews.findMany({
      where: and(
        eq(schema.surfaceViews.userId, TEST_USER),
        eq(schema.surfaceViews.surface, "train")
      ),
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].count).toBe(3);
  });

  it("keeps surfaces separate", async () => {
    await recordSurfaceView(TEST_USER, "today");
    await recordSurfaceView(TEST_USER, "body");

    const rows = await db.query.surfaceViews.findMany({
      where: eq(schema.surfaceViews.userId, TEST_USER),
    });
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.surface).sort()).toEqual(["body", "today"]);
  });

  it("never throws when the write fails", async () => {
    // A user id with no row in `users` violates the FK. The page render must
    // survive it; a missing count is always preferable to a 500.
    await expect(
      recordSurfaceView("test-telemetry-nonexistent", "today")
    ).resolves.toBeUndefined();
  });

  it("prunes rows older than the retention window and leaves recent ones", async () => {
    const old = "2020-01-01";
    await db.insert(schema.surfaceViews).values({
      userId: TEST_USER,
      surface: "today",
      day: old,
      count: 5,
    });
    await recordSurfaceView(TEST_USER, "train");

    const deleted = await pruneSurfaceViews(180);
    expect(deleted).toBeGreaterThanOrEqual(1);

    const rows = await db.query.surfaceViews.findMany({
      where: eq(schema.surfaceViews.userId, TEST_USER),
    });
    expect(rows.map((r) => r.day)).not.toContain(old);
    expect(rows.map((r) => r.surface)).toContain("train");
  });
});

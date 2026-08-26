import { describe, expect, it, beforeAll, beforeEach, afterAll } from "vitest";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { localYmd } from "@/lib/charts";
import {
  recordSurfaceView,
  pruneSurfaceViews,
  surfaceViewTotals,
} from "./telemetry";

const TEST_USER = "test-telemetry-user";
const OTHER_USER = "test-telemetry-other-user"; // proves the aggregate sums across users, not just one

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
    await db
      .insert(schema.users)
      .values({
        id: OTHER_USER,
        name: "Test Telemetry Other User",
        email: `${OTHER_USER}@example.invalid`,
      })
      .onConflictDoNothing();
  });

  afterAll(async () => {
    await db
      .delete(schema.surfaceViews)
      .where(eq(schema.surfaceViews.userId, TEST_USER));
    await db.delete(schema.users).where(eq(schema.users.id, TEST_USER));
    await db
      .delete(schema.surfaceViews)
      .where(eq(schema.surfaceViews.userId, OTHER_USER));
    await db.delete(schema.users).where(eq(schema.users.id, OTHER_USER));
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

  it("stores the tab colon-joined onto the surface", async () => {
    await recordSurfaceView(TEST_USER, "body", "labs");

    const rows = await db.query.surfaceViews.findMany({
      where: eq(schema.surfaceViews.userId, TEST_USER),
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].surface).toBe("body:labs");
    expect(rows[0].count).toBe(1);
  });

  it("counts two tabs of one surface as two rows, not one", async () => {
    // The whole point of v0.121's change. Before it, both of these wrote
    // `body` and the IA question "does anyone open Labs?" was unanswerable
    // from the data the app collected about itself.
    await recordSurfaceView(TEST_USER, "body", "trends");
    await recordSurfaceView(TEST_USER, "body", "trends");
    await recordSurfaceView(TEST_USER, "body", "labs");

    const rows = await db.query.surfaceViews.findMany({
      where: eq(schema.surfaceViews.userId, TEST_USER),
    });
    expect(Object.fromEntries(rows.map((r) => [r.surface, r.count]))).toEqual({
      "body:trends": 2,
      "body:labs": 1,
    });
  });

  it("keeps a tabbed key distinct from its bare parent", async () => {
    // Pre-v0.121 rows carry `train`; new ones carry `train:week`. They must
    // not collide — the upsert key is (user, surface, day), and merging the
    // two eras into one counter would silently overstate the new one.
    await recordSurfaceView(TEST_USER, "train", "week");
    await db.insert(schema.surfaceViews).values({
      userId: TEST_USER,
      surface: "train",
      day: localYmd(new Date()),
      count: 9,
    });

    const rows = await db.query.surfaceViews.findMany({
      where: eq(schema.surfaceViews.userId, TEST_USER),
    });
    expect(Object.fromEntries(rows.map((r) => [r.surface, r.count]))).toEqual({
      train: 9,
      "train:week": 1,
    });
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

  it("surfaceViewTotals aggregates across all users, grouped by surface, sorted descending", async () => {
    // Distinctive, made-up surface strings (not from the real SURFACES
    // tuple) inserted directly via db.insert, bypassing recordSurfaceView's
    // type restriction — this guarantees the totals this test reads can't
    // collide with real data or any other test's rows in the same shared
    // table, without needing to wipe/scope the whole table.
    const today = localYmd(new Date());
    await db.insert(schema.surfaceViews).values([
      { userId: TEST_USER, surface: "test-agg-a", day: today, count: 5 },
      { userId: OTHER_USER, surface: "test-agg-a", day: today, count: 3 },
      { userId: TEST_USER, surface: "test-agg-b", day: today, count: 1 },
    ]);

    const totals = await surfaceViewTotals();
    const a = totals.find((t) => t.surface === "test-agg-a");
    const b = totals.find((t) => t.surface === "test-agg-b");

    expect(a?.total).toBe(8); // 5 + 3 — summed across BOTH users
    expect(b?.total).toBe(1);
    // Descending order: the higher total must sort first.
    expect(totals.indexOf(a!)).toBeLessThan(totals.indexOf(b!));
  });
});

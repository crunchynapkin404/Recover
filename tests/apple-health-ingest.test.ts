import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { eq } from "drizzle-orm";

const hasDb =
  !!process.env.DATABASE_URL && process.env.DATABASE_DRIVER === "pg";

const onWellnessDataChanged = vi.fn().mockResolvedValue("skipped");
vi.mock("@/lib/sync/wellness-changed", () => ({
  onWellnessDataChanged: (...args: unknown[]) => onWellnessDataChanged(...args),
}));

const USER = "test-apple-health-ingest-user";

describe.skipIf(!hasDb)("ingestAppleHealth", () => {
  beforeAll(async () => {
    const { db, schema } = await import("@/lib/db");
    await db
      .insert(schema.users)
      .values({
        id: USER,
        name: "Apple Ingest",
        email: "apple-ingest@example.invalid",
      })
      .onConflictDoNothing();
  });

  beforeEach(async () => {
    onWellnessDataChanged.mockClear();
    const { db, schema } = await import("@/lib/db");
    await db
      .delete(schema.wellnessDaily)
      .where(eq(schema.wellnessDaily.userId, USER));
    await db
      .delete(schema.dailyMetrics)
      .where(eq(schema.dailyMetrics.userId, USER));
  });

  afterAll(async () => {
    const { db, schema } = await import("@/lib/db");
    await db
      .delete(schema.wellnessDaily)
      .where(eq(schema.wellnessDaily.userId, USER));
    await db
      .delete(schema.dailyMetrics)
      .where(eq(schema.dailyMetrics.userId, USER));
    await db.delete(schema.users).where(eq(schema.users.id, USER));
  });

  it("calls onWellnessDataChanged after a successful ingest", async () => {
    const { ingestAppleHealth } =
      await import("@/lib/sync/apple-health-ingest");
    await ingestAppleHealth(USER, {
      data: {
        metrics: [
          {
            name: "heart_rate_variability",
            units: "ms",
            data: [{ date: "2026-07-15 00:00:00 +0000", qty: 62.3 }],
          },
        ],
      },
    });
    expect(onWellnessDataChanged).toHaveBeenCalledWith(USER);
  });

  it("does not call onWellnessDataChanged when the payload carries no dates", async () => {
    const { ingestAppleHealth } =
      await import("@/lib/sync/apple-health-ingest");
    await ingestAppleHealth(USER, { data: { metrics: [] } });
    expect(onWellnessDataChanged).not.toHaveBeenCalled();
  });
});

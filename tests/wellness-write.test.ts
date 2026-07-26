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

const USER = "test-wellness-write-user";

function localYmd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

describe.skipIf(!hasDb)("upsertWellness", () => {
  beforeAll(async () => {
    const { db, schema } = await import("@/lib/db");
    await db
      .insert(schema.users)
      .values({
        id: USER,
        name: "Wellness Write",
        email: "wellness-write@example.invalid",
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

  it("calls onWellnessDataChanged after writing at least one field", async () => {
    const { upsertWellness } = await import("@/lib/wellness-write");
    await upsertWellness(USER, { date: localYmd(new Date()), hrvMs: 60 });
    expect(onWellnessDataChanged).toHaveBeenCalledWith(USER);
  });

  it("does not call onWellnessDataChanged when nothing was written", async () => {
    const { upsertWellness } = await import("@/lib/wellness-write");
    await upsertWellness(USER, { date: localYmd(new Date()) });
    expect(onWellnessDataChanged).not.toHaveBeenCalled();
  });

  // Fix 3: the CSV importer and the log_wellness MCP tool both pass
  // { notify: false } so a multi-row backfill (or a mid-chat tool call)
  // doesn't fire a morning brief/push per row.
  it("does not call onWellnessDataChanged when notify:false is passed", async () => {
    const { upsertWellness } = await import("@/lib/wellness-write");
    await upsertWellness(
      USER,
      { date: localYmd(new Date()), hrvMs: 60 },
      { notify: false }
    );
    expect(onWellnessDataChanged).not.toHaveBeenCalled();
  });

  it("still calls onWellnessDataChanged when notify is omitted (default true)", async () => {
    const { upsertWellness } = await import("@/lib/wellness-write");
    await upsertWellness(USER, { date: localYmd(new Date()), hrvMs: 60 }, {});
    expect(onWellnessDataChanged).toHaveBeenCalledWith(USER);
  });
});

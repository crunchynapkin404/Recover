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

/**
 * Fix 3: importWellnessCSV loops upsertWellness per row. Each row now passes
 * { notify: false } (suppressing upsertWellness's own onWellnessDataChanged
 * call), and the action fires onWellnessDataChanged itself exactly once
 * after the loop, only when at least one row actually imported — a
 * multi-row historical backfill must not post a morning brief (and push)
 * per row, nor burn the day's one brief slot on mid-import partial state.
 *
 * requireUser()/revalidatePath() are framework plumbing that throws outside
 * a real request (same rationale as tests/body-prefs.test.ts) — mocked here,
 * not the logic under test. onWellnessDataChanged is mocked purely to count
 * calls; upsertWellness, parseWellnessCSV, and the DB writes are all real.
 */

const hasDb =
  !!process.env.DATABASE_URL && process.env.DATABASE_DRIVER === "pg";

const USER = "test-import-wellness-csv-user";

vi.mock("@/lib/session", () => ({
  requireUser: vi.fn(async () => ({ id: USER })),
}));
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));
const onWellnessDataChanged = vi.fn().mockResolvedValue("skipped");
vi.mock("@/lib/sync/wellness-changed", () => ({
  onWellnessDataChanged: (...args: unknown[]) => onWellnessDataChanged(...args),
}));

function localYmd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function csvFormData(csv: string): FormData {
  const fd = new FormData();
  fd.set("file", new File([csv], "wellness.csv", { type: "text/csv" }));
  return fd;
}

async function cleanup() {
  const { db, schema } = await import("@/lib/db");
  await db
    .delete(schema.wellnessDaily)
    .where(eq(schema.wellnessDaily.userId, USER));
  await db
    .delete(schema.dailyMetrics)
    .where(eq(schema.dailyMetrics.userId, USER));
  await db.delete(schema.users).where(eq(schema.users.id, USER));
}

describe.skipIf(!hasDb)(
  "importWellnessCSV — single post-loop notify (Fix 3)",
  () => {
    beforeAll(async () => {
      await cleanup();
      const { db, schema } = await import("@/lib/db");
      await db
        .insert(schema.users)
        .values({
          id: USER,
          name: "Import Wellness CSV",
          email: "import-wellness-csv@example.invalid",
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

    afterAll(cleanup);

    it("fires onWellnessDataChanged exactly once for a multi-row import, not once per row", async () => {
      const { importWellnessCSV } = await import("@/app/import/actions");
      const dayBefore = localYmd(new Date(Date.now() - 2 * 86_400_000));
      const dayBefore2 = localYmd(new Date(Date.now() - 1 * 86_400_000));
      const csv = `date,hrv,resting_hr\n${dayBefore},55,60\n${dayBefore2},58,59`;

      const result = await importWellnessCSV(null, csvFormData(csv));

      expect(result.ok).toBe(true);
      expect(result.imported).toBe(2);
      // Not one call per row (that would be 2) — exactly one for the batch,
      // and with no second argument (matching upsertWellness's own default
      // notify:true call shape).
      expect(onWellnessDataChanged).toHaveBeenCalledTimes(1);
      expect(onWellnessDataChanged).toHaveBeenCalledWith(USER);

      // Each row's own upsertWellness call suppressed its hook via
      // { notify: false }, so the rows were still written for real.
      const { db, schema } = await import("@/lib/db");
      const rows = await db.query.wellnessDaily.findMany({
        where: eq(schema.wellnessDaily.userId, USER),
      });
      expect(rows).toHaveLength(2);
    });

    it("does not call onWellnessDataChanged when no row imports successfully", async () => {
      const { importWellnessCSV } = await import("@/app/import/actions");
      // No date column at all → parseWellnessCSV returns zero rows, so the
      // action returns before the loop (imported stays 0).
      const csv = `hrv,resting_hr\n55,60`;

      const result = await importWellnessCSV(null, csvFormData(csv));

      expect(result.ok).toBe(false);
      expect(result.imported).toBe(0);
      expect(onWellnessDataChanged).not.toHaveBeenCalled();
    });
  }
);

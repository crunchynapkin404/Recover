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
import {
  clearDayOverride,
  setDayOverride,
  setPlanStyleQuick,
  setSeasonModeQuick,
  setStandardWeekDay,
  setWeekAdjustmentQuick,
  submitAvailability,
  zeroDay,
} from "./actions";
// Both moved out of the "use server" module: blocksEqual so the coach tools
// can share it (I11), parseDayBlocks because a sync export there breaks the
// production build.
import { blocksEqual } from "@/lib/availability/sync-overrides";
import { parseDayBlocks } from "@/lib/availability/parse-day-blocks";
import type { AvailabilityBlock } from "@/lib/availability/types";
import type { DaySlot } from "@/lib/week-plan/types";

// requires Postgres; skips without DATABASE_URL.
const hasDb =
  !!process.env.DATABASE_URL && process.env.DATABASE_DRIVER === "pg";

const USER = "test-plan-actions-user";

const { requireUserMock } = vi.hoisted(() => ({
  requireUserMock: vi.fn(),
}));
vi.mock("@/lib/session", () => ({
  requireUser: requireUserMock,
}));

// revalidatePath requires a real Next.js request/static-generation context,
// which a plain vitest unit test has none of.
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

const one = JSON.stringify([
  { start: "18:00", end: "19:30", mins: 90, energy: "normal", sports: null },
]);

describe("parseDayBlocks", () => {
  it("reads a day's blocks out of the form field", () => {
    const r = parseDayBlocks(one);
    expect(r).toHaveLength(1);
    expect(r![0].mins).toBe(90);
  });

  it("reads a missing field as a rest day", () => {
    expect(parseDayBlocks(null)).toEqual([]);
  });

  // null, NOT [] — an empty list is a real answer ("no time that day") that
  // pins the date and moves its sessions away, so reading garbage as a rest
  // day would be the most destructive interpretation available.
  it("refuses malformed JSON rather than reading it as a rest day", () => {
    expect(parseDayBlocks("{not json")).toBeNull();
  });

  it("refuses a non-array payload", () => {
    expect(parseDayBlocks('{"mins":90}')).toBeNull();
  });

  it("refuses a day whose blocks overlap instead of storing them", () => {
    const overlapping = JSON.stringify([
      {
        start: "18:00",
        end: "19:30",
        mins: 90,
        energy: "normal",
        sports: null,
      },
      {
        start: "19:00",
        end: "20:00",
        mins: 60,
        energy: "normal",
        sports: null,
      },
    ]);
    expect(parseDayBlocks(overlapping)).toBeNull();
  });

  it("keeps an explicitly empty day empty", () => {
    expect(parseDayBlocks("[]")).toEqual([]);
  });

  // ── "HH:MM" shape gap (closed in Task 12) ──────────────────────────────
  // toMinutes() in @/lib/availability/types has no shape check of its own —
  // a malformed clock string silently becomes NaN instead of an error, and
  // validateBlocks' comparisons (NaN <= NaN, NaN < NaN) are always false, so
  // a garbage string sails straight through. parseDayBlocks is the form
  // boundary where raw strings first arrive, so it must guard the shape
  // itself before a block ever reaches validateBlocks or the database.

  it("refuses a block whose start is not a time string", () => {
    const bad = JSON.stringify([
      {
        start: "garbage",
        end: "19:30",
        mins: 90,
        energy: "normal",
        sports: null,
      },
    ]);
    expect(parseDayBlocks(bad)).toBeNull();
  });

  it("refuses a block whose end is not a time string", () => {
    const bad = JSON.stringify([
      {
        start: "18:00",
        end: "not-a-time",
        mins: 90,
        energy: "normal",
        sports: null,
      },
    ]);
    expect(parseDayBlocks(bad)).toBeNull();
  });

  it("refuses a block with an out-of-range hour", () => {
    const bad = JSON.stringify([
      {
        start: "25:00",
        end: "26:00",
        mins: 60,
        energy: "normal",
        sports: null,
      },
    ]);
    expect(parseDayBlocks(bad)).toBeNull();
  });

  it("refuses a block with an out-of-range minute", () => {
    const bad = JSON.stringify([
      {
        start: "18:00",
        end: "18:75",
        mins: 60,
        energy: "normal",
        sports: null,
      },
    ]);
    expect(parseDayBlocks(bad)).toBeNull();
  });

  it("refuses a block with one clock field null and the other set", () => {
    const bad = JSON.stringify([
      { start: "18:00", end: null, mins: 60, energy: "normal", sports: null },
    ]);
    expect(parseDayBlocks(bad)).toBeNull();
  });

  it("refuses a block whose start is a non-string value", () => {
    const bad = JSON.stringify([
      { start: 1800, end: "19:30", mins: 90, energy: "normal", sports: null },
    ]);
    expect(parseDayBlocks(bad)).toBeNull();
  });

  it("keeps a legacy block with both start and end null", () => {
    const legacy = JSON.stringify([
      { start: null, end: null, mins: 45, energy: "easy", sports: null },
    ]);
    expect(parseDayBlocks(legacy)).toHaveLength(1);
  });
});

// ── Task 16b: submitAvailability must turn a day that actually differs from
// the standard week into a date override, and leave (or clear) one that
// doesn't. blocksEqual is the pure comparison that decision rests on. ──────
describe("blocksEqual", () => {
  function blk(overrides: Partial<AvailabilityBlock> = {}): AvailabilityBlock {
    return {
      start: null,
      end: null,
      mins: 60,
      energy: "normal",
      sports: null,
      ...overrides,
    };
  }

  it("is true for two empty lists", () => {
    expect(blocksEqual([], [])).toBe(true);
  });

  it("is true for identical blocks", () => {
    expect(blocksEqual([blk()], [blk()])).toBe(true);
  });

  it("is false when lengths differ", () => {
    expect(blocksEqual([blk()], [blk(), blk()])).toBe(false);
  });

  it("is false when start differs", () => {
    expect(
      blocksEqual([blk({ start: "06:00" })], [blk({ start: "07:00" })])
    ).toBe(false);
  });

  it("is false when end differs", () => {
    expect(blocksEqual([blk({ end: "07:00" })], [blk({ end: "08:00" })])).toBe(
      false
    );
  });

  it("is false when mins differs", () => {
    expect(blocksEqual([blk({ mins: 30 })], [blk({ mins: 45 })])).toBe(false);
  });

  it("is false when energy differs", () => {
    expect(
      blocksEqual([blk({ energy: "easy" })], [blk({ energy: "full" })])
    ).toBe(false);
  });

  it("treats sports: null and sports: [] as distinct — null means any sport, [] admits nothing", () => {
    expect(blocksEqual([blk({ sports: null })], [blk({ sports: [] })])).toBe(
      false
    );
  });

  it("is true when both sports are null", () => {
    expect(blocksEqual([blk({ sports: null })], [blk({ sports: null })])).toBe(
      true
    );
  });

  it("is true when both sports arrays hold the same values", () => {
    expect(
      blocksEqual(
        [blk({ sports: ["Run", "Bike"] })],
        [blk({ sports: ["Run", "Bike"] })]
      )
    ).toBe(true);
  });

  it("is false when sports arrays differ", () => {
    expect(
      blocksEqual([blk({ sports: ["Run"] })], [blk({ sports: ["Bike"] })])
    ).toBe(false);
  });

  // Sports are a set, not a sequence. The editor emits a stable order, but
  // set_standard_week lets an LLM pick its own — and I11 now routes the
  // coach's writes through this same comparison, so an order-sensitive
  // compare would pin dates that in fact match the standard week.
  it("is true when both sports arrays hold the same values in a different order", () => {
    expect(
      blocksEqual(
        [blk({ sports: ["Bike", "Run"] })],
        [blk({ sports: ["Run", "Bike"] })]
      )
    ).toBe(true);
  });
});

describe.skipIf(!hasDb)("server actions", () => {
  beforeAll(async () => {
    requireUserMock.mockResolvedValue({ id: USER });
    const { db, schema } = await import("@/lib/db");
    await db
      .insert(schema.users)
      .values({
        id: USER,
        name: "Plan Actions Test",
        email: `${USER}@example.test`,
      })
      .onConflictDoNothing();
  });

  afterAll(async () => {
    const { db, schema } = await import("@/lib/db");
    await db
      .delete(schema.availabilityOverrides)
      .where(eq(schema.availabilityOverrides.userId, USER));
    await db
      .delete(schema.availabilityDefaults)
      .where(eq(schema.availabilityDefaults.userId, USER));
    await db.delete(schema.users).where(eq(schema.users.id, USER));
  });

  describe("setStandardWeekDay", () => {
    it("rejects an out-of-range weekday", async () => {
      const r = await setStandardWeekDay(7, []);
      expect(r).toEqual({ ok: false, error: "invalid_weekday" });
    });

    it("rejects invalid blocks without writing anything", async () => {
      const { db, schema } = await import("@/lib/db");
      const overlapping = [
        {
          start: "18:00",
          end: "19:30",
          mins: 90,
          energy: "normal" as const,
          sports: null,
        },
        {
          start: "19:00",
          end: "20:00",
          mins: 60,
          energy: "normal" as const,
          sports: null,
        },
      ];
      const r = await setStandardWeekDay(3, overlapping);
      expect(r.ok).toBe(false);

      const row = await db.query.availabilityDefaults.findFirst({
        where: and(
          eq(schema.availabilityDefaults.userId, USER),
          eq(schema.availabilityDefaults.weekday, 3)
        ),
      });
      expect(row).toBeUndefined();
    });

    it("upserts a weekday's blocks and leaves an unrelated override untouched", async () => {
      const { db, schema } = await import("@/lib/db");
      await db
        .insert(schema.availabilityOverrides)
        .values({ userId: USER, date: "2026-09-01", blocks: [] })
        .onConflictDoNothing();

      const blocks = [
        {
          start: "06:00",
          end: "07:00",
          mins: 60,
          energy: "easy" as const,
          sports: null,
        },
      ];
      const r = await setStandardWeekDay(0, blocks);
      expect(r).toEqual({ ok: true });

      const row = await db.query.availabilityDefaults.findFirst({
        where: and(
          eq(schema.availabilityDefaults.userId, USER),
          eq(schema.availabilityDefaults.weekday, 0)
        ),
      });
      expect(row?.blocks).toEqual(blocks);

      const untouchedOverride = await db.query.availabilityOverrides.findFirst({
        where: and(
          eq(schema.availabilityOverrides.userId, USER),
          eq(schema.availabilityOverrides.date, "2026-09-01")
        ),
      });
      expect(untouchedOverride?.blocks).toEqual([]);

      // Second call on the same weekday exercises the onConflictDoUpdate path.
      const blocks2 = [
        {
          start: "05:00",
          end: "06:00",
          mins: 60,
          energy: "full" as const,
          sports: null,
        },
      ];
      const r2 = await setStandardWeekDay(0, blocks2);
      expect(r2).toEqual({ ok: true });
      const row2 = await db.query.availabilityDefaults.findFirst({
        where: and(
          eq(schema.availabilityDefaults.userId, USER),
          eq(schema.availabilityDefaults.weekday, 0)
        ),
      });
      expect(row2?.blocks).toEqual(blocks2);
    });
  });

  describe("setPlanStyleQuick", () => {
    beforeEach(async () => {
      const { db, schema } = await import("@/lib/db");
      await db
        .delete(schema.trainingPlans)
        .where(eq(schema.trainingPlans.userId, USER));
      await db.insert(schema.trainingPlans).values({
        userId: USER,
        title: "Plan Style Switch Test",
        raceType: "marathon",
        raceDate: "2027-01-01",
        startDate: "2026-01-01",
        weeksTotal: 12,
        currentWeek: 2,
        status: "active",
        constraints: {
          daysPerWeek: 5,
          hoursPerWeek: 8,
          sports: ["Run"],
          planStyle: "balanced",
        },
      });
    });

    it("rejects an invalid style payload", async () => {
      const form = new FormData();
      form.set("style", "weird_style");
      await expect(setPlanStyleQuick(form)).resolves.toEqual({
        ok: false,
        error: "invalid_plan_style",
      });
    });

    it("updates the active plan style via existing set_style path", async () => {
      const form = new FormData();
      form.set("style", "block_lite");

      await expect(setPlanStyleQuick(form)).resolves.toEqual({ ok: true });

      const { db, schema } = await import("@/lib/db");
      const plan = await db.query.trainingPlans.findFirst({
        where: and(
          eq(schema.trainingPlans.userId, USER),
          eq(schema.trainingPlans.status, "active")
        ),
      });

      expect(
        (plan?.constraints as { planStyle?: unknown } | null)?.planStyle
      ).toBe("block_lite");
    });
  });

  describe("setSeasonModeQuick", () => {
    beforeEach(async () => {
      const { db, schema } = await import("@/lib/db");
      await db
        .delete(schema.trainingPlans)
        .where(eq(schema.trainingPlans.userId, USER));
      await db.insert(schema.trainingPlans).values({
        userId: USER,
        title: "Season Mode Switch Test",
        raceType: "marathon",
        raceDate: "2027-01-01",
        startDate: "2026-01-01",
        weeksTotal: 12,
        currentWeek: 2,
        status: "active",
        constraints: {
          daysPerWeek: 5,
          hoursPerWeek: 8,
          sports: ["Run"],
          seasonMode: "normal",
          reentryStage: "none",
        },
      });
    });

    it("rejects an invalid season action", async () => {
      const form = new FormData();
      form.set("seasonAction", "strange");
      await expect(setSeasonModeQuick(form)).resolves.toEqual({
        ok: false,
        error: "invalid_season_action",
      });
    });

    it("switches the active plan into off-season", async () => {
      const form = new FormData();
      form.set("seasonAction", "off_season");

      await expect(setSeasonModeQuick(form)).resolves.toEqual({ ok: true });

      const { db, schema } = await import("@/lib/db");
      const plan = await db.query.trainingPlans.findFirst({
        where: and(
          eq(schema.trainingPlans.userId, USER),
          eq(schema.trainingPlans.status, "active")
        ),
      });

      expect(
        (plan?.constraints as { seasonMode?: unknown } | null)?.seasonMode
      ).toBe("off_season");
      expect(
        (plan?.constraints as { reentryStage?: unknown } | null)?.reentryStage
      ).toBe("none");
    });

    it("starts re-entry from the existing active plan", async () => {
      const { db, schema } = await import("@/lib/db");
      await db
        .update(schema.trainingPlans)
        .set({
          constraints: { seasonMode: "off_season", reentryStage: "none" },
        })
        .where(
          and(
            eq(schema.trainingPlans.userId, USER),
            eq(schema.trainingPlans.status, "active")
          )
        );

      const form = new FormData();
      form.set("seasonAction", "begin_reentry");

      await expect(setSeasonModeQuick(form)).resolves.toEqual({ ok: true });

      const plan = await db.query.trainingPlans.findFirst({
        where: and(
          eq(schema.trainingPlans.userId, USER),
          eq(schema.trainingPlans.status, "active")
        ),
      });

      expect(
        (plan?.constraints as { seasonMode?: unknown } | null)?.seasonMode
      ).toBe("off_season");
      expect(
        (plan?.constraints as { reentryStage?: unknown } | null)?.reentryStage
      ).toBe("week_1");
    });
  });

  describe("setWeekAdjustmentQuick", () => {
    beforeEach(async () => {
      const { db, schema } = await import("@/lib/db");
      await db
        .delete(schema.trainingBlocks)
        .where(eq(schema.trainingBlocks.notes, "week adjustment test"));
      await db
        .delete(schema.trainingPlans)
        .where(eq(schema.trainingPlans.userId, USER));
      const [plan] = await db
        .insert(schema.trainingPlans)
        .values({
          userId: USER,
          title: "Week Adjustment Test",
          raceType: "marathon",
          raceDate: "2027-01-01",
          startDate: "2026-01-01",
          weeksTotal: 12,
          currentWeek: 2,
          status: "active",
          constraints: {
            daysPerWeek: 5,
            hoursPerWeek: 8,
            sports: ["Run"],
          },
        })
        .returning();
      await db.insert(schema.trainingBlocks).values({
        planId: plan.id,
        weekNumber: 2,
        phase: "build",
        targetLoadTotal: 300,
        targetSessions: 4,
        workouts: [],
        notes: "week adjustment test",
      });
    });

    it("rejects an invalid quick action payload", async () => {
      const form = new FormData();
      form.set("weekAction", "strange");
      form.set("weekNumber", "2");
      await expect(setWeekAdjustmentQuick(form)).resolves.toEqual({
        ok: false,
        error: "invalid_week_adjustment",
      });
    });

    it("reduces the open skeleton week's target load", async () => {
      const form = new FormData();
      form.set("weekAction", "reduce_load");
      form.set("weekNumber", "2");

      await expect(setWeekAdjustmentQuick(form)).resolves.toEqual({ ok: true });

      const { db, schema } = await import("@/lib/db");
      const block = await db.query.trainingBlocks.findFirst({
        where: eq(
          schema.trainingBlocks.notes,
          "reduce_load: train quick week ease"
        ),
      });
      expect(block?.targetLoadTotal).toBe(210);
    });

    it("can skip the open week", async () => {
      const form = new FormData();
      form.set("weekAction", "skip_week");
      form.set("weekNumber", "2");

      await expect(setWeekAdjustmentQuick(form)).resolves.toEqual({ ok: true });

      const { db, schema } = await import("@/lib/db");
      const block = await db.query.trainingBlocks.findFirst({
        where: eq(
          schema.trainingBlocks.notes,
          "skip_week: train quick week skip"
        ),
      });
      expect(block?.targetLoadTotal).toBe(0);
    });
  });

  describe("setDayOverride / clearDayOverride / zeroDay", () => {
    it("rejects a malformed date", async () => {
      const r = await setDayOverride("2026-9-1", []);
      expect(r).toEqual({ ok: false, error: "invalid_date" });
    });

    it("rejects invalid blocks without writing anything", async () => {
      const { db, schema } = await import("@/lib/db");
      const overlapping = [
        {
          start: "18:00",
          end: "19:30",
          mins: 90,
          energy: "normal" as const,
          sports: null,
        },
        {
          start: "19:00",
          end: "20:00",
          mins: 60,
          energy: "normal" as const,
          sports: null,
        },
      ];
      const r = await setDayOverride("2026-08-20", overlapping);
      expect(r.ok).toBe(false);

      const row = await db.query.availabilityOverrides.findFirst({
        where: and(
          eq(schema.availabilityOverrides.userId, USER),
          eq(schema.availabilityOverrides.date, "2026-08-20")
        ),
      });
      expect(row).toBeUndefined();
    });

    it("pins a date and leaves that weekday's default untouched", async () => {
      const { db, schema } = await import("@/lib/db");
      const defaultBlocks = [
        {
          start: "17:00",
          end: "18:00",
          mins: 60,
          energy: "normal" as const,
          sports: null,
        },
      ];
      await db
        .insert(schema.availabilityDefaults)
        .values({ userId: USER, weekday: 4, blocks: defaultBlocks })
        .onConflictDoUpdate({
          target: [
            schema.availabilityDefaults.userId,
            schema.availabilityDefaults.weekday,
          ],
          set: { blocks: defaultBlocks },
        });

      // 2026-08-21 is a Friday (weekday 4).
      const pinned = [
        {
          start: "12:00",
          end: "13:00",
          mins: 60,
          energy: "easy" as const,
          sports: null,
        },
      ];
      const r = await setDayOverride("2026-08-21", pinned);
      expect(r).toEqual({ ok: true });

      const override = await db.query.availabilityOverrides.findFirst({
        where: and(
          eq(schema.availabilityOverrides.userId, USER),
          eq(schema.availabilityOverrides.date, "2026-08-21")
        ),
      });
      expect(override?.blocks).toEqual(pinned);

      const def = await db.query.availabilityDefaults.findFirst({
        where: and(
          eq(schema.availabilityDefaults.userId, USER),
          eq(schema.availabilityDefaults.weekday, 4)
        ),
      });
      expect(def?.blocks).toEqual(defaultBlocks);
    });

    it("zeroDay pins an empty override for that date", async () => {
      const { db, schema } = await import("@/lib/db");
      const r = await zeroDay("2026-08-25");
      expect(r).toEqual({ ok: true });

      const override = await db.query.availabilityOverrides.findFirst({
        where: and(
          eq(schema.availabilityOverrides.userId, USER),
          eq(schema.availabilityOverrides.date, "2026-08-25")
        ),
      });
      expect(override?.blocks).toEqual([]);
    });

    it("clearDayOverride deletes the override and never touches defaults", async () => {
      const { db, schema } = await import("@/lib/db");
      const defaultBlocks = [
        {
          start: "09:00",
          end: "10:00",
          mins: 60,
          energy: "normal" as const,
          sports: null,
        },
      ];
      await db
        .insert(schema.availabilityDefaults)
        .values({ userId: USER, weekday: 5, blocks: defaultBlocks })
        .onConflictDoUpdate({
          target: [
            schema.availabilityDefaults.userId,
            schema.availabilityDefaults.weekday,
          ],
          set: { blocks: defaultBlocks },
        });

      await setDayOverride("2026-08-29", [
        {
          start: "11:00",
          end: "12:00",
          mins: 60,
          energy: "easy",
          sports: null,
        },
      ]);

      const r = await clearDayOverride("2026-08-29");
      expect(r).toEqual({ ok: true });

      const override = await db.query.availabilityOverrides.findFirst({
        where: and(
          eq(schema.availabilityOverrides.userId, USER),
          eq(schema.availabilityOverrides.date, "2026-08-29")
        ),
      });
      expect(override).toBeUndefined();

      const def = await db.query.availabilityDefaults.findFirst({
        where: and(
          eq(schema.availabilityDefaults.userId, USER),
          eq(schema.availabilityDefaults.weekday, 5)
        ),
      });
      expect(def?.blocks).toEqual(defaultBlocks);
    });

    it("clearDayOverride on a date with no override is a harmless no-op", async () => {
      const r = await clearDayOverride("2026-11-11");
      expect(r).toEqual({ ok: true });
    });
  });

  describe("submitAvailability", () => {
    it("returns the no-open-week message when there's no active plan", async () => {
      const fd = new FormData();
      fd.set("blocks-0", one);
      const result = await submitAvailability({ message: "" }, fd);
      expect(result.message).toBe("No open week to update yet.");
    });

    // ── Task 16b: an edit that differs from the standard week must survive
    // as a date override; one that matches must create no row, or clear one
    // that already existed. ────────────────────────────────────────────────
    describe("date overrides from a submitted week", () => {
      const WEEK_START = "2026-09-07"; // Monday

      function ymd(offset: number): string {
        const d = new Date(WEEK_START + "T00:00:00");
        d.setDate(d.getDate() + offset);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
          d.getDate()
        ).padStart(2, "0")}`;
      }
      const DATES = Array.from({ length: 7 }, (_, i) => ymd(i));

      function blk(
        overrides: Partial<AvailabilityBlock> = {}
      ): AvailabilityBlock {
        return {
          start: null,
          end: null,
          mins: 60,
          energy: "normal",
          sports: null,
          ...overrides,
        };
      }

      function daySlot(
        date: string,
        status: "rest" | "completed" = "rest"
      ): DaySlot {
        return {
          date,
          availableBlocks: [] as AvailabilityBlock[],
          availableMins: 0,
          workouts: [],
          status,
        };
      }

      let planId: string;

      async function seedWeek(days: DaySlot[]): Promise<void> {
        const { db, schema } = await import("@/lib/db");
        await db.insert(schema.weekPlans).values({
          userId: USER,
          planId,
          weekStart: WEEK_START,
          skeletonWeek: 1,
          days,
          status: "open",
          effectiveTarget: 300,
        });
      }

      beforeAll(async () => {
        const { db, schema } = await import("@/lib/db");
        const [plan] = await db
          .insert(schema.trainingPlans)
          .values({
            userId: USER,
            title: "Plan Actions Test Plan",
            raceType: "marathon",
            raceDate: "2027-01-01",
            startDate: "2026-01-01",
            weeksTotal: 16,
            currentWeek: 1,
            status: "active",
          })
          .returning();
        planId = plan.id;
      });

      afterAll(async () => {
        const { db, schema } = await import("@/lib/db");
        await db
          .delete(schema.weekPlans)
          .where(eq(schema.weekPlans.userId, USER));
        await db
          .delete(schema.trainingPlans)
          .where(eq(schema.trainingPlans.userId, USER));
      });

      beforeEach(async () => {
        const { db, schema } = await import("@/lib/db");
        await db
          .delete(schema.weekPlans)
          .where(eq(schema.weekPlans.userId, USER));
        await db
          .delete(schema.availabilityOverrides)
          .where(eq(schema.availabilityOverrides.userId, USER));
        await db
          .delete(schema.availabilityDefaults)
          .where(eq(schema.availabilityDefaults.userId, USER));
      });

      // I8: "No time today" wrote the override row and stopped there. The
      // button only appears when the day HOLDS a session, and adaptDay reads
      // availableBlocks off the stored week rather than the override table,
      // so the session stayed put — the availability card said "Rest · Pinned"
      // while the week grid below it still showed the session.
      it("zeroDay moves the session off the day it just pinned to zero", async () => {
        const { db, schema } = await import("@/lib/db");

        // Every weekday has room, so the displaced session has somewhere to go.
        await db.insert(schema.availabilityDefaults).values(
          Array.from({ length: 7 }, (_, weekday) => ({
            userId: USER,
            weekday,
            blocks: [blk({ mins: 120 })],
          }))
        );

        const session = {
          day: 0,
          sport: "Run",
          type: "Endurance",
          durationMins: 60,
          intensity: "Z1-Z2",
          description: "Steady hour",
          purpose: "aerobic_base" as const,
          minEffectiveMins: 40,
          blockIdx: 0,
        };
        await seedWeek(
          DATES.map((d, i) => ({
            ...daySlot(d),
            availableBlocks: [blk({ mins: 120 })],
            availableMins: 120,
            workouts: i === 0 ? [session] : [],
            status: i === 0 ? ("planned" as const) : ("rest" as const),
          }))
        );

        const r = await zeroDay(DATES[0]);
        expect(r).toEqual({ ok: true });

        const week = await db.query.weekPlans.findFirst({
          where: eq(schema.weekPlans.userId, USER),
        });
        const days = week!.days as { date: string; workouts: unknown[] }[];

        // The pinned day is actually free now...
        expect(days[0].workouts).toEqual([]);
        // ...and the session was not simply deleted.
        expect(days.slice(1).some((d) => d.workouts.length > 0)).toBe(true);
      });

      // Reported from production on v0.26.0: editing the standard week moved
      // the availability card (which renders resolveWeek's live merge) but
      // left the session grid (which renders the STORED week) untouched. The
      // athlete zeroed their Friday, saw Friday go to Rest, and still had a
      // session sitting on it. Same defect class as "No time today": write the
      // row, never replan.
      it("a standard-week change replans the open week, not just the card", async () => {
        const { db, schema } = await import("@/lib/db");

        // Standard week: two hours every day. No overrides, so the default
        // applies to every date directly.
        await db.insert(schema.availabilityDefaults).values(
          Array.from({ length: 7 }, (_, weekday) => ({
            userId: USER,
            weekday,
            blocks: [blk({ mins: 120 })],
          }))
        );

        const session = {
          day: 3,
          sport: "Run",
          type: "Endurance",
          durationMins: 90,
          intensity: "Z1-Z2",
          description: "Long steady",
          purpose: "aerobic_base" as const,
          minEffectiveMins: 40,
          blockIdx: 0,
        };
        // The session sits on DATES[3]; every day carries real availability.
        await seedWeek(
          DATES.map((d, i) => ({
            ...daySlot(d),
            availableBlocks: [blk({ mins: 120 })],
            availableMins: 120,
            workouts: i === 3 ? [session] : [],
            status: i === 3 ? ("planned" as const) : ("rest" as const),
          }))
        );

        // Zero that weekday in the STANDARD WEEK — the exact production action.
        const weekday = (new Date(DATES[3] + "T00:00:00").getDay() + 6) % 7;
        const r = await setStandardWeekDay(weekday, []);
        expect(r).toEqual({ ok: true });

        const week = await db.query.weekPlans.findFirst({
          where: eq(schema.weekPlans.userId, USER),
        });
        const days = week!.days as {
          date: string;
          availableMins: number;
          workouts: unknown[];
        }[];

        // The stored week must agree with what the card now shows...
        expect(days[3].availableMins).toBe(0);
        expect(days[3].workouts).toEqual([]);
        // ...and the session must have been relocated, not silently dropped.
        expect(days.some((d, i) => i !== 3 && d.workouts.length > 0)).toBe(
          true
        );
      });

      it("refuses the whole submission when one day cannot be read", async () => {
        const { db, schema } = await import("@/lib/db");
        const defaultBlocks = [blk({ start: "06:00", end: "07:00" })];
        await db.insert(schema.availabilityDefaults).values({
          userId: USER,
          weekday: 0,
          blocks: defaultBlocks,
        });
        await seedWeek(DATES.map((d) => daySlot(d)));

        const fd = new FormData();
        fd.set(
          "blocks-0",
          JSON.stringify([blk({ start: "18:00", end: "19:00" })])
        );
        fd.set("blocks-1", "{not json");

        const result = await submitAvailability({ message: "" }, fd);
        expect(result.message).toContain("Nothing was changed");

        // Not a partial save: the readable day must not have been pinned
        // either, and no date may have been zeroed on the strength of a
        // field nobody could parse.
        const rows = await db.query.availabilityOverrides.findMany({
          where: eq(schema.availabilityOverrides.userId, USER),
        });
        expect(rows).toEqual([]);
      });

      it("pins a date whose submitted blocks differ from the standard week", async () => {
        const { db, schema } = await import("@/lib/db");
        const defaultBlocks = [blk({ start: "06:00", end: "07:00" })];
        await db.insert(schema.availabilityDefaults).values({
          userId: USER,
          weekday: 0,
          blocks: defaultBlocks,
        });
        await seedWeek(DATES.map((d) => daySlot(d)));

        const submitted = [
          blk({ start: "18:00", end: "19:00", energy: "easy" }),
        ];
        const fd = new FormData();
        fd.set("blocks-0", JSON.stringify(submitted));
        await submitAvailability({ message: "" }, fd);

        const override = await db.query.availabilityOverrides.findFirst({
          where: and(
            eq(schema.availabilityOverrides.userId, USER),
            eq(schema.availabilityOverrides.date, DATES[0])
          ),
        });
        expect(override?.blocks).toEqual(submitted);
      });

      it("creates no override row when the submitted day matches the standard week", async () => {
        const { db, schema } = await import("@/lib/db");
        const defaultBlocks = [blk({ start: "07:00", end: "08:00" })];
        await db.insert(schema.availabilityDefaults).values({
          userId: USER,
          weekday: 1,
          blocks: defaultBlocks,
        });
        await seedWeek(DATES.map((d) => daySlot(d)));

        const fd = new FormData();
        fd.set("blocks-1", JSON.stringify(defaultBlocks));
        await submitAvailability({ message: "" }, fd);

        const override = await db.query.availabilityOverrides.findFirst({
          where: and(
            eq(schema.availabilityOverrides.userId, USER),
            eq(schema.availabilityOverrides.date, DATES[1])
          ),
        });
        expect(override).toBeUndefined();
      });

      it("deletes an existing override once its submission matches the standard week again", async () => {
        const { db, schema } = await import("@/lib/db");
        const defaultBlocks = [blk({ start: "12:00", end: "13:00" })];
        await db.insert(schema.availabilityDefaults).values({
          userId: USER,
          weekday: 2,
          blocks: defaultBlocks,
        });
        await db.insert(schema.availabilityOverrides).values({
          userId: USER,
          date: DATES[2],
          blocks: [],
        });
        await seedWeek(DATES.map((d) => daySlot(d)));

        const fd = new FormData();
        fd.set("blocks-2", JSON.stringify(defaultBlocks));
        await submitAvailability({ message: "" }, fd);

        const override = await db.query.availabilityOverrides.findFirst({
          where: and(
            eq(schema.availabilityOverrides.userId, USER),
            eq(schema.availabilityOverrides.date, DATES[2])
          ),
        });
        expect(override).toBeUndefined();
      });

      it("does not pin a day the open week already marks completed", async () => {
        const { db, schema } = await import("@/lib/db");
        const defaultBlocks = [blk({ start: "06:00", end: "07:00" })];
        await db.insert(schema.availabilityDefaults).values({
          userId: USER,
          weekday: 3,
          blocks: defaultBlocks,
        });
        const days = DATES.map((d) => daySlot(d));
        days[3] = daySlot(DATES[3], "completed");
        await seedWeek(days);

        const fd = new FormData();
        fd.set(
          "blocks-3",
          JSON.stringify([blk({ start: "20:00", end: "21:00" })])
        );
        await submitAvailability({ message: "" }, fd);

        const override = await db.query.availabilityOverrides.findFirst({
          where: and(
            eq(schema.availabilityOverrides.userId, USER),
            eq(schema.availabilityOverrides.date, DATES[3])
          ),
        });
        expect(override).toBeUndefined();
      });

      it("the rule itself: an override's date stays put when its weekday default later changes, while other instances of that weekday follow the new default", async () => {
        const { db, schema } = await import("@/lib/db");
        const defaultV1 = [blk({ start: "06:00", end: "07:00" })];
        await db.insert(schema.availabilityDefaults).values({
          userId: USER,
          weekday: 0,
          blocks: defaultV1,
        });
        await seedWeek(DATES.map((d) => daySlot(d)));

        const pinned = [blk({ start: "20:00", end: "21:00", energy: "easy" })];
        const fd = new FormData();
        fd.set("blocks-0", JSON.stringify(pinned));
        await submitAvailability({ message: "" }, fd);

        const defaultV2 = [
          blk({ start: "05:00", end: "05:30", mins: 30, energy: "full" }),
        ];
        await setStandardWeekDay(0, defaultV2);

        const otherMonday = ymd(7); // next Monday — never overridden
        const { resolveWeek } = await import("@/lib/availability/resolve");
        const resolved = await resolveWeek(USER, [DATES[0], otherMonday]);

        expect(resolved.get(DATES[0])).toEqual(pinned);
        expect(resolved.get(otherMonday)).toEqual(defaultV2);
      });
    });
  });
});

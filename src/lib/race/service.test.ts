import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { assembleForecastInputs } from "./service";
import { getOpenWeekPlan } from "@/lib/week-plan/service";
import type { DaySlot } from "@/lib/week-plan/types";

// requires Postgres; skips without DATABASE_URL.
const hasDb =
  !!process.env.DATABASE_URL && process.env.DATABASE_DRIVER === "pg";

const TEST_USER = "test-race-service-user";
const WEEK_START = "2026-07-20"; // Monday

function emptyWeek(weekStart: string): DaySlot[] {
  const days: DaySlot[] = [];
  const d = new Date(weekStart + "T00:00:00");
  for (let i = 0; i < 7; i++) {
    const ymd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    days.push({ date: ymd, availableMins: 60, workout: null, status: "rest" });
    d.setDate(d.getDate() + 1);
  }
  return days;
}

/**
 * Perf pass (v0.20): assembleForecastInputs gained an optional `preloadedWeek`
 * param so callers that already hold the open week plan (the dashboard) can
 * skip a redundant `getOpenWeekPlan` re-fetch. This is a pure query-shape
 * change — it must return byte-identical output to the original
 * always-fetch-fresh behavior. That equivalence is the whole point of this
 * test file.
 */
describe.skipIf(!hasDb)(
  "assembleForecastInputs — preloadedWeek equivalence",
  () => {
    let planId: string;

    beforeAll(async () => {
      await db
        .insert(schema.users)
        .values({
          id: TEST_USER,
          name: "Test Race Service User",
          email: `${TEST_USER}@example.invalid`,
        })
        .onConflictDoNothing();

      const [plan] = await db
        .insert(schema.trainingPlans)
        .values({
          userId: TEST_USER,
          title: "Test Plan",
          raceType: "marathon",
          raceDate: "2026-12-01",
          startDate: "2026-01-01",
          weeksTotal: 16,
          currentWeek: 1,
          status: "active",
        })
        .returning();
      planId = plan.id;

      await db.insert(schema.trainingBlocks).values({
        planId,
        weekNumber: 1,
        phase: "base",
        targetLoadTotal: 300,
        targetSessions: 4,
        workouts: [],
      });

      await db.insert(schema.weekPlans).values({
        userId: TEST_USER,
        planId,
        weekStart: WEEK_START,
        skeletonWeek: 1,
        days: emptyWeek(WEEK_START),
        status: "open",
        effectiveTarget: 300,
      });

      await db
        .insert(schema.dailyMetrics)
        .values({
          userId: TEST_USER,
          date: "2026-07-21",
          ctl: 40,
          atl: 35,
        })
        .onConflictDoNothing();
    });

    afterAll(async () => {
      await db
        .delete(schema.weekPlans)
        .where(eq(schema.weekPlans.userId, TEST_USER));
      await db
        .delete(schema.trainingBlocks)
        .where(eq(schema.trainingBlocks.planId, planId));
      await db
        .delete(schema.trainingPlans)
        .where(eq(schema.trainingPlans.userId, TEST_USER));
      await db
        .delete(schema.dailyMetrics)
        .where(eq(schema.dailyMetrics.userId, TEST_USER));
      await db.delete(schema.users).where(eq(schema.users.id, TEST_USER));
    });

    it("returns identical output whether the open week plan is preloaded or fetched fresh", async () => {
      const now = new Date("2026-07-21T08:00:00Z");
      const week = await getOpenWeekPlan(TEST_USER);
      expect(week).not.toBeNull();

      const fetchedFresh = await assembleForecastInputs(TEST_USER, null, now);
      const withPreloaded = await assembleForecastInputs(
        TEST_USER,
        null,
        now,
        week
      );

      expect(withPreloaded).toEqual(fetchedFresh);
      expect(withPreloaded).not.toBeNull();
    });

    it("preloadedWeek=null short-circuits to the same 'no open week' result as a real miss", async () => {
      const now = new Date("2026-07-21T08:00:00Z");
      const noSuchUser = "test-race-service-no-such-user";

      const naturalMiss = await assembleForecastInputs(noSuchUser, null, now);
      const forcedMiss = await assembleForecastInputs(
        TEST_USER,
        null,
        now,
        null
      );

      expect(naturalMiss).toBeNull();
      expect(forcedMiss).toBeNull();
    });

    it("actually consumes the preloaded week — a tampered week (bad planId) changes the result", async () => {
      // Guards against the fix silently ignoring `preloadedWeek` and re-fetching
      // the real open week internally. A week whose planId points nowhere makes
      // the internal `trainingPlans` lookup miss → the function returns null. If
      // the argument were ignored, it would fetch the *real* open week (real
      // planId), find the plan, and return a non-null forecast — so this null
      // assertion can only hold if the preloaded value is genuinely used.
      // (planId is a uuid column, so use a well-formed but nonexistent uuid —
      // a non-uuid string would trip Postgres's input parser, not the lookup.)
      const now = new Date("2026-07-21T08:00:00Z");
      const realWeek = await getOpenWeekPlan(TEST_USER);
      expect(realWeek).not.toBeNull();

      const tamperedWeek = {
        ...realWeek!,
        planId: "00000000-0000-0000-0000-000000000000",
      };
      const result = await assembleForecastInputs(
        TEST_USER,
        null,
        now,
        tamperedWeek
      );

      expect(result).toBeNull();
    });
  }
);

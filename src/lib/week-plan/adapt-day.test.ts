// src/lib/week-plan/adapt-day.test.ts
import { describe, expect, it } from "vitest";
import { adaptDay } from "./adapt-day";
import type { DaySlot, WeekState } from "./types";

const D = (
  date: string,
  mins: number,
  workout: Partial<DaySlot["workout"]> | null,
  status: DaySlot["status"] = workout ? "planned" : "rest"
): DaySlot => ({
  date,
  availableMins: mins,
  workout: workout
    ? {
        day: 0,
        sport: "Run",
        type: "Endurance",
        durationMins: 45,
        intensity: "Z1-Z2",
        description: "Easy run",
        ...workout,
      }
    : null,
  status,
});

const week = (days: DaySlot[]): WeekState => ({
  weekStart: days[0].date,
  skeletonWeek: 5,
  days,
});

describe("adaptDay — missed yesterday", () => {
  it("marks yesterday missed and moves a quality session forward once", () => {
    const w = week([
      D("2026-07-20", 60, { type: "Intervals", durationMins: 50 }),
      D("2026-07-21", 60, null),
      D("2026-07-22", 90, null),
      D("2026-07-23", 60, null),
      D("2026-07-24", 60, null),
      D("2026-07-25", 60, null),
      D("2026-07-26", 60, null),
    ]);
    const r = adaptDay({
      week: w,
      today: "2026-07-21",
      band: "green",
      yesterdayCompleted: false,
    });
    expect(r.week.days[0].status).toBe("missed");
    const moved = r.week.days.find((d) => d.movedFrom === "2026-07-20");
    expect(moved).toBeDefined();
    expect(moved!.workout!.type).toBe("Intervals");
    expect(moved!.status).toBe("moved");
    expect(
      r.adjustments.some(
        (a) => a.trigger === "missed_workout" && a.action === "moved"
      )
    ).toBe(true);
  });

  it("drops a quality session missed twice and redistributes capped", () => {
    const w = week([
      D("2026-07-20", 60, null, "missed"),
      D("2026-07-21", 60, { type: "Intervals", durationMins: 48 }, "moved"),
      D("2026-07-22", 60, { durationMins: 40 }),
      D("2026-07-23", 60, { durationMins: 40 }),
      D("2026-07-24", 60, null),
      D("2026-07-25", 60, null),
      D("2026-07-26", 60, null),
    ]);
    w.days[1].movedFrom = "2026-07-20";
    const r = adaptDay({
      week: w,
      today: "2026-07-22",
      band: "green",
      yesterdayCompleted: false,
    });
    expect(r.week.days[1].status).toBe("missed");
    expect(r.week.days.some((d) => d.movedFrom === "2026-07-21")).toBe(false);
    // 40 × 1.25 = 50 max per remaining day
    expect(r.week.days[2].workout!.durationMins).toBeLessThanOrEqual(50);
    expect(r.week.days[3].workout!.durationMins).toBeLessThanOrEqual(50);
    expect(
      r.adjustments.some(
        (a) => a.trigger === "missed_workout" && a.action === "dropped"
      )
    ).toBe(true);
  });

  it("never moves a non-quality missed session — drops it", () => {
    const w = week([
      D("2026-07-20", 60, { type: "Endurance", durationMins: 45 }),
      D("2026-07-21", 60, { durationMins: 40 }),
      D("2026-07-22", 90, null),
      D("2026-07-23", 60, null),
      D("2026-07-24", 60, null),
      D("2026-07-25", 60, null),
      D("2026-07-26", 60, null),
    ]);
    const r = adaptDay({
      week: w,
      today: "2026-07-21",
      band: "green",
      yesterdayCompleted: false,
    });
    expect(r.week.days[0].status).toBe("missed");
    expect(r.week.days.some((d) => d.movedFrom)).toBe(false);
  });

  it("does nothing on yesterdayCompleted true or null", () => {
    const w = week([
      D("2026-07-20", 60, { durationMins: 45 }, "completed"),
      D("2026-07-21", 60, { durationMins: 40 }),
      D("2026-07-22", 90, null),
      D("2026-07-23", 60, null),
      D("2026-07-24", 60, null),
      D("2026-07-25", 60, null),
      D("2026-07-26", 60, null),
    ]);
    const r = adaptDay({
      week: w,
      today: "2026-07-21",
      band: "green",
      yesterdayCompleted: true,
    });
    expect(r.adjustments).toHaveLength(0);
    expect(r.week).toEqual(w);
  });
});

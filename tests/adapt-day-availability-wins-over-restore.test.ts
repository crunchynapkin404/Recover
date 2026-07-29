/**
 * Regression coverage for a defect found while verifying the readiness
 * idempotency hotfix (15a1ba5, DaySlot.readinessBase): the availability-fit
 * block in adapt-day.ts ran BEFORE the readiness block. When the readiness
 * band changed mid-day, the readiness block restored `readinessBase.workouts`
 * wholesale — discarding any compression the availability block had just
 * applied in that same call — and then scaled the restored FULL-length
 * session, which could land back outside today's available time.
 *
 * Concretely: a 137min ride, amber-adapted to 116min earlier in the day.
 * Midday the athlete's window collapses to 90min AND readiness drops to
 * red. The old code: restore to 137 -> ×0.7 (RED_ENDURANCE_SCALE) -> 96min
 * in a 90min window.
 *
 * The property this file protects: availability is a hard physical
 * constraint and must have the last word, even over a readiness restore.
 * The correct pipeline is "start from the planned session -> apply
 * readiness for the current band -> fit the result to today's available
 * time" — never the other way around when a restore is involved.
 *
 * A second property protected here: the restore must never resurrect a
 * session that the availability block has already moved to another day or
 * dropped for lack of time — whether that happened earlier in the very
 * same call, or in an earlier call entirely (readinessBase persists across
 * calls, same as the wellness data that triggers each one).
 */
import { describe, expect, it } from "vitest";
import { adaptDay } from "@/lib/week-plan/adapt-day";
import {
  AMBER_SCALE,
  dayMins,
  RED_ENDURANCE_SCALE,
} from "@/lib/week-plan/types";
import type {
  DaySlot,
  ScheduledWorkout,
  WeekState,
} from "@/lib/week-plan/types";
import { withPurpose } from "@/lib/training-plan";

function blocksFor(mins: number): DaySlot["availableBlocks"] {
  return mins > 0
    ? [{ start: null, end: null, mins, energy: "full", sports: null }]
    : [];
}

const D = (
  date: string,
  mins: number,
  workout: Partial<ScheduledWorkout> | null
): DaySlot => {
  const availableBlocks = blocksFor(mins);
  return {
    date,
    availableBlocks,
    availableMins: dayMins({ availableBlocks }),
    workouts: workout
      ? [
          withPurpose({
            day: 0,
            sport: "Bike",
            type: "Endurance",
            durationMins: 137,
            intensity: "Z1-Z2",
            description: "Long ride",
            blockIdx: 0,
            ...workout,
          }),
        ]
      : [],
    status: workout ? "planned" : "rest",
  };
};

const week = (days: DaySlot[]): WeekState => ({
  weekStart: days[0].date,
  skeletonWeek: 4,
  days,
});

function setMins(day: DaySlot, mins: number): void {
  const availableBlocks = blocksFor(mins);
  day.availableBlocks = availableBlocks;
  day.availableMins = dayMins({ availableBlocks });
}

/** Every ScheduledWorkout of `type`, anywhere in the week — used to catch
 * duplication (a session resurrected on today while also sitting wherever
 * availability already placed or left it). */
function countOfType(w: WeekState, type: string): number {
  return w.days.reduce(
    (n, d) => n + d.workouts.filter((x) => x.type === type).length,
    0
  );
}

const freshWeek = () =>
  week([
    D("2026-07-27", 300, { type: "Endurance", durationMins: 137 }),
    D("2026-07-28", 300, null),
    D("2026-07-29", 300, null),
    D("2026-07-30", 300, null),
    D("2026-07-31", 300, null),
    D("2026-08-01", 300, null),
    D("2026-08-02", 300, null),
  ]);

describe("adaptDay — availability wins over a readiness restore", () => {
  it("trims a band-change restore back down to today's shrunk available time (regression)", () => {
    const w = freshWeek();

    // 06:00 — plenty of time, readiness amber.
    const morning = adaptDay({
      week: w,
      today: "2026-07-27",
      band: "amber",
      yesterdayCompleted: null,
    });
    expect(morning.week.days[0].workouts[0]!.durationMins).toBe(
      Math.round(137 * AMBER_SCALE) // 116
    );

    // Midday — the athlete's day collapses to 90 minutes AND readiness
    // drops to red, in the same call.
    setMins(morning.week.days[0], 90);
    const midday = adaptDay({
      week: morning.week,
      today: "2026-07-27",
      band: "red",
      yesterdayCompleted: null,
    });

    const finalDay = midday.week.days[0];
    const finalMins = finalDay.workouts[0]?.durationMins ?? 0;
    // Never above the 90min the athlete actually has.
    expect(finalMins).toBeLessThanOrEqual(finalDay.availableMins);
    expect(finalMins).toBe(90);
    // Both steps are visible in the log: readiness scaled it, then
    // availability trimmed the result — not a single opaque jump.
    expect(midday.adjustments.some((a) => a.trigger === "low_readiness")).toBe(
      true
    );
    expect(midday.adjustments.some((a) => a.trigger === "no_time")).toBe(true);
  });

  it("restores fully when availability is unchanged across the band change", () => {
    // Mirror case: nothing about today's time changed, only readiness did.
    // Must not regress the pre-fix behaviour for the ordinary case.
    const w = freshWeek();
    const amber = adaptDay({
      week: w,
      today: "2026-07-27",
      band: "amber",
      yesterdayCompleted: null,
    });
    const thenRed = adaptDay({
      week: amber.week,
      today: "2026-07-27",
      band: "red",
      yesterdayCompleted: null,
    });
    const redOnly = adaptDay({
      week: freshWeek(),
      today: "2026-07-27",
      band: "red",
      yesterdayCompleted: null,
    });
    const expected = Math.round(137 * RED_ENDURANCE_SCALE); // 96
    expect(thenRed.week.days[0].workouts[0]!.durationMins).toBe(expected);
    expect(thenRed.week.days[0].workouts[0]!.durationMins).toBe(
      redOnly.week.days[0].workouts[0]!.durationMins
    );
    // Fits comfortably — no extra no_time trim needed.
    expect(thenRed.adjustments.some((a) => a.trigger === "no_time")).toBe(
      false
    );
  });

  it("restores fully without needless trimming when the restored, rescaled session still fits", () => {
    // Availability did shrink, but not enough to matter once readiness has
    // applied its own reduction — the restore must land on the full
    // red-scaled value, not stay pinned at the earlier amber-scaled one,
    // and must not be trimmed any further than red already trims it.
    const w = freshWeek();
    const amber = adaptDay({
      week: w,
      today: "2026-07-27",
      band: "amber",
      yesterdayCompleted: null,
    });
    expect(amber.week.days[0].workouts[0]!.durationMins).toBe(116);

    setMins(amber.week.days[0], 150); // shrunk from 300, but 96 still fits
    const thenRed = adaptDay({
      week: amber.week,
      today: "2026-07-27",
      band: "red",
      yesterdayCompleted: null,
    });
    const finalMins = thenRed.week.days[0].workouts[0]!.durationMins;
    expect(finalMins).toBe(Math.round(137 * RED_ENDURANCE_SCALE)); // 96
    expect(finalMins).toBeLessThanOrEqual(150);
    expect(thenRed.adjustments.some((a) => a.trigger === "no_time")).toBe(
      false
    );
  });

  it("does not resurrect a session availability collapses out of today in the very same call the band changes", () => {
    const w = freshWeek();
    const amber = adaptDay({
      week: w,
      today: "2026-07-27",
      band: "amber",
      yesterdayCompleted: null,
    });
    expect(amber.week.days[0].workouts[0]!.durationMins).toBe(116);

    // Time vanishes to zero AND readiness drops to red, together.
    setMins(amber.week.days[0], 0);
    const r = adaptDay({
      week: amber.week,
      today: "2026-07-27",
      band: "red",
      yesterdayCompleted: null,
    });

    expect(r.week.days[0].workouts).toHaveLength(0);
    const moved = r.week.days.find((d) => d.movedFrom === "2026-07-27");
    expect(moved).toBeDefined();
    expect(moved!.workouts[0]!.durationMins).toBe(
      Math.round(137 * RED_ENDURANCE_SCALE) // 96 — readiness-scaled, then moved
    );
    // Exactly one copy of the session exists anywhere in the week — not
    // one on the day it was moved to AND a resurrected duplicate back on
    // today.
    expect(countOfType(r.week, "Endurance")).toBe(1);
    expect(r.adjustments.filter((a) => a.trigger === "no_time")).toHaveLength(
      1
    );
  });

  it("does not resurrect a session availability already moved away in an earlier call, once the band later changes", () => {
    const w = freshWeek();

    // Call A: amber, plenty of time. Sets readinessBase.
    const callA = adaptDay({
      week: w,
      today: "2026-07-27",
      band: "amber",
      yesterdayCompleted: null,
    });
    expect(callA.week.days[0].workouts[0]!.durationMins).toBe(116);

    // Call B: band UNCHANGED (still amber), but time now collapses to
    // zero. Availability alone moves the (amber-scaled) session away and
    // must clear the now-stale readinessBase behind it.
    setMins(callA.week.days[0], 0);
    const callB = adaptDay({
      week: callA.week,
      today: "2026-07-27",
      band: "amber",
      yesterdayCompleted: null,
    });
    expect(callB.week.days[0].workouts).toHaveLength(0);
    const movedInB = callB.week.days.find((d) => d.movedFrom === "2026-07-27");
    expect(movedInB).toBeDefined();
    expect(movedInB!.workouts[0]!.durationMins).toBe(116);
    expect(callB.week.days[0].readinessBase).toBeUndefined();

    // Call C: band NOW changes to red. Today has had nothing on it since
    // call B — a stale readinessBase would restore the pristine 137min
    // original right back onto today, duplicating the copy that's already
    // sitting on the day call B moved it to. It must not.
    const callC = adaptDay({
      week: callB.week,
      today: "2026-07-27",
      band: "red",
      yesterdayCompleted: null,
    });

    expect(callC.week.days[0].workouts).toHaveLength(0);
    expect(callC.adjustments).toHaveLength(0); // nothing left on today to act on
    expect(countOfType(callC.week, "Endurance")).toBe(1);
    // The one copy is exactly as call B left it — call C didn't touch it.
    const stillMoved = callC.week.days.find(
      (d) => d.movedFrom === "2026-07-27"
    );
    expect(stillMoved!.workouts[0]!.durationMins).toBe(116);
  });

  it("a repeat run after stabilizing produces zero adjustments (no compounding)", () => {
    const w = freshWeek();
    const amber = adaptDay({
      week: w,
      today: "2026-07-27",
      band: "amber",
      yesterdayCompleted: null,
    });
    setMins(amber.week.days[0], 90);
    const stabilized = adaptDay({
      week: amber.week,
      today: "2026-07-27",
      band: "red",
      yesterdayCompleted: null,
    });
    expect(stabilized.week.days[0].workouts[0]!.durationMins).toBe(90);

    const repeat = adaptDay({
      week: stabilized.week,
      today: "2026-07-27",
      band: "red",
      yesterdayCompleted: null,
    });
    expect(repeat.adjustments).toHaveLength(0);
    expect(repeat.week.days[0].workouts[0]!.durationMins).toBe(90);
  });

  it("the red quality-swap recovery session also respects available time after a restore", () => {
    const w = week([
      D("2026-07-27", 300, {
        sport: "Run",
        type: "Intervals",
        durationMins: 50,
        intensity: "Z4-Z5",
      }),
      D("2026-07-28", 300, null),
      D("2026-07-29", 300, null),
      D("2026-07-30", 300, null),
      D("2026-07-31", 300, null),
      D("2026-08-01", 300, null),
      D("2026-08-02", 300, null),
    ]);
    const amber = adaptDay({
      week: w,
      today: "2026-07-27",
      band: "amber",
      yesterdayCompleted: null,
    });
    // Steps down to Tempo at 85% duration, as usual.
    expect(amber.week.days[0].workouts[0]!.type).toBe("Tempo");

    // Band worsens to red AND the window shrinks below even the fixed
    // 30min recovery swap (RED_RECOVERY_MINS) — the restore brings back
    // the original Intervals session, and the red-quality branch's own
    // blockFits(RED_RECOVERY_MINS) guard must still hold against the
    // CURRENT (shrunk) block, not wherever it was when the base was
    // captured.
    setMins(amber.week.days[0], 15);
    const r = adaptDay({
      week: amber.week,
      today: "2026-07-27",
      band: "red",
      yesterdayCompleted: null,
    });

    const today = r.week.days[0];
    // Removed from today (not squeezed in) — but final-review Finding 2:
    // it must be OFFERED to a later day rather than deleted outright, since
    // the rest of the week is wide open (300min/day). Deleting it here was
    // the exact regression this branch introduced: the pristine 50min
    // Intervals session vanished from the whole week, even with a free day
    // sitting right there, and the logged reason claimed a replacement that
    // never happened.
    expect(today.workouts).toHaveLength(0);
    expect(today.availableMins).toBe(15);
    expect(
      r.adjustments.some(
        (a) => a.trigger === "low_readiness" && a.action === "moved"
      )
    ).toBe(true);
    // Nothing claims a replacement that didn't happen.
    expect(
      r.adjustments.some((a) => a.reason.includes("replaced by recovery"))
    ).toBe(false);
    // No no_time adjustment on top — the readiness branch's own guard
    // already resolved it; the final availability pass is a no-op.
    expect(r.adjustments.some((a) => a.trigger === "no_time")).toBe(false);

    // The original, undiminished session survives on the first open day.
    const target = r.week.days.find((d) => d.date === "2026-07-28")!;
    expect(target.workouts).toHaveLength(1);
    expect(target.workouts[0].type).toBe("Intervals");
    expect(target.workouts[0].durationMins).toBe(50);
    expect(target.status).toBe("moved");
    expect(target.movedFrom).toBe("2026-07-27");
  });

  it("drops the red quality-swap session (with an honest reason) when even a later day has no room", () => {
    const w = week([
      D("2026-07-27", 300, {
        sport: "Run",
        type: "Intervals",
        durationMins: 50,
        intensity: "Z4-Z5",
      }),
      D("2026-07-28", 10, null),
      D("2026-07-29", 10, null),
      D("2026-07-30", 10, null),
      D("2026-07-31", 10, null),
      D("2026-08-01", 10, null),
      D("2026-08-02", 10, null),
    ]);
    const amber = adaptDay({
      week: w,
      today: "2026-07-27",
      band: "amber",
      yesterdayCompleted: null,
    });
    expect(amber.week.days[0].workouts[0]!.type).toBe("Tempo");

    setMins(amber.week.days[0], 15);
    const r = adaptDay({
      week: amber.week,
      today: "2026-07-27",
      band: "red",
      yesterdayCompleted: null,
    });

    const today = r.week.days[0];
    expect(today.workouts).toHaveLength(0);
    expect(
      r.adjustments.some(
        (a) => a.trigger === "low_readiness" && a.action === "dropped"
      )
    ).toBe(true);
    expect(
      r.adjustments.some((a) => a.reason.includes("replaced by recovery"))
    ).toBe(false);
    // Every other day is genuinely untouched — no phantom placement.
    for (let i = 1; i < 7; i++) {
      expect(r.week.days[i].workouts).toHaveLength(0);
    }
  });
});

// src/lib/week-plan/adapt-day.ts
import {
  type AdjustmentRecord,
  type Band,
  type WeekState,
  AMBER_SCALE,
  blockFits,
  DAY_REDISTRIBUTE_CAP_PCT,
  dayMins,
  isQuality,
  RED_ENDURANCE_SCALE,
  RED_RECOVERY_MINS,
  STEP_DOWN,
} from "./types";
import { withPurpose } from "@/lib/training-plan";

export interface AdaptDayInput {
  week: WeekState;
  today: string;
  band: Band;
  yesterdayCompleted: boolean | null;
}

export interface AdaptDayResult {
  week: WeekState;
  adjustments: AdjustmentRecord[];
}

function clone(week: WeekState): WeekState {
  return {
    ...week,
    days: week.days.map((d) => ({
      ...d,
      workouts: d.workouts.map((w) => ({ ...w })),
    })),
  };
}

function handleMissedYesterday(
  week: WeekState,
  todayIdx: number,
  adjustments: AdjustmentRecord[]
): void {
  const yIdx = todayIdx - 1;
  if (yIdx < 0) return;
  const y = week.days[yIdx];
  const yWorkout = y.workouts[0] ?? null;
  if (!yWorkout || y.status === "completed" || y.status === "missed") return;

  const before = [{ ...y, workouts: y.workouts.map((w) => ({ ...w })) }];
  const wasMovedBefore = y.movedFrom != null;
  const workout = yWorkout;
  week.days[yIdx] = {
    ...y,
    workouts: [],
    status: "missed",
    movedFrom: undefined,
  };

  if (isQuality(workout) && !wasMovedBefore) {
    for (let i = todayIdx; i < 7; i++) {
      const t = week.days[i];
      const adjacentQuality =
        isQuality(week.days[i - 1]?.workouts[0] ?? null) ||
        isQuality(week.days[i + 1]?.workouts[0] ?? null);
      if (
        t.workouts.length === 0 &&
        t.status !== "race" &&
        blockFits(t, workout.blockIdx, workout.durationMins) &&
        !adjacentQuality
      ) {
        // interim: Task 9 — blockIdx is carried across days unchecked; safe
        // only while every day has one block.
        week.days[i] = {
          ...t,
          workouts: [workout],
          status: "moved",
          movedFrom: y.date,
        };
        adjustments.push({
          date: y.date,
          trigger: "missed_workout",
          action: "moved",
          before,
          after: [{ ...week.days[i] }],
          reason: `${workout.type} missed on ${y.date} — moved to ${t.date}`,
        });
        return;
      }
    }
  }

  // Drop + redistribute over remaining planned days, capped per day.
  const remaining = week.days.filter(
    (d, i) =>
      i >= todayIdx &&
      d.workouts.length > 0 &&
      d.status !== "completed" &&
      d.status !== "race"
  );
  const share = remaining.length ? workout.durationMins / remaining.length : 0;
  for (const d of remaining) {
    const w = d.workouts[0]!;
    const cap = Math.round(w.durationMins * (1 + DAY_REDISTRIBUTE_CAP_PCT));
    // interim: total-day minutes, not per-block — Task 6 replaces this
    // with proper slot admission.
    w.durationMins = Math.min(
      cap,
      Math.min(dayMins(d), Math.round(w.durationMins + share))
    );
  }
  adjustments.push({
    date: y.date,
    trigger: "missed_workout",
    action: "dropped",
    before,
    after: remaining.map((d) => ({ ...d })),
    reason: wasMovedBefore
      ? `${workout.type} missed twice — dropped; remaining sessions absorb what fits (max +${Math.round(DAY_REDISTRIBUTE_CAP_PCT * 100)}%/day)`
      : `${workout.type} missed on ${y.date} — dropped; remaining sessions absorb what fits (max +${Math.round(DAY_REDISTRIBUTE_CAP_PCT * 100)}%/day)`,
  });
}

export function adaptDay(input: AdaptDayInput): AdaptDayResult {
  const week = clone(input.week);
  const adjustments: AdjustmentRecord[] = [];
  const todayIdx = week.days.findIndex((d) => d.date === input.today);
  if (todayIdx === -1) return { week: input.week, adjustments };

  if (input.yesterdayCompleted === false) {
    handleMissedYesterday(week, todayIdx, adjustments);
  } else if (input.yesterdayCompleted === true) {
    const y = week.days[todayIdx - 1];
    if (y && y.workouts.length > 0 && y.status !== "completed")
      y.status = "completed";
  }

  const today = week.days[todayIdx];

  // Race day: the slot is sacred — no scaling, no adaptation, no moves in.
  if (today.status === "race") return { week, adjustments };

  const todayWorkout = today.workouts[0] ?? null;

  // Availability first: time is a hard constraint, readiness a soft one.
  if (
    todayWorkout &&
    !blockFits(today, todayWorkout.blockIdx, todayWorkout.durationMins)
  ) {
    const before = [
      { ...today, workouts: today.workouts.map((w) => ({ ...w })) },
    ];
    const roomToday = dayMins(today);
    if (roomToday === 0) {
      const workout = todayWorkout;
      week.days[todayIdx] = { ...today, workouts: [], status: "rest" };
      const target = week.days.findIndex(
        (d, i) =>
          i > todayIdx &&
          d.workouts.length === 0 &&
          d.status !== "race" &&
          blockFits(d, workout.blockIdx, workout.durationMins)
      );
      if (target !== -1) {
        // interim: Task 9 — blockIdx is carried across days unchecked; safe
        // only while every day has one block.
        week.days[target] = {
          ...week.days[target],
          workouts: [workout],
          status: "moved",
          movedFrom: today.date,
        };
      }
      adjustments.push({
        date: today.date,
        trigger: "no_time",
        action: target !== -1 ? "moved" : "dropped",
        before,
        after: [
          { ...week.days[todayIdx] },
          ...(target !== -1 ? [{ ...week.days[target] }] : []),
        ],
        reason:
          target !== -1
            ? `no time on ${today.date} — ${workout.type} moved to ${week.days[target].date}`
            : `no time on ${today.date} — ${workout.type} dropped`,
      });
    } else {
      todayWorkout.durationMins = roomToday;
      today.status = "adapted";
      adjustments.push({
        date: today.date,
        trigger: "no_time",
        action: "scaled",
        before,
        after: [{ ...today, workouts: today.workouts.map((w) => ({ ...w })) }],
        reason: `shortened to fit available time (${roomToday}min)`,
      });
    }
  }

  const t = week.days[todayIdx]; // may have been replaced above
  const tWorkout = t.workouts[0] ?? null;
  if (tWorkout && (input.band === "red" || input.band === "amber")) {
    const before = [{ ...t, workouts: t.workouts.map((w) => ({ ...w })) }];
    if (input.band === "red") {
      if (isQuality(tWorkout)) {
        if (!blockFits(t, tWorkout.blockIdx, RED_RECOVERY_MINS)) {
          week.days[todayIdx] = { ...t, workouts: [], status: "rest" };
        } else {
          week.days[todayIdx] = {
            ...t,
            status: "adapted",
            workouts: [
              withPurpose({
                ...tWorkout,
                type: "Recovery",
                intensity: "Recovery",
                durationMins: RED_RECOVERY_MINS,
                description: "Easy recovery session — readiness is red",
              }),
            ],
          };
        }
        adjustments.push({
          date: t.date,
          trigger: "low_readiness",
          action: "swapped",
          before,
          after: [{ ...week.days[todayIdx] }],
          reason: `readiness red — ${before[0].workouts[0]!.type} replaced by recovery`,
        });
      } else {
        tWorkout.durationMins = Math.round(
          tWorkout.durationMins * RED_ENDURANCE_SCALE
        );
        t.status = "adapted";
        adjustments.push({
          date: t.date,
          trigger: "low_readiness",
          action: "scaled",
          before,
          after: [{ ...t, workouts: t.workouts.map((w) => ({ ...w })) }],
          reason: `readiness red — duration reduced ${Math.round((1 - RED_ENDURANCE_SCALE) * 100)}%`,
        });
      }
    } else {
      const steppedType = isQuality(tWorkout)
        ? (STEP_DOWN[tWorkout.type] ?? "Endurance")
        : tWorkout.type;
      t.workouts[0] = withPurpose({
        ...tWorkout,
        type: steppedType,
        intensity: isQuality(before[0].workouts[0] ?? null)
          ? "Z3"
          : tWorkout.intensity,
        durationMins: Math.round(tWorkout.durationMins * AMBER_SCALE),
      });
      t.status = "adapted";
      adjustments.push({
        date: t.date,
        trigger: "low_readiness",
        action: "scaled",
        before,
        after: [{ ...t, workouts: t.workouts.map((w) => ({ ...w })) }],
        reason: `readiness amber — one step down, duration ×${AMBER_SCALE}`,
      });
    }
  }

  return { week, adjustments };
}

// src/lib/week-plan/adapt-day.ts
import {
  type AdjustmentRecord,
  type Band,
  type WeekState,
  AMBER_SCALE,
  DAY_REDISTRIBUTE_CAP_PCT,
  isQuality,
  RED_ENDURANCE_SCALE,
  RED_RECOVERY_MINS,
  STEP_DOWN,
} from "./types";

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
      workout: d.workout ? { ...d.workout } : null,
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
  if (!y.workout || y.status === "completed" || y.status === "missed") return;

  const before = [{ ...y, workout: { ...y.workout } }];
  const wasMovedBefore = y.movedFrom != null;
  const workout = y.workout;
  week.days[yIdx] = {
    ...y,
    workout: null,
    status: "missed",
    movedFrom: undefined,
  };

  if (isQuality(workout) && !wasMovedBefore) {
    for (let i = todayIdx; i < 7; i++) {
      const t = week.days[i];
      const adjacentQuality =
        isQuality(week.days[i - 1]?.workout ?? null) ||
        isQuality(week.days[i + 1]?.workout ?? null);
      if (
        t.workout === null &&
        t.availableMins >= workout.durationMins &&
        !adjacentQuality
      ) {
        week.days[i] = {
          ...t,
          workout,
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
    (d, i) => i >= todayIdx && d.workout && d.status !== "completed"
  );
  const share = remaining.length ? workout.durationMins / remaining.length : 0;
  for (const d of remaining) {
    const cap = Math.round(
      d.workout!.durationMins * (1 + DAY_REDISTRIBUTE_CAP_PCT)
    );
    d.workout!.durationMins = Math.min(
      cap,
      Math.min(d.availableMins, Math.round(d.workout!.durationMins + share))
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
    if (y && y.workout && y.status !== "completed") y.status = "completed";
  }

  const today = week.days[todayIdx];

  // Availability first: time is a hard constraint, readiness a soft one.
  if (today.workout && today.workout.durationMins > today.availableMins) {
    const before = [{ ...today, workout: { ...today.workout } }];
    if (today.availableMins === 0) {
      const workout = today.workout;
      week.days[todayIdx] = { ...today, workout: null, status: "rest" };
      const target = week.days.findIndex(
        (d, i) =>
          i > todayIdx &&
          d.workout === null &&
          d.availableMins >= workout.durationMins
      );
      if (target !== -1) {
        week.days[target] = {
          ...week.days[target],
          workout,
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
      today.workout.durationMins = today.availableMins;
      today.status = "adapted";
      adjustments.push({
        date: today.date,
        trigger: "no_time",
        action: "scaled",
        before,
        after: [{ ...today, workout: { ...today.workout } }],
        reason: `shortened to fit available time (${today.availableMins}min)`,
      });
    }
  }

  const t = week.days[todayIdx]; // may have been replaced above
  if (t.workout && (input.band === "red" || input.band === "amber")) {
    const before = [{ ...t, workout: { ...t.workout } }];
    if (input.band === "red") {
      if (isQuality(t.workout)) {
        if (t.availableMins < RED_RECOVERY_MINS) {
          week.days[todayIdx] = { ...t, workout: null, status: "rest" };
        } else {
          week.days[todayIdx] = {
            ...t,
            status: "adapted",
            workout: {
              ...t.workout,
              type: "Recovery",
              intensity: "Recovery",
              durationMins: RED_RECOVERY_MINS,
              description: "Easy recovery session — readiness is red",
            },
          };
        }
        adjustments.push({
          date: t.date,
          trigger: "low_readiness",
          action: "swapped",
          before,
          after: [{ ...week.days[todayIdx] }],
          reason: `readiness red — ${before[0].workout!.type} replaced by recovery`,
        });
      } else {
        t.workout.durationMins = Math.round(
          t.workout.durationMins * RED_ENDURANCE_SCALE
        );
        t.status = "adapted";
        adjustments.push({
          date: t.date,
          trigger: "low_readiness",
          action: "scaled",
          before,
          after: [{ ...t, workout: { ...t.workout } }],
          reason: `readiness red — duration reduced ${Math.round((1 - RED_ENDURANCE_SCALE) * 100)}%`,
        });
      }
    } else {
      const steppedType = isQuality(t.workout)
        ? (STEP_DOWN[t.workout.type] ?? "Endurance")
        : t.workout.type;
      t.workout = {
        ...t.workout,
        type: steppedType,
        intensity: isQuality(before[0].workout) ? "Z3" : t.workout.intensity,
        durationMins: Math.round(t.workout.durationMins * AMBER_SCALE),
      };
      t.status = "adapted";
      adjustments.push({
        date: t.date,
        trigger: "low_readiness",
        action: "scaled",
        before,
        after: [{ ...t, workout: { ...t.workout } }],
        reason: `readiness amber — one step down, duration ×${AMBER_SCALE}`,
      });
    }
  }

  return { week, adjustments };
}

// src/lib/week-plan/adapt-day.ts
import {
  type AdjustmentRecord,
  type Band,
  type DaySlot,
  type WeekState,
  DAY_REDISTRIBUTE_CAP_PCT,
  isQuality,
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

  return { week, adjustments };
}

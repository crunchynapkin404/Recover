// src/lib/week-plan/adapt-day.ts
import {
  type AdjustmentRecord,
  type Band,
  type WeekState,
  AMBER_SCALE,
  blockFits,
  DAY_REDISTRIBUTE_CAP_PCT,
  isQuality,
  RED_ENDURANCE_SCALE,
  RED_RECOVERY_MINS,
  STEP_DOWN,
} from "./types";
import { findBlockFor, fitToBlock } from "./slots";
import { blockMins } from "@/lib/availability/types";
import { withPurpose, type PlannedWorkout } from "@/lib/training-plan";

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
  if (
    y.workouts.length === 0 ||
    y.status === "completed" ||
    y.status === "missed"
  )
    return;

  const before = [{ ...y, workouts: y.workouts.map((w) => ({ ...w })) }];
  const wasMovedBefore = y.movedFrom != null;
  // Snapshot every session on the missed day — not just the first — before
  // the day itself is wiped below. A two-session day misses both sessions,
  // and each needs its own chance to move forward or be recorded as dropped.
  const missedWorkouts = y.workouts.map((w) => ({ ...w }));
  week.days[yIdx] = {
    ...y,
    workouts: [],
    status: "missed",
    movedFrom: undefined,
  };

  const toDrop: PlannedWorkout[] = [];
  for (const workout of missedWorkouts) {
    if (isQuality(workout) && !wasMovedBefore) {
      let moved = false;
      for (let i = todayIdx; i < 7; i++) {
        const t = week.days[i];
        if (t.workouts.length === 0 && t.status !== "race") {
          // admits() carries the quality-adjacency check itself (and size,
          // sport, energy ceiling) — the block tried is whichever on this
          // day actually fits, not the one the session happened to occupy
          // before.
          const blockIdx = findBlockFor(week.days, i, workout, new Set());
          if (blockIdx != null) {
            week.days[i] = {
              ...t,
              workouts: [{ ...workout, blockIdx }],
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
            moved = true;
            break;
          }
        }
      }
      if (moved) continue;
    }
    toDrop.push(workout);
  }

  if (toDrop.length === 0) return;

  // Drop + redistribute over remaining planned days, capped per day. One
  // combined pass over every dropped session's minutes — not one pass per
  // session — so the +25%/day cap is judged against each remaining day's
  // own original duration once, not compounded across multiple passes.
  const remaining = week.days.filter(
    (d, i) =>
      i >= todayIdx &&
      d.workouts.length > 0 &&
      d.status !== "completed" &&
      d.status !== "race"
  );
  const totalMins = toDrop.reduce((s, wo) => s + wo.durationMins, 0);
  const share = remaining.length ? totalMins / remaining.length : 0;
  for (const d of remaining) {
    const w = d.workouts[0]!;
    const cap = Math.round(w.durationMins * (1 + DAY_REDISTRIBUTE_CAP_PCT));
    const block = d.availableBlocks[w.blockIdx];
    const blockCapacity = block ? blockMins(block) : 0;
    w.durationMins = Math.min(
      cap,
      Math.min(blockCapacity, Math.round(w.durationMins + share))
    );
  }
  const label = toDrop.map((wo) => wo.type).join(" + ");
  adjustments.push({
    date: y.date,
    trigger: "missed_workout",
    action: "dropped",
    before,
    after: remaining.map((d) => ({ ...d })),
    reason: wasMovedBefore
      ? `${label} missed twice — dropped; remaining sessions absorb what fits (max +${Math.round(DAY_REDISTRIBUTE_CAP_PCT * 100)}%/day)`
      : `${label} missed on ${y.date} — dropped; remaining sessions absorb what fits (max +${Math.round(DAY_REDISTRIBUTE_CAP_PCT * 100)}%/day)`,
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
    const block = today.availableBlocks[todayWorkout.blockIdx];
    const blockCapacity = block ? blockMins(block) : 0;
    // Only this one session is removed from today's workouts below — any
    // sibling session (a second block, untouched) is left exactly as it
    // was, never wiped out as a side effect of this one's fate.
    const remainingToday = today.workouts.filter((w) => w !== todayWorkout);
    const fitted = fitToBlock(todayWorkout, blockCapacity);

    if (!fitted) {
      const workout = todayWorkout;
      week.days[todayIdx] = {
        ...today,
        workouts: remainingToday,
        status: remainingToday.length > 0 ? today.status : "rest",
      };
      // Same rule as the missed-yesterday move above: pick whichever block
      // on a candidate day actually admits the session, not the index it
      // carried from today. findIndex can't hand back a block index, so the
      // search is unrolled — first day (in order) with an admitting block
      // wins, matching the previous findIndex's ordering exactly.
      let target = -1;
      let targetBlockIdx: number | null = null;
      for (let i = todayIdx + 1; i < 7; i++) {
        const d = week.days[i];
        if (d.workouts.length === 0 && d.status !== "race") {
          const blockIdx = findBlockFor(week.days, i, workout, new Set());
          if (blockIdx != null) {
            target = i;
            targetBlockIdx = blockIdx;
            break;
          }
        }
      }
      if (target !== -1) {
        week.days[target] = {
          ...week.days[target],
          workouts: [{ ...workout, blockIdx: targetBlockIdx! }],
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
      week.days[todayIdx] = {
        ...today,
        workouts: [
          ...remainingToday,
          { ...fitted.workout, blockIdx: todayWorkout.blockIdx },
        ],
        status: "adapted",
      };
      adjustments.push({
        date: today.date,
        trigger: "no_time",
        action: fitted.how === "compressed" ? "scaled" : "swapped",
        before,
        after: [{ ...week.days[todayIdx] }],
        reason:
          fitted.how === "compressed"
            ? `shortened to fit available time (${fitted.workout.durationMins}min)`
            : `only ${fitted.workout.durationMins}min available — ${todayWorkout.type} replaced by ${fitted.workout.type}, which still works at that length`,
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
          const remaining = t.workouts.filter((w) => w !== tWorkout);
          week.days[todayIdx] = {
            ...t,
            workouts: remaining,
            status: remaining.length > 0 ? t.status : "rest",
          };
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

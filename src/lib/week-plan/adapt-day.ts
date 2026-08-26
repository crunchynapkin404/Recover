// src/lib/week-plan/adapt-day.ts
import {
  type AdjustmentRecord,
  type Band,
  type DaySlot,
  type ScheduledWorkout,
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

/**
 * The plan's endurance sport, read off the week's own evidence.
 *
 * `WeekState` carries no plan-level sport field — only each workout's own
 * `sport` — and `adaptDay`'s caller (`runDailyAdaptation`, service.ts) never
 * fetches the parent plan row either, so there is no plan sport already in
 * scope to reach for; threading one in would mean a new field on
 * `AdaptDayInput` and a new query and a new join at the one call site, for a
 * single substitution branch below. `fillSport` (fill.ts) already settled
 * the same question the same way: "the week itself is the evidence" — a
 * materialized week always generates its endurance sessions before
 * strength is ever appended on top (materialize.ts), so an endurance
 * `sport` is always sitting on some other day right next to the lift.
 *
 * Returns null only when literally no non-strength workout exists anywhere
 * in the week — a shape no materialized week actually has (strength is
 * always additive over a generated endurance plan); callers fall back to
 * leaving the sport as it was rather than fabricating one.
 */
function weekEnduranceSport(days: DaySlot[]): string | null {
  for (const d of days) {
    for (const w of d.workouts) {
      if (w.purpose !== "strength") return w.sport;
    }
  }
  return null;
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
  // A missed lift is not endurance debt: strength never merges into an
  // endurance metric, and that includes the MINUTES an endurance session
  // grows by here, not just the load figures elsewhere in this codebase.
  // Without this exclusion a missed 45min lift grew three 60min rides to
  // 75min each — inflating each ride's minutes by a session that was never
  // itself endurance to begin with.
  const totalMins = toDrop
    .filter((wo) => wo.purpose !== "strength")
    .reduce((s, wo) => s + wo.durationMins, 0);
  const share = remaining.length ? totalMins / remaining.length : 0;
  for (const d of remaining) {
    const w = d.workouts[0]!;
    // Strength is excluded from the recipients here for the same reason
    // it's excluded from the dropped total above: a lift's duration is not
    // a dial anywhere in this codebase (see the strength-readiness branch
    // in adaptDay below). Without this, a missed ride's minutes grew a
    // day's lift — a fabricated duration against an unchanged prescription.
    if (w.purpose === "strength") continue;
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

/**
 * Removes `workout` from today and offers it to the first later day (in
 * date order) with room for it; drops it if none exists. Mutates
 * `week.days[todayIdx]` (and the target day, if one is found) and returns
 * exactly one adjustment describing whichever actually happened — never a
 * fixed story that might not match the outcome.
 *
 * Shared by the availability pass below and the red-readiness quality swap:
 * both face the identical "doesn't fit today — does anything else?"
 * question, and the swap must offer the session to another day rather than
 * deleting it outright just because a recovery-length substitute doesn't
 * fit today either. A session removed here and not picked up by any later
 * day is gone from the whole week, so this is the ONE place that is allowed
 * to happen — every caller must route through it rather than deleting
 * inline.
 */
function moveOrDropWorkout(
  week: WeekState,
  todayIdx: number,
  today: DaySlot,
  workout: ScheduledWorkout,
  remainingToday: ScheduledWorkout[],
  before: DaySlot[],
  trigger: AdjustmentRecord["trigger"],
  reason: (targetDate: string | null) => string
): AdjustmentRecord {
  week.days[todayIdx] = {
    ...today,
    workouts: remainingToday,
    status: remainingToday.length > 0 ? today.status : "rest",
    // The session that owned this base is gone from today — moved or
    // dropped. A stale base left in place would let a later band change
    // "restore" it right back onto today, resurrecting a session that
    // was just placed elsewhere (or dropped for good reason).
    readinessBase: undefined,
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
  return {
    date: today.date,
    trigger,
    action: target !== -1 ? "moved" : "dropped",
    before,
    after: [
      { ...week.days[todayIdx] },
      ...(target !== -1 ? [{ ...week.days[target] }] : []),
    ],
    reason: reason(target !== -1 ? week.days[target].date : null),
  };
}

/**
 * Availability is a hard constraint: fit today's first session into the
 * block it occupies, or move/drop it when nothing — not even a substitute
 * at its floor — fits. Mutates `week.days[todayIdx]` in place and pushes a
 * `no_time` adjustment when a change was needed; a no-op (no adjustment)
 * when the session already fits.
 *
 * Shared by both the availability-first pass (below, on whatever is
 * actually sitting on today right now) and the final pass after readiness
 * has produced today's result — availability gets the last word either
 * way, via the exact same fitting logic.
 */
function fitAvailability(
  week: WeekState,
  todayIdx: number,
  adjustments: AdjustmentRecord[]
): void {
  const today = week.days[todayIdx];
  const todayWorkout = today.workouts[0] ?? null;
  if (
    !todayWorkout ||
    blockFits(today, todayWorkout.blockIdx, todayWorkout.durationMins)
  ) {
    return;
  }

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
    adjustments.push(
      moveOrDropWorkout(
        week,
        todayIdx,
        today,
        todayWorkout,
        remainingToday,
        before,
        "no_time",
        (targetDate) =>
          targetDate
            ? `no time on ${today.date} — ${todayWorkout.type} moved to ${targetDate}`
            : `no time on ${today.date} — ${todayWorkout.type} dropped`
      )
    );
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

  // Readiness adaptation is a function of the ORIGINAL session and today's
  // band — never of its own previous output. See DaySlot.readinessBase:
  // onWellnessDataChanged re-runs this on every wellness event, and a
  // version that read its own already-adapted output back would keep
  // shrinking the same session run after run.
  const priorBase = today.readinessBase;
  const bandChanging =
    priorBase != null &&
    priorBase.date === input.today &&
    priorBase.band !== input.band;

  if (!bandChanging) {
    // Ordinary path: either today has no readiness history yet, or the
    // band hasn't moved since the last adaptation. Availability is a hard
    // constraint checked against whatever is actually sitting on today
    // right now — time wins first, readiness (below) scales what's left.
    fitAvailability(week, todayIdx, adjustments);
  }
  // else: the band is about to change, which means the restore below is
  // going to replace today's session with the pristine original anyway.
  // Checking the stale, about-to-be-discarded session against availability
  // here would produce a throwaway adjustment at best — and at worst could
  // move or drop that stale session to another day, only for the restore
  // to resurrect it right back onto today a moment later. Skip straight to
  // the restore; the correct pipeline for this case is "restore → apply
  // readiness → fit to available time", not "fit stale → restore → scale".

  const t = week.days[todayIdx]; // may have been replaced above
  const currentBase = t.readinessBase;
  if (currentBase && currentBase.date === input.today) {
    if (currentBase.band === input.band) {
      // Already adapted for exactly this band today. Nothing left to do —
      // and critically, no further adjustment: runDailyAdaptation persists
      // whenever anything changed, so a no-op here (beyond whatever
      // fitAvailability above already logged) is what stops the
      // compounding.
      return { week, adjustments };
    }
    // The band moved. Restore the original session and re-derive from it
    // below, so amber-then-red lands exactly where red-only would, and a
    // recovery to green undoes the day entirely.
    week.days[todayIdx] = {
      ...t,
      workouts: currentBase.workouts.map((w) => ({ ...w })),
      status: "planned",
      readinessBase: undefined,
    };
  }

  const day = week.days[todayIdx];
  const tWorkout = day.workouts[0] ?? null;
  if (tWorkout && (input.band === "red" || input.band === "amber")) {
    // Snapshot the ORIGINAL session before any mutation below — this is
    // what the next run must derive from, not whatever we're about to
    // produce.
    const base = {
      date: input.today,
      band: input.band,
      workouts: day.workouts.map((w) => ({ ...w })),
    };
    const before = [{ ...day, workouts: day.workouts.map((w) => ({ ...w })) }];
    if (input.band === "red") {
      // A strength session degrades exactly like a quality one: substitute
      // to a full recovery session rather than shrink its duration. Note the
      // substitute is hardcoded here, NOT read from SUBSTITUTE_TO — this
      // branch is shared with isQuality, and reading the table would send a
      // red-day vo2max session to Tempo instead of Recovery, which is a
      // different behaviour. Cutting a lift's minutes while keeping
      // every prescribed set is a rest-interval cut, not a reduction — the
      // opposite of spec D3's intent. Sharing this branch with isQuality is
      // deliberate: both need the identical "substitute to a full recovery
      // session, or move/drop when not even that fits" behaviour, and the
      // reason strings below already read the replaced session's own
      // `type`, so nothing here needs to know it was a lift.
      if (isQuality(tWorkout) || tWorkout.purpose === "strength") {
        if (!blockFits(day, tWorkout.blockIdx, RED_RECOVERY_MINS)) {
          // Not even a recovery-length substitute fits today's block — most
          // often reached when the band worsens to red in the same call as
          // an availability collapse (the bandChanging skip above means the
          // pre-readiness fitAvailability pass never ran, so this is the
          // first time the just-restored, pristine session has met today's
          // shrunk block). Route through the same move/drop search
          // fitAvailability uses, rather than deleting the session inline:
          // deleting it here silently drops it from the entire week — even
          // when a wide-open day is sitting right there — and a
          // "replaced by recovery" reason would be a lie once nothing was
          // actually replaced.
          const remaining = day.workouts.filter((w) => w !== tWorkout);
          adjustments.push(
            moveOrDropWorkout(
              week,
              todayIdx,
              day,
              tWorkout,
              remaining,
              before,
              "low_readiness",
              (targetDate) =>
                targetDate
                  ? `readiness red — no room today even for a recovery session; ${tWorkout.type} moved to ${targetDate}`
                  : `readiness red — no room today even for a recovery session; ${tWorkout.type} dropped`
            )
          );
        } else {
          week.days[todayIdx] = {
            ...day,
            status: "adapted",
            workouts: [
              withPurpose({
                ...tWorkout,
                // A substituted lift must not keep `sport: "Strength"`:
                // completion matching (service.ts) accepts only a logged
                // lift for that sport, so an "Easy recovery session" an
                // athlete actually rode or ran could never mark the day
                // done — the day reads as missed, and its minutes get
                // redistributed as endurance debt on top. Read the plan's
                // endurance sport off the week's own evidence
                // (weekEnduranceSport, above); an ordinary quality→recovery
                // swap already carries the right sport in via `...tWorkout`
                // and is left untouched.
                sport:
                  tWorkout.purpose === "strength"
                    ? (weekEnduranceSport(week.days) ?? tWorkout.sport)
                    : tWorkout.sport,
                type: "Recovery",
                intensity: "Recovery",
                durationMins: RED_RECOVERY_MINS,
                description: "Easy recovery session — readiness is red",
                // A lift's structured prescription belongs to the session it
                // was written for, not to the recovery session replacing it —
                // carrying it over would render sets/reps/kg under a
                // "Recovery" header (week-day-list.tsx keys its description
                // line off `exercises`, not off `type`).
                exercises: undefined,
              }),
            ],
            readinessBase: base,
          };
          adjustments.push({
            date: day.date,
            trigger: "low_readiness",
            action: "swapped",
            before,
            after: [{ ...week.days[todayIdx] }],
            reason: `readiness red — ${before[0].workouts[0]!.type} replaced by recovery`,
          });
        }
      } else {
        tWorkout.durationMins = Math.round(
          tWorkout.durationMins * RED_ENDURANCE_SCALE
        );
        day.status = "adapted";
        day.readinessBase = base;
        adjustments.push({
          date: day.date,
          trigger: "low_readiness",
          action: "scaled",
          before,
          after: [{ ...day, workouts: day.workouts.map((w) => ({ ...w })) }],
          reason: `readiness red — duration reduced ${Math.round((1 - RED_ENDURANCE_SCALE) * 100)}%`,
        });
      }
    } else if (tWorkout.purpose !== "strength") {
      // Amber never touches a lift (see the red branch's comment above): a
      // strength session's duration is not a dial, and amber has no
      // lesser-stimulus tier to step down to the way a quality session
      // steps to its STEP_DOWN target. Left intact — no scaling, no type
      // change, no adjustment logged, exactly the same no-op shape as the
      // "already adapted" / "green" cases elsewhere in this function.
      const steppedType = isQuality(tWorkout)
        ? (STEP_DOWN[tWorkout.type] ?? "Endurance")
        : tWorkout.type;
      day.workouts[0] = withPurpose({
        ...tWorkout,
        type: steppedType,
        intensity: isQuality(before[0].workouts[0] ?? null)
          ? "Z3"
          : tWorkout.intensity,
        durationMins: Math.round(tWorkout.durationMins * AMBER_SCALE),
      });
      day.status = "adapted";
      day.readinessBase = base;
      adjustments.push({
        date: day.date,
        trigger: "low_readiness",
        action: "scaled",
        before,
        after: [{ ...day, workouts: day.workouts.map((w) => ({ ...w })) }],
        reason: `readiness amber — one step down, duration ×${AMBER_SCALE}`,
      });
    }
  }

  // Availability has the last word: whatever readiness just produced — a
  // restored-and-rescaled session, or the ordinary fitted-then-scaled one —
  // must still fit today's block. A no-op when it already does (the
  // ordinary path above already fit it once), which is what keeps a repeat
  // run with nothing changed from emitting a second no_time adjustment.
  fitAvailability(week, todayIdx, adjustments);

  return { week, adjustments };
}

import { generateWorkouts, withPurpose } from "@/lib/training-plan";
import {
  raceWeekWorkouts,
  taperFractionForWeek,
  TAPER_FRACTION_RACE_WEEK,
  type RaceContext,
} from "@/lib/race/taper";
import {
  type Band,
  GENERATOR_CAP_SHORTFALL_PCT,
  LOW_ADHERENCE_BUMP,
  LOW_ADHERENCE_PCT,
  MISSED_WEEK_RESTART,
  RAMP_CLAMP_PCT,
  SUPPRESSED_READINESS_DAYS,
  SUPPRESSED_REDUCTION,
  type AdjustmentRecord,
  type DaySlot,
  type WeekState,
  dayMins,
  isQuality,
  QUALITY_TYPES,
  STEP_DOWN,
} from "./types";
import { buildSlots, admits, slotKey, fitToBlock, findBlockFor } from "./slots";
import type { AvailabilityBlock } from "@/lib/availability/types";
import { MAX_SESSIONS_PER_DAY } from "@/lib/availability/types";

export interface EffectiveLoadInput {
  skeletonTarget: number;
  prevWeek: { actualLoad: number; adherencePct: number } | null;
  recentBands: Band[];
  /** Taper weeks skip restart/adherence logic and the downward ramp clamp. */
  taperWeek?: boolean;
}

export function effectiveWeekLoad(input: EffectiveLoadInput): {
  load: number;
  reasons: string[];
} {
  const { skeletonTarget, prevWeek, recentBands, taperWeek } = input;
  const reasons: string[] = [];

  if (!taperWeek && prevWeek && prevWeek.actualLoad === 0) {
    const load = Math.round(skeletonTarget * MISSED_WEEK_RESTART);
    reasons.push(
      `last week was fully missed — restarting at ${Math.round(
        MISSED_WEEK_RESTART * 100
      )}% of the skeleton target (${load})`
    );
    return { load, reasons };
  }

  let target = skeletonTarget;

  if (!taperWeek && prevWeek && prevWeek.adherencePct < LOW_ADHERENCE_PCT) {
    target = prevWeek.actualLoad * LOW_ADHERENCE_BUMP;
    reasons.push(
      `adherence was ${Math.round(prevWeek.adherencePct)}% — building on last week's actual load instead of the skeleton`
    );
  }

  const badDays = recentBands.filter(
    (b) => b === "amber" || b === "red"
  ).length;
  if (badDays >= SUPPRESSED_READINESS_DAYS) {
    target *= SUPPRESSED_REDUCTION;
    reasons.push(
      `readiness was amber or worse on ${badDays} of the last 7 days — reduced ${Math.round(
        (1 - SUPPRESSED_REDUCTION) * 100
      )}%`
    );
  }

  if (prevWeek) {
    const lo = prevWeek.actualLoad * (1 - RAMP_CLAMP_PCT);
    const hi = prevWeek.actualLoad * (1 + RAMP_CLAMP_PCT);
    if (target > hi) {
      target = hi;
      reasons.push(
        `ramp guard: week-over-week change clamped to ±${Math.round(
          RAMP_CLAMP_PCT * 100
        )}% of last week's actual load`
      );
    } else if (target < lo) {
      if (taperWeek) {
        reasons.push("taper: ramp guard downward clamp bypassed");
      } else {
        target = lo;
        reasons.push(
          `ramp guard: week-over-week change clamped to ±${Math.round(
            RAMP_CLAMP_PCT * 100
          )}% of last week's actual load`
        );
      }
    }
  }

  return { load: Math.round(target), reasons };
}

export interface MaterializeInput {
  weekStart: string;
  skeleton: {
    weekNumber: number;
    phase: "base" | "build" | "peak" | "taper" | "recovery";
    targetLoadTotal: number;
    targetSessions: number;
  };
  /** One entry per day (Mon..Sun); each is that day's list of blocks. */
  availableBlocksPerDay: AvailabilityBlock[][];
  prevWeek: { actualLoad: number; adherencePct: number } | null;
  recentBands: Band[];
  raceType: string;
  sports: string[];
  hoursPerWeek: number;
  /** Upcoming races, sorted priority A→C then date asc (service does the sort). */
  races?: RaceContext[];
  /** Latest stored CTL — taper base fallback when there is no previous week. */
  currentCtl?: number | null;
  /**
   * The hardest single day the athlete's event demands, from
   * `EventDemand.queenStageHours` — what a long ride should build toward.
   * Null when there is no target race or no FTP, which keeps the
   * pre-existing no-demand bound. Optional so existing callers and test
   * fixtures compile unchanged.
   */
  queenStageHours?: number | null;
}

export interface MaterializeResult {
  week: WeekState;
  adjustments: AdjustmentRecord[];
  effectiveLoad: number;
}

function addDays(ymd: string, n: number): string {
  const d = new Date(ymd + "T00:00:00");
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

export function materializeWeek(input: MaterializeInput): MaterializeResult {
  const adjustments: AdjustmentRecord[] = [];

  const races = input.races ?? [];
  const primary = races[0] ?? null;
  const taperFraction =
    primary && primary.priority === "A"
      ? taperFractionForWeek(input.weekStart, primary)
      : null;
  const taperBase =
    input.prevWeek && input.prevWeek.actualLoad > 0
      ? input.prevWeek.actualLoad
      : input.currentCtl != null
        ? input.currentCtl * 7
        : input.skeleton.targetLoadTotal;
  const skeleton =
    taperFraction != null
      ? {
          ...input.skeleton,
          phase: "taper" as const,
          targetLoadTotal: Math.round(taperBase * taperFraction),
        }
      : input.skeleton;

  if (taperFraction != null) {
    adjustments.push({
      date: input.weekStart,
      trigger: "race",
      action: "scaled",
      before: [],
      after: [],
      reason: `taper: ${primary!.name} on ${primary!.date} — week target set to ${Math.round(
        taperFraction * 100
      )}% of current load (${skeleton.targetLoadTotal})`,
    });
  }

  const { load, reasons } = effectiveWeekLoad({
    skeletonTarget: skeleton.targetLoadTotal,
    prevWeek: input.prevWeek,
    recentBands: input.recentBands,
    taperWeek: taperFraction != null,
  });

  const dates = Array.from({ length: 7 }, (_, i) =>
    addDays(input.weekStart, i)
  );

  const days: DaySlot[] = dates.map((date, i) => {
    const availableBlocks = input.availableBlocksPerDay[i] ?? [];
    return {
      date,
      availableBlocks,
      workouts: [],
      availableMins: dayMins({ availableBlocks }),
      status: "rest",
    };
  });

  const hoursBudget = days.reduce((s, d) => s + dayMins(d), 0) / 60;
  const usableDays = days.filter((d) => d.availableBlocks.length > 0).length;
  const sessions = Math.min(
    skeleton.targetSessions,
    usableDays * MAX_SESSIONS_PER_DAY
  );
  const neededHours =
    input.hoursPerWeek * (load / Math.max(1, skeleton.targetLoadTotal));
  let effectiveLoad = load;

  if (neededHours > 0 && hoursBudget < neededHours) {
    effectiveLoad = Math.round(load * (hoursBudget / neededHours));
    adjustments.push({
      date: input.weekStart,
      trigger: "weekly_rollover",
      action: "redistributed",
      before: [],
      after: [],
      reason: `${hoursBudget.toFixed(1)}h available instead of ${neededHours.toFixed(
        1
      )}h — week load lowered to ${effectiveLoad}`,
    });
  }
  if (reasons.length > 0) {
    adjustments.push({
      date: input.weekStart,
      trigger: "weekly_rollover",
      action: "scaled",
      before: [],
      after: [],
      reason: reasons.join("; "),
    });
  }

  const raceIdx = primary ? dates.indexOf(primary.date) : -1;
  const isRaceWeek = taperFraction === TAPER_FRACTION_RACE_WEEK && raceIdx >= 0;

  if (isRaceWeek) {
    const taken = new Set<string>();
    for (const w of raceWeekWorkouts(input.sports[0] ?? "Run", raceIdx)) {
      // Which block on this day actually admits the session — never a
      // hardcoded blockIdx 0, and never dayMins' summed-across-blocks
      // question of whether the day has room at all.
      const blockIdx = findBlockFor(days, w.day, w, taken);
      if (blockIdx != null) {
        taken.add(
          slotKey({
            dayIdx: w.day,
            blockIdx,
            mins: 0,
            energy: "full",
            sports: null,
          })
        );
        days[w.day] = {
          ...days[w.day],
          workouts: [...days[w.day].workouts, { ...w, blockIdx }],
          status: "planned",
        };
        continue;
      }

      // Nothing admits it whole on its designated pre-race day (energy
      // tier, size, sport, adjacency, or the per-day cap). Race-week
      // sessions are pinned to a specific day relative to the race, so —
      // unlike the main loop below — only that day's own blocks are
      // candidates; try the same fitting rule a replan uses before giving
      // up, and only drop, with a logged reason, when nothing does.
      const candidates = buildSlots(days).filter(
        (s) =>
          s.dayIdx === w.day &&
          !taken.has(slotKey(s)) &&
          days[s.dayIdx].workouts.length < MAX_SESSIONS_PER_DAY &&
          (s.sports === null || s.sports.includes(w.sport))
      );
      let placed = false;
      for (const candidate of candidates) {
        const fitted = fitToBlock(w, candidate.mins);
        if (!fitted) continue;
        if (!admits(candidate, fitted.workout, days, taken)) continue;

        taken.add(slotKey(candidate));
        const target = days[candidate.dayIdx];
        days[candidate.dayIdx] = {
          ...target,
          workouts: [
            ...target.workouts,
            { ...fitted.workout, blockIdx: candidate.blockIdx },
          ],
          status: "planned",
        };
        adjustments.push({
          date: target.date,
          trigger: "no_time",
          action: fitted.how === "compressed" ? "scaled" : "swapped",
          before: [],
          after: [],
          reason:
            fitted.how === "compressed"
              ? `no block fits ${w.durationMins}min — ${w.type} shortened to ${fitted.workout.durationMins}min`
              : `no block fits ${w.type} — replaced by ${fitted.workout.type}, which works in ${fitted.workout.durationMins}min`,
        });
        placed = true;
        break;
      }
      if (placed) continue;

      adjustments.push({
        date: days[w.day].date,
        trigger: "no_time",
        action: "dropped",
        before: [],
        after: [],
        reason: `no block on ${days[w.day].date} fits a ${w.durationMins}min ${w.type} — race-week session dropped`,
      });
    }
  } else if (sessions > 0) {
    const effectiveHours = Math.min(hoursBudget, neededHours);
    const workouts = generateWorkouts(
      sessions,
      effectiveHours,
      skeleton.phase,
      input.raceType,
      input.sports,
      input.queenStageHours ?? null
    )
      .sort((a, b) => b.durationMins - a.durationMins)
      .slice(0, sessions);

    // For cycling, the long ride and every Endurance filler are capped at
    // longRideBoundMins(queenStageHours) — event-derived when the athlete's
    // race gives us a queen stage, the old flat 240-minute ceiling when it
    // doesn't — and whatever that cap removes is redistributed onto
    // whichever of those sessions still has headroom rather than discarded
    // (generateCyclingWorkouts' distributeRemainder call). A shortfall below
    // can still legitimately occur when there is nowhere left to put the
    // remainder — every capped session already at its bound (few sessions,
    // a small queen stage) — and running/triathlon weeks have no such
    // redistribution at all, so their hard caps still discard outright.
    // Say so rather than let WeekRationale print an unexplained deficit.
    const generatedHours =
      workouts.reduce((s, w) => s + w.durationMins, 0) / 60;
    if (
      effectiveHours > 0 &&
      generatedHours < effectiveHours * (1 - GENERATOR_CAP_SHORTFALL_PCT)
    ) {
      adjustments.push({
        date: input.weekStart,
        trigger: "weekly_rollover",
        action: "scaled",
        before: [],
        after: [],
        reason: `session limits cap this week at ${generatedHours.toFixed(
          1
        )}h against a ${effectiveHours.toFixed(1)}h target`,
      });
    }

    const taken = new Set<string>();

    for (const w of workouts) {
      const slots = buildSlots(days); // rebuilt: earlier placements change admission
      let slot = slots.find((s) => admits(s, w, days, taken));
      let workout = w;

      if (!slot && isQuality(w)) {
        // No admitting slot for a quality session: step it down until it is
        // no longer quality, exactly as the previous engine did.
        let steppedType = w.type;
        while ((QUALITY_TYPES as readonly string[]).includes(steppedType)) {
          steppedType = STEP_DOWN[steppedType] ?? "Endurance";
        }
        const stepped = withPurpose({
          ...w,
          type: steppedType,
          intensity: "Z1-Z2",
        });
        const steppedSlot = buildSlots(days).find((s) =>
          admits(s, stepped, days, taken)
        );
        if (steppedSlot) {
          slot = steppedSlot;
          workout = stepped;
          adjustments.push({
            date: days[steppedSlot.dayIdx].date,
            trigger: "weekly_rollover",
            action: "scaled",
            before: [],
            after: [],
            reason: `no admitting slot for ${w.type} — stepped down to ${stepped.type}`,
          });
        }
      }

      if (!slot) {
        // Nothing admits it whole. Rather than drop it silently, try the
        // same fitting rule a replan uses — but a fitted (shortened or
        // substituted) session still needs to be *safe* to place, so every
        // candidate is checked with the real admission rule, roomiest
        // first, until one passes or none do.
        const candidates = buildSlots(days).filter(
          (s) =>
            !taken.has(slotKey(s)) &&
            days[s.dayIdx].workouts.length < MAX_SESSIONS_PER_DAY &&
            (s.sports === null || s.sports.includes(workout.sport))
        );
        let placed = false;
        for (const candidate of candidates) {
          const fitted = fitToBlock(workout, candidate.mins);
          if (!fitted) continue;
          if (!admits(candidate, fitted.workout, days, taken)) continue;

          taken.add(slotKey(candidate));
          const target = days[candidate.dayIdx];
          days[candidate.dayIdx] = {
            ...target,
            workouts: [
              ...target.workouts,
              { ...fitted.workout, blockIdx: candidate.blockIdx },
            ],
            status: "planned",
          };
          adjustments.push({
            date: target.date,
            trigger: "no_time",
            action: fitted.how === "compressed" ? "scaled" : "swapped",
            before: [],
            after: [],
            reason:
              fitted.how === "compressed"
                ? `no block fits ${workout.durationMins}min — ${workout.type} shortened to ${fitted.workout.durationMins}min`
                : `no block fits ${workout.type} — replaced by ${fitted.workout.type}, which works in ${fitted.workout.durationMins}min`,
          });
          placed = true;
          break;
        }
        if (placed) continue;
        adjustments.push({
          date: input.weekStart,
          trigger: "no_time",
          action: "dropped",
          before: [],
          after: [],
          reason: `no block in the week fits a ${workout.durationMins}min ${workout.type} — session dropped`,
        });
        continue;
      }
      taken.add(slotKey(slot));
      const target = days[slot.dayIdx];
      days[slot.dayIdx] = {
        ...target,
        workouts: [...target.workouts, { ...workout, blockIdx: slot.blockIdx }],
        status: "planned",
      };
    }
  }

  for (const race of races) {
    const idx = dates.indexOf(race.date);
    if (idx === -1) continue;
    if (days[idx].workouts.length > 0) {
      adjustments.push({
        date: race.date,
        trigger: "race",
        action: "swapped",
        before: [
          { ...days[idx], workouts: days[idx].workouts.map((w) => ({ ...w })) },
        ],
        after: [],
        reason: `race day: ${race.name} replaces the planned workout`,
      });
    }
    days[idx] = {
      ...days[idx],
      workouts: [],
      status: "race",
      raceName: race.name,
    };
  }

  // A/B protection: rest the day before, no quality 2 days out. C races
  // train through. The primary race decides (first in sorted input).
  if (primary && primary.priority !== "C") {
    const idx = dates.indexOf(primary.date);
    if (idx >= 1 && days[idx - 1].workouts.length > 0) {
      const before = {
        ...days[idx - 1],
        workouts: days[idx - 1].workouts.map((w) => ({ ...w })),
      };
      days[idx - 1] = { ...days[idx - 1], workouts: [], status: "rest" };
      adjustments.push({
        date: before.date,
        trigger: "race",
        action: "dropped",
        before: [before],
        after: [{ ...days[idx - 1] }],
        reason: `rest before ${primary.name}`,
      });
    }
    if (
      !isRaceWeek &&
      idx >= 2 &&
      days[idx - 2].workouts.some((w) => isQuality(w))
    ) {
      const before = {
        ...days[idx - 2],
        workouts: days[idx - 2].workouts.map((w) => ({ ...w })),
      };
      // Step down every quality session on the day, keeping any
      // non-quality sibling exactly as it was — never rebuilding the day
      // as a one-element array, which silently dropped a second session.
      days[idx - 2] = {
        ...days[idx - 2],
        workouts: days[idx - 2].workouts.map((w) =>
          isQuality(w)
            ? withPurpose({ ...w, type: "Endurance", intensity: "Z1-Z2" })
            : w
        ),
        status: "planned",
      };
      adjustments.push({
        date: before.date,
        trigger: "race",
        action: "scaled",
        before: [before],
        after: [{ ...days[idx - 2] }],
        reason: `no quality 2 days before ${primary.name} — stepped down to Endurance`,
      });
    }
  }

  return {
    week: {
      weekStart: input.weekStart,
      skeletonWeek: skeleton.weekNumber,
      days,
    },
    adjustments,
    effectiveLoad,
  };
}

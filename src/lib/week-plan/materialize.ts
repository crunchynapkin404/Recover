import { generateWorkouts, withPurpose } from "@/lib/training-plan";
import {
  raceWeekWorkouts,
  taperFractionForWeek,
  TAPER_FRACTION_RACE_WEEK,
  type RaceContext,
} from "@/lib/race/taper";
import {
  type Band,
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
import { buildSlots, admits, slotKey, fitToBlock } from "./slots";
import type { AvailabilityBlock } from "@/lib/availability/types";
import { ENERGY_CEILING, MAX_SESSIONS_PER_DAY } from "@/lib/availability/types";

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
    for (const w of raceWeekWorkouts(input.sports[0] ?? "Run", raceIdx)) {
      if (dayMins(days[w.day]) > 0) {
        days[w.day] = {
          ...days[w.day],
          workouts: [...days[w.day].workouts, { ...w }],
          status: "planned",
        };
      }
    }
  } else if (sessions > 0) {
    const effectiveHours = Math.min(hoursBudget, neededHours);
    const workouts = generateWorkouts(
      sessions,
      effectiveHours,
      skeleton.phase,
      input.raceType,
      input.sports
    )
      .sort((a, b) => b.durationMins - a.durationMins)
      .slice(0, sessions);

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
        // same fitting rule a replan uses: the roomiest slot whose energy
        // and sport allow this session, shortened or substituted to fit.
        const relaxed = buildSlots(days).find(
          (s) =>
            !taken.has(slotKey(s)) &&
            days[s.dayIdx].workouts.length < MAX_SESSIONS_PER_DAY &&
            (s.sports === null || s.sports.includes(workout.sport))
        );
        const fitted = relaxed ? fitToBlock(workout, relaxed.mins) : null;
        if (
          relaxed &&
          fitted &&
          ENERGY_CEILING[relaxed.energy].includes(fitted.workout.purpose)
        ) {
          taken.add(slotKey(relaxed));
          const target = days[relaxed.dayIdx];
          days[relaxed.dayIdx] = {
            ...target,
            workouts: [...target.workouts, fitted.workout],
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
          continue;
        }
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
        workouts: [...target.workouts, workout],
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
      isQuality(days[idx - 2].workouts[0] ?? null)
    ) {
      const before = {
        ...days[idx - 2],
        workouts: days[idx - 2].workouts.map((w) => ({ ...w })),
      };
      days[idx - 2] = {
        ...days[idx - 2],
        workouts: [
          withPurpose({
            ...days[idx - 2].workouts[0]!,
            type: "Endurance",
            intensity: "Z1-Z2",
          }),
        ],
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

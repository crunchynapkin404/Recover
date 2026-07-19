import { generateWorkouts, type PlannedWorkout } from "@/lib/training-plan";
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
  isQuality,
  QUALITY_TYPES,
  STEP_DOWN,
} from "./types";

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
  availabilityMins: number[];
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
  const availableIdx = input.availabilityMins
    .map((m, i) => ({ m, i }))
    .filter((x) => x.m > 0);

  const sessions = Math.min(skeleton.targetSessions, availableIdx.length);
  const hoursBudget = input.availabilityMins.reduce((s, m) => s + m, 0) / 60;
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

  const days: DaySlot[] = dates.map((date, i) => ({
    date,
    availableMins: input.availabilityMins[i] ?? 0,
    workout: null,
    status: "rest",
  }));

  const raceIdx = primary ? dates.indexOf(primary.date) : -1;
  const isRaceWeek = taperFraction === TAPER_FRACTION_RACE_WEEK && raceIdx >= 0;

  if (isRaceWeek) {
    for (const w of raceWeekWorkouts(input.sports[0] ?? "Run", raceIdx)) {
      if ((input.availabilityMins[w.day] ?? 0) > 0) {
        days[w.day] = { ...days[w.day], workout: { ...w }, status: "planned" };
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

    // Roomiest days first; stable by index for determinism.
    const slots = [...availableIdx].sort((a, b) => b.m - a.m || a.i - b.i);
    const taken = new Set<number>();

    const place = (w: PlannedWorkout, avoidAdjacentQuality: boolean) => {
      for (const s of slots) {
        if (taken.has(s.i)) continue;
        if (
          avoidAdjacentQuality &&
          (isQuality(days[s.i - 1]?.workout ?? null) ||
            isQuality(days[s.i + 1]?.workout ?? null))
        )
          continue;
        taken.add(s.i);
        return s.i;
      }
      return null;
    };

    for (const w of workouts) {
      const quality = isQuality(w);
      let idx = place(w, quality);
      let workout = { ...w };
      if (idx === null && quality) {
        // Unavoidable adjacency: step the session down repeatedly until it
        // is no longer a quality type (Intervals→Tempo→Endurance), since
        // Tempo alone is still in QUALITY_TYPES and would re-break the
        // adjacency invariant.
        let steppedType = w.type;
        while ((QUALITY_TYPES as readonly string[]).includes(steppedType)) {
          steppedType = STEP_DOWN[steppedType] ?? "Endurance";
        }
        idx = place(w, false);
        if (idx !== null) {
          workout = {
            ...w,
            type: steppedType,
            intensity: "Z1-Z2",
          };
          adjustments.push({
            date: days[idx].date,
            trigger: "weekly_rollover",
            action: "scaled",
            before: [],
            after: [],
            reason: `no non-adjacent day left for ${w.type} — stepped down to ${workout.type}`,
          });
        }
      }
      if (idx === null) continue; // fewer slots than workouts: drop silently sized by `sessions`
      const cap = days[idx].availableMins;
      if (workout.durationMins > cap) {
        const before = { ...days[idx], workout: { ...workout } };
        workout.durationMins = cap;
        adjustments.push({
          date: days[idx].date,
          trigger: "no_time",
          action: "scaled",
          before: [before],
          after: [{ ...days[idx], workout: { ...workout }, status: "planned" }],
          reason: `shortened to fit available time (${cap}min) on ${days[idx].date}`,
        });
      }
      days[idx] = { ...days[idx], workout, status: "planned" };
    }
  }

  for (const race of races) {
    const idx = dates.indexOf(race.date);
    if (idx === -1) continue;
    if (days[idx].workout) {
      adjustments.push({
        date: race.date,
        trigger: "race",
        action: "swapped",
        before: [{ ...days[idx], workout: { ...days[idx].workout! } }],
        after: [],
        reason: `race day: ${race.name} replaces the planned workout`,
      });
    }
    days[idx] = {
      ...days[idx],
      workout: null,
      status: "race",
      raceName: race.name,
    };
  }

  // A/B protection: rest the day before, no quality 2 days out. C races
  // train through. The primary race decides (first in sorted input).
  if (primary && primary.priority !== "C") {
    const idx = dates.indexOf(primary.date);
    if (idx >= 1 && days[idx - 1].workout) {
      const before = {
        ...days[idx - 1],
        workout: { ...days[idx - 1].workout! },
      };
      days[idx - 1] = { ...days[idx - 1], workout: null, status: "rest" };
      adjustments.push({
        date: before.date,
        trigger: "race",
        action: "dropped",
        before: [before],
        after: [{ ...days[idx - 1] }],
        reason: `rest before ${primary.name}`,
      });
    }
    if (!isRaceWeek && idx >= 2 && isQuality(days[idx - 2].workout)) {
      const before = {
        ...days[idx - 2],
        workout: { ...days[idx - 2].workout! },
      };
      days[idx - 2] = {
        ...days[idx - 2],
        workout: {
          ...days[idx - 2].workout!,
          type: "Endurance",
          intensity: "Z1-Z2",
        },
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

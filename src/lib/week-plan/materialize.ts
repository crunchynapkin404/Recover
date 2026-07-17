import { generateWorkouts, type PlannedWorkout } from "@/lib/training-plan";
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
  STEP_DOWN,
} from "./types";

export interface EffectiveLoadInput {
  skeletonTarget: number;
  prevWeek: { actualLoad: number; adherencePct: number } | null;
  recentBands: Band[];
}

export function effectiveWeekLoad(input: EffectiveLoadInput): {
  load: number;
  reasons: string[];
} {
  const { skeletonTarget, prevWeek, recentBands } = input;
  const reasons: string[] = [];

  if (prevWeek && prevWeek.actualLoad === 0) {
    const load = Math.round(skeletonTarget * MISSED_WEEK_RESTART);
    reasons.push(
      `last week was fully missed — restarting at ${Math.round(
        MISSED_WEEK_RESTART * 100
      )}% of the skeleton target (${load})`
    );
    return { load, reasons };
  }

  let target = skeletonTarget;

  if (prevWeek && prevWeek.adherencePct < LOW_ADHERENCE_PCT) {
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
    if (target > hi || target < lo) {
      target = Math.min(hi, Math.max(lo, target));
      reasons.push(
        `ramp guard: week-over-week change clamped to ±${Math.round(
          RAMP_CLAMP_PCT * 100
        )}% of last week's actual load`
      );
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
  const { load, reasons } = effectiveWeekLoad({
    skeletonTarget: input.skeleton.targetLoadTotal,
    prevWeek: input.prevWeek,
    recentBands: input.recentBands,
  });

  const dates = Array.from({ length: 7 }, (_, i) =>
    addDays(input.weekStart, i)
  );
  const availableIdx = input.availabilityMins
    .map((m, i) => ({ m, i }))
    .filter((x) => x.m > 0);

  const sessions = Math.min(input.skeleton.targetSessions, availableIdx.length);
  const hoursBudget = input.availabilityMins.reduce((s, m) => s + m, 0) / 60;
  const neededHours =
    input.hoursPerWeek * (load / Math.max(1, input.skeleton.targetLoadTotal));
  let effectiveLoad = load;

  if (hoursBudget < neededHours && sessions > 0) {
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

  if (sessions > 0) {
    const effectiveHours = Math.min(hoursBudget, neededHours);
    const workouts = generateWorkouts(
      sessions,
      effectiveHours,
      input.skeleton.phase,
      input.raceType,
      input.sports
    )
      .slice(0, sessions)
      .sort((a, b) => b.durationMins - a.durationMins);

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
        // Unavoidable adjacency: step the session down instead.
        idx = place(w, false);
        if (idx !== null) {
          workout = {
            ...w,
            type: STEP_DOWN[w.type] ?? "Endurance",
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

  return {
    week: {
      weekStart: input.weekStart,
      skeletonWeek: input.skeleton.weekNumber,
      days,
    },
    adjustments,
    effectiveLoad,
  };
}

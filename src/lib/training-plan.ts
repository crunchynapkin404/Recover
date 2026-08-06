/**
 * Training plan generation service (v0.5d) — deterministic periodized
 * training plan generator. No LLM dependency; uses template-based
 * periodization with sport-specific workout prescriptions.
 */
import { asc, desc, eq, and } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { createRace } from "@/lib/race/service";
import type { Purpose } from "@/lib/availability/types";
import { PURPOSE_FLOORS } from "@/lib/availability/types";
import {
  requirePlanSport,
  inferPlanSport,
  toPlanSport,
  type PlanSport,
} from "@/lib/plan-sport";
import {
  buildPhases,
  collectWarnings,
  type PlanPhase,
  type PlanPreview,
  type PreviewResult,
  type PreviewWeek,
} from "@/lib/plan-preview";
import { assembleWeeklyTarget } from "@/lib/week-plan/volume-inputs";
import { assessFeasibility } from "@/lib/race/feasibility";
import { PLAN_CONSTANTS as PC } from "@/lib/plan-constants";

/**
 * The transaction handle `db.transaction()`'s callback receives. `Database`
 * (the type of `db` itself) is a union of the two *database* wrapper types,
 * not their transaction counterparts, so a real transaction object does not
 * satisfy `typeof db` — `seedAvailabilityDefaults`'s `tx` parameter has to
 * accept both, matching the `Tx` convention already used in
 * `@/lib/race/debrief.ts`.
 */
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// ── Types ───────────────────────────────────────────────────────────────────

export interface PlannedWorkout {
  day: number; // 0=Mon..6=Sun
  sport: string;
  type: string; // "Endurance", "Tempo", "Intervals", "Recovery", "Long", "Brick"
  durationMins: number;
  intensity: string; // "Z1-Z2", "Z3", "Z4-Z5", "Recovery"
  description: string;
  /** What the engine reasons about. Derived from `type`, one-to-one. */
  purpose: Purpose;
  /** Below this the session no longer delivers its stimulus. */
  minEffectiveMins: number;
}

export const PURPOSE_BY_TYPE: Record<string, Purpose> = {
  Recovery: "recovery",
  Endurance: "aerobic_base",
  Long: "long",
  Tempo: "threshold",
  Intervals: "vo2max",
  Brick: "brick",
};

/**
 * Stamps purpose + floor onto a workout literal. Unknown types are aerobic.
 * Generic over the input so extra fields survive the transform untouched —
 * in particular `ScheduledWorkout`'s `blockIdx`, when this re-derives
 * purpose for a session that has already been placed. A plain template
 * (no extra fields) still returns a plain `PlannedWorkout`, unchanged.
 */
export function withPurpose<
  T extends Omit<PlannedWorkout, "purpose" | "minEffectiveMins">,
>(w: T): T & Pick<PlannedWorkout, "purpose" | "minEffectiveMins"> {
  const purpose = PURPOSE_BY_TYPE[w.type] ?? "aerobic_base";
  return { ...w, purpose, minEffectiveMins: PURPOSE_FLOORS[purpose] };
}

/**
 * Floor. A criterium's queen stage is under an hour; without this the long
 * ride would collapse below a useful endurance stimulus.
 */
export const MIN_LONG_BOUND_MINS = 120;

/** Ceiling: "shorter than six hours", regardless of how long the event is. */
export const ABSOLUTE_LONG_BOUND_MINS = 360;

/** Today's floor for easy rides, retained — it makes no new claim. */
export const MIN_EFFECTIVE_EASY_MINS = 30;

/**
 * Today's cap for an easy run, named rather than inline so the fill rung can
 * bound a run by exactly what the generator already does. Its VALUE makes no
 * new claim and is deliberately unchanged — running's real single-session
 * rule is athlete-relative and is separately scoped work.
 */
export const EASY_RUN_CAP_MINS = 60;

/**
 * Today's cap, retained DELIBERATELY for the no-demand path. Where the
 * athlete's event gives us evidence we use it; where there is none we keep
 * today's behaviour rather than inventing a bound. `weeklyTargetHours`
 * makes the same choice for its own null ceiling, on the grounds that
 * `min(demand, ceiling ?? Infinity)` "would hand a brand-new athlete
 * ~11h/week on no evidence at all".
 */
export const NO_DEMAND_LONG_BOUND_MINS = 240;

/**
 * How long a single ride may be, in minutes.
 *
 * The old code capped the long ride at a flat 240 and every endurance ride
 * at 90 — numbers that arrived with this file on 2026-07-15 carrying no
 * rationale, no citation and no test. They are the reason a 12.5h target
 * produced a 9.3h week.
 *
 * Cycling has no single-session spike rule. Running does — exceeding your
 * own recent longest run by 10-30% raises injury risk 64% in a study of
 * 5,200+ runners — but that is impact loading, and a bike is not a
 * treadmill. In cycling, overuse injury follows CUMULATIVE load outrunning
 * tissue repair, which is bounded upstream by two separate guards:
 * `weeklyTargetHours`'s own ACWR ceiling, and the week-over-week ramp clamp
 * (`RAMP_CLAMP_PCT`, applied in `materializeWeek`, not inside
 * `weeklyTargetHours`). The weekly number handed to this generator is
 * therefore already the safe one.
 *
 * What remains is: how long should ONE ride be? The evidence is
 * event-relative — "for events lasting 4-5 hours, a 4-hour long ride each
 * week is sufficient", endurance rides "longer than two hours and shorter
 * than six" for a moderately experienced rider. So bound the long ride by
 * the hardest single day the athlete's event actually demands.
 *
 * `queenStageHours` comes from `EventDemand` — "the hardest single day;
 * equals `dailyRateHours` when stages are unknown". When
 * `demand.queenStageKnown` is false it is an average across event days, so
 * for a mountain tour the real queen stage is harder and this bound is
 * conservative.
 */
export function longRideBoundMins(queenStageHours: number | null): number {
  if (
    queenStageHours == null ||
    !Number.isFinite(queenStageHours) ||
    queenStageHours <= 0
  ) {
    return NO_DEMAND_LONG_BOUND_MINS;
  }
  return Math.min(
    ABSOLUTE_LONG_BOUND_MINS,
    Math.max(MIN_LONG_BOUND_MINS, Math.round(queenStageHours * 60))
  );
}

/**
 * Push `remainder` minutes onto sessions that still have headroom.
 *
 * The caps were only half the defect. The other half was that whatever a
 * cap removed was simply DISCARDED — the week silently came in under its
 * own target. Here a session that reaches its bound drops out and the rest
 * absorb what is left, so minutes move rather than evaporate.
 *
 * Even split, repeated: each pass gives every session with room an equal
 * share (at least 1, so the loop always makes progress), capped at that
 * session's own bound. Terminates when the remainder is gone or nothing
 * has headroom — the latter is a real "these days cannot absorb this".
 *
 * `current` and `bounds` are parallel arrays; the return value is a new
 * array, same length, same order.
 */
export function distributeRemainder(
  current: number[],
  bounds: number[],
  remainder: number
): number[] {
  const out = [...current];
  let left = Math.max(0, Math.round(remainder));

  while (left > 0) {
    const open: number[] = [];
    for (let i = 0; i < out.length; i++) {
      if (out[i] < bounds[i]) open.push(i);
    }
    if (open.length === 0) break;

    const share = Math.max(1, Math.floor(left / open.length));
    for (const i of open) {
      if (left === 0) break;
      const add = Math.min(share, bounds[i] - out[i], left);
      out[i] += add;
      left -= add;
    }
  }

  return out;
}

interface Block {
  weekNumber: number;
  phase: "base" | "build" | "peak" | "taper" | "recovery";
  targetLoad: number;
  targetSessions: number;
  workouts: PlannedWorkout[];
}

export interface GeneratePlanParams {
  userId: string;
  raceType: string;
  raceDate: string; // YYYY-MM-DD
  title?: string;
  daysPerWeek?: number; // default 5
  hoursPerWeek?: number; // default 8
  raceId?: string;
}

export interface GeneratePlanResult {
  planId: string;
  summary: string;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24));
}

function localYmd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// ── Periodization engine ────────────────────────────────────────────────────

/**
 * Exported so the weekly rollover can recompute the skeleton fresh rather
 * than reading `training_blocks` as authority.
 *
 * What "fresh" actually buys: `targetLoad`, `phase` and `targetSessions` —
 * the three fields `rolloverWeekPlan` keeps from a block — are driven by
 * `startingCtl`, `weeksTotal` and fixed phase multipliers (`targetSessions`
 * also reads `constraints.daysPerWeek`), never by `hoursPerWeek`. A 20×
 * spread in `hoursPerWeek` leaves them byte-identical; only `workouts`
 * responds to it, and `rolloverWeekPlan` discards `derived.workouts`. So the
 * recompute's value is keeping the skeleton in step with the plan's
 * *current* `constraints.daysPerWeek`, `startingCtl` and `weeksTotal` —
 * whichever they are today — rather than whatever `training_blocks` held at
 * plan creation. It is not how the derived hours figure reaches the
 * athlete's week.
 *
 * The derived hours figure reaches the athlete's week through
 * `materializeWeek`'s `hoursPerWeek` parameter, a separate argument
 * `rolloverWeekPlan` passes alongside these blocks — not through
 * `targetLoad`/`targetSessions` here. Do not "simplify" that parameter away
 * on the assumption these blocks already carry it; they don't.
 */
export function periodize(
  weeksTotal: number,
  startingCtl: number,
  daysPerWeek: number,
  hoursPerWeek: number,
  sport: PlanSport,
  queenStageHours: number | null = null
): Block[] {
  // Phase distribution
  const baseWeeks = Math.max(
    PC.MIN_BASE_WEEKS,
    Math.round(weeksTotal * PC.PHASE_SHARE_BASE)
  );
  const buildWeeks = Math.max(
    PC.MIN_BUILD_WEEKS,
    Math.round(weeksTotal * PC.PHASE_SHARE_BUILD)
  );
  const taperWeeks = Math.max(
    PC.MIN_TAPER_WEEKS,
    Math.round(weeksTotal * PC.PHASE_SHARE_TAPER)
  );
  const peakWeeks = Math.max(
    PC.MIN_PEAK_WEEKS,
    weeksTotal - baseWeeks - buildWeeks - taperWeeks
  );

  // Starting weekly load from CTL (rough TSS = CTL * 7)
  const baseLoad = Math.max(
    PC.MIN_WEEKLY_LOAD,
    startingCtl * PC.CTL_TO_WEEKLY_LOAD
  );

  const blocks: Block[] = [];
  let currentLoad = baseLoad;
  // Weeks since the last recovery week, carried ACROSS phase boundaries.
  // Resetting it per phase made cadence a property of where the boundaries
  // fell: a 3-week base produced no recovery week (3 % 4 !== 0) and build
  // started counting again, giving six consecutive loading weeks. The
  // threshold below fires on `recoveryInterval - 1` loading weeks (not
  // `recoveryInterval`) so the cadence itself stays what it was before this
  // counter existed: `RECOVERY_INTERVAL_BASE = 4` means 3 loading weeks then
  // recovery (3:1), `RECOVERY_INTERVAL_DEFAULT = 3` means 2 loading weeks
  // then recovery (2:1). Only the reset-at-boundary bug is fixed here —
  // firing on the full interval would additionally insert an extra loading
  // week into every mesocycle, which was never part of this fix.
  let weeksSinceRecovery = 0;

  for (let w = 1; w <= weeksTotal; w++) {
    let phase: Block["phase"];
    if (w <= baseWeeks) phase = "base";
    else if (w <= baseWeeks + buildWeeks) phase = "build";
    else if (w <= baseWeeks + buildWeeks + peakWeeks) phase = "peak";
    else phase = "taper";

    // Still needed by loadMultiplier, which shapes hours WITHIN a phase.
    const weekInPhase =
      phase === "base"
        ? w
        : phase === "build"
          ? w - baseWeeks
          : phase === "peak"
            ? w - baseWeeks - buildWeeks
            : w - baseWeeks - buildWeeks - peakWeeks;

    const recoveryInterval =
      phase === "base"
        ? PC.RECOVERY_INTERVAL_BASE
        : PC.RECOVERY_INTERVAL_DEFAULT;
    const isRecovery =
      w > 1 && weeksSinceRecovery >= recoveryInterval - 1 && phase !== "taper";

    if (isRecovery) {
      blocks.push({
        weekNumber: w,
        phase: "recovery",
        targetLoad: Math.round(currentLoad * PC.RECOVERY_FRACTION),
        targetSessions: Math.max(3, daysPerWeek - 1),
        workouts: generateWorkouts(
          daysPerWeek - 1,
          hoursPerWeek * PC.RECOVERY_FRACTION,
          "recovery",
          sport,
          queenStageHours
        ),
      });
      weeksSinceRecovery = 0;
      // Don't increase load after recovery
    } else {
      weeksSinceRecovery += 1;
      blocks.push({
        weekNumber: w,
        phase,
        targetLoad: Math.round(currentLoad),
        targetSessions: daysPerWeek,
        workouts: generateWorkouts(
          daysPerWeek,
          hoursPerWeek * loadMultiplier(phase, weekInPhase),
          phase,
          sport,
          queenStageHours
        ),
      });

      // Load progression: +5-8% in base, +5-7% in build, flat/slight in peak, decrease in taper
      if (phase === "base") {
        currentLoad = Math.min(
          currentLoad * PC.PROGRESSION_BASE,
          currentLoad + baseLoad * PC.PROGRESSION_STEP_CAP
        );
      } else if (phase === "build") {
        currentLoad = Math.min(
          currentLoad * PC.PROGRESSION_BUILD,
          currentLoad + baseLoad * PC.PROGRESSION_STEP_CAP
        );
      } else if (phase === "peak") {
        // Maintain or slight increase
        currentLoad *= PC.PROGRESSION_PEAK;
      } else {
        // Taper: two contradicting rates, removed in Task 4.
        currentLoad *= 0.75;
      }
    }
  }

  return blocks;
}

function loadMultiplier(phase: Block["phase"], weekInPhase: number): number {
  switch (phase) {
    case "base":
      return PC.HOURS_BASE_INTERCEPT + weekInPhase * PC.HOURS_BASE_SLOPE;
    case "build":
      return PC.HOURS_BUILD_INTERCEPT + weekInPhase * PC.HOURS_BUILD_SLOPE;
    case "peak":
      return PC.HOURS_PEAK;
    case "taper":
      // Second contradicting rate, removed in Task 4.
      return 0.7 - (weekInPhase - 1) * 0.1;
    case "recovery":
      return PC.RECOVERY_FRACTION;
  }
}

// ── Workout generation ──────────────────────────────────────────────────────

/**
 * The week's sessions for a plan of `sport`.
 *
 * Dispatch is on sport ALONE. It used to route triathlon off `raceType` and
 * cycling off a sports list — two authorities for one decision, so a race
 * whose sport said Triathlon but whose race type was not in the substring
 * list produced running. The trailing catch-all that made that possible is
 * gone: an unbuildable sport throws.
 */
export function generateWorkouts(
  sessions: number,
  weekHours: number,
  phase: Block["phase"],
  sport: PlanSport,
  queenStageHours: number | null = null
): PlannedWorkout[] {
  switch (requirePlanSport(sport)) {
    case "Triathlon":
      return generateTriathlonWorkouts(sessions, weekHours, phase);
    case "Bike":
      return generateCyclingWorkouts(
        sessions,
        weekHours,
        phase,
        queenStageHours
      );
    case "Run":
      return generateRunningWorkouts(sessions, weekHours, phase);
  }
}

function generateRunningWorkouts(
  sessions: number,
  weekHours: number,
  phase: Block["phase"]
): PlannedWorkout[] {
  const totalMins = weekHours * 60;
  const workouts: PlannedWorkout[] = [];

  // Sunday: long run (30-35% of volume)
  const longRunMins = Math.round(totalMins * 0.32);
  workouts.push(
    withPurpose({
      day: 6, // Sunday
      sport: "Run",
      type: "Long",
      durationMins: Math.min(longRunMins, phase === "taper" ? 60 : 180),
      intensity: "Z1-Z2",
      description:
        phase === "taper"
          ? "Easy long run — reduced duration for taper"
          : "Long run at conversational pace",
    })
  );

  // Tuesday: tempo or intervals depending on phase
  if (phase === "build" || phase === "peak") {
    workouts.push(
      withPurpose({
        day: 1,
        sport: "Run",
        type: "Intervals",
        durationMins: Math.round(totalMins * 0.15),
        intensity: "Z4-Z5",
        description: "6×800m at 5K-10K pace, 90s jog recovery",
      })
    );
  } else if (phase !== "recovery") {
    workouts.push(
      withPurpose({
        day: 1,
        sport: "Run",
        type: "Tempo",
        durationMins: Math.round(totalMins * 0.15),
        intensity: "Z3",
        description: "Tempo run at half-marathon effort",
      })
    );
  }

  // Thursday: tempo in build/peak, endurance otherwise
  if (sessions >= 4 && phase !== "recovery") {
    workouts.push(
      withPurpose({
        day: 3,
        sport: "Run",
        type: phase === "build" || phase === "peak" ? "Tempo" : "Endurance",
        durationMins: Math.round(totalMins * 0.15),
        intensity: phase === "build" || phase === "peak" ? "Z3" : "Z1-Z2",
        description:
          phase === "build" || phase === "peak"
            ? "Tempo run — sustained effort"
            : "Easy endurance run",
      })
    );
  }

  // Fill remaining sessions with easy runs
  const usedDays = new Set(workouts.map((w) => w.day));
  const easyDays = [0, 2, 4, 5].filter((d) => !usedDays.has(d)); // Mon, Wed, Fri, Sat
  const remaining = sessions - workouts.length;
  const allocatedMins = workouts.reduce((s, w) => s + w.durationMins, 0);
  const easyMins = Math.round(
    (totalMins - allocatedMins) / Math.max(1, remaining)
  );

  for (let i = 0; i < remaining && i < easyDays.length; i++) {
    workouts.push(
      withPurpose({
        day: easyDays[i],
        sport: "Run",
        type: phase === "recovery" ? "Recovery" : "Endurance",
        durationMins: Math.max(20, Math.min(easyMins, EASY_RUN_CAP_MINS)),
        intensity: phase === "recovery" ? "Recovery" : "Z1-Z2",
        description:
          phase === "recovery" ? "Easy recovery run" : "Easy aerobic run",
      })
    );
  }

  return workouts.sort((a, b) => a.day - b.day);
}

export function generateCyclingWorkouts(
  sessions: number,
  weekHours: number,
  phase: Block["phase"],
  queenStageHours: number | null = null
): PlannedWorkout[] {
  const totalMins = Math.round(weekHours * 60);

  // A taper deliberately shortens the long ride — that is periodization,
  // not the leak this function is being fixed for, so the taper figure is
  // untouched. Every other phase is bounded by the event's hardest day.
  const longBound = phase === "taper" ? 90 : longRideBoundMins(queenStageHours);

  const workouts: PlannedWorkout[] = [];

  // Saturday: long ride (35-40% of volume)
  workouts.push(
    withPurpose({
      day: 5,
      sport: "Bike",
      type: "Long",
      durationMins: Math.min(Math.round(totalMins * 0.38), longBound),
      intensity: "Z1-Z2",
      description:
        phase === "taper"
          ? "Reduced endurance ride"
          : "Long endurance ride — steady aerobic effort",
    })
  );

  // Midweek intensity in build/peak. Its duration is prescribed by what the
  // session IS, so it is sized here and never touched again below.
  if (phase === "build" || phase === "peak") {
    workouts.push(
      withPurpose({
        day: 2,
        sport: "Bike",
        type: "Intervals",
        durationMins: Math.round(totalMins * 0.18),
        intensity: "Z4-Z5",
        description: "VO2max intervals: 5×4min at threshold+, 3min recovery",
      })
    );
  } else if (phase !== "recovery") {
    workouts.push(
      withPurpose({
        day: 2,
        sport: "Bike",
        type: "Tempo",
        durationMins: Math.round(totalMins * 0.18),
        intensity: "Z3",
        description: "Tempo ride — steady sweetspot effort",
      })
    );
  }

  // Fill remaining with endurance rides
  const usedDays = new Set(workouts.map((w) => w.day));
  const availDays = [0, 1, 3, 4, 6].filter((d) => !usedDays.has(d));
  const remaining = sessions - workouts.length;
  const allocatedMins = workouts.reduce((s, w) => s + w.durationMins, 0);
  const easyMins = Math.round(
    (totalMins - allocatedMins) / Math.max(1, remaining)
  );

  for (let i = 0; i < remaining && i < availDays.length; i++) {
    workouts.push(
      withPurpose({
        day: availDays[i],
        sport: "Bike",
        type: phase === "recovery" ? "Recovery" : "Endurance",
        durationMins: Math.max(
          MIN_EFFECTIVE_EASY_MINS,
          Math.min(easyMins, longBound)
        ),
        intensity: phase === "recovery" ? "Recovery" : "Z1-Z2",
        description:
          phase === "recovery"
            ? "Easy recovery spin"
            : "Aerobic endurance ride",
      })
    );
  }

  // Whatever the bounds above removed is redistributed rather than
  // discarded — discarding it is precisely how a 12.5h target became a
  // 9.3h week. Intensity sessions are excluded: stretching a VO2max block
  // to absorb volume changes what the session is.
  const participants = workouts
    .map((w, i) => i)
    .filter(
      (i) => workouts[i].type !== "Intervals" && workouts[i].type !== "Tempo"
    );

  const scheduled = workouts.reduce((s, w) => s + w.durationMins, 0);
  const remainder = totalMins - scheduled;

  if (remainder > 0 && participants.length > 0) {
    const grown = distributeRemainder(
      participants.map((i) => workouts[i].durationMins),
      participants.map(() => longBound),
      remainder
    );
    participants.forEach((wi, k) => {
      workouts[wi] = { ...workouts[wi], durationMins: grown[k] };
    });
  }

  return workouts.sort((a, b) => a.day - b.day);
}

function generateTriathlonWorkouts(
  sessions: number,
  weekHours: number,
  phase: Block["phase"]
): PlannedWorkout[] {
  const totalMins = weekHours * 60;
  const workouts: PlannedWorkout[] = [];

  // Split: Swim ~20%, Bike ~40%, Run ~40%
  const swimMins = totalMins * 0.2;
  const bikeMins = totalMins * 0.4;
  const runMins = totalMins * 0.4;

  // Sunday: long bike or brick
  const isBrickWeek = phase === "build" || phase === "peak";
  if (isBrickWeek) {
    workouts.push(
      withPurpose({
        day: 6,
        sport: "Bike",
        type: "Brick",
        durationMins: Math.round(bikeMins * 0.5),
        intensity: "Z1-Z2",
        description:
          "Bike-to-run brick: ride at race effort then 15-20min transition run",
      })
    );
  } else {
    workouts.push(
      withPurpose({
        day: 6,
        sport: "Bike",
        type: "Long",
        durationMins: Math.round(bikeMins * 0.5),
        intensity: "Z1-Z2",
        description:
          phase === "taper" ? "Easy endurance ride" : "Long endurance ride",
      })
    );
  }

  // Saturday: long run
  workouts.push(
    withPurpose({
      day: 5,
      sport: "Run",
      type: "Long",
      durationMins: Math.min(
        Math.round(runMins * 0.45),
        phase === "taper" ? 45 : 120
      ),
      intensity: "Z1-Z2",
      description: "Long run at easy aerobic effort",
    })
  );

  // Tuesday: swim
  workouts.push(
    withPurpose({
      day: 1,
      sport: "Swim",
      type: phase === "build" || phase === "peak" ? "Intervals" : "Endurance",
      durationMins: Math.round(swimMins * 0.55),
      intensity: phase === "build" || phase === "peak" ? "Z3" : "Z1-Z2",
      description:
        phase === "build" || phase === "peak"
          ? "Swim intervals: 10×100m at threshold, 15s rest"
          : "Steady swim with technique drills",
    })
  );

  // Thursday: bike intervals or endurance
  if (sessions >= 4) {
    workouts.push(
      withPurpose({
        day: 3,
        sport: "Bike",
        type: phase === "build" || phase === "peak" ? "Intervals" : "Endurance",
        durationMins: Math.round(bikeMins * 0.3),
        intensity: phase === "build" || phase === "peak" ? "Z4-Z5" : "Z1-Z2",
        description:
          phase === "build" || phase === "peak"
            ? "Bike intervals: 4×5min above threshold, 3min recovery"
            : "Easy aerobic ride",
      })
    );
  }

  // Fill remaining with easy runs / swims
  const usedDays = new Set(workouts.map((w) => w.day));
  const availDays = [0, 2, 4].filter((d) => !usedDays.has(d));
  const remaining = sessions - workouts.length;
  const sportsCycle = ["Run", "Swim"];

  for (let i = 0; i < remaining && i < availDays.length; i++) {
    const sport = sportsCycle[i % sportsCycle.length];
    workouts.push(
      withPurpose({
        day: availDays[i],
        sport,
        type: phase === "recovery" ? "Recovery" : "Endurance",
        durationMins: Math.max(
          20,
          Math.round((sport === "Swim" ? swimMins : runMins) * 0.3)
        ),
        intensity: phase === "recovery" ? "Recovery" : "Z1-Z2",
        description:
          phase === "recovery"
            ? `Easy recovery ${sport.toLowerCase()}`
            : `Easy aerobic ${sport.toLowerCase()}`,
      })
    );
  }

  return workouts.sort((a, b) => a.day - b.day);
}

/**
 * Seeds a standard week for a brand-new athlete so rolloverWeekPlan never
 * silently resolves to an all-rest week for someone who has never touched
 * Settings → Availability. Spreads hoursPerWeek across the last
 * daysPerWeek days of the week (Sunday backwards), one untimed block per
 * training day — the same shape migration 0031's fallback produces, and
 * the same shape the deleted prefillAvailability produced for a fresh
 * athlete, so a backfilled athlete and a newly created one end up
 * consistent. Never touches a day the athlete already configured: rows are
 * inserted only where no (userId, weekday) row exists yet.
 */
async function seedAvailabilityDefaults(
  userId: string,
  daysPerWeek: number,
  hoursPerWeek: number,
  tx: typeof db | Tx = db
): Promise<void> {
  const perDayMins =
    daysPerWeek > 0
      ? Math.max(0, Math.round((hoursPerWeek * 60) / daysPerWeek / 5) * 5)
      : 0;
  const rows = Array.from({ length: 7 }, (_, weekday) => ({
    userId,
    weekday,
    blocks:
      daysPerWeek > 0 && weekday >= 7 - daysPerWeek
        ? [
            {
              start: null,
              end: null,
              mins: perDayMins,
              energy: "normal" as const,
              sports: null,
            },
          ]
        : [],
  }));
  await tx
    .insert(schema.availabilityDefaults)
    .values(rows)
    .onConflictDoNothing({
      target: [
        schema.availabilityDefaults.userId,
        schema.availabilityDefaults.weekday,
      ],
    });
}

// ── v0.43: preview (writes a draft, nothing else) ──────────────────────────

/**
 * Writes an inert `draft` training plan and returns a `PlanPreview` for the
 * athlete to check before committing to anything. Unlike
 * `generateTrainingPlan`, this never archives an existing active plan,
 * never creates a race, never seeds availability defaults, and never
 * materializes a week — a draft is safe to throw away, which is the whole
 * point of previewing before Task 6's confirmation step activates it.
 *
 * Refusals are returned, not thrown: a thrown Error reaches the athlete as
 * whatever the coach model says about a failed tool call, which is worse
 * than a typed reason the caller can render honestly.
 */
export async function previewTrainingPlan(
  params: GeneratePlanParams
): Promise<PreviewResult> {
  const { userId, daysPerWeek = 5, hoursPerWeek = 8 } = params;

  // 1. The race decides the sport (v0.42). Refusals are returned, not thrown:
  //    a thrown Error reaches the athlete as whatever the coach model says
  //    about a failed tool call.
  const raceId = params.raceId ?? null;
  let raceType = params.raceType;
  let raceDate = params.raceDate;
  let raceNameFromRow: string | null = null;
  let racePriority: "A" | "B" | "C" = "A";
  let sport: PlanSport;

  if (raceId) {
    const race = await db.query.races.findFirst({
      where: and(eq(schema.races.id, raceId), eq(schema.races.userId, userId)),
    });
    if (!race) return { ok: false, reason: "race_not_found" };
    raceType = race.raceType;
    raceDate = race.date;
    raceNameFromRow = race.name;
    racePriority = race.priority as "A" | "B" | "C";
    const resolved = toPlanSport(race.sport);
    if (!resolved) return { ok: false, reason: "unknown_sport" };
    sport = resolved;
  } else {
    const resolved = inferPlanSport(raceType);
    if (!resolved) return { ok: false, reason: "unknown_sport" };
    sport = resolved;
  }

  // Single source of truth for "what do we call this plan when nobody named
  // it". Finding 2 (v0.43 final review): the coach's tool response
  // (`preview.race.name`, in memory) and /train's card (`previewFromDraft`
  // reading the stored `title`) used to compute this independently —
  // `params.title ?? raceType` here vs `params.title ?? \`${raceType}
  // training plan\`` at the insert below — so an untitled, race-less plan
  // showed as "gran_fondo" to the coach and "gran_fondo training plan" on
  // screen for the exact same draft. Both now read this one expression.
  const defaultTitle = params.title ?? `${raceType} training plan`;
  const raceName = raceNameFromRow ?? defaultTitle;

  // 2. Horizon. A close race is SCALED, not refused — refusing to plan is
  //    worse than planning honestly. A date beyond a year is a typo, and the
  //    athlete can act on being told so. `periodize` does not special-case a
  //    short horizon into a taper-only plan — it collapses into whatever
  //    phases fit inside the week count (base only, for 1-2 weeks) — so the
  //    `short_horizon` warning below is what carries the honesty, not a
  //    reshaped phase list.
  const today = new Date();
  const race = new Date(raceDate + "T00:00:00");
  const weeksTotal = Math.ceil(daysBetween(today, race) / 7);
  if (weeksTotal > 52) return { ok: false, reason: "horizon_too_long" };
  const planWeeks = Math.max(1, weeksTotal);
  const shortHorizon = weeksTotal < 4;

  // 3. Fitness. `?? 30` cannot be told apart from a measured CTL of 30 once
  //    stored, so the source travels with the value. Fixing the default is
  //    a later release; naming it is this release's job.
  const wellness = await db.query.wellnessDaily.findFirst({
    where: eq(schema.wellnessDaily.userId, userId),
    orderBy: desc(schema.wellnessDaily.date),
  });
  const startingCtl = wellness?.ctl ?? 30;
  const ctlSource: "wellness" | "default" =
    wellness?.ctl != null ? "wellness" : "default";

  const blocks = periodize(
    planWeeks,
    startingCtl,
    daysPerWeek,
    hoursPerWeek,
    sport
  );

  // 4. One draft per athlete. Cascade removes the old blocks with the row.
  await db
    .delete(schema.trainingPlans)
    .where(
      and(
        eq(schema.trainingPlans.userId, userId),
        eq(schema.trainingPlans.status, "draft")
      )
    );

  const startDate = localYmd(today);
  const [draft] = await db
    .insert(schema.trainingPlans)
    .values({
      userId,
      title: defaultTitle,
      raceType,
      raceDate,
      startDate,
      weeksTotal: planWeeks,
      startingCtl,
      raceId,
      status: "draft",
      constraints: { daysPerWeek, hoursPerWeek, sports: [sport] },
    })
    .returning();

  for (const block of blocks) {
    await db.insert(schema.trainingBlocks).values({
      planId: draft.id,
      weekNumber: block.weekNumber,
      phase: block.phase,
      targetLoadTotal: block.targetLoad,
      targetSessions: block.targetSessions,
      workouts: block.workouts,
    });
  }

  // 5. Reuse the engine's own numbers rather than inventing display ones.
  const { target, demand, level, longestRideHours } =
    await assembleWeeklyTarget(userId, today, {
      availabilityHours: hoursPerWeek,
      planHoursPerWeek: hoursPerWeek,
    });

  const existingAvailability = await db.query.availabilityDefaults.findMany({
    where: eq(schema.availabilityDefaults.userId, userId),
  });

  const weeks: PreviewWeek[] = blocks.map((b) => {
    // The engine's own scheduled minutes, not a ratio pinned to week 1 —
    // `targetLoad` compounds through `periodize`'s progression while
    // scheduled hours follow a differently-shaped `loadMultiplier`, so a
    // single load-per-hour figure drifts hard by the back half of a plan
    // (a 20-week Bike plan: week 15 read 15.7h for 8.8h actually scheduled).
    // Summing what `generateWorkouts` already decided cannot drift from the
    // sessions the athlete is shown.
    const workouts = b.workouts;
    const scheduledMins = workouts.reduce((sum, w) => sum + w.durationMins, 0);
    return {
      weekNumber: b.weekNumber,
      phase: b.phase as PlanPhase,
      targetLoad: b.targetLoad,
      targetHours: Math.round((scheduledMins / 60) * 10) / 10,
      raceName: b.weekNumber === planWeeks ? raceName : null,
    };
  });

  // 6. Feasibility, assembled the same way `/train` assembles it
  // (src/app/train/page.tsx) — `demand` is the athlete's currently tracked
  // race (highest priority, nearest date among their upcoming races), which
  // may or may not be the race this preview is for when raceId is null and
  // nothing has been created yet. That mirrors the rest of the app: there is
  // one "current target race" concept, not a second one invented for
  // previews. No demand (no tracked upcoming race with computable weekly
  // hours) is silence, not a guess: `assessFeasibility` itself also returns
  // null without a measured current-hours and longest-ride figure.
  const feasibility =
    demand == null
      ? null
      : assessFeasibility({
          requiredWeeklyHours: demand.weeklyHours,
          currentWeeklyHours: level.peakHours,
          queenStageHours: demand.queenStageHours,
          queenStageKnown: demand.queenStageKnown,
          longestRideHours,
          weeksUntilEvent: weeksTotal,
        });

  const preview: PlanPreview = {
    planId: draft.id,
    sport,
    race: {
      id: raceId,
      name: raceName,
      date: raceDate,
      priority: racePriority,
    },
    startDate,
    weeksTotal: planWeeks,
    daysPerWeek,
    hoursPerWeek,
    phases: buildPhases(
      weeks.map((w) => ({ weekNumber: w.weekNumber, phase: w.phase }))
    ),
    weeks,
    startingCtl: { value: startingCtl, source: ctlSource },
    feasibility,
    volume: { source: target.source, shortfall: target.shortfall },
    warnings: collectWarnings({
      startingCtlSource: ctlSource,
      volumeSource: target.source,
      hasShortfall: target.shortfall != null,
      feasibilityVerdict: feasibility?.verdict ?? null,
      raceCreated: raceId == null,
      availabilitySeeded: existingAvailability.length === 0,
      shortHorizon,
    }),
  };

  return { ok: true, preview };
}

/** The row shape `db.query.trainingPlans.findFirst` returns. */
type TrainingPlanRow = NonNullable<
  Awaited<ReturnType<typeof db.query.trainingPlans.findFirst>>
>;

/**
 * Rebuilds a `PlanPreview` from a stored draft row and its already-written
 * `training_blocks`, for an athlete who left `/train` and came back before
 * confirming. Periodization itself is NOT rerun here — `blocks` are read
 * verbatim, exactly as `previewTrainingPlan` wrote them, so this can never
 * disagree with the draft the athlete is about to confirm. What IS
 * recomputed (starting-CTL source, volume, feasibility, warnings) is
 * everything that legitimately depends on "now" rather than on "when the
 * draft was created" — a wellness sync or a demand edit that landed after
 * the draft was written should be reflected the next time the athlete
 * looks, the same way the rest of `/train` always reads live.
 *
 * `previewTrainingPlan`'s own body is intentionally left untouched rather
 * than refactored to share this block: it is one of the two things this
 * release depends on for its safety property, and Task 8 does not touch
 * `previewTrainingPlan`, `confirmTrainingPlan`, or any periodization
 * constant. This function calls the same pure/query helpers
 * (`buildPhases`, `collectWarnings`, `assembleWeeklyTarget`,
 * `assessFeasibility`) that `previewTrainingPlan` calls, rather than
 * duplicating their logic — only the row-shaped assembly around them is
 * necessarily separate, because a draft's blocks live in the database and
 * a fresh preview's blocks live in memory.
 */
export async function previewFromDraft(
  draft: TrainingPlanRow
): Promise<PlanPreview> {
  const constraints = (draft.constraints ?? {}) as {
    daysPerWeek?: number;
    hoursPerWeek?: number;
    sports?: string[];
  };
  const daysPerWeek = constraints.daysPerWeek ?? 5;
  const hoursPerWeek = constraints.hoursPerWeek ?? 8;
  const sport = requirePlanSport(constraints.sports?.[0]);

  // Race identity: a stored raceId names a real race to read the current
  // name/priority from; otherwise the draft's own fields ARE what
  // confirming will create — same contract as previewTrainingPlan.
  let raceName = draft.title;
  let racePriority: "A" | "B" | "C" = "A";
  if (draft.raceId) {
    const race = await db.query.races.findFirst({
      where: and(
        eq(schema.races.id, draft.raceId),
        eq(schema.races.userId, draft.userId)
      ),
    });
    if (race) {
      raceName = race.name;
      racePriority = race.priority as "A" | "B" | "C";
    }
  }

  const blocks = await db.query.trainingBlocks.findMany({
    where: eq(schema.trainingBlocks.planId, draft.id),
    orderBy: [asc(schema.trainingBlocks.weekNumber)],
  });

  const weeks: PreviewWeek[] = blocks.map((b) => {
    const workouts = (b.workouts ?? []) as PlannedWorkout[];
    const scheduledMins = workouts.reduce((sum, w) => sum + w.durationMins, 0);
    return {
      weekNumber: b.weekNumber,
      phase: b.phase as PlanPhase,
      targetLoad: b.targetLoadTotal != null ? Math.round(b.targetLoadTotal) : 0,
      targetHours: Math.round((scheduledMins / 60) * 10) / 10,
      raceName: b.weekNumber === draft.weeksTotal ? raceName : null,
    };
  });

  const today = new Date();
  const wellness = await db.query.wellnessDaily.findFirst({
    where: eq(schema.wellnessDaily.userId, draft.userId),
    orderBy: desc(schema.wellnessDaily.date),
  });
  const ctlSource: "wellness" | "default" =
    wellness?.ctl != null ? "wellness" : "default";

  const existingAvailability = await db.query.availabilityDefaults.findMany({
    where: eq(schema.availabilityDefaults.userId, draft.userId),
  });

  const { target, demand, level, longestRideHours } =
    await assembleWeeklyTarget(draft.userId, today, {
      availabilityHours: hoursPerWeek,
      planHoursPerWeek: hoursPerWeek,
    });

  const weeksUntilRace = Math.ceil(
    daysBetween(today, new Date(draft.raceDate + "T00:00:00")) / 7
  );

  const feasibility =
    demand == null
      ? null
      : assessFeasibility({
          requiredWeeklyHours: demand.weeklyHours,
          currentWeeklyHours: level.peakHours,
          queenStageHours: demand.queenStageHours,
          queenStageKnown: demand.queenStageKnown,
          longestRideHours,
          weeksUntilEvent: weeksUntilRace,
        });

  return {
    planId: draft.id,
    sport,
    race: {
      id: draft.raceId,
      name: raceName,
      date: draft.raceDate,
      priority: racePriority,
    },
    startDate: draft.startDate,
    weeksTotal: draft.weeksTotal,
    daysPerWeek,
    hoursPerWeek,
    phases: buildPhases(
      weeks.map((w) => ({ weekNumber: w.weekNumber, phase: w.phase }))
    ),
    weeks,
    startingCtl: { value: draft.startingCtl ?? 30, source: ctlSource },
    feasibility,
    volume: { source: target.source, shortfall: target.shortfall },
    warnings: collectWarnings({
      startingCtlSource: ctlSource,
      volumeSource: target.source,
      hasShortfall: target.shortfall != null,
      feasibilityVerdict: feasibility?.verdict ?? null,
      raceCreated: draft.raceId == null,
      availabilitySeeded: existingAvailability.length === 0,
      shortHorizon: weeksUntilRace < 4,
    }),
  };
}

/**
 * Turn a draft into the athlete's plan.
 *
 * Archive and activate happen in ONE transaction. The pre-v0.43 generator
 * archived first and inserted afterwards, so any error between the two left
 * the athlete with no active plan at all. That window does not exist here.
 */
export async function confirmTrainingPlan(
  userId: string,
  planId: string
): Promise<
  | { ok: true; planId: string }
  | { ok: false; reason: "not_found" | "sport_changed" }
> {
  const draft = await db.query.trainingPlans.findFirst({
    where: and(
      eq(schema.trainingPlans.id, planId),
      eq(schema.trainingPlans.userId, userId),
      eq(schema.trainingPlans.status, "draft")
    ),
  });
  if (!draft) return { ok: false, reason: "not_found" };

  const constraints = (draft.constraints ?? {}) as {
    daysPerWeek?: number;
    hoursPerWeek?: number;
  };

  const sport = requirePlanSport(
    (draft.constraints as { sports?: string[] } | null)?.sports?.[0]
  );

  // Finding 1 (v0.43 final review): a draft's sport is frozen into
  // `constraints.sports` when the draft is written and never re-checked.
  // `upsert_race` — untouched by this release — lets the coach change an
  // existing race's sport at any time, so a draft previewed against race R
  // while R was Bike survives a later correction of R to Run, and this
  // would otherwise activate a Bike plan against a now-Run race. v0.42 made
  // `races.sport` the sport authority precisely so this could not happen;
  // this closes the one door that reached it without going through that
  // authority. Refuse rather than silently re-deriving a new plan: the
  // athlete reviewed and agreed to a SPECIFIC plan, and quietly swapping its
  // sport under them would be the same class of defect in a new place.
  // Checked before the transaction, so a refusal here activates nothing and
  // archives nothing.
  if (draft.raceId) {
    const race = await db.query.races.findFirst({
      where: and(
        eq(schema.races.id, draft.raceId),
        eq(schema.races.userId, userId)
      ),
      columns: { sport: true },
    });
    // A race that no longer exists is a different, pre-existing edge case
    // (not this finding) — leave that behavior alone and only compare when
    // there is a live sport to compare against.
    if (race && toPlanSport(race.sport) !== sport) {
      return { ok: false, reason: "sport_changed" };
    }
  }

  await db.transaction(async (tx) => {
    await tx
      .update(schema.trainingPlans)
      .set({ status: "archived" })
      .where(
        and(
          eq(schema.trainingPlans.userId, userId),
          eq(schema.trainingPlans.status, "active")
        )
      );

    // The race the preview PROMISED to create. previewTrainingPlan writes no
    // race — that is what makes a draft inert — so a draft carrying no raceId
    // still needs one here. v0.42 made races.sport the sport authority and the
    // taper, feasibility and debrief paths all read the race, so activating a
    // plan without one would ship a plan that half the engine cannot see.
    // Inlined rather than calling createRace so it joins this transaction; the
    // date is already known to be in the future, which is createRace's only
    // extra check.
    let raceId = draft.raceId;
    if (!raceId) {
      const [created] = await tx
        .insert(schema.races)
        .values({
          userId,
          name: draft.title,
          raceType: draft.raceType,
          sport,
          date: draft.raceDate,
          priority: "A",
        })
        .returning();
      raceId = created.id;
    }

    await tx
      .update(schema.trainingPlans)
      .set({ status: "active", raceId, updatedAt: new Date() })
      .where(eq(schema.trainingPlans.id, planId));

    // onConflictDoNothing per weekday already leaves an existing standard
    // week alone; it moves inside the transaction so it cannot land for a
    // plan that then fails to activate.
    await seedAvailabilityDefaults(
      userId,
      constraints.daysPerWeek ?? 5,
      constraints.hoursPerWeek ?? 8,
      tx
    );
  });

  // Outside the transaction, and still best-effort: a rollover failure must
  // not roll back a good plan.
  try {
    const { rolloverWeekPlan } = await import("@/lib/week-plan/service");
    await rolloverWeekPlan(userId);
  } catch (err) {
    const { logger } = await import("@/lib/logger");
    logger.warn("week materialization after plan confirmation failed", {
      userId,
      message: err instanceof Error ? err.message : String(err),
    });
  }

  return { ok: true, planId };
}

// ── Main entry point ────────────────────────────────────────────────────────

export async function generateTrainingPlan(
  params: GeneratePlanParams
): Promise<GeneratePlanResult> {
  const { userId, daysPerWeek = 5, hoursPerWeek = 8 } = params;

  let raceId = params.raceId ?? null;
  let raceType = params.raceType;
  let raceDate = params.raceDate;
  // The race is the authority (v0.42). When one is given, its sport wins
  // outright; when we are about to create one, the race type must name a
  // sport or there is nothing to build.
  let sport: PlanSport;
  if (raceId) {
    const race = await db.query.races.findFirst({
      where: and(eq(schema.races.id, raceId), eq(schema.races.userId, userId)),
    });
    if (!race) throw new Error("race_not_found");
    raceType = race.raceType;
    raceDate = race.date;
    sport = requirePlanSport(race.sport);
  } else {
    sport = requirePlanSport(inferPlanSport(raceType));
  }

  // 1. Calculate plan duration
  const today = new Date();
  const race = new Date(raceDate + "T00:00:00");
  const totalDays = daysBetween(today, race);
  const weeksTotal = Math.ceil(totalDays / 7);

  if (weeksTotal < 4) {
    throw new Error("Race too soon for a plan");
  }
  if (weeksTotal > 52) {
    throw new Error("Race date too far out — maximum 52 weeks");
  }

  // 2. Gather current fitness
  const wellness = await db.query.wellnessDaily.findFirst({
    where: eq(schema.wellnessDaily.userId, userId),
    orderBy: desc(schema.wellnessDaily.date),
  });
  const startingCtl = wellness?.ctl ?? 30; // conservative default

  // Get athlete name
  const user = await db.query.users.findFirst({
    where: eq(schema.users.id, userId),
  });

  const title = params.title ?? `${raceType} training plan`;
  const startDate = localYmd(today);

  // 3. Periodize
  const blocks = periodize(
    weeksTotal,
    startingCtl,
    daysPerWeek,
    hoursPerWeek,
    sport
  );

  // 4. Store in DB — archive any existing active plan first so there is
  // always at most one active plan per user (adherence/update pick it via
  // findFirst; multiple actives would make that arbitrary).
  await db
    .update(schema.trainingPlans)
    .set({ status: "archived" })
    .where(
      and(
        eq(schema.trainingPlans.userId, userId),
        eq(schema.trainingPlans.status, "active")
      )
    );

  if (!raceId) {
    const created = await createRace(userId, {
      name: params.title ?? `${raceType}`,
      raceType,
      date: raceDate,
      priority: "A",
      sport,
    });
    if ("race" in created) raceId = created.race.id;
    // past_date is unreachable here: weeksTotal >= 4 already guarantees a future date
  }

  const [plan] = await db
    .insert(schema.trainingPlans)
    .values({
      userId,
      title,
      raceType,
      raceDate,
      startDate,
      weeksTotal,
      startingCtl,
      raceId,
      // Single-element array, not a bare field: service.ts/project.ts read
      // `constraints.sports?.[0]` — kept as an array so a plan created today
      // is shaped exactly like the pre-v0.42 rows already living in
      // production (`constraints.sports: ["Ride"]`, `["Bike"]`, ...).
      constraints: { daysPerWeek, hoursPerWeek, sports: [sport] },
    })
    .returning();

  await seedAvailabilityDefaults(userId, daysPerWeek, hoursPerWeek);

  for (const block of blocks) {
    await db.insert(schema.trainingBlocks).values({
      planId: plan.id,
      weekNumber: block.weekNumber,
      phase: block.phase,
      targetLoadTotal: block.targetLoad,
      targetSessions: block.targetSessions,
      workouts: block.workouts,
    });
  }

  // 5. Build summary
  const phaseCounts: Record<string, number> = {};
  for (const b of blocks) {
    phaseCounts[b.phase] = (phaseCounts[b.phase] ?? 0) + 1;
  }
  const phaseStr = Object.entries(phaseCounts)
    .map(([p, n]) => `${p} ${n}w`)
    .join(", ");

  const summary =
    `${weeksTotal}-week ${raceType} plan for ${user?.name ?? "athlete"}: ${phaseStr}. ` +
    `${daysPerWeek} sessions/week, ~${hoursPerWeek}h/week. ` +
    `Starting CTL: ${Math.round(startingCtl)}.`;

  // v0.9.3: the living week starts now, not at the next weekly review.
  // Dynamic import: week-plan/service → materialize → this module.
  try {
    const { rolloverWeekPlan } = await import("@/lib/week-plan/service");
    await rolloverWeekPlan(userId);
  } catch (err) {
    const { logger } = await import("@/lib/logger");
    logger.warn("week materialization after plan generation failed", {
      userId,
      message: err instanceof Error ? err.message : String(err),
    });
  }

  return { planId: plan.id, summary };
}

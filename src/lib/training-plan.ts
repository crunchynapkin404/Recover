/**
 * Training plan generation service (v0.5d) — deterministic periodized
 * training plan generator. No LLM dependency; uses template-based
 * periodization with sport-specific workout prescriptions.
 */
import { desc, eq, and } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { createRace } from "@/lib/race/service";
import type { Purpose } from "@/lib/availability/types";
import { PURPOSE_FLOORS } from "@/lib/availability/types";

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
  sports?: string[];
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

/** Infer primary sport from race type */
export function inferSports(raceType: string, explicit?: string[]): string[] {
  if (explicit?.length) return explicit;
  const rt = raceType.toLowerCase();
  if (rt.includes("triathlon") || rt.includes("ironman") || rt.includes("70.3"))
    return ["Swim", "Bike", "Run"];
  if (
    rt.includes("marathon") ||
    rt.includes("half") ||
    rt.includes("10k") ||
    rt.includes("5k")
  )
    return ["Run"];
  if (
    rt.includes("fondo") ||
    rt.includes("century") ||
    rt.includes("crit") ||
    rt.includes("cycling")
  )
    return ["Bike"];
  return ["Run"]; // default
}

function isTriathlon(raceType: string): boolean {
  const rt = raceType.toLowerCase();
  return (
    rt.includes("triathlon") || rt.includes("ironman") || rt.includes("70.3")
  );
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
  raceType: string,
  sports: string[],
  queenStageHours: number | null = null
): Block[] {
  // Phase distribution
  const baseWeeks = Math.max(2, Math.round(weeksTotal * 0.4));
  const buildWeeks = Math.max(1, Math.round(weeksTotal * 0.3));
  const taperWeeks = Math.max(2, Math.round(weeksTotal * 0.15));
  const peakWeeks = Math.max(
    1,
    weeksTotal - baseWeeks - buildWeeks - taperWeeks
  );

  // Starting weekly load from CTL (rough TSS = CTL * 7)
  const baseLoad = Math.max(100, startingCtl * 7);

  const blocks: Block[] = [];
  let currentLoad = baseLoad;

  for (let w = 1; w <= weeksTotal; w++) {
    let phase: Block["phase"];
    if (w <= baseWeeks) phase = "base";
    else if (w <= baseWeeks + buildWeeks) phase = "build";
    else if (w <= baseWeeks + buildWeeks + peakWeeks) phase = "peak";
    else phase = "taper";

    // Recovery week every 3rd or 4th week (use 4th in base, 3rd in build/peak)
    const recoveryInterval = phase === "base" ? 4 : 3;
    const weekInPhase =
      phase === "base"
        ? w
        : phase === "build"
          ? w - baseWeeks
          : phase === "peak"
            ? w - baseWeeks - buildWeeks
            : w - baseWeeks - buildWeeks - peakWeeks;
    const isRecovery =
      weekInPhase > 1 &&
      weekInPhase % recoveryInterval === 0 &&
      phase !== "taper";

    if (isRecovery) {
      blocks.push({
        weekNumber: w,
        phase: "recovery",
        targetLoad: Math.round(currentLoad * 0.6),
        targetSessions: Math.max(3, daysPerWeek - 1),
        workouts: generateWorkouts(
          daysPerWeek - 1,
          hoursPerWeek * 0.6,
          "recovery",
          raceType,
          sports,
          queenStageHours
        ),
      });
      // Don't increase load after recovery
    } else {
      blocks.push({
        weekNumber: w,
        phase,
        targetLoad: Math.round(currentLoad),
        targetSessions: daysPerWeek,
        workouts: generateWorkouts(
          daysPerWeek,
          hoursPerWeek * loadMultiplier(phase, weekInPhase),
          phase,
          raceType,
          sports,
          queenStageHours
        ),
      });

      // Load progression: +5-8% in base, +5-7% in build, flat/slight in peak, decrease in taper
      if (phase === "base") {
        currentLoad = Math.min(
          currentLoad * 1.08,
          currentLoad + baseLoad * 0.1
        );
      } else if (phase === "build") {
        currentLoad = Math.min(
          currentLoad * 1.07,
          currentLoad + baseLoad * 0.1
        );
      } else if (phase === "peak") {
        // Maintain or slight increase
        currentLoad *= 1.02;
      } else {
        // Taper: decrease 20-30% per week
        currentLoad *= 0.75;
      }
    }
  }

  return blocks;
}

function loadMultiplier(phase: Block["phase"], weekInPhase: number): number {
  switch (phase) {
    case "base":
      return 0.85 + weekInPhase * 0.05;
    case "build":
      return 1.0 + weekInPhase * 0.03;
    case "peak":
      return 1.1;
    case "taper":
      return 0.7 - (weekInPhase - 1) * 0.1;
    case "recovery":
      return 0.6;
  }
}

// ── Workout generation ──────────────────────────────────────────────────────

export function generateWorkouts(
  sessions: number,
  weekHours: number,
  phase: Block["phase"],
  raceType: string,
  sports: string[],
  queenStageHours: number | null = null
): PlannedWorkout[] {
  if (isTriathlon(raceType)) {
    return generateTriathlonWorkouts(sessions, weekHours, phase);
  }
  if (sports[0] === "Bike") {
    return generateCyclingWorkouts(sessions, weekHours, phase, queenStageHours);
  }
  return generateRunningWorkouts(sessions, weekHours, phase, raceType);
}

function generateRunningWorkouts(
  sessions: number,
  weekHours: number,
  phase: Block["phase"],
  raceType: string
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
        description: raceType.includes("5k")
          ? "5×1000m at 5K pace, 90s jog recovery"
          : raceType.includes("10k")
            ? "4×1600m at 10K pace, 2min jog recovery"
            : "6×800m at 5K-10K pace, 90s jog recovery",
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
        durationMins: Math.max(20, Math.min(easyMins, 60)),
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
  hoursPerWeek: number
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
  await db
    .insert(schema.availabilityDefaults)
    .values(rows)
    .onConflictDoNothing({
      target: [
        schema.availabilityDefaults.userId,
        schema.availabilityDefaults.weekday,
      ],
    });
}

// ── Main entry point ────────────────────────────────────────────────────────

export async function generateTrainingPlan(
  params: GeneratePlanParams
): Promise<GeneratePlanResult> {
  const { userId, daysPerWeek = 5, hoursPerWeek = 8 } = params;

  let raceId = params.raceId ?? null;
  let raceType = params.raceType;
  let raceDate = params.raceDate;
  if (raceId) {
    const race = await db.query.races.findFirst({
      where: and(eq(schema.races.id, raceId), eq(schema.races.userId, userId)),
    });
    if (!race) throw new Error("race_not_found");
    raceType = race.raceType;
    raceDate = race.date;
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

  const sports = inferSports(raceType, params.sports);
  const title = params.title ?? `${raceType} training plan`;
  const startDate = localYmd(today);

  // 3. Periodize
  const blocks = periodize(
    weeksTotal,
    startingCtl,
    daysPerWeek,
    hoursPerWeek,
    raceType,
    sports
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
      constraints: { daysPerWeek, hoursPerWeek, sports },
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

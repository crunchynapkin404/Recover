/**
 * Training plan generation service (v0.5d) — deterministic periodized
 * training plan generator. No LLM dependency; uses template-based
 * periodization with sport-specific workout prescriptions.
 */
import { desc, eq, and } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { createRace } from "@/lib/race/service";

// ── Types ───────────────────────────────────────────────────────────────────

export interface PlannedWorkout {
  day: number; // 0=Mon..6=Sun
  sport: string;
  type: string; // "Endurance", "Tempo", "Intervals", "Recovery", "Long", "Brick"
  durationMins: number;
  intensity: string; // "Z1-Z2", "Z3", "Z4-Z5", "Recovery"
  description: string;
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

function periodize(
  weeksTotal: number,
  startingCtl: number,
  daysPerWeek: number,
  hoursPerWeek: number,
  raceType: string,
  sports: string[]
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
          sports
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
          sports
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
  sports: string[]
): PlannedWorkout[] {
  if (isTriathlon(raceType)) {
    return generateTriathlonWorkouts(sessions, weekHours, phase);
  }
  if (sports[0] === "Bike") {
    return generateCyclingWorkouts(sessions, weekHours, phase);
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
  workouts.push({
    day: 6, // Sunday
    sport: "Run",
    type: "Long",
    durationMins: Math.min(longRunMins, phase === "taper" ? 60 : 180),
    intensity: "Z1-Z2",
    description:
      phase === "taper"
        ? "Easy long run — reduced duration for taper"
        : "Long run at conversational pace",
  });

  // Tuesday: tempo or intervals depending on phase
  if (phase === "build" || phase === "peak") {
    workouts.push({
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
    });
  } else if (phase !== "recovery") {
    workouts.push({
      day: 1,
      sport: "Run",
      type: "Tempo",
      durationMins: Math.round(totalMins * 0.15),
      intensity: "Z3",
      description: "Tempo run at half-marathon effort",
    });
  }

  // Thursday: tempo in build/peak, endurance otherwise
  if (sessions >= 4 && phase !== "recovery") {
    workouts.push({
      day: 3,
      sport: "Run",
      type: phase === "build" || phase === "peak" ? "Tempo" : "Endurance",
      durationMins: Math.round(totalMins * 0.15),
      intensity: phase === "build" || phase === "peak" ? "Z3" : "Z1-Z2",
      description:
        phase === "build" || phase === "peak"
          ? "Tempo run — sustained effort"
          : "Easy endurance run",
    });
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
    workouts.push({
      day: easyDays[i],
      sport: "Run",
      type: phase === "recovery" ? "Recovery" : "Endurance",
      durationMins: Math.max(20, Math.min(easyMins, 60)),
      intensity: phase === "recovery" ? "Recovery" : "Z1-Z2",
      description:
        phase === "recovery" ? "Easy recovery run" : "Easy aerobic run",
    });
  }

  return workouts.sort((a, b) => a.day - b.day);
}

function generateCyclingWorkouts(
  sessions: number,
  weekHours: number,
  phase: Block["phase"]
): PlannedWorkout[] {
  const totalMins = weekHours * 60;
  const workouts: PlannedWorkout[] = [];

  // Saturday or Sunday: long ride (35-40% of volume)
  workouts.push({
    day: 5, // Saturday
    sport: "Bike",
    type: "Long",
    durationMins: Math.min(
      Math.round(totalMins * 0.38),
      phase === "taper" ? 90 : 240
    ),
    intensity: "Z1-Z2",
    description:
      phase === "taper"
        ? "Reduced endurance ride"
        : "Long endurance ride — steady aerobic effort",
  });

  // Midweek intervals in build/peak
  if (phase === "build" || phase === "peak") {
    workouts.push({
      day: 2, // Wednesday
      sport: "Bike",
      type: "Intervals",
      durationMins: Math.round(totalMins * 0.18),
      intensity: "Z4-Z5",
      description: "VO2max intervals: 5×4min at threshold+, 3min recovery",
    });
  } else if (phase !== "recovery") {
    workouts.push({
      day: 2,
      sport: "Bike",
      type: "Tempo",
      durationMins: Math.round(totalMins * 0.18),
      intensity: "Z3",
      description: "Tempo ride — steady sweetspot effort",
    });
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
    workouts.push({
      day: availDays[i],
      sport: "Bike",
      type: phase === "recovery" ? "Recovery" : "Endurance",
      durationMins: Math.max(30, Math.min(easyMins, 90)),
      intensity: phase === "recovery" ? "Recovery" : "Z1-Z2",
      description:
        phase === "recovery" ? "Easy recovery spin" : "Aerobic endurance ride",
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
    workouts.push({
      day: 6,
      sport: "Bike",
      type: "Brick",
      durationMins: Math.round(bikeMins * 0.5),
      intensity: "Z1-Z2",
      description:
        "Bike-to-run brick: ride at race effort then 15-20min transition run",
    });
  } else {
    workouts.push({
      day: 6,
      sport: "Bike",
      type: "Long",
      durationMins: Math.round(bikeMins * 0.5),
      intensity: "Z1-Z2",
      description:
        phase === "taper" ? "Easy endurance ride" : "Long endurance ride",
    });
  }

  // Saturday: long run
  workouts.push({
    day: 5,
    sport: "Run",
    type: "Long",
    durationMins: Math.min(
      Math.round(runMins * 0.45),
      phase === "taper" ? 45 : 120
    ),
    intensity: "Z1-Z2",
    description: "Long run at easy aerobic effort",
  });

  // Tuesday: swim
  workouts.push({
    day: 1,
    sport: "Swim",
    type: phase === "build" || phase === "peak" ? "Intervals" : "Endurance",
    durationMins: Math.round(swimMins * 0.55),
    intensity: phase === "build" || phase === "peak" ? "Z3" : "Z1-Z2",
    description:
      phase === "build" || phase === "peak"
        ? "Swim intervals: 10×100m at threshold, 15s rest"
        : "Steady swim with technique drills",
  });

  // Thursday: bike intervals or endurance
  if (sessions >= 4) {
    workouts.push({
      day: 3,
      sport: "Bike",
      type: phase === "build" || phase === "peak" ? "Intervals" : "Endurance",
      durationMins: Math.round(bikeMins * 0.3),
      intensity: phase === "build" || phase === "peak" ? "Z4-Z5" : "Z1-Z2",
      description:
        phase === "build" || phase === "peak"
          ? "Bike intervals: 4×5min above threshold, 3min recovery"
          : "Easy aerobic ride",
    });
  }

  // Fill remaining with easy runs / swims
  const usedDays = new Set(workouts.map((w) => w.day));
  const availDays = [0, 2, 4].filter((d) => !usedDays.has(d));
  const remaining = sessions - workouts.length;
  const sportsCycle = ["Run", "Swim"];

  for (let i = 0; i < remaining && i < availDays.length; i++) {
    const sport = sportsCycle[i % sportsCycle.length];
    workouts.push({
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
    });
  }

  return workouts.sort((a, b) => a.day - b.day);
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

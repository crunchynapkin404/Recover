// src/lib/race/service.ts — race CRUD. Pure race math lives in taper.ts /
// forecast.ts; this layer only touches the DB.
import { and, asc, desc, eq, gte, lte } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import type { RaceContext } from "./taper";
import type { ForecastInputs } from "./forecast";
import { taperFractionForWeek } from "./taper";
import type { DaySlot } from "@/lib/week-plan/types";

export type RaceRow = typeof schema.races.$inferSelect;
export type RacePriority = "A" | "B" | "C";
export type RaceStatus = "upcoming" | "completed" | "skipped";

export interface RaceInput {
  name: string;
  raceType: string;
  date: string; // YYYY-MM-DD
  priority: RacePriority;
  sport?: string | null;
  goalNote?: string | null;
}

function localYmd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export async function createRace(
  userId: string,
  input: RaceInput,
  now = new Date()
): Promise<{ race: RaceRow } | { error: "past_date" }> {
  if (input.date < localYmd(now)) return { error: "past_date" };
  const [race] = await db
    .insert(schema.races)
    .values({
      userId,
      name: input.name,
      raceType: input.raceType,
      sport: input.sport ?? null,
      date: input.date,
      priority: input.priority,
      goalNote: input.goalNote ?? null,
    })
    .onConflictDoUpdate({
      target: [schema.races.userId, schema.races.date, schema.races.name],
      set: {
        raceType: input.raceType,
        sport: input.sport ?? null,
        priority: input.priority,
        goalNote: input.goalNote ?? null,
        updatedAt: now,
      },
    })
    .returning();
  return { race };
}

export async function updateRace(
  userId: string,
  id: string,
  patch: Partial<RaceInput> & { status?: RaceStatus },
  now = new Date()
): Promise<RaceRow | { error: "not_found" | "past_date" }> {
  const existing = await db.query.races.findFirst({
    where: and(eq(schema.races.id, id), eq(schema.races.userId, userId)),
  });
  if (!existing) return { error: "not_found" };
  if (patch.date && patch.date !== existing.date && patch.date < localYmd(now))
    return { error: "past_date" };
  const [row] = await db
    .update(schema.races)
    .set({ ...patch, updatedAt: now })
    .where(and(eq(schema.races.id, id), eq(schema.races.userId, userId)))
    .returning();
  return row;
}

export async function deleteRace(userId: string, id: string): Promise<boolean> {
  const rows = await db
    .delete(schema.races)
    .where(and(eq(schema.races.id, id), eq(schema.races.userId, userId)))
    .returning();
  return rows.length > 0;
}

export async function listRaces(
  userId: string,
  opts?: { status?: RaceStatus; priority?: RacePriority }
): Promise<RaceRow[]> {
  const conds = [eq(schema.races.userId, userId)];
  if (opts?.status) conds.push(eq(schema.races.status, opts.status));
  if (opts?.priority) conds.push(eq(schema.races.priority, opts.priority));
  return db.query.races.findMany({
    where: and(...conds),
    orderBy: asc(schema.races.date),
  });
}

export async function nextUpcomingRace(
  userId: string,
  now = new Date()
): Promise<RaceRow | null> {
  const row = await db.query.races.findFirst({
    where: and(
      eq(schema.races.userId, userId),
      eq(schema.races.status, "upcoming"),
      gte(schema.races.date, localYmd(now))
    ),
    // Same-date ties resolve to the race created first — the
    // earliest-committed intent (see Task 11: implicit A-race creation
    // means two A races can legitimately share a date).
    orderBy: [asc(schema.races.date), asc(schema.races.createdAt)],
  });
  return row ?? null;
}

const PRIORITY_ORDER: Record<string, number> = { A: 0, B: 1, C: 2 };

function addDaysYmd(ymd: string, n: number): string {
  const d = new Date(ymd + "T00:00:00");
  d.setDate(d.getDate() + n);
  return localYmd(d);
}

/**
 * Upcoming races relevant to the week starting `weekStart`: anything in
 * the week itself (race slots) or within the 27-day lookahead (taper
 * reshaping). Sorted priority A→C then date then createdAt (earliest wins
 * same-date ties, see Task 11) — materializeWeek treats the first entry as
 * primary.
 */
export async function racesForWeek(
  userId: string,
  weekStart: string
): Promise<RaceContext[]> {
  const rows = await db.query.races.findMany({
    where: and(
      eq(schema.races.userId, userId),
      eq(schema.races.status, "upcoming"),
      gte(schema.races.date, weekStart),
      lte(schema.races.date, addDaysYmd(weekStart, 27))
    ),
    orderBy: [asc(schema.races.date), asc(schema.races.createdAt)],
  });
  return rows
    .sort(
      (a, b) =>
        PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority] ||
        a.date.localeCompare(b.date) ||
        a.createdAt.getTime() - b.createdAt.getTime()
    )
    .map((r) => ({
      date: r.date,
      priority: r.priority as RaceContext["priority"],
      raceType: r.raceType,
      name: r.name,
    }));
}

/** Latest stored CTL (provider or computed) — taper base fallback. */
export async function currentCtl(userId: string): Promise<number | null> {
  const row = await db.query.dailyMetrics.findFirst({
    where: eq(schema.dailyMetrics.userId, userId),
    orderBy: desc(schema.dailyMetrics.date),
  });
  return row?.ctl ?? null;
}

export interface AssembledForecast {
  inputs: ForecastInputs;
  /** Null when no race anchors the projection (end-of-week anchor). */
  race: RaceRow | null;
}

/**
 * Gather everything forecastForm needs: today's stored CTL/ATL, the open
 * week's remaining planned loads, and the remaining skeleton weeks
 * (taper-reshaped for an A race). Distribution is deterministic: a week's
 * target load splits across its workout days proportional to duration.
 */
export async function assembleForecastInputs(
  userId: string,
  race: RaceRow | null,
  now = new Date()
): Promise<AssembledForecast | null> {
  const { getOpenWeekPlan } = await import("@/lib/week-plan/service");
  const week = await getOpenWeekPlan(userId);
  if (!week) return null;
  const plan = await db.query.trainingPlans.findFirst({
    where: eq(schema.trainingPlans.id, week.planId),
  });
  if (!plan) return null;

  const today = localYmd(now);
  const metric = await db.query.dailyMetrics.findFirst({
    where: eq(schema.dailyMetrics.userId, userId),
    orderBy: desc(schema.dailyMetrics.date),
  });
  const start =
    metric?.ctl != null && metric.atl != null
      ? { ctl: metric.ctl, atl: metric.atl }
      : null;

  const plannedLoads: { date: string; load: number }[] = [];

  // Open week: block target ∝ workout duration, future days only.
  const openBlock = await db.query.trainingBlocks.findFirst({
    where: and(
      eq(schema.trainingBlocks.planId, week.planId),
      eq(schema.trainingBlocks.weekNumber, week.skeletonWeek)
    ),
  });
  const workoutDays = week.days.filter(
    (d) =>
      d.workout &&
      (d.status === "planned" || d.status === "moved" || d.status === "adapted")
  );
  const totalMins = workoutDays.reduce(
    (s, d) => s + (d.workout?.durationMins ?? 0),
    0
  );
  // The open week's persisted effective target (post-taper, post-hours-
  // budget) wins over the block's un-tapered skeleton value — in race week
  // the block still holds the pre-taper number, which would otherwise
  // overstate the load distributed across the tiny opener sessions and
  // understate race-day freshness. Falls back to the block target on rows
  // written before this column existed.
  const weekTarget = week.effectiveTarget ?? openBlock?.targetLoadTotal ?? 0;
  for (const d of workoutDays) {
    if (d.date <= today || totalMins === 0) continue;
    plannedLoads.push({
      date: d.date,
      load:
        Math.round(
          weekTarget * ((d.workout!.durationMins ?? 0) / totalMins) * 10
        ) / 10,
    });
  }

  // Future skeleton weeks.
  const blocks = await db.query.trainingBlocks.findMany({
    where: eq(schema.trainingBlocks.planId, week.planId),
  });
  const future = blocks
    .filter((b) => b.weekNumber > week.skeletonWeek)
    .sort((a, b) => a.weekNumber - b.weekNumber);

  const lastClosed = await db.query.weekPlans.findFirst({
    where: and(
      eq(schema.weekPlans.userId, userId),
      eq(schema.weekPlans.status, "closed")
    ),
    orderBy: desc(schema.weekPlans.weekStart),
  });
  const lastActual = lastClosed
    ? (lastClosed.days as DaySlot[]).reduce(
        (s, d) => s + (d.actualLoad ?? 0),
        0
      )
    : 0;
  const ctlNow = metric?.ctl ?? null;

  const raceCtx =
    race && race.priority === "A"
      ? {
          date: race.date,
          priority: "A" as const,
          raceType: race.raceType,
          name: race.name,
        }
      : null;

  let horizonEnd = week.days[6].date;
  for (const [k, block] of future.entries()) {
    const weekStart = addDaysYmd(week.weekStart, 7 * (k + 1));
    horizonEnd = addDaysYmd(weekStart, 6);
    const fraction = raceCtx ? taperFractionForWeek(weekStart, raceCtx) : null;
    const base =
      lastActual > 0
        ? lastActual
        : ctlNow != null
          ? ctlNow * 7
          : (block.targetLoadTotal ?? 0);
    const target =
      fraction != null
        ? Math.round(base * fraction)
        : (block.targetLoadTotal ?? 0);
    const workouts = (block.workouts ?? []) as {
      day: number;
      durationMins: number;
    }[];
    const mins = workouts.reduce((s, w) => s + w.durationMins, 0);
    for (const w of workouts) {
      if (mins === 0) break;
      plannedLoads.push({
        date: addDaysYmd(weekStart, w.day),
        load: Math.round(target * (w.durationMins / mins) * 10) / 10,
      });
    }
  }

  // Trailing adherence: up to 4 most recent completed blocks.
  const adherencePcts = blocks
    .filter((b) => b.weekNumber < week.skeletonWeek && b.adherencePct != null)
    .sort((a, b) => b.weekNumber - a.weekNumber)
    .slice(0, 4)
    .map((b) => b.adherencePct!);
  const adherenceFraction =
    adherencePcts.length > 0
      ? adherencePcts.reduce((s, p) => s + p, 0) / adherencePcts.length / 100
      : null;

  return {
    inputs: {
      today,
      targetDate: race?.date ?? week.days[6].date,
      start,
      plannedLoads: plannedLoads.filter((p) => p.date > today),
      adherenceFraction,
      horizonEnd,
    },
    race,
  };
}

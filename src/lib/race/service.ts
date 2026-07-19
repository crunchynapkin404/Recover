// src/lib/race/service.ts — race CRUD. Pure race math lives in taper.ts /
// forecast.ts; this layer only touches the DB.
import { and, asc, desc, eq, gte, lte } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import type { RaceContext } from "./taper";

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
    orderBy: asc(schema.races.date),
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
 * reshaping). Sorted priority A→C then date — materializeWeek treats the
 * first entry as primary.
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
    orderBy: asc(schema.races.date),
  });
  return rows
    .map((r) => ({
      date: r.date,
      priority: r.priority as RaceContext["priority"],
      raceType: r.raceType,
      name: r.name,
    }))
    .sort(
      (a, b) =>
        PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority] ||
        a.date.localeCompare(b.date)
    );
}

/** Latest stored CTL (provider or computed) — taper base fallback. */
export async function currentCtl(userId: string): Promise<number | null> {
  const row = await db.query.dailyMetrics.findFirst({
    where: eq(schema.dailyMetrics.userId, userId),
    orderBy: desc(schema.dailyMetrics.date),
  });
  return row?.ctl ?? null;
}

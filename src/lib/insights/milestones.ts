import { and, eq, gte, isNotNull, or, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { addDaysYmd, localYmd } from "./auto-tags";

/**
 * Sober milestones, computed on read from durable rows — nothing is
 * persisted, so nothing can claim what the data no longer supports.
 */

export interface Milestones {
  currentStreak: number;
  bestStreak: number;
  planWeeksCompleted: number;
  plansCompleted: number;
}

const ADHERENCE_COMPLETE_PCT = 70;

/** Consecutive-day runs. Current run must end today or yesterday. */
export function computeStreaks(
  journaledDates: string[],
  today: string
): { current: number; best: number } {
  const days = [...new Set(journaledDates)].sort();
  let best = 0;
  let run = 0;
  let prev: string | null = null;
  for (const d of days) {
    run = prev != null && addDaysYmd(prev, 1) === d ? run + 1 : 1;
    if (run > best) best = run;
    prev = d;
  }
  const current = prev === today || prev === addDaysYmd(today, -1) ? run : 0;
  return { current, best };
}

export async function getMilestones(
  userId: string,
  now = new Date()
): Promise<Milestones> {
  const [journaled, weeks, plans] = await Promise.all([
    // A logged day carries user-entered signal; auto-synced rows
    // (HRV/sleep only) don't count — a streak the athlete didn't build
    // isn't theirs.
    db
      .select({ date: schema.wellnessDaily.date })
      .from(schema.wellnessDaily)
      .where(
        and(
          eq(schema.wellnessDaily.userId, userId),
          or(
            isNotNull(schema.wellnessDaily.energy1_10),
            isNotNull(schema.wellnessDaily.soreness1_10),
            isNotNull(schema.wellnessDaily.stress1_10),
            isNotNull(schema.wellnessDaily.mood),
            isNotNull(schema.wellnessDaily.notes),
            sql`jsonb_array_length(${schema.wellnessDaily.tags}) > 0`
          )
        )
      ),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.trainingBlocks)
      .innerJoin(
        schema.trainingPlans,
        eq(schema.trainingBlocks.planId, schema.trainingPlans.id)
      )
      .where(
        and(
          eq(schema.trainingPlans.userId, userId),
          gte(schema.trainingBlocks.adherencePct, ADHERENCE_COMPLETE_PCT)
        )
      ),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.trainingPlans)
      .where(
        and(
          eq(schema.trainingPlans.userId, userId),
          eq(schema.trainingPlans.status, "completed")
        )
      ),
  ]);

  const { current, best } = computeStreaks(
    journaled.map((j) => j.date),
    localYmd(now)
  );
  return {
    currentStreak: current,
    bestStreak: best,
    planWeeksCompleted: weeks[0]?.count ?? 0,
    plansCompleted: plans[0]?.count ?? 0,
  };
}

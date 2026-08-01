// src/lib/active-plan.ts — the single answer to "which training plan is this
// athlete on?".
//
// Seven call sites used to ask this question independently, five of them with
// `findFirst` and no `orderBy` — which Postgres answers in heap order. On the
// owner's account (three `active` rows left by a 2026-07-15 creation retry)
// that meant the coach reported week 1 while the week engine ran week 4, and
// `update_training_plan` wrote to a row nothing else read. The rule below is
// the one the engine paths already used, so adopting it everywhere moves the
// coach and the dashboard onto the engine's answer rather than the reverse.
import { and, desc, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { logger } from "@/lib/logger";

export type ActivePlan = typeof schema.trainingPlans.$inferSelect;

/**
 * The athlete's active training plan — the most recently created `active`
 * row, or null when there is none.
 *
 * Uses `findMany` rather than `findFirst` deliberately: the extra rows are how
 * ambiguity gets detected. `generateTrainingPlan` archives the previous plan
 * before inserting a new one, so more than one active row means something went
 * wrong upstream and deserves a log line rather than a silent pick.
 */
export async function getActivePlan(
  userId: string
): Promise<ActivePlan | null> {
  const rows = await db.query.trainingPlans.findMany({
    where: and(
      eq(schema.trainingPlans.userId, userId),
      eq(schema.trainingPlans.status, "active")
    ),
    // Postgres's now() is constant within a transaction, so a plan creation
    // retried inside one transaction can produce rows with identical
    // createdAt. `id` breaks that tie, matching the (created_at, id) tuple
    // migration 0034 uses to pick the same survivor.
    orderBy: [
      desc(schema.trainingPlans.createdAt),
      desc(schema.trainingPlans.id),
    ],
  });

  if (rows.length === 0) return null;

  if (rows.length > 1) {
    logger.warn("multiple active training plans", {
      userId,
      count: rows.length,
      chosen: rows[0].id,
    });
  }

  return rows[0];
}

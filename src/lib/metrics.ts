import { and, asc, eq, gte } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { logger } from "@/lib/logger";
import { BASELINE_WINDOW_DAYS, computeReadiness } from "@/lib/readiness";

function addDays(ymd: string, days: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * (Re)compute daily_metrics for every wellness day from `sinceDate` onward.
 * Baselines come from the trailing BASELINE_WINDOW_DAYS before each day, so
 * a change on day X requires recomputing X and everything after it — which
 * is exactly what callers do by passing the earliest changed date.
 */
export async function computeDailyMetrics(
  userId: string,
  sinceDate: string
): Promise<number> {
  const windowStart = addDays(sinceDate, -BASELINE_WINDOW_DAYS);

  const rows = await db.query.wellnessDaily.findMany({
    where: and(
      eq(schema.wellnessDaily.userId, userId),
      gte(schema.wellnessDaily.date, windowStart)
    ),
    orderBy: asc(schema.wellnessDaily.date),
  });

  const targets = rows.filter((r) => r.date >= sinceDate);
  let computed = 0;

  for (const day of targets) {
    const baselineFloor = addDays(day.date, -BASELINE_WINDOW_DAYS);
    const baseline = rows.filter(
      (r) => r.date < day.date && r.date >= baselineFloor
    );

    const result = computeReadiness({
      hrv: day.hrvMs,
      restingHr: day.restingHr,
      sleepScore: day.sleepScore,
      sleepSecs: day.sleepSecs,
      ctl: day.ctl,
      atl: day.atl,
      hrvBaseline: baseline
        .map((r) => r.hrvMs)
        .filter((v): v is number => v != null),
      rhrBaseline: baseline
        .map((r) => r.restingHr)
        .filter((v): v is number => v != null),
    });

    await db
      .insert(schema.dailyMetrics)
      .values({
        userId,
        date: day.date,
        readiness: result.readiness,
        band: result.band,
        componentScores: result.components,
        hrvBaselineMean: result.baselines.hrvLnMean,
        hrvBaselineSd: result.baselines.hrvLnSd,
        rhrBaselineMean: result.baselines.rhrMean,
        rhrBaselineSd: result.baselines.rhrSd,
        tsb: result.tsb,
        computedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [schema.dailyMetrics.userId, schema.dailyMetrics.date],
        set: {
          readiness: result.readiness,
          band: result.band,
          componentScores: result.components,
          hrvBaselineMean: result.baselines.hrvLnMean,
          hrvBaselineSd: result.baselines.hrvLnSd,
          rhrBaselineMean: result.baselines.rhrMean,
          rhrBaselineSd: result.baselines.rhrSd,
          tsb: result.tsb,
          computedAt: new Date(),
        },
      });
    computed++;
  }

  logger.info("daily metrics computed", { userId, sinceDate, computed });
  return computed;
}

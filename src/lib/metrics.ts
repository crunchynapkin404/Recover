import { and, asc, eq, gte, ne } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { logger } from "@/lib/logger";
import { BASELINE_WINDOW_DAYS, computeReadiness } from "@/lib/readiness";
import { isBaselineExcluded } from "@/lib/day-flags";
import {
  nativeLoadMetrics,
  resolveEffectiveLoad,
  type LoadActivity,
} from "@/lib/training-load";

function addDays(ymd: string, days: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// Local date, matching the engine's local-date activity buckets: a
// self-hosted server's "today" must not shift for timezones away from UTC.
function localYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Minimum wellness resting-HR samples before the HR load rung may use it. */
const MIN_RHR_SAMPLES = 7;

/**
 * (Re)compute daily_metrics for every relevant day from `sinceDate` onward.
 * Baselines come from the trailing BASELINE_WINDOW_DAYS before each day, so
 * a change on day X requires recomputing X and everything after it — which
 * is exactly what callers do by passing the earliest changed date.
 *
 * v0.10: days are the union of wellness days, activity days, and today —
 * an activity-only day still carries honest ctl/atl (native engine), and a
 * daily recompute refreshes today's EMA decay. Provider (intervals.icu)
 * ctl/atl win when present; native values fill the gaps, labelled
 * "computed".
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

  // Native load inputs: the full activity history (the EMA seeds at the
  // first activity ever), and the athlete's thresholds. Strava rows are
  // excluded: the stored ctl/atl and the readiness built on them are
  // injected into coach context and MCP tools, and the Nov-2024 Strava
  // agreement bars its API data from AI surfaces — aggregates included
  // (same rule as weekly-review). Dashboard-only sums (weekly rings) may
  // still count Strava; this series may not.
  const activityRows = await db.query.activities.findMany({
    where: and(
      eq(schema.activities.userId, userId),
      ne(schema.activities.provider, "strava")
    ),
    columns: {
      provider: true,
      startDate: true,
      durationS: true,
      load: true,
      avgHr: true,
      avgPower: true,
    },
  });
  const activities: LoadActivity[] = activityRows;

  const prefs = await db.query.bodyPrefs.findFirst({
    where: eq(schema.bodyPrefs.userId, userId),
  });
  const rhrSamples = rows
    .map((r) => r.restingHr)
    .filter((v): v is number => v != null && v > 0);
  const restingHr =
    rhrSamples.length >= MIN_RHR_SAMPLES
      ? rhrSamples.reduce((a, b) => a + b, 0) / rhrSamples.length
      : null;

  const today = localYmd(new Date());
  const targetDates = new Set<string>();
  for (const r of rows) if (r.date >= sinceDate) targetDates.add(r.date);
  for (const a of activities) {
    const d = localYmd(a.startDate);
    if (d >= sinceDate && d <= today) targetDates.add(d);
  }
  if (today >= sinceDate) targetDates.add(today);

  const upToDate = [...targetDates].sort().at(-1) ?? today;
  const native = nativeLoadMetrics(
    activities,
    {
      ftpWatts: prefs?.ftpWatts ?? null,
      maxHr: prefs?.maxHr ?? null,
      restingHr,
    },
    upToDate
  );

  const byDate = new Map(rows.map((r) => [r.date, r]));
  let computed = 0;

  for (const date of [...targetDates].sort()) {
    const day = byDate.get(date);
    const baselineFloor = addDays(date, -BASELINE_WINDOW_DAYS);
    // Flagged days (ill/travel/altitude) are excluded from the baseline the
    // athlete is measured against — five days of flu must not drag the
    // 60-day reference down for the next two months. Exclusion happens here,
    // where the baseline array is assembled: computeReadiness takes plain
    // numbers and has no idea where they came from.
    //
    // Note this governs baseline MEMBERSHIP only. `day` itself is still
    // scored below regardless of its flags — an ill day should read red;
    // it just shouldn't redefine "normal".
    const baseline = rows.filter(
      (r) =>
        r.date < date &&
        r.date >= baselineFloor &&
        !isBaselineExcluded(r.dayFlags)
    );

    const effective = resolveEffectiveLoad(
      { ctl: day?.ctl ?? null, atl: day?.atl ?? null },
      native.get(date)
    );

    const result = computeReadiness({
      hrv: day?.hrvMs ?? null,
      restingHr: day?.restingHr ?? null,
      sleepScore: day?.sleepScore ?? null,
      sleepSecs: day?.sleepSecs ?? null,
      ctl: effective.ctl,
      atl: effective.atl,
      hrvBaseline: baseline
        .map((r) => r.hrvMs)
        .filter((v): v is number => v != null),
      rhrBaseline: baseline
        .map((r) => r.restingHr)
        .filter((v): v is number => v != null),
    });

    const values = {
      readiness: result.readiness,
      band: result.band,
      componentScores: result.components,
      hrvBaselineMean: result.baselines.hrvLnMean,
      hrvBaselineSd: result.baselines.hrvLnSd,
      rhrBaselineMean: result.baselines.rhrMean,
      rhrBaselineSd: result.baselines.rhrSd,
      tsb: result.tsb,
      ctl: effective.ctl,
      atl: effective.atl,
      loadSource: effective.source,
      computedAt: new Date(),
    };

    await db
      .insert(schema.dailyMetrics)
      .values({ userId, date, ...values })
      .onConflictDoUpdate({
        target: [schema.dailyMetrics.userId, schema.dailyMetrics.date],
        set: values,
      });
    computed++;

    // v0.20 outbound webhooks — fire only for the live "today" row, never
    // for a historical backfill recompute (CSV import, or a multi-day
    // incremental catch-up after downtime): those touch many past dates in
    // this same loop and firing for each would replay months of events at
    // a subscriber. Guarded like every other post-write side effect in
    // this codebase (see scheduler.ts's morning-insight/push/weekly-review
    // blocks) — a webhook failure must never break metrics computation.
    if (date === today) {
      try {
        const { dispatchWebhook } = await import("@/lib/webhooks/dispatch");
        const prevDay = await db.query.dailyMetrics.findFirst({
          where: and(
            eq(schema.dailyMetrics.userId, userId),
            eq(schema.dailyMetrics.date, addDays(date, -1))
          ),
          columns: { band: true },
        });
        await dispatchWebhook(userId, "readiness_computed", {
          date,
          readiness: result.readiness,
          band: result.band,
        });
        // band_changed only when a prior day's band is known and differs —
        // computeReadiness (lib/readiness.ts) is the sole source of the
        // band value itself; this just diffs its output day-over-day.
        if (prevDay?.band && prevDay.band !== result.band) {
          await dispatchWebhook(userId, "band_changed", {
            date,
            from: prevDay.band,
            to: result.band,
            readiness: result.readiness,
          });
        }
      } catch (err) {
        logger.error("webhook dispatch failed after metrics compute", {
          userId,
          date,
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  logger.info("daily metrics computed", { userId, sinceDate, computed });
  return computed;
}

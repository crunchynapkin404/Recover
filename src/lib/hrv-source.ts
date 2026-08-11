/**
 * Which HRV metric scores a day, and against which baseline.
 *
 * The athlete's HRV can arrive as either rMSSD (`wellness_daily.hrv_ms`,
 * from intervals.icu's direct device integration) or SDNN
 * (`wellness_daily.hrv_sdnn_ms`, relayed through Apple Health by the
 * intervals.icu Companion). They are separate calculations over the same
 * beats, not one value under two names — on this instance they correlate at
 * only r = 0.67 and differ by up to 67% on a given night.
 *
 * So a value is only ever z-scored against a baseline built from its own
 * metric. Same rule, and the same reason, as `resolveEffectiveLoad` in
 * training-load.ts: "Pairs are never mixed — CTL and ATL from different
 * series make a fictional TSB."
 *
 * Pure: no db, no I/O. `computeDailyMetrics` calls it and persists the
 * chosen metric as `daily_metrics.hrv_metric`; the Today tile reads that
 * stored decision rather than re-deriving it.
 */
import { MIN_BASELINE_DAYS } from "@/lib/readiness";

export type HrvMetric = "rmssd" | "sdnn";

export interface HrvCandidate {
  /** Today's reading for this metric (null = not measured). */
  value: number | null;
  /** Trailing window, today excluded, day-flag exclusions already applied. */
  baseline: number[];
}

export interface EffectiveHrv {
  value: number | null;
  baseline: number[];
  metric: HrvMetric | null;
}

function pick(c: HrvCandidate, metric: HrvMetric): EffectiveHrv | null {
  if (c.value == null || c.value <= 0) return null;
  const baseline = c.baseline.filter((v) => v > 0);
  if (baseline.length < MIN_BASELINE_DAYS) return null;
  return { value: c.value, baseline, metric };
}

/**
 * rMSSD wins when it is present and calibrated; SDNN fills the gap; neither
 * yields a null metric and no HRV component at all (readiness then
 * renormalizes over its remaining components, exactly as before).
 *
 * Source: Invented. rMSSD is preferred because it is the metric this
 * athlete's history is denominated in and the one the readiness engine's
 * log-normal treatment was designed against — not because literature ranks
 * it above SDNN for recovery. Confidence: Low.
 */
export function resolveEffectiveHrv(
  rmssd: HrvCandidate,
  sdnn: HrvCandidate
): EffectiveHrv {
  return (
    pick(rmssd, "rmssd") ??
    pick(sdnn, "sdnn") ?? { value: null, baseline: [], metric: null }
  );
}

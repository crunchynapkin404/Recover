/**
 * Deterministic overtraining detection over stored wellness + baselines.
 * Pure math — the LLM only phrases the result, never decides it.
 * Thresholds per docs/specs/2026-07-15-v0.4b-proactive-engine-design.md.
 */
import { and, desc, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";

export interface WellnessDayInput {
  date: string;
  hrvMs: number | null;
  restingHr: number | null;
}

export interface BaselineInput {
  hrvLnMean: number | null;
  hrvLnSd: number | null;
  rhrMean: number | null;
  rhrSd: number | null;
}

export type OvertrainingSignal =
  | { kind: "hrv_suppression"; sinceDays: number }
  | { kind: "rhr_spike"; sinceDays: number };

export const MIN_HISTORY_DAYS = 21;
const HRV_SUPPRESSION_DAYS = 7;
const RHR_SPIKE_BPM = 10;
const RHR_WINDOW = 3;

export function detectOvertraining(
  days: WellnessDayInput[],
  baseline: BaselineInput
): OvertrainingSignal | null {
  if (days.length < MIN_HISTORY_DAYS) return null;
  const sorted = [...days].sort((a, b) => a.date.localeCompare(b.date));

  // HRV suppression: trailing run of days below the ln-band lower bound.
  if (baseline.hrvLnMean != null && baseline.hrvLnSd != null) {
    const low = baseline.hrvLnMean - baseline.hrvLnSd;
    let run = 0;
    for (let i = sorted.length - 1; i >= 0; i--) {
      const hrv = sorted[i].hrvMs;
      if (hrv == null || hrv <= 0 || Math.log(hrv) >= low) break;
      run++;
    }
    if (run >= HRV_SUPPRESSION_DAYS) {
      return { kind: "hrv_suppression", sinceDays: run };
    }
  }

  // RHR spike: mean of the last 3 recorded resting HRs ≥ baseline + 10 bpm.
  if (baseline.rhrMean != null) {
    const recent = sorted
      .map((d) => d.restingHr)
      .filter((v): v is number => v != null)
      .slice(-RHR_WINDOW);
    if (recent.length === RHR_WINDOW) {
      const mean = recent.reduce((s, v) => s + v, 0) / RHR_WINDOW;
      if (mean >= baseline.rhrMean + RHR_SPIKE_BPM) {
        return { kind: "rhr_spike", sinceDays: RHR_WINDOW };
      }
    }
  }

  return null;
}

/** Load the trailing window + latest baselines and run detection. */
export async function getOvertrainingStatus(
  userId: string
): Promise<OvertrainingSignal | null> {
  const [wellness, metric] = await Promise.all([
    db.query.wellnessDaily.findMany({
      where: eq(schema.wellnessDaily.userId, userId),
      orderBy: desc(schema.wellnessDaily.date),
      limit: MIN_HISTORY_DAYS,
      columns: { date: true, hrvMs: true, restingHr: true },
    }),
    db.query.dailyMetrics.findFirst({
      where: and(eq(schema.dailyMetrics.userId, userId)),
      orderBy: desc(schema.dailyMetrics.date),
    }),
  ]);
  if (!metric) return null;
  return detectOvertraining(wellness, {
    hrvLnMean: metric.hrvBaselineMean,
    hrvLnSd: metric.hrvBaselineSd,
    rhrMean: metric.rhrBaselineMean,
    rhrSd: metric.rhrBaselineSd,
  });
}

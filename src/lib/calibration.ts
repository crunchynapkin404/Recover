/**
 * Calibration progress (v0.11 first-run) — turns the bare `calibrating`
 * band into an honest "day N of 14" state. Readiness needs
 * MIN_BASELINE_DAYS of HRV *or* resting-HR history before it can score, so
 * progress is the count of days that actually carry one of those signals —
 * not merely days since signup, which would overcount empty days.
 */
import { MIN_BASELINE_DAYS } from "@/lib/readiness";

export const CALIBRATION_TARGET_DAYS = MIN_BASELINE_DAYS;

export interface CalibrationProgress {
  /** Days with a usable readiness signal, capped at the target. */
  daysWithSignal: number;
  target: number;
  /** Days still needed before readiness can score. */
  remaining: number;
  /** A short, honest next-step prompt for the first fortnight. */
  prompt: string;
}

export function calibrationProgress(
  days: Array<{ hrvMs: number | null; restingHr: number | null }>
): CalibrationProgress {
  const withSignal = days.filter(
    (d) =>
      (d.hrvMs != null && d.hrvMs > 0) ||
      (d.restingHr != null && d.restingHr > 0)
  ).length;
  const daysWithSignal = Math.min(withSignal, CALIBRATION_TARGET_DAYS);
  const remaining = Math.max(0, CALIBRATION_TARGET_DAYS - withSignal);

  let prompt: string;
  if (withSignal === 0) {
    prompt =
      "Log your first morning HRV or resting heart rate to start calibrating.";
  } else if (remaining > 7) {
    prompt = `Keep logging each morning — ${remaining} more days until your readiness score unlocks.`;
  } else if (remaining > 0) {
    prompt = `Almost there — ${remaining} more day${remaining === 1 ? "" : "s"} of morning readings and your score goes live.`;
  } else {
    prompt = "Calibration complete — your readiness score is live.";
  }

  return { daysWithSignal, target: CALIBRATION_TARGET_DAYS, remaining, prompt };
}

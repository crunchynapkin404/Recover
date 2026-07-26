import { logger } from "@/lib/logger";

/**
 * Fires whenever wellness data that could affect today's readiness may
 * have changed — a provider sync completing, an Apple Health push, or a
 * manual wellness entry. Callers are responsible for their own
 * daily_metrics recompute first (each already does); this only decides
 * whether today's plan adaptation / morning brief / readiness push should
 * now run. Never throws — every step is independently guarded so one
 * failure can't suppress the others or propagate to the caller's own
 * write path.
 *
 * The morning-brief/push half of this also has an earliest-hour floor
 * (04:00 local, non-forced calls only) — see the check inline below.
 */
export async function onWellnessDataChanged(
  userId: string,
  opts?: { force?: boolean; now?: Date }
): Promise<"fired" | "skipped"> {
  try {
    const { runDailyAdaptation } = await import("@/lib/week-plan/service");
    await runDailyAdaptation(userId, opts?.now);
  } catch (err) {
    logger.error("daily plan adaptation failed", {
      userId,
      message: err instanceof Error ? err.message : String(err),
    });
  }

  // Earliest-hour floor for the non-forced path only: Apple Health Auto
  // Export pushes roughly hourly and HealthKit's overnight HRV samples are
  // timestamped after midnight, so an unforced trigger can land as early as
  // ~00:30 — before there's enough data for an honest brief, and long before
  // the athlete is awake to see it — burning the day's one brief/push slot
  // on the least data available all day. Mirrors maybeSendMorningReadinessPush's
  // own lower bound (push.ts: `if (hour < 4 || hour >= 12) return false`).
  // The forced 09:00 backstop path is unaffected, since BACKSTOP_HOUR (9) is
  // always past 4.
  if (!opts?.force && (opts?.now ?? new Date()).getHours() < 4) {
    return "skipped";
  }

  let outcome: "fired" | "skipped" = "skipped";
  try {
    const { generateMorningInsight } = await import("@/lib/morning-insight");
    const result = await generateMorningInsight(userId, {
      now: opts?.now,
      force: opts?.force,
    });
    if (result !== "skipped") outcome = "fired";
  } catch (err) {
    logger.error("morning insight failed", {
      userId,
      message: err instanceof Error ? err.message : String(err),
    });
  }

  try {
    const { maybeSendMorningReadinessPush } = await import("@/lib/push");
    await maybeSendMorningReadinessPush(userId, opts?.now);
  } catch (err) {
    logger.error("morning push hook failed", {
      userId,
      message: err instanceof Error ? err.message : String(err),
    });
  }

  return outcome;
}

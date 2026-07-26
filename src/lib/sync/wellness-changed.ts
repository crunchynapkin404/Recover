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

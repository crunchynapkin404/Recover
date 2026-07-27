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
 * The morning-brief/push half also has two guards, both non-forced-only:
 * an earliest-hour floor (04:00 local) and a completeness gate (last
 * night's HRV and sleep must both have arrived). See inline below.
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

  // Completeness gate (2026-07-26): last night's HRV and sleep carry 60% of
  // the readiness weight between them (0.40 + 0.20), and the engine happily
  // produces a confident-looking score without either — on 2026-07-26 that
  // put out "readiness 67, green, go hard" at 08:21 from resting HR alone,
  // which the completed data later read as 58, amber. Wait for the real
  // measurement instead. The forced path (09:00 backstop) deliberately
  // bypasses this and says what's missing in the brief itself.
  if (!opts?.force) {
    try {
      const { db, schema } = await import("@/lib/db");
      const { and, eq } = await import("drizzle-orm");
      const { arrivalFromWellness, overnightComplete } =
        await import("@/lib/brief-completeness");
      const d = opts?.now ?? new Date();
      const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      const row = await db.query.wellnessDaily.findFirst({
        where: and(
          eq(schema.wellnessDaily.userId, userId),
          eq(schema.wellnessDaily.date, today)
        ),
      });
      if (!overnightComplete(arrivalFromWellness(row))) return "skipped";
    } catch (err) {
      // Fail closed: if we can't confirm completeness, don't fire — the
      // whole point of this gate is to avoid a confident-looking brief
      // built on data we can't vouch for.
      logger.error("completeness gate check failed", {
        userId,
        message: err instanceof Error ? err.message : String(err),
      });
      return "skipped";
    }
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

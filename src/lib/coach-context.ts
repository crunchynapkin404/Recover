/**
 * Pre-fetch athlete context for LLM providers that can't use tool calling
 * (e.g. small Ollama models). This injects real data into the system prompt
 * so the coach has ground truth without needing to make tool calls.
 */

import { and, desc, eq, gte, ne } from "drizzle-orm";
import type { Database } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import { calibrationProgress } from "@/lib/calibration";
import { unavailableMessage } from "@/components/ui/unavailable";
import { logger } from "@/lib/logger";

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

export async function fetchAthleteContext(
  userId: string,
  db: Database
): Promise<string> {
  const [metrics, wellness7, activities] = await Promise.all([
    db.query.dailyMetrics.findMany({
      where: and(
        eq(schema.dailyMetrics.userId, userId),
        gte(schema.dailyMetrics.date, daysAgo(7))
      ),
      orderBy: desc(schema.dailyMetrics.date),
      limit: 7,
    }),
    db.query.wellnessDaily.findMany({
      where: and(
        eq(schema.wellnessDaily.userId, userId),
        gte(schema.wellnessDaily.date, daysAgo(7))
      ),
      orderBy: desc(schema.wellnessDaily.date),
      limit: 7,
    }),
    db.query.activities.findMany({
      // Strava rows never reach LLM context (Strava API AI clause).
      where: and(
        eq(schema.activities.userId, userId),
        ne(schema.activities.provider, "strava")
      ),
      orderBy: desc(schema.activities.startDate),
      limit: 5,
    }),
  ]);

  const latest = metrics.find((m) => m.readiness != null);
  const latestWellness =
    wellness7.find(
      (w) => w.hrvMs != null || w.restingHr != null || w.sleepSecs != null
    ) ?? wellness7[0];

  const lines: string[] = [
    "## ATHLETE DATA SNAPSHOT (real, verified — do NOT override or invent different numbers)",
    "",
  ];

  if (latest) {
    const cs = latest.componentScores as Record<string, number | null> | null;
    lines.push(
      `**Readiness:** ${latest.readiness}/100 (band: ${latest.band}) — ${latest.date}`
    );
    if (cs) {
      lines.push(
        `**Components:** HRV ${cs.hrv != null ? Math.round(cs.hrv) : "—"}/100, ` +
          `RHR ${cs.rhr != null ? Math.round(cs.rhr) : "—"}/100, ` +
          `Sleep ${cs.sleep != null ? Math.round(cs.sleep) : "—"}/100, ` +
          `Form ${cs.form != null ? Math.round(cs.form) : "—"}/100`
      );
    }
  } else {
    // Fail closed on a query error: the most conservative reading
    // (calibrating, zero days) rather than throwing into a coach reply.
    // 90 days, matching Today hero's and Body Battery's own
    // calibrationProgress() callers (page.tsx, body/page.tsx) — not
    // wellness7 above (a 7-day window used for unrelated trend lines) and
    // not just the 14-day target, which would undercount an
    // already-calibrated athlete with an ordinary gap in the last two weeks.
    let calibrationWindow: Awaited<
      ReturnType<typeof db.query.wellnessDaily.findMany>
    > = [];
    try {
      calibrationWindow = await db.query.wellnessDaily.findMany({
        where: and(
          eq(schema.wellnessDaily.userId, userId),
          gte(schema.wellnessDaily.date, daysAgo(90))
        ),
      });
    } catch (err) {
      logger.error("readiness-calibration read failed", {
        userId,
        message: err instanceof Error ? err.message : String(err),
      });
    }
    const calibration = calibrationProgress(
      calibrationWindow.map((w) => ({
        hrvMs: w.hrvMs,
        restingHr: w.restingHr,
        hrvSdnnMs: w.hrvSdnnMs,
      }))
    );
    lines.push(
      `**Readiness:** ${unavailableMessage(
        calibration.remaining > 0
          ? {
              kind: "calibrating",
              have: calibration.daysWithSignal,
              need: calibration.target,
              unit: "days",
            }
          : { kind: "missing_input", needs: "a readiness score today" }
      )}`
    );
  }

  if (latestWellness) {
    lines.push(
      `**Latest wellness (${latestWellness.date}):** ` +
        `HRV ${latestWellness.hrvMs != null ? Math.round(latestWellness.hrvMs) + "ms" : "—"}, ` +
        `RHR ${latestWellness.restingHr != null ? Math.round(latestWellness.restingHr) + "bpm" : "—"}, ` +
        `Sleep ${latestWellness.sleepSecs != null ? (latestWellness.sleepSecs / 3600).toFixed(1) + "h" : "—"}`
    );
  }

  // The resolved figure (provider value, or the native engine's honest
  // computation when there's no intervals.icu sync) — not
  // latestWellness.ctl/atl, which is picked above for HRV/RHR/sleep
  // presence and would be null for a manual-only or Strava-only athlete
  // even on a day `metrics` has a real resolved number. See
  // docs/specs/2026-08-10-ctl-atl-tsb-readiness-ownership-design.md.
  const latestLoad = metrics.find((m) => m.ctl != null && m.atl != null);
  if (latestLoad?.ctl != null && latestLoad.atl != null) {
    const ctl = latestLoad.ctl;
    const atl = latestLoad.atl;
    const tsb = ctl - atl;
    lines.push(
      `**Training Load:** CTL=${ctl.toFixed(0)} (fitness), ATL=${atl.toFixed(0)} (fatigue), ` +
        `TSB=${tsb.toFixed(0)} (form: ${tsb > 5 ? "fresh" : tsb > -10 ? "neutral" : tsb > -25 ? "fatigued — reduce load" : "overtrained — rest now"})`
    );
    lines.push(
      `**NOTE: TSB is ${tsb.toFixed(0)}, NOT a percentage. Negative = accumulated fatigue. ` +
        `Do NOT confuse TSB with component scores (which are 0-100).**`
    );
  }

  if (wellness7.length > 1) {
    const hrvs = wellness7.filter((w) => w.hrvMs != null).map((w) => w.hrvMs!);
    const rhrs = wellness7
      .filter((w) => w.restingHr != null)
      .map((w) => w.restingHr!);
    if (hrvs.length > 0) {
      lines.push(
        `**7-day HRV trend:** ${hrvs.map((v) => Math.round(v)).join(", ")} ms (newest first)`
      );
    }
    if (rhrs.length > 0) {
      lines.push(
        `**7-day RHR trend:** ${rhrs.map((v) => Math.round(v)).join(", ")} bpm (newest first)`
      );
    }
  }

  if (activities.length > 0) {
    lines.push("", "**Recent activities:**");
    for (const a of activities) {
      const dur = a.durationS
        ? `${Math.floor(a.durationS / 3600)}h${Math.round((a.durationS % 3600) / 60)}m`
        : "—";
      lines.push(
        `- ${a.name ?? a.sport} (${a.sport}) on ${(a.startDateLocal ?? a.startDate).toISOString().slice(0, 10)}: ${dur}, load ${a.load != null ? Math.round(a.load) : "—"}`
      );
    }
  }

  lines.push(
    "",
    "**IMPORTANT: The numbers above are the athlete's REAL data. Do NOT invent different values. If asked about data not shown here, say you don't have that information.**"
  );

  return lines.join("\n");
}

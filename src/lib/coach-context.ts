/**
 * Pre-fetch athlete context for LLM providers that can't use tool calling
 * (e.g. small Ollama models). This injects real data into the system prompt
 * so the coach has ground truth without needing to make tool calls.
 */

import { and, desc, eq, gte } from "drizzle-orm";
import type { Database } from "@/lib/db";
import * as schema from "@/lib/db/schema";

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
      where: eq(schema.activities.userId, userId),
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
    lines.push("**Readiness:** Calibrating (needs 14+ days of data)");
  }

  if (latestWellness) {
    lines.push(
      `**Latest wellness (${latestWellness.date}):** ` +
        `HRV ${latestWellness.hrvMs != null ? Math.round(latestWellness.hrvMs) + "ms" : "—"}, ` +
        `RHR ${latestWellness.restingHr != null ? Math.round(latestWellness.restingHr) + "bpm" : "—"}, ` +
        `Sleep ${latestWellness.sleepSecs != null ? (latestWellness.sleepSecs / 3600).toFixed(1) + "h" : "—"}`
    );
    const ctl = latestWellness.ctl;
    const atl = latestWellness.atl;
    if (ctl != null && atl != null) {
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
        `- ${a.name ?? a.sport} (${a.sport}) on ${a.startDate.toISOString().slice(0, 10)}: ${dur}, load ${a.load != null ? Math.round(a.load) : "—"}`
      );
    }
  }

  lines.push(
    "",
    "**IMPORTANT: The numbers above are the athlete's REAL data. Do NOT invent different values. If asked about data not shown here, say you don't have that information.**"
  );

  return lines.join("\n");
}

import { z } from "zod";
import { and, eq, gte, desc } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import { biologicalAge } from "@/lib/biological-age";
import { bpTrend } from "@/lib/blood-pressure";
import { sleepConsistency, type SleepNight } from "@/lib/sleep-insights";
import type { ToolDefinition, ToolContext } from "./registry";

const parameters = z.object({});

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

async function execute(_args: z.infer<typeof parameters>, ctx: ToolContext) {
  const [rows, wellness, prefs] = await Promise.all([
    ctx.db.query.biomarkers.findMany({
      where: eq(schema.biomarkers.userId, ctx.userId),
      orderBy: desc(schema.biomarkers.measuredAt),
    }),
    ctx.db.query.wellnessDaily.findMany({
      where: and(
        eq(schema.wellnessDaily.userId, ctx.userId),
        gte(schema.wellnessDaily.date, daysAgo(90))
      ),
      orderBy: schema.wellnessDaily.date,
    }),
    ctx.db.query.bodyPrefs.findFirst({
      where: eq(schema.bodyPrefs.userId, ctx.userId),
    }),
  ]);

  // Latest value + prior per biomarker for a simple trend.
  const byName = new Map<string, typeof rows>();
  for (const b of rows) {
    const list = byName.get(b.name) ?? [];
    list.push(b);
    byName.set(b.name, list);
  }
  const biomarkers = [...byName.values()].map((list) => {
    const sorted = [...list].sort((a, b) =>
      b.measuredAt.localeCompare(a.measuredAt)
    );
    const cur = sorted[0];
    const prev = sorted[1];
    const trend =
      prev == null
        ? "no_prior"
        : cur.value > prev.value
          ? "up"
          : cur.value < prev.value
            ? "down"
            : "flat";
    return {
      name: cur.displayName,
      value: cur.value,
      unit: cur.unit,
      measured_at: cur.measuredAt,
      trend,
    };
  });

  const trend = bpTrend(
    wellness.map((w) => ({
      date: w.date,
      systolic: w.systolic,
      diastolic: w.diastolic,
    }))
  );

  const latestWellness = [...wellness]
    .reverse()
    .find((w) => w.restingHr != null || w.hrvMs != null);
  const nights: SleepNight[] = wellness
    .filter((w) => w.date >= daysAgo(30))
    .map((w) => ({
      date: w.date,
      sleepSecs: w.sleepSecs,
      sleepDeepSecs: w.sleepDeepSecs,
      sleepRemSecs: w.sleepRemSecs,
      sleepLightSecs: w.sleepLightSecs,
      sleepAwakeSecs: w.sleepAwakeSecs,
      bedStart: w.bedStart,
      bedEnd: w.bedEnd,
    }));
  const consistency = sleepConsistency(nights);
  const latestBodyFat = [...wellness]
    .reverse()
    .find((w) => w.bodyFatPct != null)?.bodyFatPct;

  const bioAge = biologicalAge({
    chronologicalAge:
      prefs?.birthYear != null
        ? new Date().getFullYear() - prefs.birthYear
        : null,
    restingHr: latestWellness?.restingHr ?? null,
    hrvMs: latestWellness?.hrvMs ?? null,
    sleepConsistency: consistency?.score ?? null,
    vo2max:
      [...wellness].reverse().find((w) => w.vo2max != null)?.vo2max ?? null,
    bodyFatPct: latestBodyFat ?? null,
  });

  return {
    biomarkers,
    blood_pressure: trend
      ? {
          latest: `${trend.latest.systolic}/${trend.latest.diastolic}`,
          category: trend.latest.category,
          direction: trend.direction,
          readings: trend.readings,
        }
      : null,
    biological_age:
      "insufficient" in bioAge
        ? { status: "insufficient", missing: bioAge.missing }
        : { bio_age: bioAge.bioAge, delta_years: bioAge.deltaYears },
    disclaimer:
      "Surface trends and reference bands only. Do not diagnose or recommend treatment; suggest the athlete consult a clinician for anything abnormal.",
  };
}

export const getBiomarkers: ToolDefinition<typeof parameters> = {
  name: "get_biomarkers",
  description:
    "Get the athlete's latest blood biomarkers (with a simple up/down/flat trend), blood-pressure classification and direction, and biological-age estimate. Reference trends and guideline bands only — NEVER diagnose, NEVER recommend treatment or supplements; for anything abnormal, advise seeing a clinician.",
  parameters,
  execute,
};

import { and, eq, gte, desc } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { AppShell } from "@/components/app-shell";
import { HealthUpload } from "@/components/health/health-upload";
import { HealthManualEntry } from "@/components/health/health-manual-entry";
import {
  BiomarkerList,
  type BiomarkerRow,
} from "@/components/health/biomarker-list";
import { BioAgeCard } from "@/components/health/bio-age-card";
import { BloodPressureCard } from "@/components/health/blood-pressure-card";
import { biologicalAge } from "@/lib/biological-age";
import { bpTrend } from "@/lib/blood-pressure";
import { sleepConsistency, type SleepNight } from "@/lib/sleep-insights";
import type { BiomarkerCategory } from "@/lib/health-records";

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

export default async function HealthPage() {
  const user = await requireUser();

  const [biomarkerRows, wellness, prefs] = await Promise.all([
    db.query.biomarkers.findMany({
      where: eq(schema.biomarkers.userId, user.id),
      orderBy: desc(schema.biomarkers.measuredAt),
    }),
    db.query.wellnessDaily.findMany({
      where: and(
        eq(schema.wellnessDaily.userId, user.id),
        gte(schema.wellnessDaily.date, daysAgo(90))
      ),
      orderBy: schema.wellnessDaily.date,
    }),
    db.query.bodyPrefs.findFirst({
      where: eq(schema.bodyPrefs.userId, user.id),
    }),
  ]);

  // Latest value per biomarker + the prior one for a direction arrow.
  const byName = new Map<string, typeof biomarkerRows>();
  for (const b of biomarkerRows) {
    const list = byName.get(b.name) ?? [];
    list.push(b);
    byName.set(b.name, list);
  }
  const latest: BiomarkerRow[] = [];
  for (const list of byName.values()) {
    const sorted = [...list].sort((a, b) =>
      b.measuredAt.localeCompare(a.measuredAt)
    );
    const cur = sorted[0];
    latest.push({
      name: cur.name,
      displayName: cur.displayName,
      category: cur.category as BiomarkerCategory,
      value: cur.value,
      unit: cur.unit,
      measuredAt: cur.measuredAt,
      source: cur.source,
      prevValue: sorted[1]?.value ?? null,
    });
  }

  // Blood-pressure trend from wellness readings.
  const trend = bpTrend(
    wellness.map((w) => ({
      date: w.date,
      systolic: w.systolic,
      diastolic: w.diastolic,
    }))
  );

  // Biological-age inputs from the honest, already-computed signals.
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
    vo2max: null, // no provider wired for VO2max yet (v0.11 doesn't carry it)
    bodyFatPct: latestBodyFat ?? null,
  });

  return (
    <AppShell>
      <header className="mb-8 pt-8">
        <h1 className="text-2xl font-bold tracking-tighter">Health</h1>
        <p className="mt-1 text-xs font-medium uppercase tracking-widest text-white/50">
          Bloodwork, blood pressure & biological age
        </p>
      </header>

      <div className="space-y-6 lg:grid lg:grid-cols-2 lg:items-start lg:gap-6 lg:space-y-0">
        <BioAgeCard result={bioAge} />
        <BloodPressureCard trend={trend} />
        <HealthUpload />
        <HealthManualEntry birthYear={prefs?.birthYear ?? null} />
        <div className="lg:col-span-2">
          <BiomarkerList rows={latest} />
        </div>
      </div>
    </AppShell>
  );
}

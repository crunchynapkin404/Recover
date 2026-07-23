import Link from "next/link";
import { and, desc, eq, gte } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { AppShell } from "@/components/app-shell";
import { BaselineTrendCard } from "@/components/body/baseline-trend-card";
import { SleepNightCard } from "@/components/body/sleep-night-card";
import { CorrelationRows } from "@/components/body/correlation-rows";
import { LabsTiles } from "@/components/body/labs-tiles";
import { BodyBatteryCurve } from "@/components/dashboard/body-battery";
import { MilestonesCard } from "@/components/dashboard/milestones-card";
import { JournalForm } from "@/components/journal/journal-form";
import { BioAgeCard } from "@/components/health/bio-age-card";
import { BloodPressureCard } from "@/components/health/blood-pressure-card";
import { HealthUpload } from "@/components/health/health-upload";
import { HealthManualEntry } from "@/components/health/health-manual-entry";
import {
  BiomarkerList,
  type BiomarkerRow,
} from "@/components/health/biomarker-list";
import { EmptyState } from "@/components/ui/empty-state";
import { baselineBandLn, baselineBandLinear } from "@/lib/charts";
import { computeTagInsights } from "@/lib/insights/correlations";
import { getMilestones } from "@/lib/insights/milestones";
import { biologicalAge } from "@/lib/biological-age";
import { bpTrend } from "@/lib/blood-pressure";
import {
  chronotype,
  sleepConsistency,
  stageBreakdown,
  type SleepNight,
} from "@/lib/sleep-insights";
import {
  computeBodyBattery,
  typicalBedMinutes,
  DEFAULT_WAKE_MINUTES,
  DEFAULT_BED_MINUTES,
} from "@/lib/body-battery";
import { computeSleepDebt, DEFAULT_SLEEP_NEED_SECS } from "@/lib/sleep-debt";
import { buildBodyHref, BODY_TABS, type BodyTab } from "@/lib/log-href";
import type { BiomarkerCategory } from "@/lib/health-records";
import type { DayFlag } from "@/lib/day-flags";
import { HeartPulse, Moon } from "lucide-react";

export const dynamic = "force-dynamic";

const RANGES = [30, 90, 180, 365];

const TAB_LABEL: Record<BodyTab, string> = {
  trends: "Trends",
  sleep: "Sleep",
  journal: "Journal",
  labs: "Labs",
};

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

/** "07:15" → 435; null for anything malformed, never NaN. */
function hhmmToMinutes(v: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(v.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

function minsToHhMm(mins: number): string {
  const m = ((Math.round(mins) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

export default async function BodyPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; range?: string }>;
}) {
  const user = await requireUser();
  const sp = await searchParams;
  const tab: BodyTab = BODY_TABS.find((t) => t === sp.tab) ?? "trends";
  const range = RANGES.includes(Number(sp.range)) ? Number(sp.range) : 90;
  const href = (over: { tab?: BodyTab; range?: number }) =>
    buildBodyHref({ tab, range }, over);

  // The streak chip is on every segment, so it's fetched once here.
  const milestones = await getMilestones(user.id);

  return (
    <AppShell>
      <header className="mb-5 pt-8">
        <div className="mb-4 flex items-start justify-between gap-3">
          <h1 className="text-[22px] font-bold tracking-[-0.03em]">Body</h1>
          {milestones.currentStreak > 0 && (
            <span className="shrink-0 rounded-full border border-emerald-500/30 bg-emerald-500/[0.08] px-3 py-1 text-[10.5px] font-bold text-emerald-400">
              Streak {milestones.currentStreak}d ✓
            </span>
          )}
        </div>
        <nav aria-label="Body sections" className="flex flex-wrap gap-1.5">
          {BODY_TABS.map((t) => (
            <Link
              key={t}
              href={href({ tab: t })}
              aria-current={t === tab ? "page" : undefined}
              className={`rounded-full px-4 py-1.5 text-[11px] font-bold transition-colors ${
                t === tab
                  ? "bg-white/[0.12] text-white"
                  : "bg-white/[0.04] text-white/50 hover:text-white/80"
              }`}
            >
              {TAB_LABEL[t]}
            </Link>
          ))}
        </nav>
      </header>

      {tab === "trends" ? (
        <TrendsTab userId={user.id} range={range} href={href} />
      ) : tab === "sleep" ? (
        <SleepTab userId={user.id} />
      ) : tab === "journal" ? (
        <JournalTab userId={user.id} milestones={milestones} />
      ) : (
        <LabsTab userId={user.id} />
      )}
    </AppShell>
  );
}

// ── Trends ────────────────────────────────────────────────────────────────

async function TrendsTab({
  userId,
  range,
  href,
}: {
  userId: string;
  range: number;
  href: (over: { tab?: BodyTab; range?: number }) => string;
}) {
  const wellness = await db.query.wellnessDaily.findMany({
    where: and(
      eq(schema.wellnessDaily.userId, userId),
      gte(schema.wellnessDaily.date, daysAgo(range))
    ),
    orderBy: schema.wellnessDaily.date,
  });

  // Baselines are the athlete's own, computed nightly into daily_metrics —
  // never a population norm.
  const baseline = await db.query.dailyMetrics.findFirst({
    where: eq(schema.dailyMetrics.userId, userId),
    orderBy: desc(schema.dailyMetrics.date),
  });

  const hrvBand =
    baseline?.hrvBaselineMean != null && baseline?.hrvBaselineSd != null
      ? baselineBandLn(baseline.hrvBaselineMean, baseline.hrvBaselineSd)
      : null;
  const rhrBand =
    baseline?.rhrBaselineMean != null && baseline?.rhrBaselineSd != null
      ? baselineBandLinear(baseline.rhrBaselineMean, baseline.rhrBaselineSd)
      : null;

  return (
    <div className="pb-10">
      <div className="mb-3 flex justify-end gap-1">
        {RANGES.map((r) => (
          <Link
            key={r}
            href={href({ range: r })}
            aria-current={r === range ? "true" : undefined}
            className={`rounded-full px-2.5 py-1 text-[10px] font-bold transition-colors ${
              r === range
                ? "bg-white/[0.12] text-white"
                : "bg-white/[0.04] text-white/45 hover:text-white/70"
            }`}
          >
            {r}d
          </Link>
        ))}
      </div>

      <BaselineTrendCard
        title="HRV vs baseline"
        values={wellness.map((w) => w.hrvMs)}
        band={hrvBand}
        color="#10b981"
        bandFill="rgba(16,185,129,0.08)"
        unit="ms"
      />
      <BaselineTrendCard
        title="Resting HR vs baseline"
        values={wellness.map((w) => w.restingHr)}
        band={rhrBand}
        color="#3b82f6"
        bandFill="rgba(59,130,246,0.08)"
        unit="bpm"
      />
      <BaselineTrendCard
        title="Weight"
        values={wellness.map((w) => w.weightKg)}
        band={null}
        color="#a78bfa"
        bandFill="transparent"
        unit="kg"
        decimals={1}
      />

      {wellness.length === 0 && (
        <EmptyState
          icon={HeartPulse}
          message="No wellness readings in this range yet."
        />
      )}
    </div>
  );
}

// ── Sleep ─────────────────────────────────────────────────────────────────

async function SleepTab({ userId }: { userId: string }) {
  const wellness = await db.query.wellnessDaily.findMany({
    where: and(
      eq(schema.wellnessDaily.userId, userId),
      gte(schema.wellnessDaily.date, daysAgo(90))
    ),
    orderBy: schema.wellnessDaily.date,
  });

  const prefs = await db.query.bodyPrefs.findFirst({
    where: eq(schema.bodyPrefs.userId, userId),
  });

  const nights: SleepNight[] = wellness.map((w) => ({
    date: w.date,
    sleepSecs: w.sleepSecs,
    sleepDeepSecs: w.sleepDeepSecs,
    sleepRemSecs: w.sleepRemSecs,
    sleepLightSecs: w.sleepLightSecs,
    sleepAwakeSecs: w.sleepAwakeSecs,
    bedStart: w.bedStart,
    bedEnd: w.bedEnd,
  }));

  const lastNight = [...nights].reverse().find((n) => n.sleepSecs != null);
  const stages = lastNight ? stageBreakdown(lastNight) : null;
  const consistency = sleepConsistency(
    nights.filter((n) => n.date >= daysAgo(30))
  );
  const chrono = chronotype(nights);

  const bedWindow =
    lastNight?.bedStart != null && lastNight?.bedEnd != null
      ? {
          start: minsToHhMm(
            lastNight.bedStart.getHours() * 60 + lastNight.bedStart.getMinutes()
          ),
          end: minsToHhMm(
            lastNight.bedEnd.getHours() * 60 + lastNight.bedEnd.getMinutes()
          ),
        }
      : null;

  // Recommended bedtime tonight — the same computation the sleep vital's
  // debt delta uses on Today, so the two can't disagree.
  const bedtimes = wellness
    .filter((w) => w.date >= daysAgo(14) && w.bedStart != null)
    .map((w) => w.bedStart!.getHours() * 60 + w.bedStart!.getMinutes());
  const debt = computeSleepDebt({
    nights: wellness
      .filter((w) => w.date >= daysAgo(14))
      .map((w) => ({ sleepSecs: w.sleepSecs })),
    sleepNeedSecs: prefs?.sleepNeedSecs ?? DEFAULT_SLEEP_NEED_SECS,
    wakeTime: prefs?.wakeTime ?? null,
    bedtimes,
  });

  // Body battery — modelled, and labelled as such by the component itself.
  const todayYmd = daysAgo(0);
  const todayActivities = await db.query.activities.findMany({
    where: and(
      eq(schema.activities.userId, userId),
      gte(schema.activities.startDate, new Date(`${todayYmd}T00:00:00`))
    ),
  });
  const todayMetric = await db.query.dailyMetrics.findFirst({
    where: eq(schema.dailyMetrics.userId, userId),
    orderBy: desc(schema.dailyMetrics.date),
  });
  // The waking window comes from the athlete's own schedule (wake time +
  // typical sleep need), never from tonight's debt-repayment bedtime — being
  // in debt must not silently compress the modelled day. A malformed
  // wakeTime degrades to the defaults instead of feeding NaN into the curve.
  const parsedWake = prefs?.wakeTime ? hhmmToMinutes(prefs.wakeTime) : null;
  const wakeMinutes = parsedWake ?? DEFAULT_WAKE_MINUTES;
  const bedMinutes =
    parsedWake != null
      ? typicalBedMinutes(
          wakeMinutes,
          prefs?.sleepNeedSecs ?? DEFAULT_SLEEP_NEED_SECS
        )
      : DEFAULT_BED_MINUTES;

  const now = new Date();
  const battery = computeBodyBattery({
    readiness: todayMetric?.readiness ?? null,
    wakeMinutes,
    bedMinutes,
    activities: todayActivities.map((a) => ({
      startMinutes: a.startDate.getHours() * 60 + a.startDate.getMinutes(),
      durationMin: (a.durationS ?? 0) / 60,
      load: a.load ?? 0,
    })),
    nowMinutes: now.getHours() * 60 + now.getMinutes(),
  });

  return (
    <div className="pb-10">
      <SleepNightCard
        totalSecs={lastNight?.sleepSecs ?? null}
        stages={
          stages
            ? {
                deepSecs: stages.deepSecs,
                remSecs: stages.remSecs,
                lightSecs: stages.lightSecs,
                awakeSecs: stages.awakeSecs,
              }
            : null
        }
        bedWindow={bedWindow}
        consistency={consistency?.score ?? null}
        chronotype={chrono ? `midpoint ${chrono.midpointHhMm}` : null}
        bedtimeTonight={debt.bedtime}
      />

      <BaselineTrendCard
        title="Sleep duration"
        values={wellness.map((w) =>
          w.sleepSecs != null ? w.sleepSecs / 3600 : null
        )}
        band={null}
        color="#3b82f6"
        bandFill="transparent"
        unit="h"
        decimals={1}
      />

      {wellness.some((w) => w.sleepScore != null) && (
        <BaselineTrendCard
          title="Sleep score"
          values={wellness.map((w) => w.sleepScore)}
          band={null}
          color="#8b5cf6"
          bandFill="transparent"
          unit=""
        />
      )}

      {battery.current != null && (
        <BodyBatteryCurve current={battery.current} points={battery.points} />
      )}

      {wellness.every((w) => w.sleepSecs == null) && (
        <EmptyState icon={Moon} message="No sleep data recorded yet." />
      )}
    </div>
  );
}

// ── Journal ───────────────────────────────────────────────────────────────

async function JournalTab({
  userId,
  milestones,
}: {
  userId: string;
  milestones: Awaited<ReturnType<typeof getMilestones>>;
}) {
  const latest = await db.query.wellnessDaily.findFirst({
    where: eq(schema.wellnessDaily.userId, userId),
    orderBy: desc(schema.wellnessDaily.date),
  });

  // Five days back so the form can restore a day the athlete missed.
  const recentEntries = await db.query.wellnessDaily.findMany({
    where: and(
      eq(schema.wellnessDaily.userId, userId),
      gte(schema.wellnessDaily.date, daysAgo(4))
    ),
    orderBy: desc(schema.wellnessDaily.date),
  });

  const entriesByDate: Record<
    string,
    {
      energy: number | null;
      soreness: number | null;
      stress: number | null;
      mood: string | null;
      tags: string[] | null;
      dayFlags: DayFlag[] | null;
      notes: string | null;
    }
  > = {};
  for (const entry of recentEntries) {
    entriesByDate[entry.date] = {
      energy: entry.energy1_10,
      soreness: entry.soreness1_10,
      stress: entry.stress1_10,
      mood: entry.mood,
      tags: entry.tags,
      dayFlags: entry.dayFlags,
      notes: entry.notes,
    };
  }

  const activeConnection = await db.query.connections.findFirst({
    where: and(
      eq(schema.connections.userId, userId),
      eq(schema.connections.status, "active")
    ),
    columns: { id: true },
  });

  const insights = await computeTagInsights(userId);
  const journalPrefsRow = await db.query.journalPrefs.findFirst({
    where: eq(schema.journalPrefs.userId, userId),
    columns: { usualBehaviorTags: true },
  });

  return (
    <div className="pb-10">
      <CorrelationRows insights={insights} />

      {/* The check-in itself becomes bottom-sheet 1h in step 6. Until then
          it lives here, so the athlete can still log a day. */}
      <JournalForm
        syncedHrv={latest?.hrvMs ?? null}
        syncedRhr={latest?.restingHr ?? null}
        syncedWeight={latest?.weightKg ?? null}
        syncedSleepHours={
          latest?.sleepSecs != null ? latest.sleepSecs / 3600 : null
        }
        streakDays={milestones.currentStreak}
        entriesByDate={entriesByDate}
        hasActiveConnection={!!activeConnection}
        usualTags={journalPrefsRow?.usualBehaviorTags ?? []}
      />

      <div className="mt-6">
        {/* The header chip and the journal form's ring both already carry the
            streak — this card shows the rest of the milestones only. */}
        <MilestonesCard {...milestones} hideStreak />
      </div>
    </div>
  );
}

// ── Labs ──────────────────────────────────────────────────────────────────

async function LabsTab({ userId }: { userId: string }) {
  const [biomarkerRows, wellness, prefs] = await Promise.all([
    db.query.biomarkers.findMany({
      where: eq(schema.biomarkers.userId, userId),
      orderBy: desc(schema.biomarkers.measuredAt),
    }),
    db.query.wellnessDaily.findMany({
      where: and(
        eq(schema.wellnessDaily.userId, userId),
        gte(schema.wellnessDaily.date, daysAgo(90))
      ),
      orderBy: schema.wellnessDaily.date,
    }),
    db.query.bodyPrefs.findFirst({
      where: eq(schema.bodyPrefs.userId, userId),
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
    bodyFatPct:
      [...wellness].reverse().find((w) => w.bodyFatPct != null)?.bodyFatPct ??
      null,
  });

  return (
    <div className="space-y-4 pb-10">
      <LabsTiles
        bioAge={bioAge}
        biomarkerCount={latest.length}
        lastDraw={biomarkerRows[0]?.measuredAt ?? null}
      />
      <BioAgeCard result={bioAge} hideHeadline />
      <BloodPressureCard trend={trend} />
      <HealthUpload />
      <HealthManualEntry birthYear={prefs?.birthYear ?? null} />
      <BiomarkerList rows={latest} />
    </div>
  );
}

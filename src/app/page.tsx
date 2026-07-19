import Link from "next/link";
import { and, desc, eq, gte, ne } from "drizzle-orm";
import { Sparkles, User } from "lucide-react";
import { db, schema } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { AppShell } from "@/components/app-shell";
import { PullToRefresh } from "@/components/dashboard/pull-to-refresh";
import { SyncChip } from "@/components/dashboard/sync-chip";
import { ScoreRing } from "@/components/dashboard/score-ring";
import { StrainBudget } from "@/components/dashboard/strain-budget";
import { MorningBrief } from "@/components/dashboard/morning-brief";
import { CoachInsight } from "@/components/dashboard/coach-insight";
import { getLatestMorningInsight } from "@/lib/morning-insight";
import { getLatestWeeklyReview } from "@/lib/weekly-review";
import { getOpenWeekPlan, listAdjustments } from "@/lib/week-plan/service";
import { TodayCard } from "@/components/plan/today-card";
import { WeekStrip } from "@/components/plan/week-strip";
import { VitalsGrid } from "@/components/dashboard/vitals-grid";
import { SleepCard } from "@/components/dashboard/sleep-card";
import { WeeklySummary } from "@/components/dashboard/weekly-summary";
import { BodyBatteryCurve } from "@/components/dashboard/body-battery";
import { BehaviorTags } from "@/components/dashboard/behavior-tags";
import { MilestonesCard } from "@/components/dashboard/milestones-card";
import { getMilestones } from "@/lib/insights/milestones";
import {
  RaceCountdownCard,
  type RaceCountdownProps,
} from "@/components/dashboard/race-countdown";
import { nextUpcomingRace, assembleForecastInputs } from "@/lib/race/service";
import { forecastForm } from "@/lib/race/forecast";
import type { Band } from "@/lib/readiness";
import { formatDay, formatDuration, formatKm } from "@/lib/format";
import {
  computeBodyBattery,
  typicalBedMinutes,
  DEFAULT_BED_MINUTES,
  DEFAULT_WAKE_MINUTES,
} from "@/lib/body-battery";
import { computeSleepDebt, DEFAULT_SLEEP_NEED_SECS } from "@/lib/sleep-debt";
import { sparkPath } from "@/lib/sparkline";
import {
  activityLoad,
  dedupeActivities,
  type AthleteThresholds,
} from "@/lib/training-load";
import {
  plannedWeekVolumeS,
  ringFraction,
  trailingWeeklyAverages,
} from "@/lib/weekly-targets";
import {
  calibrationProgress,
  CALIBRATION_TARGET_DAYS,
} from "@/lib/calibration";
import { CalibrationProgress } from "@/components/dashboard/calibration-progress";
import {
  stageBreakdown,
  sleepConsistency,
  chronotype,
  type SleepNight,
} from "@/lib/sleep-insights";
import { SleepStagesCard } from "@/components/dashboard/sleep-stages-card";
import { SleepQualityCard } from "@/components/dashboard/sleep-quality-card";

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

function greetingLine(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

function todayLabel(): string {
  return new Date().toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

/** Local "HH:MM" for a bed-window edge. */
function fmtClock(d: Date): string {
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function buildNarrative(
  hrvMs: number | null,
  restingHr: number | null,
  sleepHours: number | null,
  band: Band,
  strainBudget: number | null
): string {
  const parts: string[] = [];
  if (hrvMs != null)
    parts.push(
      `Your HRV is at ${Math.round(hrvMs)}ms${band === "green" ? " — a strong signal" : ""}.`
    );
  if (restingHr != null)
    parts.push(`Resting HR is ${Math.round(restingHr)} bpm.`);
  if (sleepHours != null)
    parts.push(
      `Sleep was ${sleepHours.toFixed(1)} hours${sleepHours >= 7 ? " with good recovery time" : ""}.`
    );
  if (band === "green")
    parts.push(
      strainBudget != null
        ? `You have a high strain budget today (${strainBudget.toFixed(1)}) — green light for intensity.`
        : `Green light for intensity.`
    );
  else if (band === "amber")
    parts.push(
      `Moderate readiness — consider a lighter session or zone-2 work.`
    );
  else if (band === "red")
    parts.push(`Take it easy today. Focus on recovery and mobility.`);
  else parts.push(`Still calibrating — keep logging and it'll dial in.`);
  return parts.join(" ");
}

export default async function DashboardPage() {
  const user = await requireUser();

  const connection = await db.query.connections.findFirst({
    where: and(
      eq(schema.connections.userId, user.id),
      eq(schema.connections.status, "active")
    ),
  });

  const allConnections = await db.query.connections.findMany({
    where: eq(schema.connections.userId, user.id),
    columns: { lastSyncAt: true },
  });
  const lastSyncAt =
    allConnections
      .map((c) => c.lastSyncAt)
      .filter((d): d is Date => d != null)
      .sort((a, b) => b.getTime() - a.getTime())[0]
      ?.toISOString() ?? null;

  const wellness = await db.query.wellnessDaily.findMany({
    where: and(
      eq(schema.wellnessDaily.userId, user.id),
      gte(schema.wellnessDaily.date, daysAgo(90))
    ),
    orderBy: schema.wellnessDaily.date,
  });

  const recentActivities = await db.query.activities.findMany({
    where: eq(schema.activities.userId, user.id),
    orderBy: desc(schema.activities.startDate),
    limit: 8,
  });

  const insight = await getLatestMorningInsight(user.id);
  const weeklyReview = await getLatestWeeklyReview(user.id);

  // v0.9.2 living week — today's slot + latest adjustment, or nothing.
  const weekPlan = await getOpenWeekPlan(user.id);
  const milestones = await getMilestones(user.id);
  const todayDate = new Date();
  const todayYmd = `${todayDate.getFullYear()}-${String(todayDate.getMonth() + 1).padStart(2, "0")}-${String(todayDate.getDate()).padStart(2, "0")}`;
  const todaySlot = weekPlan?.days.find((d) => d.date === todayYmd) ?? null;
  const todayAdjustment = weekPlan
    ? ((await listAdjustments(weekPlan.id))
        .filter((a) => a.date === todayYmd)
        .at(-1)?.reason ?? null)
    : null;

  // ── Next race (v0.14) ──────────────────────────────────────────────────
  // Form-only projection, never called "readiness" — HRV/RHR can't be
  // forecast, so band range is an honest form outlook, not a score.
  const race = await nextUpcomingRace(user.id, todayDate);
  let raceCard: RaceCountdownProps = {
    race: null,
    daysOut: null,
    outlook: null,
  };
  if (race) {
    const assembled = await assembleForecastInputs(user.id, race, todayDate);
    const outlook = !assembled
      ? ({ kind: "no_plan" } as const)
      : (() => {
          const f = forecastForm(assembled.inputs);
          return f.insufficient
            ? ({ kind: "insufficient" } as const)
            : ({
                kind: "projection",
                full: f.full,
                adherence: f.adherence,
                capped: f.capped,
              } as const);
        })();
    raceCard = {
      race: {
        name: race.name,
        date: race.date,
        priority: race.priority,
        goalNote: race.goalNote,
      },
      daysOut: Math.max(
        0,
        Math.round(
          (new Date(race.date + "T00:00:00").getTime() -
            new Date(todayYmd + "T00:00:00").getTime()) /
            86_400_000
        )
      ),
      outlook,
    };
  }

  const metrics = await db.query.dailyMetrics.findMany({
    where: and(
      eq(schema.dailyMetrics.userId, user.id),
      gte(schema.dailyMetrics.date, daysAgo(30))
    ),
    orderBy: schema.dailyMetrics.date,
  });

  const bodyPrefsRow = await db.query.bodyPrefs.findFirst({
    where: eq(schema.bodyPrefs.userId, user.id),
  });

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  // Strava rows are excluded from analytics throughout (Nov 2024 API agreement).
  const todayActivities = await db.query.activities.findMany({
    where: and(
      eq(schema.activities.userId, user.id),
      ne(schema.activities.provider, "strava"),
      gte(schema.activities.startDate, startOfToday)
    ),
  });

  // Use the most recent metric with a readiness score (today may be incomplete)
  const todayMetric =
    [...metrics].reverse().find((m) => m.readiness != null) ?? metrics.at(-1);
  const band = (todayMetric?.band ?? "calibrating") as Band;
  const readiness = todayMetric?.readiness ?? 0;
  // The battery needs the real null; `readiness` above is coalesced to 0 for
  // the score ring, which would model a calibrating athlete as flat empty.
  const readinessOrNull = todayMetric?.readiness ?? null;

  // First-run calibrating progress ("day N of 14") — shown in place of a
  // bare calibrating label while readiness learns the athlete's baseline.
  const calibration = calibrationProgress(
    wellness.map((w) => ({ hrvMs: w.hrvMs, restingHr: w.restingHr }))
  );

  // ── Onboarding ──────────────────────────────────────────────────────────
  if (!connection && wellness.length === 0) {
    return (
      <AppShell>
        <div className="flex min-h-[60svh] flex-col items-center justify-center text-center">
          <div className="glass mx-auto max-w-md rounded-[2.5rem] p-8">
            <h2 className="text-xl font-bold tracking-tight">
              Welcome to Recover
            </h2>
            <p className="mt-2 text-sm text-white/50">
              Pick how your data gets in. You can add more sources anytime.
            </p>

            <div className="mt-8 space-y-3 text-left">
              <Link
                href="/settings"
                className="flex w-full flex-col rounded-2xl bg-emerald-500 px-5 py-3 text-black transition-all hover:bg-emerald-400"
              >
                <span className="flex items-center gap-2 font-bold">
                  <Sparkles className="h-4 w-4" />
                  Connect a device
                </span>
                <span className="text-[11px] font-medium text-black/70">
                  intervals.icu, Whoop, Oura, Apple Health, or Withings — fully
                  automatic
                </span>
              </Link>
              <Link
                href="/journal"
                className="flex w-full flex-col rounded-2xl border border-white/10 px-5 py-3 transition-all hover:bg-white/5"
              >
                <span className="font-bold text-white/80">Log manually</span>
                <span className="text-[11px] font-medium text-white/50">
                  Two morning taps: HRV and resting heart rate
                </span>
              </Link>
              <Link
                href="/import"
                className="flex w-full flex-col rounded-2xl border border-white/10 px-5 py-3 transition-all hover:bg-white/5"
              >
                <span className="font-bold text-white/80">Import CSV</span>
                <span className="text-[11px] font-medium text-white/50">
                  Bring wellness or activity history from anywhere
                </span>
              </Link>
            </div>

            <p className="mt-6 text-[11px] text-white/30">
              Recover needs {CALIBRATION_TARGET_DAYS} days of HRV &amp; resting
              HR to calibrate your readiness score — it&apos;ll show a
              day-by-day countdown while it learns your baseline.
            </p>
          </div>
        </div>
      </AppShell>
    );
  }

  // ── Derived data ────────────────────────────────────────────────────────
  const latest = [...wellness]
    .reverse()
    .find((w) => w.hrvMs != null || w.restingHr != null);

  const window7 = wellness.filter((w) => w.date >= daysAgo(7));

  const avg7hrv =
    window7.reduce((s, w) => s + (w.hrvMs ?? 0), 0) /
    (window7.filter((w) => w.hrvMs != null).length || 1);
  const avg7rhr =
    window7.reduce((s, w) => s + (w.restingHr ?? 0), 0) /
    (window7.filter((w) => w.restingHr != null).length || 1);

  // ── Strain & Recovery (v0.10 Honest Load) ──────────────────────────────
  // Effective ctl/atl from daily_metrics: provider values win, the native
  // engine fills gaps, and null means calibrating — never `?? 0` again.
  const loadMetric =
    [...metrics].reverse().find((m) => m.ctl != null && m.atl != null) ?? null;
  const todayCtl = loadMetric?.ctl ?? null;
  const todayAtl = loadMetric?.atl ?? null;
  const loadComputed = loadMetric?.loadSource === "computed";
  const loadCalibrating = todayCtl == null || todayAtl == null;

  const tsb = loadCalibrating ? null : todayCtl! - todayAtl!;
  const strainMax = loadCalibrating ? null : Math.max(todayCtl! * 1.5, 14);
  // Strain: ATL relative to personal capacity (CTL*1.5), capped at 100
  const strainFraction = loadCalibrating
    ? 0
    : Math.min((todayAtl! / strainMax!) * 100, 100);
  // Recovery: inverse of fatigue — high TSB = high recovery, deep negative TSB = low recovery
  // Maps TSB range [-30, +20] → [0, 100]
  const recoveryScore = loadCalibrating
    ? 0
    : Math.max(0, Math.min(100, Math.round((tsb! + 30) * 2)));

  const sleepHours = latest?.sleepSecs != null ? latest.sleepSecs / 3600 : null;

  // ── Sleep intelligence (v0.12) ─────────────────────────────────────────
  // Everything here is gated on real provider stage/bed data; a manual
  // athlete gets null and the new cards simply don't mount.
  const sleepNights: SleepNight[] = wellness.map((w) => ({
    date: w.date,
    sleepSecs: w.sleepSecs,
    sleepDeepSecs: w.sleepDeepSecs,
    sleepRemSecs: w.sleepRemSecs,
    sleepLightSecs: w.sleepLightSecs,
    sleepAwakeSecs: w.sleepAwakeSecs,
    bedStart: w.bedStart,
    bedEnd: w.bedEnd,
  }));
  const window30Nights = sleepNights.filter((n) => n.date >= daysAgo(30));
  const latestStageNight = [...sleepNights]
    .reverse()
    .find((n) => stageBreakdown(n) != null);
  const stages = latestStageNight ? stageBreakdown(latestStageNight) : null;
  const stageBedWindow =
    latestStageNight?.bedStart && latestStageNight?.bedEnd
      ? {
          start: fmtClock(latestStageNight.bedStart),
          end: fmtClock(latestStageNight.bedEnd),
        }
      : null;
  const consistency = sleepConsistency(window30Nights);
  const chrono = chronotype(window30Nights);

  // Real bed-start clock minutes for bedtime v2 (last 14 nights).
  const bedtimes = sleepNights
    .filter((n) => n.date >= daysAgo(14) && n.bedStart != null)
    .map((n) => n.bedStart!.getHours() * 60 + n.bedStart!.getMinutes());

  // sleepDebt is a recommendation for tonight (used by the sleep card, v0.9.0
  // Task 5) — it must not leak into the battery's waking window below, which
  // models the athlete's actual schedule instead.
  const sleepDebt = computeSleepDebt({
    nights: wellness
      .filter((w) => w.date >= daysAgo(14))
      .map((w) => ({ sleepSecs: w.sleepSecs })),
    sleepNeedSecs: bodyPrefsRow?.sleepNeedSecs ?? DEFAULT_SLEEP_NEED_SECS,
    wakeTime: bodyPrefsRow?.wakeTime ?? null,
    bedtimes,
  });

  // null on anything that doesn't parse as a valid "HH:MM" — mirrors
  // sleep-debt.ts's parseHhMm degrading to null rather than NaN. Unreachable
  // today (the server action regex-validates on write); this is hardening,
  // not a live bug fix.
  const hhmmToMinutes = (v: string): number | null => {
    const m = /^(\d{1,2}):(\d{2})$/.exec(v.trim());
    if (!m) return null;
    const h = Number(m[1]);
    const min = Number(m[2]);
    if (h > 23 || min > 59) return null;
    return h * 60 + min;
  };

  // The battery's waking window comes from the athlete's own schedule (wake
  // time + typical sleep need), never from tonight's debt-repayment bedtime
  // recommendation — carrying debt must not silently compress the modelled
  // day. A malformed wakeTime degrades to the same defaults as "unset"
  // rather than propagating NaN into the curve and its SVG path.
  const parsedWakeMinutes = bodyPrefsRow?.wakeTime
    ? hhmmToMinutes(bodyPrefsRow.wakeTime)
    : null;
  const wakeMinutes = parsedWakeMinutes ?? DEFAULT_WAKE_MINUTES;
  const bedMinutes =
    parsedWakeMinutes != null
      ? typicalBedMinutes(
          wakeMinutes,
          bodyPrefsRow?.sleepNeedSecs ?? DEFAULT_SLEEP_NEED_SECS
        )
      : DEFAULT_BED_MINUTES;

  const now = new Date();
  const battery = computeBodyBattery({
    readiness: readinessOrNull,
    wakeMinutes,
    bedMinutes,
    activities: todayActivities.map((a) => ({
      startMinutes: a.startDate.getHours() * 60 + a.startDate.getMinutes(),
      durationMin: (a.durationS ?? 0) / 60,
      load: a.load ?? 0,
    })),
    nowMinutes: now.getHours() * 60 + now.getMinutes(),
  });

  // ── This week vs a real target (v0.10) ─────────────────────────────────
  // Trailing 28 days of activities, deduped across providers, loads resolved
  // through the native engine ladder — same numbers the CTL/ATL series sees.
  const monthActivities = await db.query.activities.findMany({
    where: and(
      eq(schema.activities.userId, user.id),
      gte(schema.activities.startDate, new Date(daysAgo(28)))
    ),
    orderBy: schema.activities.startDate,
  });
  const rhrSamples = wellness
    .map((w) => w.restingHr)
    .filter((v): v is number => v != null && v > 0);
  const athlete: AthleteThresholds = {
    ftpWatts: bodyPrefsRow?.ftpWatts ?? null,
    maxHr: bodyPrefsRow?.maxHr ?? null,
    restingHr:
      rhrSamples.length >= 7
        ? rhrSamples.reduce((a, b) => a + b, 0) / rhrSamples.length
        : null,
  };
  const dedupedMonth = dedupeActivities(monthActivities).map((a) => ({
    startDate: a.startDate,
    durationS: a.durationS,
    loadValue: activityLoad(a, athlete)?.load ?? null,
  }));

  const weekStartDate = new Date(daysAgo(7));
  const weekActivities = dedupedMonth.filter(
    (a) => a.startDate >= weekStartDate
  );
  const weekVolume = weekActivities.reduce((s, a) => s + (a.durationS ?? 0), 0);
  const weekLoad = weekActivities.reduce((s, a) => s + (a.loadValue ?? 0), 0);
  const avgLoad =
    weekActivities.length > 0
      ? Math.round(weekLoad / weekActivities.length)
      : 0;

  // Ring targets: the open week plan (volume) and the active block's target
  // load — falling back to trailing 28-day weekly averages, or nothing.
  const activePlan = await db.query.trainingPlans.findFirst({
    where: and(
      eq(schema.trainingPlans.userId, user.id),
      eq(schema.trainingPlans.status, "active")
    ),
  });
  const currentBlock =
    activePlan && weekPlan
      ? await db.query.trainingBlocks.findFirst({
          where: and(
            eq(schema.trainingBlocks.planId, activePlan.id),
            eq(schema.trainingBlocks.weekNumber, weekPlan.skeletonWeek)
          ),
        })
      : null;
  const fallback = trailingWeeklyAverages(dedupedMonth, new Date());
  const volumeTargetS = weekPlan
    ? (plannedWeekVolumeS(weekPlan.days) ?? fallback.volumeS)
    : fallback.volumeS;
  const loadTarget = currentBlock?.targetLoadTotal ?? fallback.load;
  const ringOuter = ringFraction(weekVolume, volumeTargetS);
  const ringInner = ringFraction(weekLoad, loadTarget);

  const hrvSparkPath = sparkPath(window7.map((w) => w.hrvMs));
  const rhrSparkPath = sparkPath(window7.map((w) => w.restingHr));

  const narrative = buildNarrative(
    latest?.hrvMs ?? null,
    latest?.restingHr ?? null,
    sleepHours,
    band,
    loadCalibrating ? null : strainMax! - todayAtl!
  );

  // ── Render ──────────────────────────────────────────────────────────────
  return (
    <AppShell noChrome>
      <PullToRefresh>
        <div className="mx-auto max-w-lg px-6 lg:max-w-5xl lg:pb-16">
          {/* ── Header ──────────────────────────────────────────────── */}
          <header className="mb-8 flex items-start justify-between pt-8">
            <div className="flex flex-col">
              <span className="mb-1.5 text-[11px] font-bold uppercase tracking-[0.2em] text-white/50">
                {todayLabel()}
              </span>
              <h1 className="text-2xl font-bold tracking-tight text-white/90">
                {greetingLine()}
              </h1>
              <div className="mt-2">
                <SyncChip lastSyncAt={lastSyncAt} />
              </div>
            </div>
            <Link
              href="/settings"
              className="glass flex h-10 w-10 items-center justify-center rounded-full"
            >
              <User className="size-5 text-white/80" strokeWidth={1.5} />
            </Link>
          </header>

          {/* ── Hero Trifecta ───────────────────────────────────────── */}
          <section className="mb-8 flex flex-col items-center">
            <div className="mb-6 flex items-end justify-center gap-4">
              {/* Recovery (left) */}
              <div className="mb-4">
                <ScoreRing
                  value={recoveryScore}
                  label="Recovery"
                  color="#10b981"
                  size="sm"
                  calibrating={loadCalibrating}
                />
              </div>
              {/* Readiness (center) */}
              <ScoreRing
                value={readiness}
                label="Readiness"
                color={
                  band === "green"
                    ? "#10b981"
                    : band === "amber"
                      ? "#f59e0b"
                      : band === "red"
                        ? "#ef4444"
                        : "rgba(255,255,255,0.3)"
                }
                size="lg"
              />
              {/* Strain (right) */}
              <div className="mb-4">
                <ScoreRing
                  value={strainFraction}
                  label="Strain"
                  color="#3b82f6"
                  size="sm"
                  calibrating={loadCalibrating}
                  displayValue={
                    loadCalibrating
                      ? undefined
                      : Math.min((todayAtl! / strainMax!) * 21, 21).toFixed(1)
                  }
                />
              </div>
            </div>
            {loadComputed && !loadCalibrating && (
              <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-white/40">
                Load computed from your sessions
              </p>
            )}
            {/* Status line */}
            {band !== "calibrating" && (
              <p
                className={`flex items-center gap-1.5 text-[13px] font-medium ${
                  band === "green"
                    ? "text-emerald-400"
                    : band === "amber"
                      ? "text-amber-400"
                      : "text-red-400"
                }`}
              >
                {band === "green" && "✓ Recovery strong · Ready for intensity"}
                {band === "amber" &&
                  "⚡ Moderate recovery · Consider easy work"}
                {band === "red" && "⚠ Low recovery · Prioritize rest"}
              </p>
            )}
          </section>

          {/* ── Calibration progress (first-run, v0.11) ─────────────── */}
          {band === "calibrating" && calibration.remaining > 0 && (
            <section className="mb-10">
              <CalibrationProgress
                daysWithSignal={calibration.daysWithSignal}
                target={calibration.target}
                prompt={calibration.prompt}
              />
            </section>
          )}

          {/* ── Strain Budget ───────────────────────────────────────── */}
          <section className="mb-10">
            <StrainBudget
              used={
                loadCalibrating
                  ? 0
                  : Math.min((todayAtl! / strainMax!) * 21, 21)
              }
              total={21}
              calibrating={loadCalibrating}
            />
          </section>

          {/* ── AI Morning Brief ────────────────────────────────────── */}
          <section className="mb-10">
            <MorningBrief narrative={narrative} />
          </section>

          {/* ── Proactive coach insight (v0.4b) ─────────────────────── */}
          {insight && (
            <section className="mb-10">
              <CoachInsight
                text={insight.text}
                warning={insight.warning}
                threadId={insight.threadId}
              />
            </section>
          )}

          {/* ── Weekly Review (v0.5b) ───────────────────────────────── */}
          {weeklyReview && (
            <section className="mb-10">
              <Link
                href={`/coach?thread=${weeklyReview.threadId}`}
                className="glass block rounded-[2rem] p-5 transition-colors hover:bg-white/5"
              >
                <div className="mb-2 flex items-center gap-2">
                  <Sparkles aria-hidden className="size-4 text-violet-400" />
                  <span className="text-[10px] font-bold uppercase tracking-widest text-white/50">
                    Weekly Review
                  </span>
                </div>
                <p className="text-sm leading-relaxed text-white/80">
                  {weeklyReview.text.length > 200
                    ? weeklyReview.text.slice(0, 200) + "…"
                    : weeklyReview.text}
                </p>
              </Link>
            </section>
          )}

          {/* ── Living week (v0.9.2) ────────────────────────────────── */}
          {weekPlan && (
            <section className="mb-10 space-y-4">
              <TodayCard slot={todaySlot} adjustmentReason={todayAdjustment} />
              <WeekStrip days={weekPlan.days} />
            </section>
          )}

          {/* ── Next race (v0.14) ──────────────────────────────────── */}
          {raceCard.race && (
            <section className="mb-10">
              <RaceCountdownCard {...raceCard} />
            </section>
          )}

          {/* Lower cards tile into two columns on desktop (v0.12). */}
          <div className="lg:grid lg:grid-cols-2 lg:items-start lg:gap-x-6">
            {/* ── Vitals Grid ─────────────────────────────────────────── */}
            <section className="mb-10">
              <VitalsGrid
                tiles={[
                  {
                    label: "HRV",
                    value:
                      latest?.hrvMs != null
                        ? Math.round(latest.hrvMs).toString()
                        : "—",
                    unit: "ms",
                    avg7d: avg7hrv > 0 ? `${Math.round(avg7hrv)}ms` : null,
                    trend:
                      latest?.hrvMs != null && latest.hrvMs > avg7hrv
                        ? "up"
                        : "down",
                    trendGood: latest?.hrvMs != null && latest.hrvMs >= avg7hrv,
                    sparkPath: hrvSparkPath,
                    sparkColor: "#10b981",
                  },
                  {
                    label: "Resting HR",
                    value:
                      latest?.restingHr != null
                        ? Math.round(latest.restingHr).toString()
                        : "—",
                    unit: "bpm",
                    avg7d: avg7rhr > 0 ? `${Math.round(avg7rhr)}bpm` : null,
                    trend:
                      latest?.restingHr != null && latest.restingHr < avg7rhr
                        ? "down"
                        : "up",
                    trendGood:
                      latest?.restingHr != null && latest.restingHr <= avg7rhr,
                    sparkPath: rhrSparkPath,
                    sparkColor: "#10b981",
                  },
                  {
                    label: "Sleep Score",
                    value:
                      latest?.sleepScore != null
                        ? Math.round(latest.sleepScore).toString()
                        : "—",
                    unit: "/100",
                    avg7d: null,
                    trend: "flat",
                    trendGood: true,
                    sparkPath: sparkPath(window7.map((w) => w.sleepScore)),
                    sparkColor: "#3b82f6",
                  },
                  {
                    label: "Training Status",
                    value:
                      band === "green"
                        ? "Productive"
                        : band === "amber"
                          ? "Maintaining"
                          : band === "red"
                            ? "Recovery"
                            : "Calibrating",
                    unit: "",
                    avg7d:
                      todayCtl != null
                        ? `CTL ${Math.round(todayCtl)}${loadComputed ? " · computed" : ""}`
                        : null,
                    trend: "flat",
                    trendGood: band === "green",
                    sparkPath: "",
                    sparkColor: "transparent",
                  },
                ]}
              />
            </section>

            {/* ── Sleep Card ──────────────────────────────────────────── */}
            {sleepHours != null && (
              <section className="mb-10">
                <SleepCard
                  score={latest?.sleepScore ?? null}
                  duration={`${Math.floor(sleepHours)}h ${Math.round((sleepHours % 1) * 60)}m`}
                  debtSecs={sleepDebt.debtSecs}
                  bedtimeAdvice={sleepDebt.bedtime}
                  wakeTimeSet={bodyPrefsRow?.wakeTime != null}
                />
              </section>
            )}

            {/* ── Sleep Stages (v0.12, provider stage data only) ──────── */}
            {stages && (
              <section className="mb-10">
                <SleepStagesCard
                  deepSecs={stages.deepSecs}
                  remSecs={stages.remSecs}
                  lightSecs={stages.lightSecs}
                  awakeSecs={stages.awakeSecs}
                  fractions={stages.fractions}
                  bedWindow={stageBedWindow}
                />
              </section>
            )}

            {/* ── Sleep Quality (v0.12, consistency + chronotype) ─────── */}
            {(consistency || chrono) && (
              <section className="mb-10">
                <SleepQualityCard
                  consistency={consistency}
                  chronotype={chrono}
                />
              </section>
            )}

            {/* ── Estimated Energy ────────────────────────────────────── */}
            <section className="mb-10">
              <BodyBatteryCurve
                current={battery.current}
                points={battery.points}
              />
            </section>

            {/* ── Behavior Tags ───────────────────────────────────────── */}
            <section className="mb-10">
              <BehaviorTags />
            </section>

            {/* ── Recent Activities ────────────────────────────────────── */}
            {recentActivities.length > 0 && (
              <section className="mb-10">
                <div className="glass rounded-[2rem] p-6">
                  <span className="label-micro mb-4 block">
                    Recent Activities
                  </span>
                  <div className="divide-y divide-white/5">
                    {recentActivities.slice(0, 5).map((a) => (
                      <Link
                        href={`/activity/${a.id}`}
                        key={a.id}
                        className="flex items-baseline justify-between gap-4 py-3 transition-colors hover:bg-white/5"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm font-bold">
                            {a.name ?? a.sport}
                          </p>
                          <p className="text-[10px] text-white/40">
                            {a.sport} · {formatDay(a.startDate)}
                          </p>
                        </div>
                        <p className="shrink-0 text-xs tabular-nums text-white/40">
                          {formatDuration(a.durationS)}
                          {a.distanceM != null && (
                            <> · {formatKm(a.distanceM)}</>
                          )}
                          {a.load != null && <> · {Math.round(a.load)}</>}
                        </p>
                      </Link>
                    ))}
                  </div>
                </div>
              </section>
            )}

            {/* ── Weekly Summary ──────────────────────────────────────── */}
            <section className="mb-10">
              <WeeklySummary
                workouts={weekActivities.length}
                totalVolume={`${(weekVolume / 3600).toFixed(1)}h`}
                avgLoad={avgLoad.toString()}
                streak={milestones.currentStreak}
                ringOuter={ringOuter}
                ringInner={ringInner}
              />
            </section>

            {/* ── Milestones ──────────────────────────────────────────── */}
            <section className="mb-10">
              <MilestonesCard {...milestones} />
            </section>
          </div>
        </div>
      </PullToRefresh>
    </AppShell>
  );
}

import Link from "next/link";
import { and, eq, gte, ne } from "drizzle-orm";
import { Sparkles, User } from "lucide-react";
import { db, schema } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { AppShell, shellUser } from "@/components/app-shell";
import { PullToRefresh } from "@/components/dashboard/pull-to-refresh";
import { SyncChip } from "@/components/dashboard/sync-chip";
import { getLatestMorningInsight } from "@/lib/morning-insight";
import { getOpenWeekPlan, listAdjustments } from "@/lib/week-plan/service";
import { nextUpcomingRace, assembleForecastInputs } from "@/lib/race/service";
import { forecastForm } from "@/lib/race/forecast";
import type { RaceCountdownProps } from "@/components/dashboard/race-countdown";
import type { Band } from "@/lib/readiness";
import { computeSleepDebt, DEFAULT_SLEEP_NEED_SECS } from "@/lib/sleep-debt";
import { sparkPath } from "@/lib/sparkline";
import {
  calibrationProgress,
  CALIBRATION_TARGET_DAYS,
} from "@/lib/calibration";
import { CalibrationProgress } from "@/components/dashboard/calibration-progress";
import { TodayHero, fmtTsb } from "@/components/today/today-hero";
import { VitalsGrid, type VitalTile } from "@/components/today/vitals-grid";
import { SessionCard } from "@/components/today/session-card";
import { DebriefChip } from "@/components/today/debrief-chip";
import { RaceChip } from "@/components/today/race-chip";
import { CoachBrief } from "@/components/today/coach-brief";
import { SheetHost } from "@/components/today/sheet-host";
import { WeekRow } from "@/components/today/week-row";
import { listInboxItems } from "@/lib/coach-inbox";

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

/** "Tue Jul 22" — the date prefix in the header sync micro-label. */
function todayShort(): string {
  const d = new Date();
  const wd = d.toLocaleDateString("en-US", { weekday: "short" });
  const mo = d.toLocaleDateString("en-US", { month: "short" });
  return `${wd} ${mo} ${d.getDate()}`;
}

/** Decimal hours → "7:12" for the sleep vital. */
function hoursToClock(hours: number): string {
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  return `${h}:${String(m).padStart(2, "0")}`;
}

/**
 * Sleep debt is a 14-night cumulative deficit, so it routinely runs to hours.
 * Minutes stay minutes while they read naturally; past 90 it switches to
 * hours rather than printing "debt 1359m" in a 9.5px slot.
 */
function fmtSleepDebt(debtSecs: number): string {
  const mins = Math.round(debtSecs / 60);
  if (mins < 90) return `debt ${mins}m`;
  return `debt ${(mins / 60).toFixed(1)}h · 14d`;
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ sheet?: string; activity?: string }>;
}) {
  const user = await requireUser();
  // Sheet state lives in the URL so the morning and post-ride pushes can
  // deep-link straight into an open sheet, and Back closes it.
  const { sheet, activity: sheetActivity } = await searchParams;

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

  const insight = await getLatestMorningInsight(user.id);

  // v0.9.2 living week — today's slot + latest adjustment, or nothing.
  const weekPlan = await getOpenWeekPlan(user.id);
  const todayDate = new Date();
  const todayYmd = `${todayDate.getFullYear()}-${String(todayDate.getMonth() + 1).padStart(2, "0")}-${String(todayDate.getDate()).padStart(2, "0")}`;
  const todaySlot = weekPlan?.days.find((d) => d.date === todayYmd) ?? null;
  const todayAdjustment = weekPlan
    ? ((await listAdjustments(weekPlan.id))
        .filter((a) => a.date === todayYmd)
        .at(-1)?.reason ?? null)
    : null;
  const otherDays = weekPlan
    ? weekPlan.days
        .filter((o) => o.date !== todayYmd)
        .map((o) => ({
          date: o.date,
          hasWorkout: o.workout !== null,
          isRace: o.status === "race",
        }))
    : [];

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
    const assembled = await assembleForecastInputs(
      user.id,
      race,
      todayDate,
      weekPlan
    );
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

  // ── Desktop (3a) extras ────────────────────────────────────────────────
  // This week's real volume against the plan's own stated target. Both come
  // from stored data; when the plan states no weekly hours, the row shows
  // what was done and claims no target.
  const weekActivities = await db.query.activities.findMany({
    where: and(
      eq(schema.activities.userId, user.id),
      gte(schema.activities.startDate, new Date(daysAgo(7))),
      ne(schema.activities.provider, "strava")
    ),
    columns: { durationS: true },
  });
  const weekHours =
    weekActivities.reduce((sum, a) => sum + (a.durationS ?? 0), 0) / 3600;

  const activePlan = await db.query.trainingPlans.findFirst({
    where: and(
      eq(schema.trainingPlans.userId, user.id),
      eq(schema.trainingPlans.status, "active")
    ),
    columns: { constraints: true },
  });
  const hoursTarget =
    (activePlan?.constraints as { hoursPerWeek?: number } | null)
      ?.hoursPerWeek ?? null;

  // "Inbox: weekly review (Sun) · debrief — Endurance Spin (Mon)" — the two
  // most recent unread coach items, or nothing when the inbox is clear.
  const inboxItems = await listInboxItems(user.id, 6);
  const unreadTeaser = inboxItems.filter((i) => i.unread).slice(0, 2);
  const inboxTeaser =
    unreadTeaser.length > 0
      ? `Inbox: ${unreadTeaser
          .map(
            (i) =>
              `${i.title.toLowerCase()} (${i.createdAt.toLocaleDateString("en-US", { weekday: "short" })})`
          )
          .join(" · ")}`
      : null;

  // Avatar initial, per the 2a mockup; falls back to the generic glyph when
  // the account has no usable name.
  const initial = (user.name ?? user.email ?? "")
    .trim()
    .charAt(0)
    .toUpperCase();

  // Use the most recent metric with a readiness score (today may be incomplete)
  const todayMetric =
    [...metrics].reverse().find((m) => m.readiness != null) ?? metrics.at(-1);
  const band = (todayMetric?.band ?? "calibrating") as Band;
  // The real null (not coalesced) so a calibrating athlete gets a track-only
  // ring and "—", never a modelled empty score.
  const readinessOrNull = todayMetric?.readiness ?? null;

  // First-run calibrating progress ("day N of 14") — shown under the hero
  // while readiness learns the athlete's baseline.
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
                href="/body?tab=journal"
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

            <p className="mt-6 text-[11px] text-white/50">
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

  // ── Form (v0.10 Honest Load) ────────────────────────────────────────────
  // Effective ctl/atl from daily_metrics; null means calibrating — never ?? 0.
  const loadMetric =
    [...metrics].reverse().find((m) => m.ctl != null && m.atl != null) ?? null;
  const todayCtl = loadMetric?.ctl ?? null;
  const todayAtl = loadMetric?.atl ?? null;
  const loadCalibrating = todayCtl == null || todayAtl == null;
  const tsb = loadCalibrating ? null : todayCtl! - todayAtl!;
  // Recovery: TSB range [-30, +20] → [0, 100]; null while load calibrates.
  const recoveryScore = loadCalibrating
    ? null
    : Math.max(0, Math.min(100, Math.round((tsb! + 30) * 2)));

  const sleepHours = latest?.sleepSecs != null ? latest.sleepSecs / 3600 : null;

  // sleepDebt is a recommendation for tonight (the sleep vital's delta). Its
  // waking-window inputs come from the athlete's own schedule.
  const bedtimes = wellness
    .filter((w) => w.date >= daysAgo(14) && w.bedStart != null)
    .map((w) => w.bedStart!.getHours() * 60 + w.bedStart!.getMinutes());
  const sleepDebt = computeSleepDebt({
    nights: wellness
      .filter((w) => w.date >= daysAgo(14))
      .map((w) => ({ sleepSecs: w.sleepSecs })),
    sleepNeedSecs: bodyPrefsRow?.sleepNeedSecs ?? DEFAULT_SLEEP_NEED_SECS,
    wakeTime: bodyPrefsRow?.wakeTime ?? null,
    bedtimes,
  });

  // ── Vitals sparklines (7d) — "" when fewer than two real points ─────────
  const hrvSparkPath = sparkPath(window7.map((w) => w.hrvMs));
  const rhrSparkPath = sparkPath(window7.map((w) => w.restingHr));
  const sleepSparkPath = sparkPath(window7.map((w) => w.sleepSecs));
  const formSparkPath = sparkPath(
    metrics
      .filter((m) => m.date >= daysAgo(7))
      .map((m) => (m.ctl != null && m.atl != null ? m.ctl - m.atl : null))
  );

  const hrvGood = latest?.hrvMs != null && latest.hrvMs >= avg7hrv;
  const rhrGood = latest?.restingHr != null && latest.restingHr <= avg7rhr;

  const vitals: VitalTile[] = [
    {
      label: "HRV",
      value: latest?.hrvMs != null ? String(Math.round(latest.hrvMs)) : "—",
      unit: "ms",
      delta:
        latest?.hrvMs != null && avg7hrv > 0
          ? {
              text: `${hrvGood ? "▲" : "▼"} 7d ${Math.round(avg7hrv)}`,
              tone: hrvGood ? "good" : "muted",
            }
          : null,
      sparkPath: hrvSparkPath,
      sparkColor: "#10b981",
      href: "/body?tab=trends",
    },
    {
      label: "RHR",
      value:
        latest?.restingHr != null ? String(Math.round(latest.restingHr)) : "—",
      unit: "bpm",
      delta:
        latest?.restingHr != null && avg7rhr > 0
          ? {
              text: `${rhrGood ? "▼" : "▲"} 7d ${Math.round(avg7rhr)}`,
              tone: rhrGood ? "good" : "muted",
            }
          : null,
      sparkPath: rhrSparkPath,
      sparkColor: "#10b981",
      href: "/body?tab=trends",
    },
    {
      label: "Sleep",
      value: sleepHours != null ? hoursToClock(sleepHours) : "—",
      delta:
        sleepDebt.debtSecs != null && sleepDebt.debtSecs > 0
          ? { text: fmtSleepDebt(sleepDebt.debtSecs), tone: "warn" }
          : null,
      sparkPath: sleepSparkPath,
      sparkColor: "#3b82f6",
      href: "/body?tab=sleep",
    },
    {
      label: "Form · TSB",
      value: tsb != null ? fmtTsb(tsb) : "—",
      delta:
        todayCtl != null
          ? { text: `CTL ${Math.round(todayCtl)}`, tone: "muted" }
          : null,
      sparkPath: formSparkPath,
      sparkColor: "#8b5cf6",
      href: "/body?tab=trends",
    },
  ];

  // ── Render (2a Today) ────────────────────────────────────────────────────
  return (
    <AppShell noChrome user={shellUser(user)}>
      <PullToRefresh>
        <div className="mx-auto max-w-lg px-6 pb-16 lg:max-w-6xl lg:px-10">
          {/* ── Header ──────────────────────────────────────────────── */}
          <header className="mb-6 flex items-start justify-between pt-8 lg:mb-5">
            <div className="flex min-w-0 flex-col gap-1">
              <SyncChip
                variant="microLabel"
                datePrefix={todayShort()}
                lastSyncAt={lastSyncAt}
              />
              <h1 className="text-[21px] font-bold tracking-[-0.03em]">
                {greetingLine()}
              </h1>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Link
                href="/?sheet=checkin"
                className="rounded-full bg-emerald-500/10 px-3 py-1.5 text-[10.5px] font-bold text-emerald-400 transition-colors hover:bg-emerald-500/20 lg:bg-emerald-500 lg:px-5 lg:py-2 lg:text-[12.5px] lg:text-black lg:hover:opacity-90"
              >
                Check in
                <span className="hidden lg:inline"> · 60s</span>
              </Link>
              <Link
                href="/settings"
                aria-label="Menu"
                className="glass flex size-9 shrink-0 items-center justify-center rounded-full"
              >
                {initial ? (
                  <span
                    aria-hidden
                    className="text-[13px] font-bold text-white/80"
                  >
                    {initial}
                  </span>
                ) : (
                  <User className="size-5 text-white/80" strokeWidth={1.5} />
                )}
              </Link>
            </div>
          </header>

          <div className="lg:grid lg:grid-cols-[7fr_5fr] lg:items-start lg:gap-5">
            <div className="min-w-0">
              {/* ── Hero (the only glass mega-card) ─────────────────────── */}
              <TodayHero
                readiness={readinessOrNull}
                band={band}
                recoveryScore={recoveryScore}
                sleepScore={latest?.sleepScore ?? null}
                why={{
                  hrv: latest?.hrvMs ?? null,
                  hrvBaseline: avg7hrv > 0 ? avg7hrv : null,
                  rhr: latest?.restingHr ?? null,
                  sleepHours,
                  tsb,
                }}
              />

              {/* Calibrating keeps the progress bar directly under the hero. */}
              {band === "calibrating" && calibration.remaining > 0 && (
                <section className="mb-6">
                  <CalibrationProgress
                    daysWithSignal={calibration.daysWithSignal}
                    target={calibration.target}
                    prompt={calibration.prompt}
                  />
                </section>
              )}

              {/* ── Vitals ─────────────────────────────────────────────── */}
              <VitalsGrid tiles={vitals} />

              {/* Desktop only: the week at a glance, with Train one click away. */}
              <WeekRow
                days={weekPlan?.days ?? null}
                hoursDone={weekHours}
                hoursTarget={hoursTarget}
              />
            </div>

            <div className="min-w-0">
              {/* ── Today's session ─────────────────────────────────────── */}
              <SessionCard
                slot={todaySlot}
                adjustmentReason={todayAdjustment}
                otherDays={otherDays}
              />

              {/* ── Post-ride debrief chip (v0.15) ──────────────────────── */}
              <DebriefChip userId={user.id} />

              {/* ── Race chip (next race ≤ 21 days) ─────────────────────── */}
              {raceCard.race &&
                raceCard.daysOut != null &&
                raceCard.daysOut <= 21 && <RaceChip {...raceCard} />}

              {/* ── Coach brief ─────────────────────────────────────────── */}
              {insight && (
                <CoachBrief
                  text={insight.text}
                  threadId={insight.threadId}
                  inboxTeaser={inboxTeaser}
                />
              )}
            </div>
          </div>
        </div>
      </PullToRefresh>

      <SheetHost
        userId={user.id}
        sheet={sheet}
        activityId={sheetActivity}
        closeHref="/"
        todayYmd={todayYmd}
      />
    </AppShell>
  );
}

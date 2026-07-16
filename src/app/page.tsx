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
import { VitalsGrid } from "@/components/dashboard/vitals-grid";
import { SleepCard } from "@/components/dashboard/sleep-card";
import { WeeklySummary } from "@/components/dashboard/weekly-summary";
import { BodyBatteryCurve } from "@/components/dashboard/body-battery";
import { BehaviorTags } from "@/components/dashboard/behavior-tags";
import type { Band } from "@/lib/readiness";
import { formatDay, formatDuration, formatKm } from "@/lib/format";
import {
  computeBodyBattery,
  typicalBedMinutes,
  DEFAULT_BED_MINUTES,
  DEFAULT_WAKE_MINUTES,
} from "@/lib/body-battery";
import { computeSleepDebt, DEFAULT_SLEEP_NEED_SECS } from "@/lib/sleep-debt";

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

function buildNarrative(
  hrvMs: number | null,
  restingHr: number | null,
  sleepHours: number | null,
  band: Band,
  strainBudget: number
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
      `You have a high strain budget today (${strainBudget.toFixed(1)}) — green light for intensity.`
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

/** Simple SVG-safe sparkline path from data */
function sparkPath(values: (number | null)[]): string {
  const nums = values.filter((v): v is number => v != null);
  if (nums.length < 2) return "M0 10 L100 10";
  const min = Math.min(...nums);
  const max = Math.max(...nums);
  const range = max - min || 1;
  return nums
    .map((v, i) => {
      const x = (i / (nums.length - 1)) * 100;
      const y = 18 - ((v - min) / range) * 16;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
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
              Track your readiness, recovery, and training — your way.
            </p>

            <div className="mt-8 space-y-3">
              <Link
                href="/journal"
                className="flex w-full items-center justify-center gap-2 rounded-2xl bg-emerald-500 px-6 py-3 font-bold text-black transition-all hover:bg-emerald-400"
              >
                <Sparkles className="h-4 w-4" />
                Start logging manually
              </Link>
              <Link
                href="/settings"
                className="flex w-full items-center justify-center gap-2 rounded-2xl border border-white/10 px-6 py-3 font-medium text-white/70 transition-all hover:bg-white/5"
              >
                Connect intervals.icu
              </Link>
              <Link
                href="/import"
                className="flex w-full items-center justify-center gap-2 rounded-2xl border border-white/10 px-6 py-3 font-medium text-white/70 transition-all hover:bg-white/5"
              >
                Import CSV data
              </Link>
            </div>

            <p className="mt-6 text-[11px] text-white/30">
              Log 14 days of HRV &amp; resting HR to unlock your readiness
              score. Connect integrations anytime from Settings.
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
  const window30 = wellness.filter((w) => w.date >= daysAgo(30));

  const avg7hrv =
    window7.reduce((s, w) => s + (w.hrvMs ?? 0), 0) /
    (window7.filter((w) => w.hrvMs != null).length || 1);
  const avg7rhr =
    window7.reduce((s, w) => s + (w.restingHr ?? 0), 0) /
    (window7.filter((w) => w.restingHr != null).length || 1);

  // Strain & Recovery calculations (all capped 0-100 for ring display)
  const todayAtl = latest?.atl ?? 0;
  const todayCtl = latest?.ctl ?? 0;
  const tsb = todayCtl - todayAtl;
  const strainMax = Math.max(todayCtl * 1.5, 14);
  // Strain: ATL relative to personal capacity (CTL*1.5), capped at 100
  const strainFraction = Math.min((todayAtl / strainMax) * 100, 100);
  // Recovery: inverse of fatigue — high TSB = high recovery, deep negative TSB = low recovery
  // Maps TSB range [-30, +20] → [0, 100]
  const recoveryScore = Math.max(0, Math.min(100, Math.round((tsb + 30) * 2)));

  const sleepHours = latest?.sleepSecs != null ? latest.sleepSecs / 3600 : null;

  // sleepDebt is a recommendation for tonight (used by the sleep card, v0.9.0
  // Task 5) — it must not leak into the battery's waking window below, which
  // models the athlete's actual schedule instead.
  const sleepDebt = computeSleepDebt({
    nights: wellness
      .filter((w) => w.date >= daysAgo(14))
      .map((w) => ({ sleepSecs: w.sleepSecs })),
    sleepNeedSecs: bodyPrefsRow?.sleepNeedSecs ?? DEFAULT_SLEEP_NEED_SECS,
    wakeTime: bodyPrefsRow?.wakeTime ?? null,
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

  // Activities this week
  const weekStartDate = new Date(daysAgo(7));
  const weekActivities = recentActivities.filter(
    (a) => a.startDate >= weekStartDate
  );
  const weekVolume = weekActivities.reduce((s, a) => s + (a.durationS ?? 0), 0);
  const weekLoad = weekActivities.reduce((s, a) => s + (a.load ?? 0), 0);
  const avgLoad =
    weekActivities.length > 0
      ? Math.round(weekLoad / weekActivities.length)
      : 0;

  const hrvSparkPath = sparkPath(window7.map((w) => w.hrvMs));
  const rhrSparkPath = sparkPath(window7.map((w) => w.restingHr));

  const narrative = buildNarrative(
    latest?.hrvMs ?? null,
    latest?.restingHr ?? null,
    sleepHours,
    band,
    strainMax - todayAtl
  );

  // ── Render ──────────────────────────────────────────────────────────────
  return (
    <AppShell noChrome>
      <PullToRefresh>
        <div className="mx-auto max-w-lg px-6">
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
                  displayValue={Math.min(
                    (todayAtl / strainMax) * 21,
                    21
                  ).toFixed(1)}
                />
              </div>
            </div>
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

          {/* ── Strain Budget ───────────────────────────────────────── */}
          <section className="mb-10">
            <StrainBudget
              used={Math.min((todayAtl / strainMax) * 21, 21)}
              total={21}
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
                  sparkPath: sparkPath(window7.map((w) => w.sleepSecs)),
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
                  avg7d: todayCtl > 0 ? `Optimal load intensity` : null,
                  trend: "flat",
                  trendGood: band === "green",
                  sparkPath: "M0 10 L100 10",
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
                        {a.distanceM != null && <> · {formatKm(a.distanceM)}</>}
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
              streak={Math.min(window30.length, 30)}
              ringOuter={0.7}
              ringInner={0.8}
            />
          </section>
        </div>
      </PullToRefresh>
    </AppShell>
  );
}

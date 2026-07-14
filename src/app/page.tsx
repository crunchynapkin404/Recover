import Link from "next/link";
import { and, desc, eq, gte } from "drizzle-orm";
import { User } from "lucide-react";
import { db, schema } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { AppShell } from "@/components/app-shell";
import { PullToRefresh } from "@/components/dashboard/pull-to-refresh";
import { SyncChip } from "@/components/dashboard/sync-chip";
import { ScoreRing } from "@/components/dashboard/score-ring";
import { StrainBudget } from "@/components/dashboard/strain-budget";
import { MorningBrief } from "@/components/dashboard/morning-brief";
import { VitalsGrid } from "@/components/dashboard/vitals-grid";
import { SleepCard } from "@/components/dashboard/sleep-card";
import { WeeklySummary } from "@/components/dashboard/weekly-summary";
import { BodyBatteryCurve } from "@/components/dashboard/body-battery";
import { BehaviorTags } from "@/components/dashboard/behavior-tags";
import type { Band, ComponentScores } from "@/lib/readiness";
import { formatDay, formatDuration, formatKm } from "@/lib/format";

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
      eq(schema.connections.provider, "intervals_icu")
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

  const metrics = await db.query.dailyMetrics.findMany({
    where: and(
      eq(schema.dailyMetrics.userId, user.id),
      gte(schema.dailyMetrics.date, daysAgo(30))
    ),
    orderBy: schema.dailyMetrics.date,
  });

  // Use the most recent metric with a readiness score (today may be incomplete)
  const todayMetric =
    [...metrics].reverse().find((m) => m.readiness != null) ?? metrics.at(-1);
  const band = (todayMetric?.band ?? "calibrating") as Band;
  const readiness = todayMetric?.readiness ?? 0;
  const components = (todayMetric?.componentScores ?? {
    hrv: null,
    rhr: null,
    sleep: null,
    form: null,
  }) as ComponentScores;

  // ── Onboarding ──────────────────────────────────────────────────────────
  if (!connection && wellness.length === 0) {
    return (
      <AppShell>
        <div className="flex min-h-[60svh] flex-col items-center justify-center text-center">
          <div className="glass mx-auto max-w-sm rounded-[2.5rem] p-8">
            <h2 className="text-xl font-bold tracking-tight">
              Welcome to Recover
            </h2>
            <p className="mt-2 text-sm text-white/50">
              Connect intervals.icu to pull in your wellness and training data.
            </p>
            <Link
              href="/settings"
              className="mt-6 inline-flex items-center justify-center gap-2 rounded-2xl bg-emerald-500 px-6 py-3 font-bold text-black transition-all hover:bg-emerald-400"
            >
              Connect intervals.icu
            </Link>
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
                    sleepHours != null
                      ? Math.round((sleepHours / 9) * 100).toString()
                      : "—",
                  unit: "/100",
                  avg7d:
                    sleepHours != null
                      ? `Efficiency: ${Math.min(Math.round((sleepHours / 8) * 100), 100)}%`
                      : null,
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
                score={Math.round((sleepHours / 9) * 100)}
                duration={`${Math.floor(sleepHours)}h ${Math.round((sleepHours % 1) * 60)}m`}
                efficiency={`${Math.min(Math.round((sleepHours / 8) * 100), 100)}%`}
                stages={[
                  { label: "Awake", pct: 8, color: "rgba(239,68,68,0.8)" },
                  { label: "Deep", pct: 20, color: "#6366f1" },
                  { label: "Core", pct: 25, color: "#3b82f6" },
                  { label: "REM", pct: 47, color: "#38bdf8" },
                ]}
                bedtimeAdvice="22:30 – 23:00"
              />
            </section>
          )}

          {/* ── Body Battery Curve ──────────────────────────────────── */}
          <section className="mb-10">
            <BodyBatteryCurve
              current={Math.round(
                ((sleepHours ?? 7) / 9) * 100 * (readiness / 100 || 0.5)
              )}
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
                    <div
                      key={a.id}
                      className="flex items-baseline justify-between gap-4 py-3"
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
                    </div>
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

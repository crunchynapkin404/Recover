import Link from "next/link";
import { and, desc, eq, gte, ne } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { AppShell } from "@/components/app-shell";
import { LogTabs } from "@/components/log/log-tabs";
import { PmcChart } from "@/components/log/pmc-chart";
import { WeeklyLoadBars } from "@/components/log/weekly-load-bars";
import { WellnessTrends } from "@/components/log/wellness-trends";
import { localYmd, weeklyLoads } from "@/lib/charts";
import { TrendingUp, Bike, Mountain } from "lucide-react";
import { formatDuration, formatKm } from "@/lib/format";

const RANGES = [30, 90, 180, 365];
const HISTORY_STEP = 31;

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

const SPORT_ICON: Record<string, typeof Bike> = {
  Ride: Bike,
  Run: Mountain,
};

export default async function LogPage({
  searchParams,
}: {
  searchParams: Promise<{
    sport?: string;
    tab?: string;
    range?: string;
    days?: string;
  }>;
}) {
  const user = await requireUser();
  const sp = await searchParams;
  const sportFilter = sp.sport;
  const tab =
    sp.tab === "wellness" ? ("wellness" as const) : ("training" as const);
  const range = RANGES.includes(Number(sp.range)) ? Number(sp.range) : 90;
  const days = Math.min(
    Math.max(Number(sp.days) || HISTORY_STEP, HISTORY_STEP),
    365
  );

  // Every state change is a link; this builds hrefs that keep the rest of
  // the URL state intact ("" clears the sport filter).
  const href = (over: {
    range?: number;
    days?: number;
    sport?: string;
  }): string => {
    const q = new URLSearchParams({ tab, range: String(over.range ?? range) });
    const d = over.days ?? days;
    if (d !== HISTORY_STEP) q.set("days", String(d));
    const s = over.sport !== undefined ? over.sport : (sportFilter ?? "");
    if (s) q.set("sport", s);
    return `/log?${q.toString()}`;
  };

  const wellness = await db.query.wellnessDaily.findMany({
    where: and(
      eq(schema.wellnessDaily.userId, user.id),
      gte(schema.wellnessDaily.date, daysAgo(range))
    ),
    orderBy: schema.wellnessDaily.date,
  });

  const allActivities = await db.query.activities.findMany({
    where: and(
      eq(schema.activities.userId, user.id),
      ne(schema.activities.provider, "strava")
    ),
    orderBy: desc(schema.activities.startDate),
    limit: 400,
  });

  const sports = [...new Set(allActivities.map((a) => a.sport))].sort();
  const windowStart = new Date(daysAgo(days));
  const sportActivities = sportFilter
    ? allActivities.filter((a) => a.sport === sportFilter)
    : allActivities;
  const activities = sportActivities.filter((a) => a.startDate >= windowStart);
  const hasMore = days < 365 && sportActivities.length > activities.length;

  // History list grouped by local day; activities are already newest-first.
  const dayGroups: { day: string; items: typeof activities }[] = [];
  for (const a of activities) {
    const key = localYmd(a.startDate);
    const last = dayGroups[dayGroups.length - 1];
    if (last && last.day === key) last.items.push(a);
    else dayGroups.push({ day: key, items: [a] });
  }

  const latest = [...wellness].reverse().find((w) => w.ctl != null);
  const ctl = latest?.ctl ?? 0;
  const atl = latest?.atl ?? 0;
  const tsb = ctl - atl;

  // Use readiness from daily_metrics for consistent status with dashboard
  const latestMetric = await db.query.dailyMetrics.findFirst({
    where: eq(schema.dailyMetrics.userId, user.id),
    orderBy: desc(schema.dailyMetrics.date),
  });
  const readinessMetric =
    latestMetric?.readiness != null
      ? latestMetric
      : (
          await db.query.dailyMetrics.findMany({
            where: eq(schema.dailyMetrics.userId, user.id),
            orderBy: desc(schema.dailyMetrics.date),
            limit: 7,
          })
        ).find((m) => m.readiness != null);
  const readiness = readinessMetric?.readiness ?? null;
  const band = readinessMetric?.band ?? "calibrating";
  const trainingStatus =
    band === "green"
      ? "Productive"
      : band === "amber"
        ? "Maintaining"
        : band === "red"
          ? "Recovery"
          : "Calibrating";

  const weekStart = new Date(daysAgo(7));
  const weekActivities = allActivities.filter((a) => a.startDate >= weekStart);
  const weekVolume = weekActivities.reduce((s, a) => s + (a.durationS ?? 0), 0);
  const weekLoad = weekActivities.reduce((s, a) => s + (a.load ?? 0), 0);

  const weekly = weeklyLoads(
    allActivities.map((a) => ({ startDate: a.startDate, load: a.load })),
    12
  );

  // Latest daily_metrics row carries the personal baselines (HRV ln-space).
  const baselineMetric = latestMetric;

  // Real per-weekday load (Mon..Sun) for the last 7 days.
  const dayLoads = Array(7).fill(0) as number[];
  for (const a of weekActivities) {
    const weekday = (a.startDate.getDay() + 6) % 7; // Mon=0 … Sun=6
    dayLoads[weekday] += a.load ?? 0;
  }
  const maxDayLoad = Math.max(1, ...dayLoads);
  const todayIdx = (new Date().getDay() + 6) % 7;

  return (
    <AppShell>
      <header className="mb-8 pt-8">
        <div className="mb-8 flex items-center justify-between">
          <div className="flex flex-col">
            <h1 className="text-2xl font-bold tracking-tighter">Performance</h1>
            <span className="text-[10px] font-bold uppercase tracking-widest text-white/50">
              Training Analytics
            </span>
          </div>
        </div>

        {/* Training Status */}
        <div className="glass mb-8 flex items-center justify-between rounded-3xl p-5">
          <div className="flex items-center gap-4">
            <div
              className={`relative flex h-14 w-14 items-center justify-center rounded-full border-4 ${
                band === "green"
                  ? "border-emerald-500/30"
                  : band === "amber"
                    ? "border-amber-500/30"
                    : band === "red"
                      ? "border-red-500/30"
                      : "border-white/10"
              }`}
            >
              <TrendingUp
                aria-hidden
                className={`size-6 ${
                  band === "green"
                    ? "text-emerald-400"
                    : band === "amber"
                      ? "text-amber-400"
                      : band === "red"
                        ? "text-red-400"
                        : "text-white/40"
                }`}
              />
              {band === "green" && (
                <div className="absolute -right-1 -top-1 h-4 w-4 rounded-full border-2 border-[#0a0a0a] bg-emerald-500" />
              )}
            </div>
            <div>
              <h2 className="text-lg font-bold">{trainingStatus}</h2>
              <p className="text-xs font-medium text-white/40">
                {readiness != null
                  ? `Readiness ${readiness} · TSB ${tsb.toFixed(0)}`
                  : latest
                    ? `TSB ${tsb.toFixed(0)}`
                    : "Connect intervals.icu in Settings"}
              </p>
            </div>
          </div>
        </div>

        <LogTabs active={tab} range={range} />
      </header>

      {tab === "wellness" ? (
        <div className="pb-12">
          <WellnessTrends
            wellness={wellness.map((w) => ({
              date: w.date,
              hrvMs: w.hrvMs,
              restingHr: w.restingHr,
              sleepSecs: w.sleepSecs,
              sleepScore: w.sleepScore,
            }))}
            baselines={
              baselineMetric
                ? {
                    hrvLnMean: baselineMetric.hrvBaselineMean,
                    hrvLnSd: baselineMetric.hrvBaselineSd,
                    rhrMean: baselineMetric.rhrBaselineMean,
                    rhrSd: baselineMetric.rhrBaselineSd,
                  }
                : null
            }
          />
        </div>
      ) : (
        <div className="pb-12">
          {/* PMC chart — CTL/ATL/TSB over the selected range */}
          {wellness.some((w) => w.ctl != null) && (
            <div className="glass relative mb-8 overflow-hidden rounded-3xl p-6">
              <div className="mb-6 flex items-end justify-between">
                <div>
                  <h3 className="text-sm font-bold">Training Stress Balance</h3>
                  <p className="text-[10px] text-white/50">Last {range} days</p>
                </div>
                <div className="flex gap-3">
                  <div className="flex items-center gap-1.5">
                    <span
                      aria-hidden
                      className="h-2 w-2 rounded-full bg-blue-500"
                    />
                    <span className="text-[9px] font-bold text-white/60">
                      CTL
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span
                      aria-hidden
                      className="h-2 w-2 rounded-full bg-red-500"
                    />
                    <span className="text-[9px] font-bold text-white/60">
                      ATL
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span
                      aria-hidden
                      className="h-2 w-2 rounded-full bg-emerald-500/40"
                    />
                    <span className="text-[9px] font-bold text-white/60">
                      TSB
                    </span>
                  </div>
                </div>
              </div>
              <PmcChart
                wellness={wellness.map((w) => ({
                  date: w.date,
                  ctl: w.ctl,
                  atl: w.atl,
                }))}
              />
            </div>
          )}

          {/* Weekly stats */}
          <div className="mb-8 grid grid-cols-2 gap-4">
            <div className="glass flex flex-col justify-center gap-4 rounded-3xl p-5">
              <div>
                <span className="block text-lg font-bold">
                  {(weekVolume / 3600).toFixed(1)}h
                </span>
                <span className="text-[8px] font-bold uppercase tracking-widest text-white/50">
                  Volume (7d)
                </span>
              </div>
              <div className="h-px bg-white/5" />
              <div>
                <span className="block text-lg font-bold">
                  {Math.round(weekLoad)}
                </span>
                <span className="text-[8px] font-bold uppercase tracking-widest text-white/50">
                  Load (7d)
                </span>
              </div>
            </div>
            <div className="glass flex flex-col items-center justify-center rounded-3xl p-5">
              <div
                className="relative h-20 w-20"
                role="img"
                aria-label={`${weekActivities.length} sessions in the last 7 days`}
              >
                <svg className="h-full w-full -rotate-90">
                  <circle
                    cx="40"
                    cy="40"
                    r="34"
                    stroke="rgba(59,130,246,0.2)"
                    strokeWidth="6"
                    fill="transparent"
                  />
                  <circle
                    cx="40"
                    cy="40"
                    r="34"
                    stroke="#3b82f6"
                    strokeWidth="6"
                    fill="transparent"
                    strokeDasharray="213"
                    strokeDashoffset={
                      213 * (1 - Math.min(weekActivities.length / 7, 1))
                    }
                    strokeLinecap="round"
                  />
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span className="text-sm font-bold">
                    {weekActivities.length}
                  </span>
                  <span className="text-[6px] font-bold uppercase text-white/50">
                    Sessions
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Weekly load bars (12 w) */}
          {weekly.some((w) => w.load > 0) && (
            <div className="mb-8">
              <WeeklyLoadBars data={weekly} />
            </div>
          )}

          {/* Sport filter — real, via query param */}
          {sports.length > 1 && (
            <nav
              aria-label="Filter by sport"
              className="hide-scrollbar -mx-6 mb-6 flex gap-2 overflow-x-auto px-6"
            >
              <Link
                href={href({ sport: "" })}
                aria-current={!sportFilter ? "true" : undefined}
                className={`glass whitespace-nowrap rounded-full px-5 py-2 text-[9px] font-bold uppercase tracking-wider ${!sportFilter ? "bg-white/10" : "opacity-60"}`}
              >
                All
              </Link>
              {sports.map((s) => (
                <Link
                  key={s}
                  href={href({ sport: s ?? "" })}
                  aria-current={sportFilter === s ? "true" : undefined}
                  className={`glass whitespace-nowrap rounded-full px-5 py-2 text-[9px] font-bold uppercase tracking-wider ${sportFilter === s ? "bg-white/10" : "opacity-60"}`}
                >
                  {s}
                </Link>
              ))}
            </nav>
          )}

          {/* History — grouped by day, rows link to the activity */}
          <section className="space-y-6">
            {dayGroups.map((g) => (
              <div key={g.day}>
                <h3 className="mb-2 px-1 text-[10px] font-bold uppercase tracking-widest text-white/40">
                  {g.items[0].startDate.toLocaleDateString(undefined, {
                    weekday: "short",
                    month: "short",
                    day: "numeric",
                  })}
                </h3>
                <div className="space-y-3">
                  {g.items.map((a) => {
                    const SportIcon = SPORT_ICON[a.sport ?? ""] ?? Bike;
                    const color = a.sport === "Run" ? "#10b981" : "#3b82f6";
                    return (
                      <Link
                        key={a.id}
                        href={`/activity/${a.id}`}
                        className="glass block rounded-[2rem] border-l-[6px] p-5 transition-colors hover:bg-white/5"
                        style={{ borderLeftColor: `${color}cc` }}
                      >
                        <div className="mb-4 flex items-start justify-between">
                          <div className="flex gap-4">
                            <div
                              className="flex h-10 w-10 items-center justify-center rounded-xl border"
                              style={{
                                background: `${color}15`,
                                borderColor: `${color}30`,
                              }}
                            >
                              <SportIcon
                                aria-hidden
                                className="size-5"
                                style={{ color }}
                              />
                            </div>
                            <div>
                              <h4 className="text-base font-bold tracking-tight">
                                {a.name ?? a.sport}
                              </h4>
                              <p className="text-[10px] font-medium uppercase text-white/50">
                                {a.sport}
                              </p>
                            </div>
                          </div>
                        </div>

                        <div className="grid grid-cols-4 gap-2">
                          {(
                            [
                              [formatDuration(a.durationS), "Duration"],
                              [
                                a.load != null
                                  ? String(Math.round(a.load))
                                  : "—",
                                "Load",
                              ],
                              [
                                a.distanceM != null
                                  ? formatKm(a.distanceM)
                                  : "—",
                                "Distance",
                              ],
                              [
                                a.avgHr != null
                                  ? `${Math.round(a.avgHr)} bpm`
                                  : "—",
                                "Avg HR",
                              ],
                            ] as const
                          ).map(([value, label]) => (
                            <div key={label} className="flex flex-col">
                              <span className="text-sm font-bold">{value}</span>
                              <span className="text-[7px] font-bold uppercase text-white/50">
                                {label}
                              </span>
                            </div>
                          ))}
                        </div>
                      </Link>
                    );
                  })}
                </div>
              </div>
            ))}

            {activities.length === 0 && (
              <div className="glass rounded-[2rem] p-8 text-center">
                <p className="text-sm text-white/50">
                  {sportFilter
                    ? `No ${sportFilter} activities in the last ${days} days.`
                    : "No activities synced yet."}
                </p>
              </div>
            )}

            {hasMore && (
              <Link
                href={href({ days: Math.min(days + HISTORY_STEP, 365) })}
                className="glass block rounded-full px-6 py-3 text-center text-[10px] font-bold uppercase tracking-widest text-white/60"
              >
                Load more
              </Link>
            )}

            {/* Daily load — real per-weekday aggregation */}
            {weekActivities.length > 0 && (
              <div className="glass mt-8 rounded-[2rem] p-6">
                <div className="mb-6 flex items-center justify-between">
                  <h3 className="text-sm font-bold">Daily Training Load</h3>
                  <span className="label-micro">Last 7 days</span>
                </div>
                <div className="relative flex h-20 items-end justify-between gap-2">
                  {["M", "T", "W", "T", "F", "S", "S"].map((day, i) => {
                    const pct = Math.round((dayLoads[i] / maxDayLoad) * 100);
                    const isToday = i === todayIdx;
                    return (
                      <div
                        key={day + i}
                        className="flex flex-1 flex-col items-center"
                        aria-label={`${["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][i]}: load ${Math.round(dayLoads[i])}`}
                      >
                        <div
                          className={`w-full rounded-t-md ${
                            isToday
                              ? "bg-blue-500"
                              : dayLoads[i] > 0
                                ? "bg-white/20"
                                : "border border-white/10 bg-white/5"
                          }`}
                          style={{ height: `${Math.max(pct, 4)}%` }}
                        />
                        <span
                          className={`mt-2 text-[8px] ${isToday ? "font-bold text-white" : "text-white/50"}`}
                        >
                          {day}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </section>
        </div>
      )}
    </AppShell>
  );
}

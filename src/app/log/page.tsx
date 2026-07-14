import Link from "next/link";
import { and, desc, eq, gte, ne } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { AppShell } from "@/components/app-shell";
import { TrendingUp, Bike, Mountain } from "lucide-react";
import { formatDay, formatDuration, formatKm } from "@/lib/format";

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

const SPORT_ICON: Record<string, typeof Bike> = {
  Ride: Bike,
  Run: Mountain,
};

/** Map a series onto SVG polyline points in a 0-100 × 0-40 viewBox. */
function toPolyline(values: (number | null)[], max: number): string {
  const pts: string[] = [];
  const n = values.length;
  values.forEach((v, i) => {
    if (v == null) return;
    const x = n > 1 ? (i / (n - 1)) * 100 : 0;
    const y = 38 - (Math.min(v, max) / max) * 34;
    pts.push(`${x.toFixed(1)},${y.toFixed(1)}`);
  });
  return pts.join(" ");
}

export default async function LogPage({
  searchParams,
}: {
  searchParams: Promise<{ sport?: string }>;
}) {
  const user = await requireUser();
  const { sport: sportFilter } = await searchParams;

  const wellness = await db.query.wellnessDaily.findMany({
    where: and(
      eq(schema.wellnessDaily.userId, user.id),
      gte(schema.wellnessDaily.date, daysAgo(90))
    ),
    orderBy: schema.wellnessDaily.date,
  });

  const allActivities = await db.query.activities.findMany({
    where: and(
      eq(schema.activities.userId, user.id),
      ne(schema.activities.provider, "strava")
    ),
    orderBy: desc(schema.activities.startDate),
    limit: 60,
  });

  const sports = [...new Set(allActivities.map((a) => a.sport))].sort();
  const activities = (
    sportFilter
      ? allActivities.filter((a) => a.sport === sportFilter)
      : allActivities
  ).slice(0, 20);

  const latest = [...wellness].reverse().find((w) => w.ctl != null);
  const ctl = latest?.ctl ?? 0;
  const atl = latest?.atl ?? 0;
  const tsb = ctl - atl;

  const weekStart = new Date(daysAgo(7));
  const weekActivities = allActivities.filter((a) => a.startDate >= weekStart);
  const weekVolume = weekActivities.reduce((s, a) => s + (a.durationS ?? 0), 0);
  const weekLoad = weekActivities.reduce((s, a) => s + (a.load ?? 0), 0);

  // Real PMC series from wellness history.
  const pmcMax = Math.max(
    10,
    ...wellness.map((w) => Math.max(w.ctl ?? 0, w.atl ?? 0))
  );
  const ctlLine = toPolyline(
    wellness.map((w) => w.ctl),
    pmcMax
  );
  const atlLine = toPolyline(
    wellness.map((w) => w.atl),
    pmcMax
  );

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
      {/* Header */}
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
            <div className="relative flex h-14 w-14 items-center justify-center rounded-full border-4 border-emerald-500/30">
              <TrendingUp aria-hidden className="size-6 text-emerald-400" />
            </div>
            <div>
              <h2 className="text-lg font-bold">
                {latest == null
                  ? "No data yet"
                  : tsb > 5
                    ? "Fresh"
                    : tsb > -10
                      ? "Maintaining"
                      : "Recovery needed"}
              </h2>
              <p className="text-xs font-medium text-white/50">
                {latest
                  ? `TSB ${tsb.toFixed(0)} as of ${latest.date}`
                  : "Connect intervals.icu in Settings"}
              </p>
            </div>
          </div>
        </div>

        {/* PMC chart — real 90-day CTL/ATL */}
        {wellness.some((w) => w.ctl != null) && (
          <div className="glass relative mb-8 overflow-hidden rounded-3xl p-6">
            <div className="mb-6 flex items-end justify-between">
              <div>
                <h3 className="text-sm font-bold">Training Stress Balance</h3>
                <p className="text-[10px] text-white/50">Last 90 days</p>
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
              </div>
            </div>

            <div
              className="relative h-28 w-full"
              role="img"
              aria-label={`Fitness CTL ${ctl.toFixed(0)}, fatigue ATL ${atl.toFixed(0)}, form TSB ${tsb.toFixed(0)}`}
            >
              <svg
                className="absolute inset-0 h-full w-full overflow-visible"
                viewBox="0 0 100 40"
                preserveAspectRatio="none"
              >
                <polyline
                  points={ctlLine}
                  stroke="#3b82f6"
                  strokeWidth="1.5"
                  fill="none"
                  vectorEffect="non-scaling-stroke"
                />
                <polyline
                  points={atlLine}
                  stroke="#ef4444"
                  strokeWidth="1"
                  fill="none"
                  strokeDasharray="2 1"
                  vectorEffect="non-scaling-stroke"
                />
              </svg>
            </div>

            <div className="mt-6 grid grid-cols-3 border-t border-white/5 pt-4">
              {(
                [
                  [ctl > 0 ? ctl.toFixed(0) : "—", "CTL", "text-blue-400"],
                  [atl > 0 ? atl.toFixed(0) : "—", "ATL", "text-red-400"],
                  [ctl > 0 ? tsb.toFixed(0) : "—", "TSB", "text-emerald-400"],
                ] as const
              ).map(([value, label, color]) => (
                <div key={label} className="flex flex-col items-center">
                  <span className={`text-base font-bold ${color}`}>
                    {value}
                  </span>
                  <span className="text-[8px] font-bold uppercase tracking-widest text-white/50">
                    {label}
                  </span>
                </div>
              ))}
            </div>
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
      </header>

      {/* Sport filter — real, via query param */}
      {sports.length > 1 && (
        <nav
          aria-label="Filter by sport"
          className="hide-scrollbar -mx-6 mb-6 flex gap-2 overflow-x-auto px-6"
        >
          <Link
            href="/log"
            aria-current={!sportFilter ? "true" : undefined}
            className={`glass whitespace-nowrap rounded-full px-5 py-2 text-[9px] font-bold uppercase tracking-wider ${!sportFilter ? "bg-white/10" : "opacity-60"}`}
          >
            All
          </Link>
          {sports.map((s) => (
            <Link
              key={s}
              href={`/log?sport=${encodeURIComponent(s)}`}
              aria-current={sportFilter === s ? "true" : undefined}
              className={`glass whitespace-nowrap rounded-full px-5 py-2 text-[9px] font-bold uppercase tracking-wider ${sportFilter === s ? "bg-white/10" : "opacity-60"}`}
            >
              {s}
            </Link>
          ))}
        </nav>
      )}

      {/* Activity list */}
      <section className="space-y-4">
        {activities.map((a) => {
          const SportIcon = SPORT_ICON[a.sport ?? ""] ?? Bike;
          const color = a.sport === "Run" ? "#10b981" : "#3b82f6";
          return (
            <div
              key={a.id}
              className="glass rounded-[2rem] border-l-[6px] p-5"
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
                    <h3 className="text-base font-bold tracking-tight">
                      {a.name ?? a.sport}
                    </h3>
                    <p className="text-[10px] font-medium uppercase text-white/50">
                      {formatDay(a.startDate)}
                    </p>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-4 gap-2">
                {(
                  [
                    [formatDuration(a.durationS), "Duration"],
                    [a.load != null ? String(Math.round(a.load)) : "—", "Load"],
                    [
                      a.distanceM != null ? formatKm(a.distanceM) : "—",
                      "Distance",
                    ],
                    [
                      a.avgHr != null ? `${Math.round(a.avgHr)} bpm` : "—",
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
            </div>
          );
        })}

        {activities.length === 0 && (
          <div className="glass rounded-[2rem] p-8 text-center">
            <p className="text-sm text-white/50">
              {sportFilter
                ? `No ${sportFilter} activities in the last 60.`
                : "No activities synced yet."}
            </p>
          </div>
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
    </AppShell>
  );
}

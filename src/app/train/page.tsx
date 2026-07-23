import Link from "next/link";
import { and, asc, desc, eq, gte, ne } from "drizzle-orm";
import { Bike, ClipboardList, LineChart, Plus } from "lucide-react";
import { db, schema } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { AppShell } from "@/components/app-shell";
import { WeekStrip } from "@/components/plan/week-strip";
import { RacesSection } from "@/components/plan/races-section";
import { IntakeForm } from "@/components/plan/intake-form";
import { PlanEmpty } from "@/components/plan/plan-empty";
import { PmcChart } from "@/components/log/pmc-chart";
import { WeeklyLoadBars } from "@/components/log/weekly-load-bars";
import {
  FitnessStatsRow,
  rampTrendLabel,
} from "@/components/log/fitness-stats-row";
import { RangeTabs } from "@/components/log/range-tabs";
import { ViewTabs, currentYm } from "@/components/log/view-tabs";
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsiblePanel,
} from "@/components/ui/collapsible";
import { EmptyState } from "@/components/ui/empty-state";
import { TrainTabs } from "@/components/train/train-tabs";
import { WeekDayList } from "@/components/train/week-day-list";
import {
  HistoryList,
  type HistoryGroup,
} from "@/components/train/history-list";
import { HistoryStatStrip } from "@/components/train/history-stat-strip";
import {
  FitnessTiles,
  type FitnessTile,
} from "@/components/train/fitness-tiles";
import { RaceChip } from "@/components/today/race-chip";
import type { RaceCountdownProps } from "@/components/dashboard/race-countdown";
import { BAND_COLOR } from "@/lib/band-color";
import type { Band } from "@/lib/readiness";
import { getOpenWeekPlan, listAdjustments } from "@/lib/week-plan/service";
import { prefillAvailability } from "@/lib/week-plan/availability";
import {
  listRaces,
  nextUpcomingRace,
  assembleForecastInputs,
} from "@/lib/race/service";
import { forecastForm } from "@/lib/race/forecast";
import {
  fetchBusyTimes,
  getValidGoogleAccessToken,
  type CalendarBusyBlock,
} from "@/lib/connectors/google-calendar";
import { localYmd, weeklyLoads } from "@/lib/charts";
import {
  buildTrainHref,
  TRAIN_TABS,
  type TrainHref,
  type TrainTab,
} from "@/lib/log-href";
import { startWeek, submitAvailability } from "@/app/plan/actions";

export const dynamic = "force-dynamic";

const RANGES = [30, 90, 180, 365];

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

function addDaysYmd(ymd: string, n: number): string {
  const d = new Date(ymd + "T00:00:00");
  d.setDate(d.getDate() + n);
  return localYmd(d);
}

function monthLabelFor(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });
}

/** Total busy minutes per week day (Monday first) from calendar blocks. */
function busyMinsPerDay(
  blocks: CalendarBusyBlock[],
  weekStart: string
): number[] {
  const result = Array.from({ length: 7 }, () => 0);
  for (let i = 0; i < 7; i++) {
    const dayStart = new Date(addDaysYmd(weekStart, i) + "T00:00:00").getTime();
    const dayEnd = dayStart + 86_400_000;
    for (const b of blocks) {
      const s = Math.max(new Date(b.start).getTime(), dayStart);
      const e = Math.min(new Date(b.end).getTime(), dayEnd);
      if (e > s) result[i] += Math.round((e - s) / 60_000);
    }
  }
  return result;
}

/** The activity's own sub-line: what the athlete said about it, or nothing. */
function feedbackLine(a: {
  perceivedExertion: number | null;
  feel: string | null;
  debriefState: string | null;
}): string | null {
  const parts: string[] = [];
  if (a.perceivedExertion != null) {
    parts.push(`RPE ${Math.round(a.perceivedExertion)}`);
  }
  if (a.feel) parts.push(`felt ${a.feel}`);
  if (parts.length > 0) return parts.join(" · ");
  return a.debriefState === "pending" ? "debrief pending" : null;
}

export default async function TrainPage({
  searchParams,
}: {
  searchParams: Promise<{
    tab?: string;
    sport?: string;
    view?: string;
    month?: string;
    range?: string;
  }>;
}) {
  const user = await requireUser();
  const sp = await searchParams;

  const tab: TrainTab = TRAIN_TABS.find((t) => t === sp.tab) ?? "week";
  const view: "today" | "week" | "month" =
    sp.view === "today" || sp.view === "month" ? sp.view : "week";
  const month =
    sp.month && /^\d{4}-\d{2}$/.test(sp.month) ? sp.month : currentYm();
  const range = RANGES.includes(Number(sp.range)) ? Number(sp.range) : 90;
  const sportFilter = sp.sport;

  // One href builder for every segment, filter and range link on the page —
  // switching one axis never drops the others (see src/lib/log-href.ts).
  const href: TrainHref = (over) =>
    buildTrainHref({ tab, view, month, range, sport: sportFilter ?? "" }, over);

  return (
    <AppShell>
      {tab === "week" ? (
        <WeekTab userId={user.id} href={href} />
      ) : tab === "history" ? (
        <HistoryTab
          userId={user.id}
          href={href}
          view={view}
          month={month}
          sportFilter={sportFilter}
        />
      ) : (
        <FitnessTab userId={user.id} href={href} range={range} />
      )}
    </AppShell>
  );
}

/** Shared page chrome: title, contextual subtitle/action, segmented control. */
function TrainHeader({
  subtitle,
  action,
  tab,
  href,
}: {
  subtitle?: string;
  action?: React.ReactNode;
  tab: TrainTab;
  href: TrainHref;
}) {
  return (
    <header className="mb-5 pt-8">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-[22px] font-bold tracking-[-0.03em]">Train</h1>
          {subtitle && (
            <p className="mt-0.5 truncate text-[10.5px] font-medium text-white/50">
              {subtitle}
            </p>
          )}
        </div>
        {action}
      </div>
      <TrainTabs active={tab} href={href} />
    </header>
  );
}

// ── Week (1c) ─────────────────────────────────────────────────────────────

async function WeekTab({ userId, href }: { userId: string; href: TrainHref }) {
  const plan = await db.query.trainingPlans.findFirst({
    where: and(
      eq(schema.trainingPlans.userId, userId),
      eq(schema.trainingPlans.status, "active")
    ),
  });

  // The readiness chip reads the same daily_metrics row Today's hero does,
  // so the two screens can never disagree about the athlete's band.
  const latestMetric = await db.query.dailyMetrics.findFirst({
    where: eq(schema.dailyMetrics.userId, userId),
    orderBy: desc(schema.dailyMetrics.date),
  });
  const readinessMetric =
    latestMetric?.readiness != null
      ? latestMetric
      : (
          await db.query.dailyMetrics.findMany({
            where: eq(schema.dailyMetrics.userId, userId),
            orderBy: desc(schema.dailyMetrics.date),
            limit: 7,
          })
        ).find((m) => m.readiness != null);
  const band = (readinessMetric?.band ?? "calibrating") as Band;
  const readiness = readinessMetric?.readiness ?? null;

  const chip = (
    <span
      className="shrink-0 rounded-full border px-3 py-1 text-[10.5px] font-bold"
      style={{
        borderColor:
          band === "calibrating" ? "rgba(255,255,255,0.15)" : BAND_COLOR[band],
        color: BAND_COLOR[band],
      }}
    >
      <span
        aria-hidden
        className="mr-1.5 inline-block size-1.5 rounded-full align-middle"
        style={{ background: BAND_COLOR[band] }}
      />
      {readiness != null ? `${readiness} · ${band}` : "calibrating"}
    </span>
  );

  if (!plan) {
    return (
      <>
        <TrainHeader tab="week" href={href} action={chip} />
        <PlanEmpty />
      </>
    );
  }

  const week = await getOpenWeekPlan(userId);
  const adjustments = week ? await listAdjustments(week.id) : [];
  const races = await listRaces(userId);

  const blocks = await db.query.trainingBlocks.findMany({
    where: eq(schema.trainingBlocks.planId, plan.id),
    orderBy: [asc(schema.trainingBlocks.weekNumber)],
  });
  const remaining = blocks.filter((b) => b.weekNumber >= plan.currentWeek);
  const openBlock = blocks.find(
    (b) => b.weekNumber === (week?.skeletonWeek ?? plan.currentWeek)
  );

  // Availability intake — only while the week hasn't started completing.
  let intake: { suggested: number[] } | null = null;
  if (week && week.days[0]?.status !== "completed") {
    // Calendar prefill lives here, where a human confirms it — never in
    // the automatic rollover (spec).
    let busy: number[] | null = null;
    const connection = await db.query.connections.findFirst({
      where: and(
        eq(schema.connections.userId, userId),
        eq(schema.connections.provider, "google_calendar"),
        eq(schema.connections.status, "active")
      ),
    });
    if (connection) {
      try {
        const accessToken = await getValidGoogleAccessToken(connection);
        const busyBlocks = await fetchBusyTimes({
          accessToken,
          startDate: week.weekStart,
          endDate: addDaysYmd(week.weekStart, 7),
        });
        busy = busyMinsPerDay(busyBlocks, week.weekStart);
      } catch {
        busy = null; // calendar is a hint, never a blocker
      }
    }
    const constraints = (plan.constraints ?? {}) as {
      daysPerWeek?: number;
      hoursPerWeek?: number;
    };
    intake = {
      suggested: prefillAvailability({
        hoursPerWeek: constraints.hoursPerWeek ?? 8,
        daysPerWeek: constraints.daysPerWeek ?? 5,
        lastWeekMins: week.days.map((d) => d.availableMins),
        busyMinsPerDay: busy,
      }),
    };
  }

  // Next race as the compact row under the week; the full list stays in the
  // races section below.
  const today = new Date();
  const race = await nextUpcomingRace(userId, today);
  let raceCard: RaceCountdownProps = {
    race: null,
    daysOut: null,
    outlook: null,
  };
  if (race) {
    const assembled = await assembleForecastInputs(userId, race, today, week);
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
            new Date(localYmd(today) + "T00:00:00").getTime()) /
            86_400_000
        )
      ),
      outlook,
    };
  }

  const subtitle = [
    plan.title,
    `week ${Math.min(plan.currentWeek, plan.weeksTotal)} of ${plan.weeksTotal}`,
    openBlock?.phase ? `${openBlock.phase} phase` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <>
      <TrainHeader tab="week" href={href} subtitle={subtitle} action={chip} />

      {week ? (
        <>
          <section className="mb-4">
            <WeekStrip days={week.days} />
          </section>

          <WeekDayList days={week.days} />

          {raceCard.race && (
            <>
              <RaceChip {...raceCard} />
              {raceCard.race.goalNote && (
                <p className="-mt-5 mb-6 px-1 text-[10.5px] text-white/40">
                  {raceCard.race.goalNote}
                </p>
              )}
            </>
          )}

          {adjustments.length > 0 && (
            <div className="mb-5">
              <Collapsible>
                <CollapsibleTrigger className="rounded-[18px] p-4">
                  <span className="text-[11px] font-bold uppercase tracking-[0.15em] text-white/60">
                    What changed &amp; why · {adjustments.length}
                  </span>
                </CollapsibleTrigger>
                <CollapsiblePanel>
                  <ul className="px-4 pb-4 pt-3">
                    {adjustments.map((a) => (
                      <li
                        key={a.id}
                        className="border-b border-white/[0.06] py-2.5 last:border-0"
                      >
                        <p className="text-[12px] text-white/80">
                          <span aria-hidden className="mr-1.5 text-white/30">
                            ↻
                          </span>
                          {a.reason}
                        </p>
                        <p className="mt-0.5 pl-4 text-[10px] text-white/35">
                          {a.createdAt.toLocaleString("en-US", {
                            month: "short",
                            day: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </p>
                      </li>
                    ))}
                  </ul>
                </CollapsiblePanel>
              </Collapsible>
            </div>
          )}

          {intake && (
            <section className="mb-6">
              <IntakeForm
                suggested={intake.suggested}
                action={submitAvailability}
              />
            </section>
          )}
        </>
      ) : (
        <section className="mb-6">
          <form
            action={startWeek}
            className="rounded-[18px] border border-white/[0.08] bg-white/[0.03] p-5"
          >
            <p className="text-[12.5px] leading-relaxed text-white/70">
              This week hasn&apos;t been planned yet. Start it now and it
              materializes from your skeleton — you can adjust your availability
              right after.
            </p>
            <button
              type="submit"
              className="mt-4 w-full rounded-full bg-emerald-500 py-2.5 text-[11.5px] font-bold text-black transition-opacity hover:opacity-90"
            >
              Plan this week
            </button>
          </form>
        </section>
      )}

      {/* The next race already has its chip above with the countdown and form
          outlook. This is the management list (add / status / delete), so it
          stays collapsed rather than printing the same race twice. */}
      {races.length > 0 && (
        <div className="mb-5">
          <Collapsible>
            <CollapsibleTrigger className="rounded-[18px] p-4">
              <span className="text-[11px] font-bold uppercase tracking-[0.15em] text-white/60">
                Races · {races.length}
              </span>
            </CollapsibleTrigger>
            <CollapsiblePanel>
              <div className="px-4 pb-1 pt-3">
                <RacesSection races={races} hideHeading />
              </div>
            </CollapsiblePanel>
          </Collapsible>
        </div>
      )}
      {races.length === 0 && (
        <div className="mb-5">
          <RacesSection races={races} />
        </div>
      )}

      {remaining.length > 0 && (
        <div className="mb-10">
          <Collapsible>
            <CollapsibleTrigger className="rounded-[18px] p-4">
              <span className="text-[11px] font-bold uppercase tracking-[0.15em] text-white/60">
                Remaining skeleton · {remaining.length}
              </span>
            </CollapsibleTrigger>
            <CollapsiblePanel>
              <table className="w-full text-left">
                <thead>
                  <tr className="text-[9px] font-bold uppercase tracking-[0.15em] text-white/40">
                    <th className="px-4 py-2">Week</th>
                    <th className="px-4 py-2">Phase</th>
                    <th className="px-4 py-2 text-right">Target load</th>
                  </tr>
                </thead>
                <tbody>
                  {remaining.map((b) => (
                    <tr
                      key={b.weekNumber}
                      className="border-t border-white/[0.06]"
                    >
                      <td className="px-4 py-2 font-mono text-[11px] text-white/80">
                        {b.weekNumber}
                      </td>
                      <td className="px-4 py-2 text-[11px] capitalize text-white/60">
                        {b.phase}
                      </td>
                      <td className="px-4 py-2 text-right font-mono text-[11px] text-white/60">
                        {b.targetLoadTotal != null
                          ? Math.round(b.targetLoadTotal)
                          : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CollapsiblePanel>
          </Collapsible>
        </div>
      )}
    </>
  );
}

// ── History (1d) ──────────────────────────────────────────────────────────

async function HistoryTab({
  userId,
  href,
  view,
  month,
  sportFilter,
}: {
  userId: string;
  href: TrainHref;
  view: "today" | "week" | "month";
  month: string;
  sportFilter: string | undefined;
}) {
  const allActivities = await db.query.activities.findMany({
    where: and(
      eq(schema.activities.userId, userId),
      ne(schema.activities.provider, "strava")
    ),
    orderBy: desc(schema.activities.startDate),
    limit: 400,
  });

  const sports = [...new Set(allActivities.map((a) => a.sport))].sort();

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const windowStart =
    view === "today"
      ? startOfToday
      : view === "week"
        ? new Date(daysAgo(7))
        : new Date(`${month}-01T00:00:00`);
  const windowEnd =
    view === "month"
      ? new Date(
          new Date(`${month}-01T00:00:00`).getFullYear(),
          new Date(`${month}-01T00:00:00`).getMonth() + 1,
          1
        )
      : null;

  const sportActivities = sportFilter
    ? allActivities.filter((a) => a.sport === sportFilter)
    : allActivities;
  const activities = sportActivities.filter(
    (a) =>
      a.startDate >= windowStart &&
      (windowEnd == null || a.startDate < windowEnd)
  );

  // Grouped by local day; the query already returns newest-first.
  const groups: HistoryGroup[] = [];
  for (const a of activities) {
    const key = localYmd(a.startDate);
    const last = groups[groups.length - 1];
    const row = {
      id: a.id,
      name: a.name ?? a.sport,
      sport: a.sport,
      startDate: a.startDate,
      durationS: a.durationS,
      load: a.load,
      distanceM: a.distanceM,
      feedback: feedbackLine(a),
    };
    if (last && last.day === key) last.items.push(row);
    else groups.push({ day: key, items: [row] });
  }

  // The strip totals exactly what's listed below it — same filtered set, so
  // the summary can never disagree with the rows.
  const totalSecs = activities.reduce((s, a) => s + (a.durationS ?? 0), 0);
  const totalLoad = activities.reduce((s, a) => s + (a.load ?? 0), 0);
  const totalMeters = activities.reduce((s, a) => s + (a.distanceM ?? 0), 0);
  const scope =
    view === "today"
      ? "Today"
      : view === "week"
        ? "7 days"
        : monthLabelFor(month);

  return (
    <>
      <TrainHeader
        tab="history"
        href={href}
        action={
          <Link
            href="/activity/log"
            className="flex shrink-0 items-center gap-1 rounded-full bg-emerald-500/10 px-3 py-1.5 text-[10.5px] font-bold text-emerald-400 transition-colors hover:bg-emerald-500/20"
          >
            <Plus aria-hidden className="size-3" />
            Log activity
          </Link>
        }
      />

      <HistoryStatStrip
        scope={scope}
        stats={[
          { value: `${(totalSecs / 3600).toFixed(1)}h` },
          { value: String(Math.round(totalLoad)), label: "load" },
          { value: String(activities.length), label: "sessions" },
          ...(totalMeters > 0
            ? [{ value: (totalMeters / 1000).toFixed(0), label: "km" }]
            : []),
        ]}
      />

      <div className="mb-4">
        <ViewTabs active={view} month={month} href={href} />
      </div>

      {sports.length > 1 && (
        <nav
          aria-label="Filter by sport"
          className="hide-scrollbar -mx-6 mb-4 flex gap-1.5 overflow-x-auto px-6"
        >
          <Link
            href={href({ sport: "" })}
            aria-current={!sportFilter ? "true" : undefined}
            className={`whitespace-nowrap rounded-full px-3.5 py-1.5 text-[10px] font-bold uppercase tracking-wider transition-colors ${
              !sportFilter
                ? "bg-white/[0.12] text-white"
                : "bg-white/[0.04] text-white/50 hover:text-white/80"
            }`}
          >
            All
          </Link>
          {sports.map((s) => (
            <Link
              key={s}
              href={href({ sport: s })}
              aria-current={sportFilter === s ? "true" : undefined}
              className={`whitespace-nowrap rounded-full px-3.5 py-1.5 text-[10px] font-bold uppercase tracking-wider transition-colors ${
                sportFilter === s
                  ? "bg-white/[0.12] text-white"
                  : "bg-white/[0.04] text-white/50 hover:text-white/80"
              }`}
            >
              {s}
            </Link>
          ))}
        </nav>
      )}

      <div className="pb-10">
        {groups.length > 0 ? (
          <HistoryList groups={groups} />
        ) : (
          <EmptyState
            icon={Bike}
            message={
              sportFilter
                ? `No ${sportFilter} activities ${scope === "Today" ? "today" : `in ${scope.toLowerCase()}`}.`
                : `No activities ${scope === "Today" ? "today" : `in ${scope.toLowerCase()}`}.`
            }
          />
        )}
      </div>
    </>
  );
}

// ── Fitness (1e) ──────────────────────────────────────────────────────────

async function FitnessTab({
  userId,
  href,
  range,
}: {
  userId: string;
  href: TrainHref;
  range: number;
}) {
  const wellness = await db.query.wellnessDaily.findMany({
    where: and(
      eq(schema.wellnessDaily.userId, userId),
      gte(schema.wellnessDaily.date, daysAgo(range))
    ),
    orderBy: schema.wellnessDaily.date,
  });

  const activities = await db.query.activities.findMany({
    where: and(
      eq(schema.activities.userId, userId),
      ne(schema.activities.provider, "strava")
    ),
    orderBy: desc(schema.activities.startDate),
    limit: 400,
  });

  const weekly = weeklyLoads(
    activities.map((a) => ({ startDate: a.startDate, load: a.load })),
    12
  );

  // ctl/atl come from the wellness series; null means calibrating, never 0.
  const latest = [...wellness].reverse().find((w) => w.ctl != null);
  const ctl = latest?.ctl ?? null;
  const atl = latest?.atl ?? null;
  const tsb = ctl != null && atl != null ? ctl - atl : null;

  // "▲ +4 in 28d" — CTL against itself four weeks back, only when both ends
  // are real values inside the loaded range.
  const priorCtl = wellness.find(
    (w) => w.date >= daysAgo(28) && w.ctl != null
  )?.ctl;
  const ctlDelta =
    ctl != null && priorCtl != null ? Math.round(ctl - priorCtl) : null;

  const weekStart = new Date(daysAgo(7));
  const weekLoad = activities
    .filter((a) => a.startDate >= weekStart)
    .reduce((s, a) => s + (a.load ?? 0), 0);

  const tiles: FitnessTile[] = [
    {
      label: "Fitness · CTL",
      value: ctl != null ? String(Math.round(ctl)) : "—",
      color: "#60a5fa",
      // A flat block is flat — no arrow, no colour, no implied progress.
      context:
        ctlDelta == null
          ? null
          : ctlDelta === 0
            ? "level over 28d"
            : `${ctlDelta > 0 ? "▲ +" : "▼ −"}${Math.abs(ctlDelta)} in 28d`,
      contextColor:
        ctlDelta != null && ctlDelta > 0 ? "#34d399" : "rgba(255,255,255,0.4)",
    },
    {
      label: "Fatigue · ATL",
      value: atl != null ? String(Math.round(atl)) : "—",
      color: "#f87171",
      context: weekLoad > 0 ? `7d load ${Math.round(weekLoad)}` : null,
    },
    {
      label: "Form · TSB",
      value:
        tsb != null ? `${tsb < 0 ? "−" : ""}${Math.abs(tsb).toFixed(1)}` : "—",
      color: "#34d399",
      context:
        tsb == null
          ? null
          : tsb > 5
            ? "fresh"
            : tsb < -10
              ? "deep fatigue"
              : "neutral zone",
    },
  ];

  const latestOf = (key: "eftp" | "pMax" | "wPrime" | "rampRate") =>
    [...wellness].reverse().find((w) => w[key] != null)?.[key] ?? null;

  const eftp = latestOf("eftp");
  const pMax = latestOf("pMax");
  const wPrime = latestOf("wPrime");
  const rampLabel = rampTrendLabel(latestOf("rampRate"));

  const fitnessStats: { label: string; value: string }[] = [];
  if (eftp != null) {
    fitnessStats.push({ label: "eFTP", value: `${Math.round(eftp)}W` });
  }
  if (pMax != null) {
    fitnessStats.push({ label: "Max Power", value: `${Math.round(pMax)}W` });
  }
  if (wPrime != null) {
    fitnessStats.push({
      label: "W'",
      value: `${(wPrime / 1000).toFixed(1)}kJ`,
    });
  }
  if (rampLabel != null) {
    fitnessStats.push({ label: "Ramp", value: rampLabel });
  }

  const hasLoadSeries = wellness.some((w) => w.ctl != null);

  return (
    <>
      <TrainHeader
        tab="fitness"
        href={href}
        action={<RangeTabs active={range} view="training" href={href} />}
      />

      <FitnessTiles tiles={tiles} />

      <section className="mb-4 rounded-[18px] border border-white/[0.08] bg-white/[0.03] p-4">
        {hasLoadSeries ? (
          <>
            {/* showStats off: the tiles above already carry CTL/ATL/TSB. */}
            <PmcChart
              showStats={false}
              wellness={wellness.map((w) => ({
                date: w.date,
                ctl: w.ctl,
                atl: w.atl,
              }))}
            />
            <ul className="mt-3 flex items-center gap-4 border-t border-white/[0.06] pt-3">
              {[
                { label: "CTL", color: "#60a5fa" },
                { label: "ATL", color: "#f87171" },
                { label: "TSB", color: "#34d399" },
              ].map((l) => (
                <li
                  key={l.label}
                  className="flex items-center gap-1.5 text-[9.5px] font-bold uppercase tracking-wider text-white/50"
                >
                  <span
                    aria-hidden
                    className="h-0.5 w-4 rounded-full"
                    style={{ background: l.color }}
                  />
                  {l.label}
                </li>
              ))}
            </ul>
          </>
        ) : (
          <EmptyState icon={LineChart} message="No training-load data yet." />
        )}
      </section>

      {weekly.some((w) => w.load > 0) && (
        <div className="mb-4">
          <WeeklyLoadBars data={weekly} />
        </div>
      )}

      {fitnessStats.length > 0 && (
        <div className="mb-10 rounded-[18px] border border-white/[0.08] bg-white/[0.03] p-4">
          <FitnessStatsRow stats={fitnessStats} />
        </div>
      )}

      {!hasLoadSeries && fitnessStats.length === 0 && (
        <div className="mb-10">
          <EmptyState
            icon={ClipboardList}
            message="Connect a training source in Settings to build a fitness picture."
          />
        </div>
      )}
    </>
  );
}

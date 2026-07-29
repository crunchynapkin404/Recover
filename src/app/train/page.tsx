import Link from "next/link";
import { and, asc, desc, eq, gte, inArray, ne } from "drizzle-orm";
import { Bike, ClipboardList, LineChart, Plus } from "lucide-react";
import { db, schema } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { AppShell, shellUser } from "@/components/app-shell";
import { WeekStrip } from "@/components/plan/week-strip";
import { RacesSection } from "@/components/plan/races-section";
import { IntakeForm } from "@/components/plan/intake-form";
import { StandardWeek } from "@/components/plan/standard-week";
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
import { WeekRationale } from "@/components/plan/week-rationale";
import { EventReadiness } from "@/components/plan/event-readiness";
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
import {
  getOpenWeekPlan,
  listAdjustments,
  planConstraints,
} from "@/lib/week-plan/service";
import { assembleWeeklyTarget } from "@/lib/week-plan/volume-inputs";
import { assessFeasibility, type Feasibility } from "@/lib/race/feasibility";
import type { EventDemand } from "@/lib/race/demand";
import {
  listRaces,
  nextUpcomingRace,
  assembleForecastInputs,
} from "@/lib/race/service";
import { forecastForm } from "@/lib/race/forecast";
import { localYmd, weeklyLoads } from "@/lib/charts";
import {
  buildTrainHref,
  TRAIN_TABS,
  type TrainHref,
  type TrainTab,
} from "@/lib/log-href";
import { startWeek, submitAvailability } from "@/app/plan/actions";
import { blockMins, type AvailabilityBlock } from "@/lib/availability/types";
import { resolveWeek } from "@/lib/availability/resolve";
import {
  availabilityVerdict,
  type Verdict,
} from "@/lib/week-plan/ctl-projection";

export const dynamic = "force-dynamic";

const RANGES = [30, 90, 180, 365];

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

function monthLabelFor(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });
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
    <AppShell user={shellUser(user)}>
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
  const constraints = planConstraints(plan.constraints);

  // Why this week looks the way it does — the same figures the rollover
  // derived, recomputed for display. Reading them off the stored week
  // instead would show a target that no longer matches what the athlete's
  // calendar and races now say.
  let rationale: {
    reasons: string[];
    targetHours: number | null;
    plannedHours: number | null;
    shortfall: { wantedHours: number; offeredHours: number } | null;
    raceName: string | null;
    source: "race" | "ceiling" | "floor" | "fallback" | null;
  } | null = null;
  // Is the athlete's next race reachable from here — the question anyone
  // entering a hard event actually has. Captured out of the `if (week)`
  // block below (where `volumeInputs` lives) so it survives to the render
  // section further down.
  let eventReadiness: {
    raceName: string;
    feasibility: Feasibility;
    demand: EventDemand;
  } | null = null;
  if (week) {
    // `adjustments` above already holds every plan_adjustments row for this
    // week (fetched for the "What changed & why" panel) — filter the array
    // already in scope instead of re-querying the same table.
    const reasons = adjustments
      .filter(
        (a) =>
          a.trigger === "weekly_rollover" || a.trigger === "availability_change"
      )
      .map((a) => a.reason);

    const availabilityHours =
      week.days.reduce((s, d) => s + d.availableMins, 0) / 60;
    // fallbackHours must be the active plan's own hoursPerWeek — exactly what
    // rolloverWeekPlan passes — never this week's own availability. A
    // fallback equal to availability makes `availability < target`
    // structurally false, so the shortfall could never fire and the shown
    // target would silently always equal whatever the calendar offered,
    // regardless of the plan's real hoursPerWeek. Routed through
    // assembleWeeklyTarget — the same producer the dashboard's WeekRow
    // calls — so the two surfaces can never show different numbers
    // (final-review Finding I5).
    const { target, ...volumeInputs } = await assembleWeeklyTarget(
      userId,
      new Date(),
      { availabilityHours, planHoursPerWeek: constraints.hoursPerWeek }
    );
    const plannedHours =
      week.days.reduce(
        (s, d) => s + d.workouts.reduce((t, w) => t + w.durationMins, 0),
        0
      ) / 60;

    rationale = {
      reasons,
      targetHours: target.hours,
      plannedHours,
      shortfall: target.shortfall,
      raceName: volumeInputs.targetRace?.name ?? null,
      source: target.source,
    };

    // Weeks until the event, counted from this week's Monday so it agrees
    // with the rest of the page rather than drifting by a day mid-week.
    const raceDate = volumeInputs.targetRace?.date ?? null;
    const weeksUntilEvent =
      raceDate == null
        ? null
        : Math.max(
            0,
            Math.round(
              (new Date(raceDate + "T00:00:00").getTime() -
                new Date(week.weekStart + "T00:00:00").getTime()) /
                (7 * 24 * 60 * 60 * 1000)
            )
          );

    const feasibility =
      volumeInputs.demand == null || weeksUntilEvent == null
        ? null
        : assessFeasibility({
            requiredWeeklyHours: volumeInputs.demand.weeklyHours,
            currentWeeklyHours: volumeInputs.level.peakHours,
            queenStageHours: volumeInputs.demand.queenStageHours,
            queenStageKnown: volumeInputs.demand.queenStageKnown,
            longestRideHours: volumeInputs.longestRideHours,
            weeksUntilEvent,
          });

    if (volumeInputs.targetRace && volumeInputs.demand && feasibility) {
      eventReadiness = {
        raceName: volumeInputs.targetRace.name,
        feasibility,
        demand: volumeInputs.demand,
      };
    }
  }

  const defaultRows = await db.query.availabilityDefaults.findMany({
    where: eq(schema.availabilityDefaults.userId, userId),
  });
  const standardWeek: AvailabilityBlock[][] = Array.from(
    { length: 7 },
    (_, i) =>
      (defaultRows.find((r) => r.weekday === i)?.blocks as
        AvailabilityBlock[] | undefined) ?? []
  );

  const blocks = await db.query.trainingBlocks.findMany({
    where: eq(schema.trainingBlocks.planId, plan.id),
    orderBy: [asc(schema.trainingBlocks.weekNumber)],
  });
  const remaining = blocks.filter((b) => b.weekNumber >= plan.currentWeek);
  const openBlock = blocks.find(
    (b) => b.weekNumber === (week?.skeletonWeek ?? plan.currentWeek)
  );

  // Availability intake — only while the week hasn't started completing.
  let intake: {
    resolved: AvailabilityBlock[][];
    dates: string[];
    overrideDates: string[];
    verdict: Verdict;
  } | null = null;
  if (week && week.days[0]?.status !== "completed") {
    const dates = week.days.map((d) => d.date);
    const resolvedMap = await resolveWeek(userId, dates);
    const overrides = await db.query.availabilityOverrides.findMany({
      where: and(
        eq(schema.availabilityOverrides.userId, userId),
        inArray(schema.availabilityOverrides.date, dates)
      ),
    });

    // Load per hour over the last 28 days, from real sessions only.
    const since = new Date();
    since.setDate(since.getDate() - 28);
    const recent = await db.query.activities.findMany({
      where: and(
        eq(schema.activities.userId, userId),
        ne(schema.activities.provider, "strava"),
        gte(schema.activities.startDate, since)
      ),
    });
    const hours = recent.reduce((s, a) => s + (a.durationS ?? 0) / 3600, 0);
    const load = recent.reduce((s, a) => s + (a.load ?? 0), 0);
    const loadPerHour = hours > 0 ? load / hours : null;

    // The real span of history, not "any activity means 28 days". An
    // athlete who synced their first ride yesterday must not be told what
    // their CTL will do.
    const oldest = recent.reduce<Date | null>((min, a) => {
      const d = a.startDateLocal ?? a.startDate;
      return min == null || d < min ? d : min;
    }, null);
    const historyDays =
      oldest == null
        ? 0
        : Math.floor((new Date().getTime() - oldest.getTime()) / 86_400_000);

    const offeredMins = dates.reduce(
      (s, d) =>
        s + (resolvedMap.get(d) ?? []).reduce((x, b) => x + blockMins(b), 0),
      0
    );

    intake = {
      resolved: dates.map((d) => resolvedMap.get(d) ?? []),
      dates,
      overrideDates: overrides.map((o) => o.date),
      verdict: availabilityVerdict({
        offeredMins,
        currentCtl: latestMetric?.ctl ?? null,
        loadPerHour,
        historyDays,
        effectiveTarget: week.effectiveTarget ?? 0,
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

          {rationale && (
            <WeekRationale
              reasons={rationale.reasons}
              targetHours={rationale.targetHours}
              plannedHours={rationale.plannedHours}
              shortfall={rationale.shortfall}
              raceName={rationale.raceName}
              source={rationale.source}
            />
          )}

          {eventReadiness && (
            <EventReadiness
              raceName={eventReadiness.raceName}
              feasibility={eventReadiness.feasibility}
              demand={eventReadiness.demand}
            />
          )}

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
                resolved={intake.resolved}
                dates={intake.dates}
                overrideDates={intake.overrideDates}
                verdict={intake.verdict}
                sports={constraints.sports ?? ["Bike"]}
                action={submitAvailability}
              />
            </section>
          )}

          <div className="mb-6">
            <Collapsible>
              <CollapsibleTrigger className="rounded-[18px] p-4">
                <span className="text-[11px] font-bold uppercase tracking-[0.15em] text-white/60">
                  Standard week
                </span>
              </CollapsibleTrigger>
              <CollapsiblePanel>
                <div className="px-1 pb-1 pt-3">
                  <StandardWeek
                    defaults={standardWeek}
                    sports={constraints.sports ?? ["Bike"]}
                  />
                </div>
              </CollapsiblePanel>
            </Collapsible>
          </div>
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
  const activities = sportActivities.filter((a) => {
    const local = a.startDateLocal ?? a.startDate;
    return local >= windowStart && (windowEnd == null || local < windowEnd);
  });

  // Grouped by local day; the query already returns newest-first.
  const groups: HistoryGroup[] = [];
  for (const a of activities) {
    const key = localYmd(a.startDateLocal ?? a.startDate);
    const last = groups[groups.length - 1];
    const row = {
      id: a.id,
      name: a.name ?? a.sport,
      sport: a.sport,
      startDate: a.startDateLocal ?? a.startDate,
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
    activities.map((a) => ({
      startDate: a.startDateLocal ?? a.startDate,
      load: a.load,
    })),
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
    .filter((a) => (a.startDateLocal ?? a.startDate) >= weekStart)
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

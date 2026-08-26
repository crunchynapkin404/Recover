import Link from "next/link";
import { and, asc, desc, eq, gte, inArray, lte, ne } from "drizzle-orm";
import { Bike, ClipboardList, LineChart, Plus } from "lucide-react";
import { db, schema } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { recordSurfaceView } from "@/lib/telemetry";
import { getActivePlan } from "@/lib/active-plan";
import { AppShell, shellUser } from "@/components/app-shell";
import { WeekStrip } from "@/components/week/week-strip";
import {
  RacesSection,
  type RaceListItem,
} from "@/components/train/races-section";
import { IntakeForm } from "@/components/week/intake-form";
import { StandardWeek } from "@/components/train/standard-week";
import { PlanEmpty } from "@/components/train/plan-empty";
import { PlanPreviewCard } from "@/components/train/plan-preview-card";
import { PmcChart } from "@/components/train/pmc-chart";
import { WeeklyLoadBars } from "@/components/train/weekly-load-bars";
import {
  FitnessStatsRow,
  rampTrendLabel,
} from "@/components/train/fitness-stats-row";
import { RangeTabs } from "@/components/train/range-tabs";
import { ViewTabs, currentYm } from "@/components/train/view-tabs";
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsiblePanel,
} from "@/components/ui/collapsible";
import { EmptyState } from "@/components/ui/empty-state";
import { TrainTabs } from "@/components/train/train-tabs";
import { WeekDayList } from "@/components/train/week-day-list";
import { SeasonTimelineCard } from "@/components/train/season-timeline-card";
import { FuellingCard } from "@/components/train/fuelling-card";
import { PlanStyleSwitch } from "@/components/train/plan-style-switch";
import { SeasonModeSwitch } from "@/components/train/season-mode-switch";
import { WeekRationale } from "@/components/week/week-rationale";
import { EventReadiness } from "@/components/train/event-readiness";
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
import { raceCard } from "@/lib/race/outlook";
import { Unavailable } from "@/components/ui/unavailable";
import { isFirstRun } from "@/lib/first-run";

/** Seconds per km as m:ss/km. 285 -> "4:45/km". */
function fmtPace(secPerKm: number): string {
  const m = Math.floor(secPerKm / 60);
  const sec = Math.round(secPerKm % 60);
  return `${m}:${String(sec).padStart(2, "0")}/km`;
}
import { BAND_TEXT, BAND_DOT } from "@/lib/band-color";
import type { Band } from "@/lib/readiness";
import { Figure } from "@/lib/uncertainty";
import {
  addDaysYmd,
  getOpenWeekPlan,
  listAdjustments,
  planConstraints,
} from "@/lib/week-plan/service";
import { deriveDayActuals } from "@/lib/week-plan/actuals";
import {
  disciplinesOf,
  requirePlanSport,
  type PlanSport,
} from "@/lib/plan-sport";
import { previewFromDraft } from "@/lib/training-plan";
import { planRaceTargets } from "@/lib/plan-targets";
import { assembleWeeklyTarget } from "@/lib/week-plan/volume-inputs";
import { currentTargetLoad, weekTargetLoad } from "@/lib/week-plan/volume";
import { plannedMins, availableMins } from "@/lib/week-plan/fill";
import { feasibilityFor, type Feasibility } from "@/lib/race/feasibility";
import type { EventDemandResult } from "@/lib/race/demand";
import { listRaces, stagesByRaceIds } from "@/lib/race/service";
import {
  localYmd,
  seasonTimelinePoints,
  weeklyActivitySummaries,
  weeklyLoads,
} from "@/lib/charts";
import {
  buildTrainHref,
  isRange,
  TRAIN_DEFAULTS,
  TRAIN_TABS,
  type TrainHref,
  type TrainTab,
} from "@/lib/log-href";
import {
  submitPlanStyleQuick,
  submitSeasonModeQuick,
  startWeek,
  submitAvailability,
} from "@/app/plan/actions";
import {
  AvailabilityWeekSwitcher,
  type AvailabilityWeekMode,
  type WeekIntake,
} from "@/components/train/availability-week-switcher";
import { blockMins, type AvailabilityBlock } from "@/lib/availability/types";
import { resolveWeek } from "@/lib/availability/resolve";
import { availabilityVerdict } from "@/lib/week-plan/ctl-projection";
import { projectWeek } from "@/lib/week-plan/project";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

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

/**
 * One week's worth of `IntakeForm` data — resolved blocks, which dates carry
 * an override, and the availability verdict. Shared by this week's and next
 * week's derivation (Task 5's fix pass) so the two never drift apart; only
 * `dates` and `effectiveTarget` differ between the two callers.
 */
async function resolveWeekIntake(
  userId: string,
  dates: string[],
  verdictInput: {
    currentCtl: number | null;
    loadPerHour: number | null;
    historyDays: number;
    effectiveTarget: number;
  }
): Promise<Omit<WeekIntake, "weekStart">> {
  const resolvedMap = await resolveWeek(userId, dates);
  const overrides = await db.query.availabilityOverrides.findMany({
    where: and(
      eq(schema.availabilityOverrides.userId, userId),
      inArray(schema.availabilityOverrides.date, dates)
    ),
  });
  const offeredMins = dates.reduce(
    (s, d) =>
      s + (resolvedMap.get(d) ?? []).reduce((x, b) => x + blockMins(b), 0),
    0
  );
  return {
    resolved: dates.map((d) => resolvedMap.get(d) ?? []),
    dates,
    overrideDates: overrides.map((o) => o.date),
    verdict: availabilityVerdict({ ...verdictInput, offeredMins }),
  };
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
    availability?: string;
  }>;
}) {
  const user = await requireUser();
  await recordSurfaceView(user.id, "train");
  const sp = await searchParams;

  const tab: TrainTab = TRAIN_TABS.find((t) => t === sp.tab) ?? "week";
  const view: "today" | "week" | "month" =
    sp.view === "today" || sp.view === "month" ? sp.view : "week";
  const month =
    sp.month && /^\d{4}-\d{2}$/.test(sp.month) ? sp.month : currentYm();
  const range = isRange(sp.range) ? Number(sp.range) : TRAIN_DEFAULTS.range;
  const sportFilter = sp.sport;
  // Direct reachability for the availability week switcher: a link to
  // `?availability=next` (the next-week preview, wired up separately) must
  // start the control in next-week mode on a fresh load, not only on click.
  const initialAvailabilityMode: AvailabilityWeekMode =
    sp.availability === "next" ? "next" : "this";

  // One href builder for every segment, filter and range link on the page —
  // switching one axis never drops the others (see src/lib/log-href.ts).
  const href: TrainHref = (over) =>
    buildTrainHref({ tab, view, month, range, sport: sportFilter ?? "" }, over);

  return (
    <AppShell user={shellUser(user)}>
      {tab === "week" ? (
        <WeekTab
          userId={user.id}
          href={href}
          initialAvailabilityMode={initialAvailabilityMode}
        />
      ) : tab === "history" ? (
        <HistoryTab
          userId={user.id}
          href={href}
          view={view}
          month={month}
          sportFilter={sportFilter}
        />
      ) : tab === "season" ? (
        <SeasonTab userId={user.id} href={href} />
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
  controls,
  controlsNote,
  tab,
  href,
}: {
  subtitle?: string;
  /**
   * Sits on the title row, right-aligned. Room for ONE compact element —
   * a chip or a small tab group. Anything more belongs in `controls`: this
   * row cannot wrap without colliding with the title.
   */
  action?: React.ReactNode;
  /**
   * Full-width row beneath the title, above the tabs. Wraps. This exists
   * because the planning switches outgrew `action`: chip + Style + Season
   * is ~300px of unshrinkable pills in a slot sized for one, so on a phone
   * it ran off the viewport and overlapped the heading.
   */
  controls?: React.ReactNode;
  /** One quiet line under `controls`, for saying what they affect. */
  controlsNote?: string;
  tab: TrainTab;
  href: TrainHref;
}) {
  return (
    <header className="mb-5 pt-8">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-title font-bold tracking-[-0.03em]">Train</h1>
          {subtitle && (
            <p className="mt-0.5 truncate text-label font-medium text-ink-muted">
              {subtitle}
            </p>
          )}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
      {controls && (
        <div className="mb-4">
          <div className="flex flex-wrap items-center gap-2">{controls}</div>
          {controlsNote && (
            <p className="mt-1.5 text-label font-medium text-ink-muted">
              {controlsNote}
            </p>
          )}
        </div>
      )}
      <TrainTabs active={tab} href={href} />
    </header>
  );
}

// ── Week (1c) ─────────────────────────────────────────────────────────────

async function WeekTab({
  userId,
  href,
  initialAvailabilityMode,
}: {
  userId: string;
  href: TrainHref;
  initialAvailabilityMode: AvailabilityWeekMode;
}) {
  const plan = await getActivePlan(userId);

  // A plan the coach proposed but the athlete hasn't confirmed yet (v0.43).
  // At most one per athlete — previewTrainingPlan deletes any prior draft
  // before writing a new one — and independent of whether an active plan
  // also exists, so a draft for NEXT season still surfaces while this
  // season's plan keeps running.
  const draft = await db.query.trainingPlans.findFirst({
    where: and(
      eq(schema.trainingPlans.userId, userId),
      eq(schema.trainingPlans.status, "draft")
    ),
  });
  // `previewFromDraft` calls the throwing `requirePlanSport` plus several
  // queries. `/train` is force-dynamic and has no `error.tsx`, so an
  // uncaught throw here would break the whole page — including the
  // athlete's real active plan — over a draft that is meant to be harmless
  // to ignore. Same degraded-path pattern as the `projectWeek` call below:
  // take no preview rather than no page, but log it so a corrupted draft is
  // diagnosable.
  let draftPreview: Awaited<ReturnType<typeof previewFromDraft>> | null = null;
  if (draft) {
    try {
      draftPreview = await previewFromDraft(draft);
    } catch (err) {
      logger.error("draft plan preview failed; showing no preview", {
        userId,
        draftId: draft.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // The readiness chip reads the same daily_metrics row Today's hero does,
  // so the two screens can never disagree about the athlete's band.
  const latestMetric = await db.query.dailyMetrics.findFirst({
    where: eq(schema.dailyMetrics.userId, userId),
    orderBy: desc(schema.dailyMetrics.date),
  });
  const recentWellness = await db.query.wellnessDaily.findMany({
    where: eq(schema.wellnessDaily.userId, userId),
    orderBy: desc(schema.wellnessDaily.date),
    limit: 30,
  });
  const bodyMassKg =
    recentWellness.find((w) => w.weightKg != null)?.weightKg ?? null;
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
      className={`shrink-0 rounded-full border border-current px-3 py-1 text-label font-bold ${BAND_TEXT[band]}`}
    >
      <span
        aria-hidden
        className={`mr-1.5 inline-block size-1.5 rounded-full align-middle ${BAND_DOT[band]}`}
      />
      {readiness != null ? `${readiness} · ${band}` : "calibrating"}
    </span>
  );

  if (!plan) {
    // Skipped when a draft preview exists — a coach-proposed plan is worth
    // showing even to a first-run athlete. Otherwise this is the fork: a
    // first-run athlete with nothing at all gets a way back to the data
    // paths, while an established athlete between seasons keeps the
    // honest "no plan yet" wording untouched (see PlanEmpty).
    // The explicit `: boolean` is load-bearing here, unlike on Body/Coach: a
    // dropped `await` would type this ternary as `false | Promise<boolean>`,
    // and having a real `false` arm stops TS2801's "always truthy Promise"
    // check from firing — only this annotation still turns that mistake
    // into a compile error (a bare `Promise<boolean>` isn't assignable to
    // `boolean`).
    const firstRun: boolean = draftPreview ? false : await isFirstRun(userId);
    return (
      <>
        <TrainHeader tab="week" href={href} action={chip} />
        {draftPreview ? (
          <PlanPreviewCard preview={draftPreview} />
        ) : firstRun ? (
          <div
            data-testid="first-run"
            className="flex min-h-[60svh] items-center justify-center px-6"
          >
            <div className="mx-auto max-w-sm space-y-4 text-center">
              <Unavailable
                full
                state={{
                  kind: "missing_input",
                  needs: "wellness data before it can plan your week",
                  fix: {
                    label: "Connect a device or log manually",
                    href: "/",
                  },
                }}
              />
              {/* Unavailable's `full` treatment renders the EmptyState
                  message only — it does not surface `state.fix` (see
                  components/ui/unavailable.tsx). The fix link is rendered
                  here instead, same pattern PlanEmpty uses for its own "Talk
                  to the coach" link below the EmptyState. */}
              <Link
                href="/"
                className="inline-flex items-center justify-center gap-2 rounded-2xl bg-accent px-6 py-3 font-bold text-accent-foreground transition-all hover:bg-accent/90"
              >
                Connect a device or log manually
              </Link>
            </div>
          </div>
        ) : (
          <PlanEmpty />
        )}
      </>
    );
  }

  const week = await getOpenWeekPlan(userId);
  const adjustments = week ? await listAdjustments(week.id) : [];
  const races = await listRaces(userId);
  // Per-day stage detail per race — a separate table, so one batched query
  // rather than N+1. Final-review Finding I6: the races list must show
  // (and, part 2, let the athlete correct) what's actually driving each
  // race's demand, not just accept it silently on the add form. Shared with
  // the coach's get_races since v0.41, so the two cannot drift.
  const stagesByRace = await stagesByRaceIds(races.map((r) => r.id));
  const raceListItems: RaceListItem[] = races.map((r) => ({
    ...r,
    // Narrowed to what the list renders: RaceListItem is a client-component
    // prop and has no use for the stage name.
    stages: (stagesByRace.get(r.id) ?? []).map((s) => ({
      dayNumber: s.dayNumber,
      distanceKm: s.distanceKm,
      elevationM: s.elevationM,
    })),
  }));
  const constraints = planConstraints(plan.constraints);
  // BlockSheet's per-block sport chips need the plan's real disciplines,
  // not `constraints.sports` verbatim: since v0.42 that field stores the
  // plan's single PlanSport (e.g. a triathlon plan holds ["Triathlon"]),
  // so passing it straight through collapsed every triathlete's chips to
  // one non-discipline value and BlockSheet's `sports.length > 1` gate hid
  // them entirely. `constraints.sports` stays the single stored authority
  // (the weekly rollover calls `requirePlanSport(constraints.sports?.[0])`
  // and would throw on anything else) — only this derived, UI-only view
  // expands it to disciplines. Rows written before v0.42 already stored
  // the disciplines directly (e.g. ["Swim","Bike","Run"]); those pass
  // through unchanged rather than through `requirePlanSport`, which
  // deliberately throws on a bare "Swim".
  const rawPlanSports =
    constraints.sports.length > 0 ? constraints.sports : ["Bike"];
  const blockSheetSports: string[] =
    rawPlanSports.length === 1
      ? [...disciplinesOf(requirePlanSport(rawPlanSports[0]))]
      : rawPlanSports;

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
    sport: PlanSport;
    feasibility: Figure<Feasibility>;
    demand: EventDemandResult;
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

    const availabilityHours = availableMins(week.days) / 60;
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
    // plannedMins is the one definition of "the week's minutes" in this
    // codebase — the same function that produced `materialized_mins`. A
    // second hand-rolled sum here would let the figure the athlete reads
    // drift from the one the forecast reasons about.
    const plannedHours = plannedMins(week.days) / 60;

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

    // weeksUntilEvent may be null (no target race date) — feasibilityFor
    // handles that itself and states that exact reason, so no separate
    // null check is needed here.
    const feasibilityFigure = feasibilityFor({
      demand: volumeInputs.demand,
      currentWeeklyHours: volumeInputs.level.peakHours,
      longestSessionHours: volumeInputs.longestSessionHours,
      weeksUntilEvent,
    });

    // Populated whenever there is a target race with a priced (or refused)
    // demand result — not only the "available" case. Before this, an
    // unpriceable race fell through this condition entirely and the athlete
    // saw nothing at all; now EventReadiness itself renders the refusal —
    // and, since Task 7, the Figure it's handed states the reason for any
    // missing verdict, not only a missing demand figure.
    if (volumeInputs.targetRace && volumeInputs.demand) {
      eventReadiness = {
        raceName: volumeInputs.targetRace.name,
        sport: volumeInputs.targetRace.sport,
        feasibility: feasibilityFigure,
        demand: volumeInputs.demand,
      };
    }
  }

  const today = new Date();
  const todayYmd = localYmd(today);
  const todaySlot = week?.days.find((d) => d.date === todayYmd) ?? null;

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

  // Next week does not exist as a row — it is derived on every render and
  // never written. See docs/specs/2026-07-29-next-week-preview-design.md.
  // Computed here, unconditionally whenever there's an open week, rather
  // than only inside the availability-intake block below: the rolling day
  // list's "next week" preview must still render once this week starts
  // completing (Sunday evening is exactly when an athlete needs to see
  // what's ahead), even though the intake/switcher below — which edits
  // THIS week's availability — rightly stops applying at that point. This
  // is also the ONLY `projectWeek` call for the render; the availability
  // intake block reuses `projected` rather than calling it a second time.
  const nextWeekStart = week ? addDaysYmd(week.weekStart, 7) : null;
  // `projectWeek` throws if the plan record it resolves to has disappeared
  // or if `periodize` yields no blocks for the requested skeleton week
  // (see project.ts's two explicit `throw`s). `/train` is force-dynamic,
  // so `next build` can never exercise this render path — an uncaught
  // throw here would break the whole page, not just the preview. Take the
  // degraded path (no preview, no switcher) instead, but log it — a
  // corrupted plan should be diagnosable, not silently swallowed.
  let projected: Awaited<ReturnType<typeof projectWeek>> = null;
  if (week && nextWeekStart) {
    try {
      projected = await projectWeek(userId, nextWeekStart, new Date());
    } catch (err) {
      logger.error("next-week projection failed; showing this week only", {
        userId,
        nextWeekStart,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  // Same link the deleted next-week prose note used to carry (Task 12,
  // Part D dedupe) — computed once here and threaded into the summary
  // below, so the "planned vs target" figures and the one action that
  // follows from them live in one place instead of two.
  const nextWeekAvailabilityHref = href({ availability: "next" });
  const nextWeekPreview = projected
    ? {
        days: projected.days,
        pinned: projected.pinned,
        // `VolumeResult.hours` is a plain number, so this needs no fallback:
        // inside this branch `projected` is non-null and the figure is real.
        targetHours: projected.target.hours,
        availabilityHref: nextWeekAvailabilityHref,
      }
    : null;

  // Availability intake. This week's half only applies while the week
  // hasn't started completing — this week's availability is frozen once
  // Monday is done (unchanged rule). Next week's half is independent of
  // that: it must stay reachable all week, so the next-week entry point
  // this release exists for does not vanish the moment Monday completes
  // (review finding on this task, closed in the "Fix pass" section of
  // task-6-report.md). Either half may be null on its own — `intake`
  // itself is null only when NEITHER half applies (Monday completed and no
  // projection: nothing to show).
  const mondayCompleted = week?.days[0]?.status === "completed";
  let intake: {
    thisWeek: WeekIntake | null;
    nextWeek: WeekIntake | null;
  } | null = null;
  if (week && (!mondayCompleted || projected)) {
    const dates = week.days.map((d) => d.date);

    // Load per hour over the last 28 days, from real sessions only. Week-
    // independent — today's real rate feeds both this week's and next
    // week's verdict identically.
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

    // This week's half — skipped once Monday has completed; this week's
    // availability is frozen from that point on (unchanged rule).
    const thisWeekData = mondayCompleted
      ? null
      : await resolveWeekIntake(userId, dates, {
          currentCtl: latestMetric?.ctl ?? null,
          loadPerHour,
          historyDays,
          effectiveTarget:
            currentTargetLoad({
              effectiveTarget: week.effectiveTarget,
              materializedMins: week.materializedMins,
              currentMins: plannedMins(week.days),
            }) ?? 0,
        });

    // Next week's OWN data — not this week's, copied. This is the second
    // critical fix from Task 5's review: the switcher used to hand next-
    // week mode this week's `resolved`/`dates`/`overrideDates`/`verdict`
    // unchanged, so unpinning or submitting in next-week mode acted on
    // this week's rows. `projected` (computed once, above, shared with the
    // rolling day list's preview) is `null` when there's no active plan to
    // project from (the spec's edge case: "No projection; the rolling list
    // shows this week only"), so there is no next-week half either — the
    // page below falls back to this week's plain `IntakeForm` (or nothing,
    // if Monday has also completed).
    //
    // `projected.weekStart` is read directly as next week's `weekStart`
    // here, rather than re-deriving or re-checking the outer
    // `nextWeekStart` local: `materializeWeek` always echoes its
    // `weekStart` input back unchanged (materialize.ts's
    // `weekStart: input.weekStart`), so the two are the same value by
    // construction, and `projected` is already narrowed non-null in this
    // branch — no second `&& nextWeekStart` check needed just to satisfy
    // the type checker.
    const nextWeekData = projected
      ? {
          ...(await resolveWeekIntake(
            userId,
            Array.from({ length: 7 }, (_, i) =>
              addDaysYmd(projected.weekStart, i)
            ),
            {
              currentCtl: latestMetric?.ctl ?? null,
              loadPerHour,
              historyDays,
              // NOT `projected.target.hours` — that's the pre-materialize
              // hours figure fed into `periodize`, a different unit than the
              // load quantity `availabilityVerdict` divides by `loadPerHour`.
              // `effectiveLoad` is `materializeWeek`'s actual result, the same
              // field this week's own `effectiveTarget` above reads off the
              // stored week (see `project.ts`'s `ProjectedWeek.effectiveLoad`
              // docstring).
              effectiveTarget: projected.effectiveLoad,
            }
          )),
          weekStart: projected.weekStart,
        }
      : null;

    intake = {
      thisWeek: thisWeekData ? { ...thisWeekData, weekStart: "" } : null,
      nextWeek: nextWeekData,
    };
  }

  // What the athlete actually trained, per local day, from the same
  // derivation the week plan books from — so the screen and the stored
  // numbers cannot disagree. They did before v0.44: this view was right and
  // the stored actuals were missing up to 60% of the week.
  const dayActuals = week
    ? await deriveDayActuals(
        userId,
        week.weekStart,
        addDaysYmd(week.weekStart, 6)
      )
    : {};

  // Next race as the compact row under the week; the full list stays in the
  // races section below. Owner: src/lib/race/outlook.ts (v0.87).
  const card = await raceCard(userId, today, week);

  // plan.raceDate/raceType have always meant the plan's FINAL target
  // (planRaceTargets, src/lib/plan-targets.ts); on a two-A-race season this
  // names the earlier one too, so the subtitle doesn't silently describe
  // only the race the plan ends on. Calendar fact only — no comparative
  // claim about the second race (the evidence pass found no source in
  // either direction), and this is additive: a single-race plan's subtitle
  // is unchanged, since `planTargets.first` is null there.
  const planTargets = planRaceTargets(plan);
  const subtitle = [
    plan.title,
    `week ${Math.min(plan.currentWeek, plan.weeksTotal)} of ${plan.weeksTotal}`,
    openBlock?.phase ? `${openBlock.phase} phase` : null,
    planTargets.first
      ? `${planTargets.first.raceType} ${planTargets.first.date} → ${planTargets.final.raceType} ${planTargets.final.date}`
      : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <>
      <TrainHeader
        tab="week"
        href={href}
        subtitle={subtitle}
        action={chip}
        // Both switches write plan constraints and stop there — the open
        // week is already materialized in week_plans and nothing recomputes
        // it, so this week keeps the sessions it has. The next-week preview
        // below DOES re-read constraints (projectWeek), so the athlete can
        // see the effect immediately; it just isn't where they might look
        // first. Saying so is cheaper than the alternative reading, which is
        // that the control is broken.
        controlsNote="Applies from next week — this week is already planned."
        controls={
          <>
            <PlanStyleSwitch
              effectiveStyle={constraints.planStyle}
              action={submitPlanStyleQuick}
            />
            <SeasonModeSwitch
              effectiveSeasonMode={constraints.seasonMode}
              reentryStage={constraints.reentryStage}
              action={submitSeasonModeQuick}
            />
            {/*
              WeekAdjustmentSwitch (v0.56–v0.60) is deliberately not rendered.
              Its action writes trainingBlocks.targetLoadTotal, but the open
              week the athlete actually trains is materialized from a target
              periodize() recomputes on the spot — service.ts says so outright:
              "Recomputed fresh, never read as authority". The persisted
              weekPlans row is not recomputed either, so pressing "Skip week"
              left this week's sessions untouched.

              That made the buttons worse than inert: targetLoadTotal IS read
              by the blocks table below, get_training_plan, get_plan_drift and
              race forecasting, so the number moved everywhere the plan is
              reported and nowhere it is executed. A live press had already
              left one athlete's block at 0 against a real week of 259.

              Re-enabling this needs a decision, not a patch: either the action
              re-materializes the open week, or the copy describes the skeleton
              it actually edits. Until then the controls stay off rather than
              promising "Ease -30% · Deload -50%" and doing none of it.
            */}
          </>
        }
      />

      {draftPreview && <PlanPreviewCard preview={draftPreview} />}

      {week ? (
        <>
          <section className="mb-4">
            <WeekStrip days={week.days} />
          </section>

          <WeekDayList
            days={week.days}
            today={todayYmd}
            nextWeek={nextWeekPreview}
            actuals={dayActuals}
          />

          {todaySlot && todaySlot.workouts.length > 0 && (
            <FuellingCard
              date={todayYmd}
              workouts={todaySlot.workouts}
              bodyMassKg={bodyMassKg}
            />
          )}

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
              sport={eventReadiness.sport}
              feasibility={eventReadiness.feasibility}
              demand={eventReadiness.demand}
            />
          )}

          {card.race && (
            <>
              {/* The chip's own mb-6 moved to its call sites in v0.99 slice 1
                  (Today's redesign owns block spacing there). Train is a later
                  slice, and the goalNote below is tuned to collapse against
                  this 24px — without it the note is pulled onto the chip. */}
              <div className="mb-6">
                <RaceChip {...card} />
              </div>
              {card.race.goalNote && (
                <p className="-mt-5 mb-6 px-1 text-label text-ink-muted">
                  {card.race.goalNote}
                </p>
              )}
              {/* Rendered here rather than inside RaceChip: the chip is shared
                  with Today, which is out of scope for pacing, and a target, a
                  band and an assumption do not fit a chip — the assumption is
                  what a chip would drop first, and it is the half that
                  matters. */}
              {card.pacing?.available && (
                <p
                  data-testid="race-pacing"
                  className="-mt-5 mb-6 px-1 text-label text-ink-muted"
                >
                  <span className="font-bold text-ink-secondary">
                    {card.pacing.value.sport === "Bike"
                      ? `Target ${card.pacing.value.targetWatts} W · hold ${card.pacing.value.lowWatts}–${card.pacing.value.highWatts} W`
                      : `Target ${fmtPace(card.pacing.value.targetSecPerKm)} · hold ${fmtPace(card.pacing.value.lowSecPerKm)}–${fmtPace(card.pacing.value.highSecPerKm)}`}
                  </span>{" "}
                  {card.pacing.why} ({card.pacing.confidence} confidence)
                </p>
              )}
              {/* Every non-available kind, not just not_applicable. The
                  seeded athlete has no threshold pace, so this is
                  missing_input — which carries a fix link, and rendering
                  nothing for it would throw away the whole point of the
                  vocabulary. <Unavailable> is the house component for this
                  and handles calibrating/missing_input/not_applicable
                  uniformly. */}
              {card.pacing && !card.pacing.available && (
                <p className="-mt-5 mb-6 px-1 text-label text-ink-muted">
                  Race pacing: <Unavailable state={card.pacing} />
                </p>
              )}
            </>
          )}

          {adjustments.length > 0 && (
            <div className="mb-5">
              <Collapsible>
                <CollapsibleTrigger className="rounded-[18px] p-4">
                  <span className="text-label font-bold uppercase tracking-[0.15em] text-ink-secondary">
                    What changed &amp; why · {adjustments.length}
                  </span>
                </CollapsibleTrigger>
                <CollapsiblePanel>
                  <ul className="px-4 pb-4 pt-3">
                    {adjustments.map((a) => (
                      <li
                        key={a.id}
                        className="border-b border-hairline py-2.5 last:border-0"
                      >
                        <p className="text-caption text-ink-secondary">
                          <span aria-hidden className="mr-1.5 text-ink-muted">
                            ↻
                          </span>
                          {a.reason}
                        </p>
                        <p className="mt-0.5 pl-4 text-label text-ink-muted">
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
              {intake.thisWeek && intake.nextWeek ? (
                <AvailabilityWeekSwitcher
                  // `initialMode` only seeds `useState` on the FIRST mount —
                  // a prop change on its own does nothing once mounted. The
                  // "Set next week's availability" link below is now a
                  // `Link` (Finding 3), which does a client-side transition
                  // that keeps this component instance alive across the
                  // `?availability=` change rather than a full reload
                  // remounting it fresh. Keying on the mode forces exactly
                  // that remount when the URL's mode actually changes, so
                  // the link still lands in next-week mode after the
                  // switch away from a plain `<a>`.
                  key={initialAvailabilityMode}
                  thisWeek={intake.thisWeek}
                  nextWeek={intake.nextWeek}
                  initialMode={initialAvailabilityMode}
                  sports={blockSheetSports}
                  action={submitAvailability}
                />
              ) : intake.nextWeek ? (
                // Monday has completed, so this week's half is frozen — but
                // a projection exists, so next week must still be enterable
                // (the fix this section exists for: the "Set next week's
                // availability" link above must always land on a real
                // control, not a page with nothing to activate). No
                // switcher, no "this week" option — just next week's plain
                // form, matching the switcher's own next-week heading.
                <IntakeForm
                  heading="Next week's availability"
                  resolved={intake.nextWeek.resolved}
                  dates={intake.nextWeek.dates}
                  overrideDates={intake.nextWeek.overrideDates}
                  verdict={intake.nextWeek.verdict}
                  sports={blockSheetSports}
                  action={submitAvailability}
                  weekStart={intake.nextWeek.weekStart}
                />
              ) : intake.thisWeek ? (
                <IntakeForm
                  resolved={intake.thisWeek.resolved}
                  dates={intake.thisWeek.dates}
                  overrideDates={intake.thisWeek.overrideDates}
                  verdict={intake.thisWeek.verdict}
                  sports={blockSheetSports}
                  action={submitAvailability}
                />
              ) : null}
            </section>
          )}

          <div className="mb-6">
            <Collapsible>
              <CollapsibleTrigger className="rounded-[18px] p-4">
                <span className="text-label font-bold uppercase tracking-[0.15em] text-ink-secondary">
                  Standard week
                </span>
              </CollapsibleTrigger>
              <CollapsiblePanel>
                <div className="px-1 pb-1 pt-3">
                  <StandardWeek
                    defaults={standardWeek}
                    sports={blockSheetSports}
                  />
                </div>
              </CollapsiblePanel>
            </Collapsible>
          </div>
        </>
      ) : (
        <section className="mb-6">
          <form action={startWeek} className="glass rounded-[18px] p-5">
            <p className="text-caption leading-relaxed text-ink-secondary">
              This week hasn&apos;t been planned yet. Start it now and it
              materializes from your skeleton — you can adjust your availability
              right after.
            </p>
            <button
              type="submit"
              className="mt-4 w-full rounded-full bg-accent py-2.5 text-label font-bold text-primary-foreground transition-opacity hover:opacity-90"
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
              <span className="text-label font-bold uppercase tracking-[0.15em] text-ink-secondary">
                Races · {races.length}
              </span>
            </CollapsibleTrigger>
            <CollapsiblePanel>
              <div className="px-4 pb-1 pt-3">
                <RacesSection races={raceListItems} hideHeading />
              </div>
            </CollapsiblePanel>
          </Collapsible>
        </div>
      )}
      {races.length === 0 && (
        <div className="mb-5">
          <RacesSection races={raceListItems} />
        </div>
      )}

      {remaining.length > 0 && (
        <div className="mb-10">
          <Collapsible>
            <CollapsibleTrigger className="rounded-[18px] p-4">
              <span className="text-label font-bold uppercase tracking-[0.15em] text-ink-secondary">
                Remaining skeleton · {remaining.length}
              </span>
            </CollapsibleTrigger>
            <CollapsiblePanel>
              <div className="hide-scrollbar overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="text-label font-bold uppercase tracking-[0.15em] text-ink-muted">
                      <th className="whitespace-nowrap px-4 py-2">Week</th>
                      <th className="whitespace-nowrap px-4 py-2">Phase</th>
                      <th className="whitespace-nowrap px-4 py-2 text-right">
                        Target load
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {remaining.map((b) => {
                      // The open week (week?.skeletonWeek) has a materialized
                      // effective target that supersedes the block's un-tapered
                      // skeleton value — every other row here is a future week
                      // with no weekPlans row yet, so its skeleton value is all
                      // there is. See week-plan/volume.ts's weekTargetLoad().
                      const resolved =
                        b.weekNumber === (week?.skeletonWeek ?? -1)
                          ? weekTargetLoad({
                              effectiveTarget: week?.effectiveTarget ?? null,
                              blockTarget: b.targetLoadTotal,
                            })
                          : null;
                      const targetLoad = resolved
                        ? resolved.available
                          ? resolved.value
                          : null
                        : b.targetLoadTotal;
                      return (
                        <tr
                          key={b.weekNumber}
                          className="border-t border-hairline"
                        >
                          <td className="px-4 py-2 font-numeric text-label text-ink-secondary">
                            {b.weekNumber}
                          </td>
                          {/* Task 12 per-pair override: pre-migration the
                              week-number cell (above) was 80% white and
                              phase/target were 60% — a genuine
                              alpha pair that flattened onto one token in
                              Task 6. Phase and target move to ink-muted;
                              the week number keeps ink-secondary. */}
                          <td className="px-4 py-2 text-label capitalize text-ink-muted">
                            {b.phase}
                          </td>
                          <td className="px-4 py-2 text-right font-numeric text-label text-ink-muted">
                            {targetLoad != null ? Math.round(targetLoad) : "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
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
            className="flex shrink-0 items-center gap-1 rounded-full bg-accent/10 px-3 py-1.5 text-label font-bold text-accent transition-colors hover:bg-accent/20"
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
            className={`whitespace-nowrap rounded-full px-3.5 py-1.5 text-label font-bold uppercase tracking-wider transition-colors ${
              !sportFilter
                ? "bg-surface-overlay text-ink-primary"
                : "bg-surface-raised text-ink-muted hover:text-ink-secondary"
            }`}
          >
            All
          </Link>
          {sports.map((s) => (
            <Link
              key={s}
              href={href({ sport: s })}
              aria-current={sportFilter === s ? "true" : undefined}
              className={`whitespace-nowrap rounded-full px-3.5 py-1.5 text-label font-bold uppercase tracking-wider transition-colors ${
                sportFilter === s
                  ? "bg-surface-overlay text-ink-primary"
                  : "bg-surface-raised text-ink-muted hover:text-ink-secondary"
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

// ── Season (v0.48) ───────────────────────────────────────────────────────

async function SeasonTab({
  userId,
  href,
}: {
  userId: string;
  href: TrainHref;
}) {
  const plan = await getActivePlan(userId);
  const thisMonday = new Date();
  thisMonday.setHours(0, 0, 0, 0);
  thisMonday.setDate(thisMonday.getDate() - ((thisMonday.getDay() + 6) % 7));
  const thisMondayYmd = localYmd(thisMonday);

  if (!plan) {
    return (
      <>
        <TrainHeader tab="season" href={href} />
        <EmptyState
          icon={LineChart}
          message="No active plan yet. Build a plan to unlock season target vs actual tracking."
        />
      </>
    );
  }

  const weeks = await db.query.weekPlans.findMany({
    where: and(
      eq(schema.weekPlans.userId, userId),
      eq(schema.weekPlans.planId, plan.id),
      lte(schema.weekPlans.weekStart, thisMondayYmd)
    ),
    orderBy: asc(schema.weekPlans.weekStart),
  });

  if (weeks.length === 0) {
    return (
      <>
        <TrainHeader tab="season" href={href} />
        <EmptyState
          icon={LineChart}
          message="No season weeks to compare yet. Season progress appears once the first week starts."
        />
      </>
    );
  }

  const firstWeek = weeks[0].weekStart;
  const firstWeekDate = new Date(`${firstWeek}T00:00:00`);
  const spanWeeks =
    Math.max(
      1,
      Math.floor(
        (thisMonday.getTime() - firstWeekDate.getTime()) / 604_800_000
      ) + 1
    ) || 1;

  const activities = await db.query.activities.findMany({
    where: and(
      eq(schema.activities.userId, userId),
      ne(schema.activities.provider, "strava"),
      gte(schema.activities.startDate, firstWeekDate)
    ),
    orderBy: desc(schema.activities.startDate),
    limit: 1000,
  });

  const actualSummaries = weeklyActivitySummaries(
    activities.map((a) => ({
      startDate: a.startDateLocal ?? a.startDate,
      load: a.load,
      durationS: a.durationS,
      distanceM: a.distanceM,
    })),
    spanWeeks
  );

  const points = seasonTimelinePoints(
    weeks.map((w) => ({
      weekStart: w.weekStart,
      targetLoad: w.effectiveTarget,
    })),
    actualSummaries
  );

  return (
    <>
      <TrainHeader tab="season" href={href} />
      <div className="pb-10">
        <SeasonTimelineCard data={points} />
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

  // The resolved authority for ctl/atl/tsb — the provider's value wins when
  // present, and Recover's native engine fills the gap when it isn't
  // (metrics.ts:43-45). wellness_daily.ctl/.atl is provider-only and stays
  // empty for an athlete with no intervals.icu connection, even though
  // Recover has computed a real fitness trend for them all along. `wellness`
  // above still supplies HRV, resting HR, sleep, weight, eFTP, pMax, W',
  // ramp rate — those genuinely live on wellness_daily and are unaffected.
  const dailyMetrics = await db.query.dailyMetrics.findMany({
    where: and(
      eq(schema.dailyMetrics.userId, userId),
      gte(schema.dailyMetrics.date, daysAgo(range))
    ),
    orderBy: schema.dailyMetrics.date,
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

  // ctl/atl come from the resolved daily_metrics series, not the
  // provider-only wellness_daily one; null means calibrating, never 0.
  const latest = [...dailyMetrics].reverse().find((w) => w.ctl != null);
  const ctl = latest?.ctl ?? null;
  const atl = latest?.atl ?? null;
  const tsb = ctl != null && atl != null ? ctl - atl : null;

  // "▲ +4 in 28d" — CTL against itself four weeks back, only when both ends
  // are real values inside the loaded range.
  const priorCtl = dailyMetrics.find(
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
      label: "CTL",
      srLabel: "Fitness",
      value:
        ctl != null
          ? Figure.available(String(Math.round(ctl)), "high")
          : Figure.missingInput("training-load history"),
      color: "var(--chart-1)",
      // A flat block is flat — no arrow, no colour, no implied progress.
      context:
        ctlDelta == null
          ? null
          : ctlDelta === 0
            ? "level over 28d"
            : `${ctlDelta > 0 ? "▲ +" : "▼ −"}${Math.abs(ctlDelta)} in 28d`,
      // Only a gain is tinted. The flat/negative case takes FitnessTiles'
      // default, which is the --ink-muted text floor: the literal that used
      // to be written here was the same 3.77:1 white-40% the component's own
      // fallback was, so fixing one and not the other would have left the
      // athlete looking at it.
      contextColor:
        ctlDelta != null && ctlDelta > 0 ? "var(--chart-2)" : undefined,
    },
    {
      label: "ATL",
      srLabel: "Fatigue",
      value:
        atl != null
          ? Figure.available(String(Math.round(atl)), "high")
          : Figure.missingInput("training-load history"),
      color: "var(--chart-5)",
      context: weekLoad > 0 ? `7d load ${Math.round(weekLoad)}` : null,
    },
    {
      label: "TSB",
      srLabel: "Form",
      value:
        tsb != null
          ? Figure.available(
              `${tsb < 0 ? "−" : ""}${Math.abs(tsb).toFixed(1)}`,
              "high"
            )
          : Figure.missingInput("training-load history"),
      color: "var(--chart-2)",
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

  const hasLoadSeries = dailyMetrics.some((w) => w.ctl != null);

  return (
    <>
      <TrainHeader
        tab="fitness"
        href={href}
        action={<RangeTabs active={range} view="training" href={href} />}
      />

      <FitnessTiles tiles={tiles} />

      {hasLoadSeries ? (
        <section className="glass mb-4 rounded-[18px] p-4">
          {/* showStats off: the tiles above already carry CTL/ATL/TSB. */}
          <PmcChart
            showStats={false}
            wellness={dailyMetrics.map((w) => ({
              date: w.date,
              ctl: w.ctl,
              atl: w.atl,
            }))}
          />
          <ul className="mt-3 flex items-center gap-4 border-t border-hairline pt-3">
            {[
              { label: "CTL", dot: "bg-chart-1" },
              { label: "ATL", dot: "bg-chart-5" },
              { label: "TSB", dot: "bg-chart-2" },
            ].map((l) => (
              <li
                key={l.label}
                className="flex items-center gap-1.5 text-label font-bold uppercase tracking-wider text-ink-muted"
              >
                <span
                  aria-hidden
                  className={`h-0.5 w-4 rounded-full ${l.dot}`}
                />
                {l.label}
              </li>
            ))}
          </ul>
        </section>
      ) : (
        // Rendered bare, not inside the `.glass` section above: EmptyState's
        // own root is `.glass` (C2, whole-branch review 2 2026-08-13), and
        // nesting it inside another `.glass` wrapper stacks two translucent
        // fills and two blurs into an undeclared compositing ground. Matches
        // how the other four Train call sites of EmptyState already render —
        // bare, in a plain div or a fragment.
        <div className="mb-4">
          <EmptyState icon={LineChart} message="No training-load data yet." />
        </div>
      )}

      {weekly.some((w) => w.load > 0) && (
        <div className="mb-4">
          <WeeklyLoadBars data={weekly} />
        </div>
      )}

      {fitnessStats.length > 0 && (
        <div className="glass mb-10 rounded-[18px] p-4">
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

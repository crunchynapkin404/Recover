import Link from "next/link";
import { and, desc, eq, gte, ne } from "drizzle-orm";
import { Sparkles, User } from "lucide-react";
import { db, schema } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { recordSurfaceView } from "@/lib/telemetry";
import { getActivePlan } from "@/lib/active-plan";
import { Figure } from "@/lib/uncertainty";
import { AppShell, shellUser } from "@/components/app-shell";
import { PullToRefresh } from "@/components/today/pull-to-refresh";
import { SyncChip } from "@/components/today/sync-chip";
import { getLatestMorningInsight } from "@/lib/morning-insight";
import {
  getOpenWeekPlan,
  listAdjustments,
  planConstraints,
} from "@/lib/week-plan/service";
import { assembleWeeklyTarget } from "@/lib/week-plan/volume-inputs";
import { availableMins } from "@/lib/week-plan/fill";
import { raceCard } from "@/lib/race/outlook";
import type { Band } from "@/lib/readiness";
import { formatSleepDebt, sleepDebtFrom } from "@/lib/sleep-debt";
import { buildHrvTile } from "@/lib/today/hrv-tile";
import { sparkPath } from "@/lib/sparkline";
import {
  calibrationProgress,
  CALIBRATION_TARGET_DAYS,
} from "@/lib/calibration";
import {
  hasDayLog,
  previewStateFrom,
  resolveTodayState,
} from "@/lib/today/state";
import {
  BLOCK_ORDER,
  MORNING_LEFT_COLUMN,
  type TodayBlockKey,
} from "@/lib/today/block-order";
import { getCachedActivityDetail } from "@/lib/activity-streams";
import {
  JustLandedCard,
  streamPath,
  type JustLandedStream,
} from "@/components/today/just-landed-card";
import { DayLogCard } from "@/components/today/day-log-card";
import { BedtimeCard } from "@/components/today/bedtime-card";
import { formatDuration } from "@/lib/format";
import { CalibrationProgress } from "@/components/today/calibration-progress";
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

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ sheet?: string; activity?: string; state?: string }>;
}) {
  const user = await requireUser();
  await recordSurfaceView(user.id, "today");
  // Sheet state lives in the URL so the morning and post-ride pushes can
  // deep-link straight into an open sheet, and Back closes it.
  const { sheet, activity: sheetActivity, state } = await searchParams;

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
          workoutCount: o.workouts.length,
          isRace: o.status === "race",
        }))
    : [];

  // ── Next race (v0.14) ──────────────────────────────────────────────────
  // Form-only projection, never called "readiness" — HRV/RHR can't be
  // forecast, so the band is an honest form outlook, not a score.
  // Owner: src/lib/race/outlook.ts (v0.87).
  const card = await raceCard(user.id, todayDate, weekPlan);

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

  // ── State inputs (v0.99 slice 1) ────────────────────────────────────────
  // The most recent session, for "just landed". Strava rows are excluded
  // here for the same reason weekActivities excludes them: a ride that
  // synced from both providers exists twice, and the duplicate would
  // shadow the row that carries the debrief.
  const recentActivity = await db.query.activities.findFirst({
    where: and(
      eq(schema.activities.userId, user.id),
      ne(schema.activities.provider, "strava"),
      gte(schema.activities.startDate, new Date(daysAgo(1)))
    ),
    orderBy: desc(schema.activities.startDate),
  });

  // End, not start: a three-hour ride starting at 15:00 has only just
  // finished at 18:00.
  const lastSessionEndedAt = recentActivity
    ? new Date(
        (recentActivity.startDateLocal ?? recentActivity.startDate).getTime() +
          (recentActivity.durationS ?? 0) * 1000
      )
    : null;

  const todayWellness = wellness.find((w) => w.date === todayYmd) ?? null;

  const todayState =
    previewStateFrom(state) ??
    resolveTodayState({
      now: todayDate,
      lastSessionEndedAt,
      hasDayLog: hasDayLog(todayWellness),
    });

  // Same resolver every other surface uses, so the dashboard cannot disagree
  // with the engine about which plan it is describing. The old `columns`
  // projection is dropped on purpose: one shared shape beats saving four
  // columns on one query.
  const activePlan = await getActivePlan(user.id);
  // The same derived, race/ceiling-aware figure /train's WeekRationale
  // shows — never the plan's raw typed constraints.hoursPerWeek — so the
  // two surfaces can never disagree (final-review Finding I5). weekPlan is
  // already fetched above for the today card, so this adds no query. No
  // active plan or no open week: null, same as before — WeekRow renders
  // nothing without `days` regardless.
  let hoursTarget: number | null = null;
  if (activePlan && weekPlan) {
    const constraints = planConstraints(activePlan.constraints);
    const availabilityHours = availableMins(weekPlan.days) / 60;
    const { target } = await assembleWeeklyTarget(user.id, todayDate, {
      availabilityHours,
      planHoursPerWeek: constraints.hoursPerWeek,
    });
    hoursTarget = target.hours;
  }

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
    wellness.map((w) => ({
      hrvMs: w.hrvMs,
      restingHr: w.restingHr,
      hrvSdnnMs: w.hrvSdnnMs,
    }))
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
    .find((w) => w.hrvMs != null || w.hrvSdnnMs != null || w.restingHr != null);

  // The tile reads the decision computeDailyMetrics already made, rather than
  // re-resolving it — the tile and the ring must never name different metrics.
  const latestHrvMetric =
    metrics.find((m) => m.date === latest?.date)?.hrvMetric ?? null;

  const window7 = wellness.filter((w) => w.date >= daysAgo(7));

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
  const sleepDebt = sleepDebtFrom(wellness, bodyPrefsRow ?? null, daysAgo(0));

  // ── Vitals sparklines (7d) — "" when fewer than two real points ─────────
  const rhrSparkPath = sparkPath(window7.map((w) => w.restingHr));
  const sleepSparkPath = sparkPath(window7.map((w) => w.sleepSecs));
  const formSparkPath = sparkPath(
    metrics
      .filter((m) => m.date >= daysAgo(7))
      .map((m) => (m.ctl != null && m.atl != null ? m.ctl - m.atl : null))
  );

  const rhrGood = latest?.restingHr != null && latest.restingHr <= avg7rhr;

  const vitals: VitalTile[] = [
    buildHrvTile({ latest, metric: latestHrvMetric, window7 }),
    {
      label: "RHR",
      value:
        latest?.restingHr != null
          ? Figure.available(String(Math.round(latest.restingHr)), "high")
          : Figure.missingInput("a resting-heart-rate reading"),
      unit: "bpm",
      delta:
        latest?.restingHr != null && avg7rhr > 0
          ? {
              text: `${rhrGood ? "▼" : "▲"} 7d ${Math.round(avg7rhr)}`,
              tone: rhrGood ? "good" : "muted",
            }
          : null,
      sparkPath: rhrSparkPath,
      sparkClass: "stroke-chart-2",
      href: "/body?tab=trends",
    },
    {
      label: "Sleep",
      value:
        sleepHours != null
          ? Figure.available(hoursToClock(sleepHours), "high")
          : Figure.missingInput("a sleep reading"),
      delta:
        sleepDebt.debtSecs != null && sleepDebt.debtSecs > 0
          ? {
              text: formatSleepDebt(sleepDebt.debtSecs),
              tone: "warn",
              confidence: sleepDebt.confidence === "low" ? "low" : undefined,
            }
          : null,
      sparkPath: sleepSparkPath,
      sparkClass: "stroke-chart-1",
      href: "/body?tab=sleep",
    },
    {
      label: "Form · TSB",
      value:
        tsb != null
          ? Figure.available(fmtTsb(tsb), "high")
          : Figure.missingInput("training-load history"),
      delta:
        todayCtl != null
          ? { text: `CTL ${Math.round(todayCtl)}`, tone: "muted" }
          : null,
      sparkPath: formSparkPath,
      sparkClass: "stroke-chart-4",
      href: "/body?tab=trends",
    },
  ];

  // Same column the score used, and the baseline the score actually ran
  // against — exp() of the stored ln-mean. The old raw 7-day rMSSD mean
  // next to an SDNN reading printed "HRV 91 vs 97 baseline" and invented a
  // deficit. Hoisted (v0.99 slice 1): TodayHero now renders up to three
  // times per state (full lead, compact recap, stale recap) and this must
  // not be duplicated three ways.
  const heroWhy = {
    hrv: latestHrvMetric
      ? latestHrvMetric === "rmssd"
        ? (latest?.hrvMs ?? null)
        : (latest?.hrvSdnnMs ?? null)
      : null,
    hrvBaseline:
      todayMetric?.hrvBaselineMean != null
        ? Math.exp(todayMetric.hrvBaselineMean)
        : null,
    rhr: latest?.restingHr ?? null,
    sleepHours,
    tsb,
  };

  // Only assembled when the state needs it — a cache read and a slot
  // lookup are cheap, but there is no reason to pay for them at 09:00.
  let justLanded: React.ComponentProps<typeof JustLandedCard> | null = null;
  if (todayState === "post-session" && recentActivity) {
    const detail = await getCachedActivityDetail(user.id, recentActivity.id);
    const a = detail?.activity ?? recentActivity;

    const stats: { label: string; value: string; unit?: string }[] = [];
    if (a.durationS != null)
      stats.push({ label: "Duration", value: formatDuration(a.durationS) });
    if (a.distanceM != null)
      stats.push({
        label: "Distance",
        value: (a.distanceM / 1000).toFixed(1),
        unit: "km",
      });
    if (a.load != null)
      stats.push({ label: "Load", value: String(Math.round(a.load)) });
    if (a.avgHr != null)
      stats.push({
        label: "Avg HR",
        value: String(Math.round(a.avgHr)),
        unit: "bpm",
      });
    if (a.avgPower != null)
      stats.push({
        label: "Avg Power",
        value: String(Math.round(a.avgPower)),
        unit: "W",
      });
    if (a.elevationM != null)
      stats.push({
        label: "Climb",
        value: String(Math.round(a.elevationM)),
        unit: "m",
      });

    // The plan's own ask for today, when there was one. Never a judgement
    // on the gap — that claim would have no owner.
    const plannedToday = todaySlot?.workouts[0] ?? null;
    const asked = plannedToday
      ? `${plannedToday.durationMins} min · ${plannedToday.intensity}`
      : null;
    const delivered = [
      a.durationS != null ? formatDuration(a.durationS) : null,
      a.load != null ? `${Math.round(a.load)} load` : null,
      a.avgHr != null ? `avg HR ${Math.round(a.avgHr)}bpm` : null,
    ]
      .filter(Boolean)
      .join(" · ");

    const review =
      a.debriefState === "answered" && a.reviewSummary ? a.reviewSummary : null;
    const answer =
      a.debriefState === "answered"
        ? [
            a.perceivedExertion != null
              ? `RPE ${Math.round(a.perceivedExertion)}`
              : null,
            a.feel != null ? `felt ${a.feel}` : null,
          ]
            .filter(Boolean)
            .join(" · ") || null
        : null;

    const streamSpecs: { label: string; key: string; className: string }[] = [
      { label: "HR", key: "heartrate", className: "stroke-chart-5" },
      { label: "Power", key: "watts", className: "stroke-chart-4" },
      { label: "Pace", key: "velocity_smooth", className: "stroke-chart-1" },
      { label: "Elev.", key: "altitude", className: "stroke-chart-2" },
    ];
    const streams: JustLandedStream[] = streamSpecs
      .map((s) => ({
        label: s.label,
        className: s.className,
        path: streamPath(detail?.streams?.[s.key]),
      }))
      .filter((s) => s.path !== "");

    justLanded = {
      activityId: a.id,
      name: a.name ?? a.sport,
      meta: [
        a.sport,
        (a.startDateLocal ?? a.startDate).toLocaleDateString("en-US", {
          weekday: "short",
          month: "short",
          day: "numeric",
        }),
        a.provider === "intervals_icu" ? "intervals.icu" : a.provider,
      ].join(" · "),
      asked,
      delivered,
      stats,
      debrief:
        answer || a.debriefNotes || review
          ? { answer, notes: a.debriefNotes, review }
          : null,
      streams,
      lapCount: detail?.laps?.length ?? null,
    };
  }

  // ── Evening blocks ──────────────────────────────────────────────────────
  const tomorrowYmd = (() => {
    const d = new Date(todayDate);
    d.setDate(d.getDate() + 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  })();
  // Null when tomorrow falls outside the open week — the card renders
  // nothing rather than claiming a session that has not been planned.
  const tomorrowSlot =
    weekPlan?.days.find((d) => d.date === tomorrowYmd) ?? null;

  // Not `as const`: a tuple literal array infers each row as its own
  // "Energy"/"Soreness"/"Stress" literal union, which then rejects a
  // `string`-typed predicate as a widening rather than a narrowing.
  const dayLogRows: [string, number | null | undefined][] = [
    ["Energy", todayWellness?.energy1_10],
    ["Soreness", todayWellness?.soreness1_10],
    ["Stress", todayWellness?.stress1_10],
  ];
  const dayLogScores = dayLogRows
    .filter((s): s is [string, number] => s[1] != null)
    .map(([label, value]) => ({ label, value }));

  // The day's debrief, folded into the log the way the evening mockup does.
  const debriefedToday =
    recentActivity?.debriefState === "answered" ? recentActivity : null;
  const debriefLine = debriefedToday
    ? [
        debriefedToday.name ?? debriefedToday.sport,
        [
          debriefedToday.perceivedExertion != null
            ? `RPE ${Math.round(debriefedToday.perceivedExertion)}`
            : null,
          debriefedToday.feel != null ? `felt ${debriefedToday.feel}` : null,
        ]
          .filter(Boolean)
          .join(" · "),
      ]
        .filter((p) => p !== "")
        .join(" — ")
    : null;

  // ── Render (2a Today) ────────────────────────────────────────────────────
  return (
    <AppShell
      noChrome
      user={shellUser(user)}
      overlay={
        <SheetHost
          userId={user.id}
          sheet={sheet}
          activityId={sheetActivity}
          closeHref="/"
          todayYmd={todayYmd}
        />
      }
    >
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
              <h1 className="text-title font-bold tracking-[-0.02em] text-ink-primary">
                {greetingLine()}
              </h1>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Link
                href="/?sheet=checkin"
                className="rounded-full bg-accent px-3.5 py-1.5 text-label font-bold text-primary-foreground transition-opacity hover:opacity-90"
              >
                Check in
                <span className="hidden lg:inline"> · 60s</span>
              </Link>
              <Link
                href="/settings"
                aria-label="Menu"
                className="flex size-9 shrink-0 items-center justify-center rounded-full border border-hairline bg-surface-raised"
              >
                {initial ? (
                  <span
                    aria-hidden
                    className="text-caption font-bold text-ink-primary"
                  >
                    {initial}
                  </span>
                ) : (
                  <User
                    className="size-5 text-ink-secondary"
                    strokeWidth={1.5}
                  />
                )}
              </Link>
            </div>
          </header>

          {(() => {
            const blocks: Record<TodayBlockKey, React.ReactNode> = {
              heroFull: (
                <TodayHero
                  readiness={readinessOrNull}
                  band={band}
                  recoveryScore={recoveryScore}
                  sleepScore={latest?.sleepScore ?? null}
                  why={heroWhy}
                />
              ),
              heroCompact: (
                <TodayHero
                  readiness={readinessOrNull}
                  band={band}
                  recoveryScore={recoveryScore}
                  sleepScore={latest?.sleepScore ?? null}
                  why={heroWhy}
                  variant="compact"
                />
              ),
              heroRecap: (
                <TodayHero
                  readiness={readinessOrNull}
                  band={band}
                  recoveryScore={recoveryScore}
                  sleepScore={latest?.sleepScore ?? null}
                  why={heroWhy}
                  variant="compact"
                  staleLabel="Readiness this morning"
                />
              ),
              calibration:
                band === "calibrating" && calibration.remaining > 0 ? (
                  <CalibrationProgress
                    daysWithSignal={calibration.daysWithSignal}
                    target={calibration.target}
                    prompt={calibration.prompt}
                  />
                ) : null,
              vitals: <VitalsGrid tiles={vitals} />,
              week: (
                <WeekRow
                  days={weekPlan?.days ?? null}
                  hoursDone={weekHours}
                  hoursTarget={hoursTarget}
                />
              ),
              session: (
                <SessionCard
                  slot={todaySlot}
                  adjustmentReason={todayAdjustment}
                  otherDays={otherDays}
                />
              ),
              sessionDone: (
                <SessionCard
                  slot={todaySlot}
                  adjustmentReason={todayAdjustment}
                  otherDays={otherDays}
                  variant="done"
                />
              ),
              sessionTomorrow: (
                <SessionCard
                  slot={tomorrowSlot}
                  adjustmentReason={null}
                  otherDays={otherDays}
                  heading="Tomorrow's session"
                  allowMarkDone={false}
                />
              ),
              justLanded: justLanded ? (
                <JustLandedCard {...justLanded} />
              ) : null,
              dayLog: (
                <DayLogCard
                  scores={dayLogScores}
                  tags={todayWellness?.tags ?? []}
                  notes={todayWellness?.notes ?? null}
                  debriefLine={debriefLine}
                />
              ),
              bedtime: (
                <BedtimeCard
                  bedtime={sleepDebt.bedtime}
                  debtSecs={sleepDebt.debtSecs}
                  confidence={sleepDebt.confidence}
                />
              ),
              debriefChip: <DebriefChip userId={user.id} />,
              raceChip:
                card.race && card.daysOut != null && card.daysOut <= 21 ? (
                  <RaceChip {...card} />
                ) : null,
              coach: insight ? (
                <CoachBrief
                  text={insight.text}
                  threadId={insight.threadId}
                  inboxTeaser={inboxTeaser}
                />
              ) : null,
            };

            // Reorder, never hide. The sequence lives in
            // src/lib/today/block-order.ts, which has its own tests
            // asserting every state shows every block — see that file for
            // why the rule is checked against concepts rather than keys.
            const ordered = BLOCK_ORDER[todayState].map((key) => (
              <div key={key} className="mb-6 empty:mb-0">
                {blocks[key]}
              </div>
            ));

            // The 7fr/5fr split is a morning-shaped layout — vitals and the
            // week on the left, the session and the coach on the right. It
            // cannot survive an arbitrary reorder, and desktop is not where
            // the post-session moment happens, so the other two states take
            // one honest column instead of a wrong two.
            if (todayState !== "morning")
              return <div className="min-w-0">{ordered}</div>;

            return (
              <div className="lg:grid lg:grid-cols-[7fr_5fr] lg:items-start lg:gap-5">
                <div className="min-w-0">
                  {ordered.filter((n) =>
                    MORNING_LEFT_COLUMN.has(
                      String((n as React.ReactElement).key) as TodayBlockKey
                    )
                  )}
                </div>
                <div className="min-w-0">
                  {ordered.filter(
                    (n) =>
                      !MORNING_LEFT_COLUMN.has(
                        String((n as React.ReactElement).key) as TodayBlockKey
                      )
                  )}
                </div>
              </div>
            );
          })()}
        </div>
      </PullToRefresh>
    </AppShell>
  );
}

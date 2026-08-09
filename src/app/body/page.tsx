import Link from "next/link";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { recordSurfaceView } from "@/lib/telemetry";
import { AppShell, shellUser } from "@/components/app-shell";
import { BaselineTrendCard } from "@/components/body/baseline-trend-card";
import { SleepNightCard } from "@/components/body/sleep-night-card";
import { SleepHistoryStrip } from "@/components/body/sleep-history-strip";
import { selectNight } from "@/lib/sleep-history";
import { CorrelationRows } from "@/components/body/correlation-rows";
import { LabsTiles } from "@/components/body/labs-tiles";
import { BodyBatteryCurve } from "@/components/dashboard/body-battery";
import { MilestonesCard } from "@/components/dashboard/milestones-card";
import { JournalForm } from "@/components/journal/journal-form";
import { BioAgeCard } from "@/components/health/bio-age-card";
import { BloodPressureCard } from "@/components/health/blood-pressure-card";
import { HealthUpload } from "@/components/health/health-upload";
import { HealthManualEntry } from "@/components/health/health-manual-entry";
import {
  BiomarkerList,
  type BiomarkerRow,
} from "@/components/health/biomarker-list";
import { EmptyState } from "@/components/ui/empty-state";
import {
  baselineBandFromSeries,
  baselineBandLn,
  baselineBandLinear,
} from "@/lib/charts";
import { BASELINE_WINDOW_DAYS } from "@/lib/readiness";
import { computeTagInsights } from "@/lib/insights/correlations";
import { getMilestones } from "@/lib/insights/milestones";
import { biologicalAge, type BioAgeResult } from "@/lib/biological-age";
import { bpTrend } from "@/lib/blood-pressure";
import {
  chronotype,
  sleepConsistency,
  stageBreakdown,
  type SleepNight,
} from "@/lib/sleep-insights";
import {
  computeBodyBattery,
  typicalBedMinutes,
  DEFAULT_WAKE_MINUTES,
  DEFAULT_BED_MINUTES,
} from "@/lib/body-battery";
import { computeSleepDebt, DEFAULT_SLEEP_NEED_SECS } from "@/lib/sleep-debt";
import { buildBodyHref, BODY_TABS, type BodyTab } from "@/lib/log-href";
import type { BiomarkerCategory } from "@/lib/health-records";
import { isBaselineExcluded, type DayFlag } from "@/lib/day-flags";
import { Figure } from "@/lib/uncertainty";
import { HeartPulse, Moon } from "lucide-react";

export const dynamic = "force-dynamic";

const RANGES = [30, 90, 180, 365];

const TAB_LABEL: Record<BodyTab, string> = {
  trends: "Trends",
  sleep: "Sleep",
  journal: "Journal",
  labs: "Labs",
};

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

/** "07:15" → 435; null for anything malformed, never NaN. */
function hhmmToMinutes(v: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(v.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

function minsToHhMm(mins: number): string {
  const m = ((Math.round(mins) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/**
 * One entry per calendar day across the window, oldest first. Days with no
 * synced row are explicit nulls rather than being omitted — BaselineTrendCard
 * positions points by array index, so a sparse array (missing days silently
 * dropped) compresses sync gaps in x instead of showing them as gaps.
 */
function fillDailyGaps<Row extends { date: string }, T>(
  rows: Row[],
  days: number,
  pick: (row: Row) => T | null
): (T | null)[] {
  const byDate = new Map(rows.map((r) => [r.date, pick(r)]));
  const out: (T | null)[] = [];
  for (let i = days; i >= 0; i--) {
    out.push(byDate.get(daysAgo(i)) ?? null);
  }
  return out;
}

/**
 * Only HRV and RHR have a stored baseline (daily_metrics carries those two
 * columns and no others), so every other metric's band is computed here from
 * the athlete's own readings — under the readiness engine's own rules: the
 * trailing BASELINE_WINDOW_DAYS, flagged days (ill/travel/altitude) excluded,
 * and the reading the chart shows as "current" left out of what it is being
 * measured against.
 */
function ownBaselineBand<
  Row extends { date: string; dayFlags: DayFlag[] | null },
>(
  rows: Row[],
  pick: (row: Row) => number | null
): { low: number; high: number } | null {
  const history = rows
    .filter(
      (r) =>
        r.date >= daysAgo(BASELINE_WINDOW_DAYS) &&
        !isBaselineExcluded(r.dayFlags)
    )
    .map(pick)
    .filter((v): v is number => v != null);
  // Rows arrive oldest-first, so the last reading is the current one.
  return baselineBandFromSeries(history.slice(0, -1));
}

export default async function BodyPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; range?: string; night?: string }>;
}) {
  const user = await requireUser();
  await recordSurfaceView(user.id, "body");
  const sp = await searchParams;
  const tab: BodyTab = BODY_TABS.find((t) => t === sp.tab) ?? "trends";
  const range = RANGES.includes(Number(sp.range)) ? Number(sp.range) : 90;
  // Raw URL input — validated against the loaded nights inside SleepTab,
  // never used to build a query.
  const night = sp.night;
  const href = (over: { tab?: BodyTab; range?: number; night?: string }) =>
    buildBodyHref({ tab, range, night }, over);

  // The streak chip is on every segment, so it's fetched once here.
  const milestones = await getMilestones(user.id);

  return (
    <AppShell user={shellUser(user)}>
      <header className="mb-5 pt-8">
        <div className="mb-4 flex items-start justify-between gap-3">
          <h1 className="text-[22px] font-bold tracking-[-0.03em]">Body</h1>
          {milestones.currentStreak > 0 && (
            <span className="shrink-0 rounded-full border border-emerald-500/30 bg-emerald-500/[0.08] px-3 py-1 text-[10.5px] font-bold text-emerald-400">
              Streak {milestones.currentStreak}d ✓
            </span>
          )}
        </div>
        <nav aria-label="Body sections" className="flex flex-wrap gap-1.5">
          {BODY_TABS.map((t) => (
            <Link
              key={t}
              href={href({ tab: t })}
              aria-current={t === tab ? "page" : undefined}
              className={`rounded-full px-4 py-1.5 text-[11px] font-bold transition-colors ${
                t === tab
                  ? "bg-white/[0.12] text-white"
                  : "bg-white/[0.04] text-white/50 hover:text-white/80"
              }`}
            >
              {TAB_LABEL[t]}
            </Link>
          ))}
        </nav>
      </header>

      {tab === "trends" ? (
        <TrendsTab userId={user.id} range={range} href={href} />
      ) : tab === "sleep" ? (
        <SleepTab userId={user.id} night={night} href={href} />
      ) : tab === "journal" ? (
        <JournalTab userId={user.id} milestones={milestones} />
      ) : (
        <LabsTab userId={user.id} />
      )}
    </AppShell>
  );
}

// ── Trends ────────────────────────────────────────────────────────────────

async function TrendsTab({
  userId,
  range,
  href,
}: {
  userId: string;
  range: number;
  href: (over: { tab?: BodyTab; range?: number }) => string;
}) {
  // Always at least the baseline window, even on the 30d chart: the band is
  // a fixed 60-day reference, so a shorter range must not quietly narrow it
  // to whatever happens to be on screen. fillDailyGaps only reads the days it
  // is asked for, so the extra rows never reach the chart itself.
  const wellness = await db.query.wellnessDaily.findMany({
    where: and(
      eq(schema.wellnessDaily.userId, userId),
      gte(
        schema.wellnessDaily.date,
        daysAgo(Math.max(range, BASELINE_WINDOW_DAYS))
      )
    ),
    orderBy: schema.wellnessDaily.date,
  });

  // HRV and RHR read their baselines from daily_metrics, where the nightly
  // job stores them; the rest are derived from the same rows the chart draws.
  // Either way they're the athlete's own — never a population norm.
  const baseline = await db.query.dailyMetrics.findFirst({
    where: eq(schema.dailyMetrics.userId, userId),
    orderBy: desc(schema.dailyMetrics.date),
  });

  const hrvBand =
    baseline?.hrvBaselineMean != null && baseline?.hrvBaselineSd != null
      ? baselineBandLn(baseline.hrvBaselineMean, baseline.hrvBaselineSd)
      : null;
  const rhrBand =
    baseline?.rhrBaselineMean != null && baseline?.rhrBaselineSd != null
      ? baselineBandLinear(baseline.rhrBaselineMean, baseline.rhrBaselineSd)
      : null;

  // Which optional cards render is a question about the chosen range, not
  // about the baseline window — a VO2max reading from 50 days ago must not
  // put an empty card on the 30d view.
  const inRange = wellness.filter((w) => w.date >= daysAgo(range));

  return (
    <div className="pb-10">
      <div className="mb-3 flex justify-end gap-1">
        {RANGES.map((r) => (
          <Link
            key={r}
            href={href({ range: r })}
            aria-current={r === range ? "true" : undefined}
            className={`rounded-full px-2.5 py-1 text-[10px] font-bold transition-colors ${
              r === range
                ? "bg-white/[0.12] text-white"
                : "bg-white/[0.04] text-white/45 hover:text-white/70"
            }`}
          >
            {r}d
          </Link>
        ))}
      </div>

      <BaselineTrendCard
        title="HRV vs baseline"
        values={fillDailyGaps(wellness, range, (w) => w.hrvMs)}
        band={hrvBand}
        color="#10b981"
        bandFill="rgba(16,185,129,0.08)"
        unit="ms"
      />
      <BaselineTrendCard
        title="Resting HR vs baseline"
        values={fillDailyGaps(wellness, range, (w) => w.restingHr)}
        band={rhrBand}
        color="#3b82f6"
        bandFill="rgba(59,130,246,0.08)"
        unit="bpm"
      />
      <BaselineTrendCard
        title="Weight"
        values={fillDailyGaps(wellness, range, (w) => w.weightKg)}
        band={ownBaselineBand(wellness, (w) => w.weightKg)}
        color="#a78bfa"
        bandFill="rgba(167,139,250,0.08)"
        unit="kg"
        decimals={1}
      />
      {inRange.some((w) => w.vo2max != null) && (
        <BaselineTrendCard
          title="VO2max"
          values={fillDailyGaps(wellness, range, (w) => w.vo2max)}
          band={ownBaselineBand(wellness, (w) => w.vo2max)}
          color="#f59e0b"
          bandFill="rgba(245,158,11,0.08)"
          unit="ml/kg/min"
          decimals={1}
        />
      )}
      {inRange.some((w) => w.bloodOxygenPct != null) && (
        <BaselineTrendCard
          title="Blood oxygen"
          values={fillDailyGaps(wellness, range, (w) => w.bloodOxygenPct)}
          band={ownBaselineBand(wellness, (w) => w.bloodOxygenPct)}
          color="#06b6d4"
          bandFill="rgba(6,182,212,0.08)"
          unit="%"
        />
      )}
      {inRange.some((w) => w.wristTempC != null) && (
        <BaselineTrendCard
          title="Wrist temperature"
          values={fillDailyGaps(wellness, range, (w) => w.wristTempC)}
          band={ownBaselineBand(wellness, (w) => w.wristTempC)}
          color="#f472b6"
          bandFill="rgba(244,114,182,0.08)"
          unit="°C"
          decimals={1}
        />
      )}
      {inRange.some((w) => w.bmi != null) && (
        <BaselineTrendCard
          title="BMI"
          values={fillDailyGaps(wellness, range, (w) => w.bmi)}
          band={ownBaselineBand(wellness, (w) => w.bmi)}
          color="#facc15"
          bandFill="rgba(250,204,21,0.08)"
          unit=""
          decimals={1}
        />
      )}
      {inRange.some((w) => w.leanMassKg != null) && (
        <BaselineTrendCard
          title="Lean body mass"
          values={fillDailyGaps(wellness, range, (w) => w.leanMassKg)}
          band={ownBaselineBand(wellness, (w) => w.leanMassKg)}
          color="#34d399"
          bandFill="rgba(52,211,153,0.08)"
          unit="kg"
          decimals={1}
        />
      )}
      {inRange.some((w) => w.waistCm != null) && (
        <BaselineTrendCard
          title="Waist circumference"
          values={fillDailyGaps(wellness, range, (w) => w.waistCm)}
          band={ownBaselineBand(wellness, (w) => w.waistCm)}
          color="#fb923c"
          bandFill="rgba(251,146,60,0.08)"
          unit="cm"
          decimals={1}
        />
      )}
      {inRange.some((w) => w.respiratoryRate != null) && (
        <BaselineTrendCard
          title="Respiratory rate"
          values={fillDailyGaps(wellness, range, (w) => w.respiratoryRate)}
          band={ownBaselineBand(wellness, (w) => w.respiratoryRate)}
          color="#38bdf8"
          bandFill="rgba(56,189,248,0.08)"
          unit="br/min"
          decimals={1}
        />
      )}
      {inRange.some((w) => w.sleepingHr != null) && (
        <BaselineTrendCard
          title="Sleeping HR"
          values={fillDailyGaps(wellness, range, (w) => w.sleepingHr)}
          band={ownBaselineBand(wellness, (w) => w.sleepingHr)}
          color="#818cf8"
          bandFill="rgba(129,140,248,0.08)"
          unit="bpm"
        />
      )}
      {inRange.some((w) => w.hrvSdnnMs != null) && (
        <BaselineTrendCard
          title="HRV (SDNN)"
          values={fillDailyGaps(wellness, range, (w) => w.hrvSdnnMs)}
          band={ownBaselineBand(wellness, (w) => w.hrvSdnnMs)}
          color="#2dd4bf"
          bandFill="rgba(45,212,191,0.08)"
          unit="ms"
        />
      )}
      {/* "Readiness score" (not "Readiness") — /plan already uses
          EventReadiness for a race's demand, a different concept. */}
      {inRange.some((w) => w.readiness != null) && (
        <BaselineTrendCard
          title="Readiness score"
          values={fillDailyGaps(wellness, range, (w) => w.readiness)}
          band={ownBaselineBand(wellness, (w) => w.readiness)}
          color="#fbbf24"
          bandFill="rgba(251,191,36,0.08)"
          unit=""
        />
      )}
      {inRange.some((w) => w.steps != null) && (
        <BaselineTrendCard
          title="Steps"
          values={fillDailyGaps(wellness, range, (w) => w.steps)}
          band={ownBaselineBand(wellness, (w) => w.steps)}
          color="#c084fc"
          bandFill="rgba(192,132,252,0.08)"
          unit=""
        />
      )}
      {inRange.some((w) => w.hydrationL != null) && (
        <BaselineTrendCard
          title="Hydration"
          values={fillDailyGaps(wellness, range, (w) => w.hydrationL)}
          band={ownBaselineBand(wellness, (w) => w.hydrationL)}
          color="#22d3ee"
          bandFill="rgba(34,211,238,0.08)"
          unit="L"
          decimals={1}
        />
      )}

      {inRange.length === 0 && (
        <EmptyState
          icon={HeartPulse}
          message="No wellness readings in this range yet."
        />
      )}
    </div>
  );
}

// ── Sleep ─────────────────────────────────────────────────────────────────

async function SleepTab({
  userId,
  night,
  href,
}: {
  userId: string;
  night: string | undefined;
  href: (over: { tab?: BodyTab; range?: number; night?: string }) => string;
}) {
  const wellness = await db.query.wellnessDaily.findMany({
    where: and(
      eq(schema.wellnessDaily.userId, userId),
      gte(schema.wellnessDaily.date, daysAgo(90))
    ),
    orderBy: schema.wellnessDaily.date,
  });

  const prefs = await db.query.bodyPrefs.findFirst({
    where: eq(schema.bodyPrefs.userId, userId),
  });

  const nights: SleepNight[] = wellness.map((w) => ({
    date: w.date,
    sleepSecs: w.sleepSecs,
    sleepDeepSecs: w.sleepDeepSecs,
    sleepRemSecs: w.sleepRemSecs,
    sleepLightSecs: w.sleepLightSecs,
    sleepAwakeSecs: w.sleepAwakeSecs,
    bedStart: w.bedStart,
    bedEnd: w.bedEnd,
  }));

  // v0.35: which night is on screen. `night` is raw URL input; selectNight
  // only honours it by matching a night already loaded.
  const { selected: shownNight, recent, index } = selectNight(nights, night);
  const isLatest = index === recent.length - 1;

  const stages = shownNight ? stageBreakdown(shownNight) : null;
  // "Your provider doesn't send stages" is only true when NO night has them.
  // Otherwise this night simply hasn't had its stages written yet, which is
  // routine: the Companion writes a night's duration before its stages.
  const stagesUnsupported = !nights.some((n) => n.sleepDeepSecs != null);
  const consistency = sleepConsistency(
    nights.filter((n) => n.date >= daysAgo(30))
  );
  const chrono = chronotype(nights);

  const bedWindow =
    shownNight?.bedStart != null && shownNight?.bedEnd != null
      ? {
          start: minsToHhMm(
            shownNight.bedStart.getHours() * 60 +
              shownNight.bedStart.getMinutes()
          ),
          end: minsToHhMm(
            shownNight.bedEnd.getHours() * 60 + shownNight.bedEnd.getMinutes()
          ),
        }
      : null;

  // Recommended bedtime tonight — the same computation the sleep vital's
  // debt delta uses on Today, so the two can't disagree.
  const bedtimes = wellness
    .filter((w) => w.date >= daysAgo(14) && w.bedStart != null)
    .map((w) => w.bedStart!.getHours() * 60 + w.bedStart!.getMinutes());
  const debt = computeSleepDebt({
    nights: wellness
      .filter((w) => w.date >= daysAgo(14))
      .map((w) => ({ sleepSecs: w.sleepSecs })),
    sleepNeedSecs: prefs?.sleepNeedSecs ?? DEFAULT_SLEEP_NEED_SECS,
    wakeTime: prefs?.wakeTime ?? null,
    bedtimes,
  });

  // Body battery — modelled, and labelled as such by the component itself.
  const todayYmd = daysAgo(0);
  const todayActivities = await db.query.activities.findMany({
    where: and(
      eq(schema.activities.userId, userId),
      // COALESCE at the SQL level, not just in JS: a plain
      // gte(startDateLocal, ...) would silently drop every pre-migration row
      // (startDateLocal is a nullable, not-yet-backfilled column — NULL >= x
      // is NULL/false in SQL), excluding them from the window entirely
      // rather than falling back to startDate.
      gte(
        sql`coalesce(${schema.activities.startDateLocal}, ${schema.activities.startDate})`,
        new Date(`${todayYmd}T00:00:00`)
      )
    ),
  });
  const todayMetric = await db.query.dailyMetrics.findFirst({
    where: eq(schema.dailyMetrics.userId, userId),
    orderBy: desc(schema.dailyMetrics.date),
  });
  // The waking window comes from the athlete's own schedule (wake time +
  // typical sleep need), never from tonight's debt-repayment bedtime — being
  // in debt must not silently compress the modelled day. A malformed
  // wakeTime degrades to the defaults instead of feeding NaN into the curve.
  const parsedWake = prefs?.wakeTime ? hhmmToMinutes(prefs.wakeTime) : null;
  const wakeMinutes = parsedWake ?? DEFAULT_WAKE_MINUTES;
  const bedMinutes =
    parsedWake != null
      ? typicalBedMinutes(
          wakeMinutes,
          prefs?.sleepNeedSecs ?? DEFAULT_SLEEP_NEED_SECS
        )
      : DEFAULT_BED_MINUTES;

  const now = new Date();
  const battery = computeBodyBattery({
    readiness: todayMetric?.readiness ?? null,
    wakeMinutes,
    bedMinutes,
    activities: todayActivities.map((a) => ({
      startMinutes:
        (a.startDateLocal ?? a.startDate).getHours() * 60 +
        (a.startDateLocal ?? a.startDate).getMinutes(),
      durationMin: (a.durationS ?? 0) / 60,
      load: a.load ?? 0,
    })),
    nowMinutes: now.getHours() * 60 + now.getMinutes(),
    // v0.63 gave computeBodyBattery a sleep-debt penalty and a "sleep debt"
    // tag, then never passed the value — both were dead in production while
    // `debt` sat computed 40 lines above.
    sleepDebtSecs: debt.debtSecs,
  });

  return (
    <div className="pb-10">
      <SleepHistoryStrip
        nights={recent}
        selectedDate={shownNight?.date ?? null}
        href={(d) => href({ night: d })}
      />

      <SleepNightCard
        totalSecs={shownNight?.sleepSecs ?? null}
        stages={
          stages
            ? {
                deepSecs: stages.deepSecs,
                remSecs: stages.remSecs,
                lightSecs: stages.lightSecs,
                awakeSecs: stages.awakeSecs,
              }
            : null
        }
        bedWindow={bedWindow}
        heading={
          isLatest ? "Last night" : (shownNight?.date ?? "No sleep recorded")
        }
        prevHref={
          index > 0 ? href({ night: recent[index - 1].date }) : undefined
        }
        nextHref={
          index >= 0 && index < recent.length - 1
            ? // Stepping back to the newest night clears the param rather than
              // pinning it, so the URL returns to its default shape.
              index + 1 === recent.length - 1
              ? href({ night: "" })
              : href({ night: recent[index + 1].date })
            : undefined
        }
        stagesUnsupported={stagesUnsupported}
        bedtimeTonight={isLatest ? debt.bedtime : null}
      />

      {(consistency != null || chrono) && (
        <div className="mb-3 flex flex-wrap items-baseline gap-x-5 gap-y-1 rounded-[18px] border border-white/[0.08] bg-white/[0.03] px-4 py-3">
          {/* 30-day aggregates: they describe the athlete's rhythm, not the
              night selected above, so they live outside that card. */}
          {consistency != null && (
            <span className="text-[11px] text-white/50">
              Consistency{" "}
              <strong className="font-bold text-white/85">
                {Math.round(consistency.score)}
              </strong>
            </span>
          )}
          {chrono && (
            <span className="text-[11px] text-white/50">
              Chronotype{" "}
              <strong className="font-bold text-white/85">
                midpoint {chrono.midpointHhMm}
              </strong>
            </span>
          )}
          <span className="text-[10px] text-white/30">last 30 nights</span>
        </div>
      )}

      <BaselineTrendCard
        title="Sleep duration vs baseline"
        values={fillDailyGaps(wellness, 90, (w) =>
          w.sleepSecs != null ? w.sleepSecs / 3600 : null
        )}
        band={ownBaselineBand(wellness, (w) =>
          w.sleepSecs != null ? w.sleepSecs / 3600 : null
        )}
        color="#3b82f6"
        bandFill="rgba(59,130,246,0.08)"
        unit="h"
        decimals={1}
      />

      {wellness.some((w) => w.sleepScore != null) && (
        <BaselineTrendCard
          title="Sleep score vs baseline"
          values={fillDailyGaps(wellness, 90, (w) => w.sleepScore)}
          band={ownBaselineBand(wellness, (w) => w.sleepScore)}
          color="#8b5cf6"
          bandFill="rgba(139,92,246,0.08)"
          unit=""
        />
      )}

      {battery.current != null && (
        <BodyBatteryCurve
          current={battery.current}
          points={battery.points}
          tags={battery.tags}
          checkpoints={battery.checkpoints}
        />
      )}

      {wellness.every((w) => w.sleepSecs == null) && (
        <EmptyState icon={Moon} message="No sleep data recorded yet." />
      )}
    </div>
  );
}

// ── Journal ───────────────────────────────────────────────────────────────

async function JournalTab({
  userId,
  milestones,
}: {
  userId: string;
  milestones: Awaited<ReturnType<typeof getMilestones>>;
}) {
  const latest = await db.query.wellnessDaily.findFirst({
    where: eq(schema.wellnessDaily.userId, userId),
    orderBy: desc(schema.wellnessDaily.date),
  });

  // Five days back so the form can restore a day the athlete missed.
  const recentEntries = await db.query.wellnessDaily.findMany({
    where: and(
      eq(schema.wellnessDaily.userId, userId),
      gte(schema.wellnessDaily.date, daysAgo(4))
    ),
    orderBy: desc(schema.wellnessDaily.date),
  });

  const entriesByDate: Record<
    string,
    {
      energy: number | null;
      soreness: number | null;
      stress: number | null;
      mood: string | null;
      tags: string[] | null;
      dayFlags: DayFlag[] | null;
      notes: string | null;
    }
  > = {};
  for (const entry of recentEntries) {
    entriesByDate[entry.date] = {
      energy: entry.energy1_10,
      soreness: entry.soreness1_10,
      stress: entry.stress1_10,
      mood: entry.mood,
      tags: entry.tags,
      dayFlags: entry.dayFlags,
      notes: entry.notes,
    };
  }

  const activeConnection = await db.query.connections.findFirst({
    where: and(
      eq(schema.connections.userId, userId),
      eq(schema.connections.status, "active")
    ),
    columns: { id: true },
  });

  const insights = await computeTagInsights(userId);
  const journalPrefsRow = await db.query.journalPrefs.findFirst({
    where: eq(schema.journalPrefs.userId, userId),
    columns: { usualBehaviorTags: true },
  });

  return (
    <div className="pb-10">
      <CorrelationRows insights={insights} />

      {/* The check-in itself becomes bottom-sheet 1h in step 6. Until then
          it lives here, so the athlete can still log a day. */}
      <JournalForm
        syncedHrv={latest?.hrvMs ?? null}
        syncedRhr={latest?.restingHr ?? null}
        syncedWeight={latest?.weightKg ?? null}
        syncedSleepHours={
          latest?.sleepSecs != null ? latest.sleepSecs / 3600 : null
        }
        streakDays={milestones.currentStreak}
        entriesByDate={entriesByDate}
        hasActiveConnection={!!activeConnection}
        usualTags={journalPrefsRow?.usualBehaviorTags ?? []}
      />

      <div className="mt-6">
        {/* The header chip and the journal form's ring both already carry the
            streak — this card shows the rest of the milestones only. */}
        <MilestonesCard {...milestones} hideStreak />
      </div>
    </div>
  );
}

// ── Labs ──────────────────────────────────────────────────────────────────

async function LabsTab({ userId }: { userId: string }) {
  const [biomarkerRows, wellness, prefs] = await Promise.all([
    db.query.biomarkers.findMany({
      where: eq(schema.biomarkers.userId, userId),
      orderBy: desc(schema.biomarkers.measuredAt),
    }),
    db.query.wellnessDaily.findMany({
      where: and(
        eq(schema.wellnessDaily.userId, userId),
        gte(schema.wellnessDaily.date, daysAgo(90))
      ),
      orderBy: schema.wellnessDaily.date,
    }),
    db.query.bodyPrefs.findFirst({
      where: eq(schema.bodyPrefs.userId, userId),
    }),
  ]);

  // Latest value per biomarker + the prior one for a direction arrow.
  const byName = new Map<string, typeof biomarkerRows>();
  for (const b of biomarkerRows) {
    const list = byName.get(b.name) ?? [];
    list.push(b);
    byName.set(b.name, list);
  }
  const latest: BiomarkerRow[] = [];
  for (const list of byName.values()) {
    const sorted = [...list].sort((a, b) =>
      b.measuredAt.localeCompare(a.measuredAt)
    );
    const cur = sorted[0];
    latest.push({
      name: cur.name,
      displayName: cur.displayName,
      category: cur.category as BiomarkerCategory,
      value: cur.value,
      unit: cur.unit,
      measuredAt: cur.measuredAt,
      source: cur.source,
      prevValue: sorted[1]?.value ?? null,
    });
  }

  const trend = bpTrend(
    wellness.map((w) => ({
      date: w.date,
      systolic: w.systolic,
      diastolic: w.diastolic,
    }))
  );

  const latestWellness = [...wellness]
    .reverse()
    .find((w) => w.restingHr != null || w.hrvMs != null);
  const nights: SleepNight[] = wellness
    .filter((w) => w.date >= daysAgo(30))
    .map((w) => ({
      date: w.date,
      sleepSecs: w.sleepSecs,
      sleepDeepSecs: w.sleepDeepSecs,
      sleepRemSecs: w.sleepRemSecs,
      sleepLightSecs: w.sleepLightSecs,
      sleepAwakeSecs: w.sleepAwakeSecs,
      bedStart: w.bedStart,
      bedEnd: w.bedEnd,
    }));
  const consistency = sleepConsistency(nights);

  const bioAgeResult = biologicalAge({
    chronologicalAge:
      prefs?.birthYear != null
        ? new Date().getFullYear() - prefs.birthYear
        : null,
    restingHr: latestWellness?.restingHr ?? null,
    hrvMs: latestWellness?.hrvMs ?? null,
    sleepConsistency: consistency?.score ?? null,
    vo2max:
      [...wellness].reverse().find((w) => w.vo2max != null)?.vo2max ?? null,
    bodyFatPct:
      [...wellness].reverse().find((w) => w.bodyFatPct != null)?.bodyFatPct ??
      null,
  });
  // A deterministic formula over already-known signals, same reasoning
  // correlationFigure and the CTL/ATL/TSB tiles already use — never a
  // modelled interval, so "high" throughout.
  const bioAge: Figure<BioAgeResult> =
    "insufficient" in bioAgeResult
      ? Figure.missingInput(bioAgeResult.missing.join(", "))
      : Figure.available(bioAgeResult, "high");

  return (
    <div className="space-y-4 pb-10">
      <LabsTiles
        bioAge={bioAge}
        biomarkerCount={latest.length}
        lastDraw={biomarkerRows[0]?.measuredAt ?? null}
      />
      <BioAgeCard result={bioAge} hideHeadline />
      <BloodPressureCard trend={trend} />
      <HealthUpload />
      <HealthManualEntry birthYear={prefs?.birthYear ?? null} />
      <BiomarkerList rows={latest} />
    </div>
  );
}

/**
 * `projectWeek` — the single derivation of a training week's `DaySlot`s,
 * whether that week is the currently open (stored) week or a week with no
 * `week_plans` row at all (a forecast).
 *
 * Lifted out of `repair.ts` (docs/plans/2026-07-29-next-week-preview.md,
 * Task 3): `computeWeekRepair` recomputes what the OPEN week SHOULD hold,
 * and the next-week preview needs the exact same recomputation for a week
 * that has never been materialized. Both are the same pipeline —
 * `assembleVolumeInputs` -> `weeklyTargetHours` -> `hoursForMaterialize` ->
 * `periodize` -> `materializeWeek` — differing only in where availability
 * and `prevWeek` come from. This file owns that pipeline; nothing else may
 * duplicate it.
 *
 * Never persists anything: no `week_plans` row is written here, for a
 * stored week or a projected one. A second open row would break
 * `getOpenWeekPlan`'s single-open-week assumption and the rollover's
 * idempotency/adherence math, so this function is pure-read — no
 * adaptation, no replan, no cache mutation. It is exactly the function a
 * page render calls to show next week before it exists.
 */
import { and, desc, eq, inArray, ne } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { racesForWeek, currentCtl } from "@/lib/race/service";
import { periodize } from "@/lib/training-plan";
import { requirePlanSport } from "@/lib/plan-sport";
import { resolveWeek } from "@/lib/availability/resolve";
import type { AvailabilityBlock } from "@/lib/availability/types";
import { assembleVolumeInputs } from "./volume-inputs";
import {
  hoursForMaterialize,
  weeklyTargetHours,
  type VolumeResult,
} from "./volume";
import { materializeWeek } from "./materialize";
import { addDaysYmd, getOpenWeekPlan, planConstraints } from "./service";
import { dayMins, type Band, type DaySlot } from "./types";

export interface ProjectedWeek {
  weekStart: string;
  skeletonWeek: number;
  days: DaySlot[];
  target: VolumeResult;
  /**
   * `materializeWeek`'s `effectiveLoad` for this week — the same value
   * `rolloverWeekPlan` persists as `week_plans.effective_target`
   * (`src/lib/week-plan/service.ts`'s `effectiveTarget: r.effectiveLoad`)
   * and the same field `availabilityVerdict`'s `effectiveTarget` input
   * expects (a load quantity divided by `loadPerHour`, NOT `target.hours` —
   * different units; `target` is the pre-materialize hours figure fed into
   * `periodize`, `effectiveLoad` is what materialize actually landed on
   * after the availability clamp in `materializeWeek`).
   */
  effectiveLoad: number;
  /** True when no `week_plans` row exists for this weekStart — a forecast. */
  provisional: boolean;
  /** date -> the athlete pinned availability for it (an override row exists). */
  pinned: Record<string, boolean>;
}

/**
 * Last 7 readiness bands, oldest first; missing rows count as calibrating.
 * This is today's real recent readiness — independent of which week is
 * being projected (see the `prevWeek` fork below), so it is read the same
 * way for a stored or a projected week. Mirrors service.ts's private
 * `recentBands` — not exported there, and small enough that duplicating it
 * here (the repo's own convention for this kind of trivial per-file helper
 * — see volume-inputs.ts's own `localYmd`) is safer than reaching into
 * service.ts's internals.
 */
async function recentBandsFor(userId: string): Promise<Band[]> {
  const rows = await db.query.dailyMetrics.findMany({
    where: eq(schema.dailyMetrics.userId, userId),
    orderBy: desc(schema.dailyMetrics.date),
    limit: 7,
  });
  return rows.reverse().map((r) => (r.band ?? "calibrating") as Band);
}

/**
 * Derives one week's `DaySlot`s — the currently open (stored) week, or a
 * week with no stored row at all — without ever writing one. Returns `null`
 * when there is nothing to derive from: no `week_plans` row for this exact
 * `weekStart`, AND no open week to anchor a projection on either (which also
 * covers "no active plan" — a plan's first week is always materialized
 * immediately, so an active plan with no open week does not arise in
 * practice).
 *
 * Two behavioural forks, both load-bearing:
 *
 * 1. **Availability.** A STORED week (a `week_plans` row exists for exactly
 *    this `weekStart`) uses that row's own already-resolved
 *    `day.availableBlocks` — never re-resolved. Re-resolving availability is
 *    a replan, which `repair.ts`'s original docstring is explicit is out of
 *    scope for the repair path, and the repair script depends on that
 *    staying true. A PROJECTED week (no row) has nothing stored to read, so
 *    it resolves fresh with `resolveWeek`.
 *
 * 2. **`prevWeek`.** A stored week keeps the original lookup: the
 *    `trainingBlocks` row at `skeletonWeek - 1` — whatever the week that
 *    closed into this one actually did. A projected week gets
 *    `prevWeek: null` — deliberately. `prevWeek: null` is precisely "assume
 *    this week closes to plan". The missed-week restart, the low-adherence
 *    rebuild and the ramp clamp in `effectiveWeekLoad` are each guarded on
 *    `prevWeek &&`, so a null `prevWeek` leaves `skeletonTarget` unmodified
 *    by any of them. Feeding this week's actuals-so-far in instead would
 *    make the preview move every day, and move DOWNWARD early in the week
 *    when little is logged yet, for reasons unconnected to anything the
 *    athlete decided. (The suppressed-readiness branch, driven by
 *    `recentBands` rather than `prevWeek`, is NOT guarded this way and does
 *    still apply — it is today's real readiness history, not a function of
 *    the week being projected.)
 *
 *    `skeletonWeek` for a projected week is the stored open week's
 *    `skeletonWeek + 1`; if the plan has run out of periodized blocks by
 *    then, the same fallback-to-last-block rule applies as for a stored
 *    week (and as `rolloverWeekPlan` itself uses).
 */
export async function projectWeek(
  userId: string,
  weekStart: string,
  now: Date
): Promise<ProjectedWeek | null> {
  const storedRow = await db.query.weekPlans.findFirst({
    where: and(
      eq(schema.weekPlans.userId, userId),
      eq(schema.weekPlans.weekStart, weekStart)
    ),
  });
  const provisional = storedRow == null;

  const dates = Array.from({ length: 7 }, (_, i) => addDaysYmd(weekStart, i));

  let planId: string;
  let requestedSkeletonWeek: number;
  let availableBlocksPerDay: AvailabilityBlock[][];
  let prevWeek: { actualLoad: number; adherencePct: number } | null;

  if (storedRow) {
    planId = storedRow.planId;
    requestedSkeletonWeek = storedRow.skeletonWeek;
    const storedDays = storedRow.days as DaySlot[];
    // The week's OWN already-resolved blocks — not re-resolved. See the
    // docstring above: re-resolving availability is a replan, out of scope.
    availableBlocksPerDay = storedDays.map((d) => d.availableBlocks);

    // rolloverWeekPlan writes the closing week's actualLoad/adherencePct
    // onto trainingBlocks (planId, weekNumber = that week's own
    // skeletonWeek) at the exact moment THIS week was materialized — so the
    // block one weekNumber below this week's own is the same prevWeek value
    // originally fed into materializeWeek. Reading it back is not a second
    // derivation; it's the persisted result of the first one.
    const prevBlock = await db.query.trainingBlocks.findFirst({
      where: and(
        eq(schema.trainingBlocks.planId, planId),
        eq(schema.trainingBlocks.weekNumber, requestedSkeletonWeek - 1)
      ),
    });
    prevWeek =
      prevBlock?.actualLoad != null && prevBlock?.adherencePct != null
        ? {
            actualLoad: prevBlock.actualLoad,
            adherencePct: prevBlock.adherencePct,
          }
        : null;
  } else {
    const openWeek = await getOpenWeekPlan(userId);
    if (!openWeek) return null;
    planId = openWeek.planId;
    requestedSkeletonWeek = openWeek.skeletonWeek + 1;

    const resolved = await resolveWeek(userId, dates);
    availableBlocksPerDay = dates.map((d) => resolved.get(d) ?? []);
    // See the docstring above: assume this week closes to plan.
    prevWeek = null;
  }

  // Excludes only `draft` (v0.43): this plan is looked up by the primary
  // key a stored week_plans row already points at, so an `archived` plan
  // legitimately backs an older week and must still resolve. A `draft`
  // never should have a week projected onto it — treat it the same as a
  // deleted plan.
  const plan = await db.query.trainingPlans.findFirst({
    where: and(
      eq(schema.trainingPlans.id, planId),
      ne(schema.trainingPlans.status, "draft")
    ),
  });
  if (!plan) {
    throw new Error(
      `week-plan (user ${userId}, week ${weekStart}) references plan ${planId}, which no longer exists`
    );
  }

  const constraints = planConstraints(plan.constraints);
  const availabilityHours =
    availableBlocksPerDay.reduce(
      (s, blocks) => s + dayMins({ availableBlocks: blocks }),
      0
    ) / 60;

  const volumeInputs = await assembleVolumeInputs(userId, now);
  const target = weeklyTargetHours({
    raceDemandHours: volumeInputs.demand?.available
      ? volumeInputs.demand.weeklyHours
      : null,
    ceilingHours: volumeInputs.level.ceilingHours,
    floorHours: volumeInputs.level.floorHours,
    availabilityHours,
    fallbackHours: constraints.hoursPerWeek,
  });
  // The hardest single day this athlete's event demands — what a long ride
  // should build toward. Null when there is no race or no FTP, which keeps
  // the pre-existing 240-minute bound. Shared by both `periodize` and
  // `materializeWeek` below so they can't drift onto different values.
  const queenStageHours = volumeInputs.demand?.available
    ? volumeInputs.demand.queenStageHours
    : null;

  // Same reasoning as service.ts's rolloverWeekPlan: a sport word from the
  // plan's own stored constraints, never an inference from plan.raceType's
  // free text, since this recurring pipeline must not throw on an unusual
  // historical spelling.
  const sport = requirePlanSport(constraints.sports?.[0]);

  const derivedBlocks = periodize(
    plan.weeksTotal,
    plan.startingCtl ?? 0,
    constraints.daysPerWeek,
    target.hours,
    sport,
    queenStageHours
  );
  // Matched by the requested skeleton week number — the stored week's own
  // skeletonWeek, or the open week's skeletonWeek + 1 for a projection —
  // not `plan.currentWeek`, which may have moved on since. Same
  // fallback-to-last-block rule `rolloverWeekPlan` uses when a plan runs out
  // of periodized blocks.
  const derived =
    derivedBlocks.find((b) => b.weekNumber === requestedSkeletonWeek) ??
    derivedBlocks[derivedBlocks.length - 1];
  if (!derived) {
    throw new Error(
      `plan ${plan.id} produced no periodize blocks — cannot project week ${weekStart}`
    );
  }

  const [races, ctlNow, recentBands] = await Promise.all([
    racesForWeek(userId, weekStart),
    currentCtl(userId),
    recentBandsFor(userId),
  ]);

  const r = materializeWeek({
    weekStart,
    skeleton: {
      weekNumber: derived.weekNumber,
      phase: derived.phase,
      targetLoadTotal: derived.targetLoad,
      targetSessions: derived.targetSessions,
    },
    availableBlocksPerDay,
    prevWeek,
    recentBands,
    sport,
    hoursPerWeek: hoursForMaterialize(target),
    races,
    currentCtl: ctlNow,
    queenStageHours,
    planStyle: constraints.planStyle,
  });

  const overrides = await db.query.availabilityOverrides.findMany({
    where: and(
      eq(schema.availabilityOverrides.userId, userId),
      inArray(schema.availabilityOverrides.date, dates)
    ),
  });
  const overrideDates = new Set(overrides.map((o) => o.date));
  const pinned: Record<string, boolean> = Object.fromEntries(
    dates.map((d) => [d, overrideDates.has(d)])
  );

  return {
    weekStart: r.week.weekStart,
    skeletonWeek: r.week.skeletonWeek,
    days: r.week.days,
    target,
    effectiveLoad: r.effectiveLoad,
    provisional,
    pinned,
  };
}

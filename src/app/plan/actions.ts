"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { requireUser } from "@/lib/session";
import { db, schema } from "@/lib/db";
import {
  applyAvailability,
  applyResolvedAvailability,
  getOpenWeekPlan,
  markDayDone,
  moveWorkout,
  rolloverWeekPlan,
  swapWorkouts,
} from "@/lib/week-plan/service";
import { syncDateOverrides } from "@/lib/availability/sync-overrides";
import { parseDayBlocks } from "@/lib/availability/parse-day-blocks";
import {
  isMondayYmd,
  resolveWeekStartTarget,
} from "@/lib/availability/validate-week-start";
import {
  assembleForecastInputs,
  createRace,
  deleteRace,
  nextUpcomingRace,
  updateRace,
} from "@/lib/race/service";
import { simulatePlanChange, type PlanChange } from "@/lib/race/forecast";
import {
  validateBlocks,
  type AvailabilityBlock,
} from "@/lib/availability/types";
import type { IntakeState } from "@/components/plan/intake-form";

type Result = { ok: true } | { ok: false; error: string };

function revalidatePlan(): void {
  revalidatePath("/train");
  revalidatePath("/");
}

/**
 * v0.9.3 "Plan this week": materialize the current week on demand — for
 * plans created mid-week (or before this patch) that would otherwise wait
 * for the next weekly review. Safe to press twice: the rollover is
 * idempotent per user-week.
 */
export async function startWeek(): Promise<void> {
  const user = await requireUser();
  await rolloverWeekPlan(user.id);
  revalidatePath("/train");
  revalidatePath("/");
}

export async function submitAvailability(
  _prev: IntakeState,
  formData: FormData
): Promise<IntakeState> {
  const user = await requireUser();

  const parsed = Array.from({ length: 7 }, (_, i) =>
    parseDayBlocks(formData.get(`blocks-${i}`))
  );
  if (parsed.some((day) => day === null)) {
    // Writing the understood days and zeroing the rest would pin those dates
    // and move their sessions away — a silent, destructive partial save.
    return {
      message: "Some of that week didn't come through. Nothing was changed.",
    };
  }
  const blocksPerDay = parsed as AvailabilityBlock[][];

  // `weekStart`, present only from the next-week preview's editor, is meant
  // to target a FUTURE week: one with no materialised week_plans row to
  // replan. This is a "use server" export — a directly reachable RPC
  // endpoint, not just whatever our own UI sends — so anything that isn't a
  // genuine Monday is refused outright rather than trusted to name a real
  // week.
  const weekStartField = formData.get("weekStart");
  const requestedWeekStart =
    typeof weekStartField === "string" && weekStartField !== ""
      ? weekStartField
      : null;
  if (requestedWeekStart !== null && !isMondayYmd(requestedWeekStart)) {
    return {
      message: "That doesn't look like a Monday. Nothing was changed.",
    };
  }

  // A genuine Monday is not automatically a FUTURE Monday: it names a week,
  // and that week might turn out to be the one that's already open. That
  // happens for real, not just adversarially — the week switcher's hidden
  // `weekStart` is baked in at page-render time, so an athlete with the tab
  // open across the scheduled Sunday→Monday rollover submits a value that,
  // by the time this action runs, IS the now-open week's `weekStart`. The
  // actual decision (current vs. future vs. reject-as-past) is pure — see
  // `resolveWeekStartTarget` — so only the DB read for the open week's own
  // `weekStart` lives here, and only when there's a requested value to
  // resolve against it.
  const openWeek =
    requestedWeekStart !== null ? await getOpenWeekPlan(user.id) : null;
  const resolution = resolveWeekStartTarget(
    requestedWeekStart,
    openWeek?.weekStart ?? null
  );
  if (resolution.kind === "rejected") {
    return {
      message: "That week has already passed. Nothing was changed.",
    };
  }
  const target = resolution.kind === "future" ? resolution.weekStart : null;

  await syncDateOverrides(user.id, blocksPerDay, target ?? undefined);

  // Only the CURRENT week has a materialised plan to replan. A future week
  // has no week_plans row — the preview recomputes from these overrides on
  // its next render, and Monday's rollover reads them for real.
  if (!target) {
    const result = await applyAvailability(user.id, blocksPerDay);
    revalidatePlan();
    return {
      message:
        result === "applied"
          ? "Week updated around your availability."
          : "No open week to update yet.",
    };
  }

  revalidatePlan();
  return { message: "Next week updated around your availability." };
}

// ── Standard week + date overrides ────────────────────────────────────────

/** Standard week: one weekday's blocks. Never touches existing overrides. */
export async function setStandardWeekDay(
  weekday: number,
  blocks: AvailabilityBlock[]
): Promise<Result> {
  const user = await requireUser();
  if (weekday < 0 || weekday > 6) {
    return { ok: false, error: "invalid_weekday" };
  }
  const invalid = validateBlocks(blocks);
  if (invalid) return { ok: false, error: invalid };

  await db
    .insert(schema.availabilityDefaults)
    .values({ userId: user.id, weekday, blocks })
    .onConflictDoUpdate({
      target: [
        schema.availabilityDefaults.userId,
        schema.availabilityDefaults.weekday,
      ],
      set: { blocks, updatedAt: new Date() },
    });

  // Replan the open week too. The availability card renders resolveWeek's
  // live merge of defaults + overrides, so it moves the moment this row is
  // written — while the week grid renders the STORED week. Without this the
  // two disagree on screen: the athlete zeroes their Friday, watches Friday
  // go to Rest, and still has a session sitting on it. Pinned dates are
  // unaffected, because resolveWeek still lets their override win.
  await applyResolvedAvailability(user.id);
  revalidatePlan();
  return { ok: true };
}

/** Pin one date. Wins over the weekday default from now on. */
export async function setDayOverride(
  date: string,
  blocks: AvailabilityBlock[]
): Promise<Result> {
  const user = await requireUser();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return { ok: false, error: "invalid_date" };
  }
  const invalid = validateBlocks(blocks);
  if (invalid) return { ok: false, error: invalid };

  await db
    .insert(schema.availabilityOverrides)
    .values({ userId: user.id, date, blocks })
    .onConflictDoUpdate({
      target: [
        schema.availabilityOverrides.userId,
        schema.availabilityOverrides.date,
      ],
      set: { blocks, updatedAt: new Date() },
    });
  revalidatePlan();
  return { ok: true };
}

/** "Back to standard": deletes the pin so the weekday default applies again. */
export async function clearDayOverride(date: string): Promise<Result> {
  const user = await requireUser();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return { ok: false, error: "invalid_date" };
  }
  await db
    .delete(schema.availabilityOverrides)
    .where(
      and(
        eq(schema.availabilityOverrides.userId, user.id),
        eq(schema.availabilityOverrides.date, date)
      )
    );
  revalidatePlan();
  return { ok: true };
}

/**
 * "No time today": pins the date to zero AND moves what was scheduled on it.
 *
 * Writing the override row alone changes nothing the athlete can see —
 * adaptDay reads availableBlocks off the stored week, not the override
 * table — so the button, which only appears when the day holds a session,
 * left that session sitting on a day now labelled "Rest · Pinned". This is
 * the spec's "JOIN swap-menu reset", and a reset that does not move the
 * session is not one.
 */
export async function zeroDay(date: string): Promise<Result> {
  const written = await setDayOverride(date, []);
  if (!written.ok) return written;

  const user = await requireUser();
  await applyResolvedAvailability(user.id);
  revalidatePlan();
  return { ok: true };
}

// ── v0.14 Race Ready: races management + move/swap with preview ──────────

/**
 * `distance_km` is a `real` column, which happily accepts the strings
 * "NaN"/"Infinity" — so a non-finite value would NOT throw on insert, it
 * would silently corrupt the row. Reject it here rather than relying on
 * Postgres to catch it.
 */
function validateDistance(value: number | null, label: string): string | null {
  if (value == null) return null;
  if (!Number.isFinite(value)) return `${label} must be a valid number.`;
  if (value < 0) return `${label} cannot be negative.`;
  return null;
}

/**
 * `elevation_m` is an `integer` column, so a fractional or non-finite value
 * throws `invalid input syntax for integer` in Postgres — and by the time
 * that happens for the top-level field, `createRace` has already committed.
 * Validate finiteness/sign up front; fractional values are rounded (not
 * rejected) by `roundElevation` below, since someone typing 1234.7m meant
 * something reasonable.
 */
function validateElevation(value: number | null, label: string): string | null {
  return validateDistance(value, label);
}

function roundElevation(value: number | null): number | null {
  return value == null ? null : Math.round(value);
}

interface DemandInput {
  eventDays: number;
  distanceKm: number | null;
  elevationM: number | null;
  stages: {
    dayNumber: number;
    distanceKm: number | null;
    elevationM: number | null;
  }[];
}

/**
 * Shared by `addRace` and `updateRaceDemand` so a correction goes through
 * the exact same checks as the original entry — final-review Finding I6
 * part 2. Two passes over `stages` (distance/elevation first, then
 * dayNumber/duplicates), matching addRace's original structure exactly:
 * collapsing this into one pass would change which error surfaces first for
 * a malformed multi-stage payload, and that precedence is untested but not
 * worth risking on a refactor.
 */
function validateDemandInput(input: DemandInput): string | null {
  if (!Number.isInteger(input.eventDays) || input.eventDays < 1) {
    return "An event runs over at least one day.";
  }
  const distanceError = validateDistance(input.distanceKm, "Distance");
  if (distanceError) return distanceError;
  const elevationError = validateElevation(input.elevationM, "Elevation");
  if (elevationError) return elevationError;

  for (const stage of input.stages) {
    const stageDistanceError = validateDistance(
      stage.distanceKm,
      `Day ${stage.dayNumber} distance`
    );
    if (stageDistanceError) return stageDistanceError;
    const stageElevationError = validateElevation(
      stage.elevationM,
      `Day ${stage.dayNumber} elevation`
    );
    if (stageElevationError) return stageElevationError;
  }
  // `race_stages` has a unique index on (raceId, dayNumber), so duplicates
  // throw on insert. The transaction means that rolls back cleanly rather
  // than corrupting anything, but this action's contract is to RETURN its
  // errors, not raise them — and it is an exported "use server" function, so
  // a caller other than our own form can reach it. The UI cannot produce this
  // (`stagesForSubmit` always emits sequential days); a direct caller can.
  const days = new Set<number>();
  for (const stage of input.stages) {
    if (!Number.isInteger(stage.dayNumber) || stage.dayNumber < 1) {
      return "Each stage needs a day number of 1 or more.";
    }
    if (days.has(stage.dayNumber)) {
      return `Day ${stage.dayNumber} is listed twice.`;
    }
    days.add(stage.dayNumber);
  }
  return null;
}

/**
 * Writes a race's demand fields + replaces its stages wholesale, as one
 * transaction — shared by `addRace` (new race) and `updateRaceDemand`
 * (correcting an existing one). Without the transaction, a failure partway
 * through (e.g. a duplicate dayNumber hitting the unique index on the
 * insert) would leave the update and delete committed but the insert not —
 * the race would claim new days/distance/elevation with zero race_stages
 * rows, destroying the previously-good per-day data.
 */
async function writeRaceDemand(
  raceId: string,
  input: DemandInput
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .update(schema.races)
      .set({
        eventDays: input.eventDays,
        distanceKm: input.distanceKm,
        elevationM: roundElevation(input.elevationM),
        updatedAt: new Date(),
      })
      .where(eq(schema.races.id, raceId));

    // Stages are replaced wholesale. `createRace` upserts on
    // (userId, date, name), so re-adding the same race reuses its row — a
    // partial write would leave a stale day 7 behind when an eight-day event
    // is re-entered as six.
    await tx
      .delete(schema.raceStages)
      .where(eq(schema.raceStages.raceId, raceId));
    if (input.stages.length > 0) {
      await tx.insert(schema.raceStages).values(
        input.stages.map((s) => ({
          raceId,
          dayNumber: s.dayNumber,
          distanceKm: s.distanceKm,
          elevationM: roundElevation(s.elevationM),
        }))
      );
    }
  });
}

export async function addRace(input: {
  name: string;
  raceType: string;
  date: string;
  priority: "A" | "B" | "C";
  goalNote?: string;
  eventDays: number;
  distanceKm: number | null;
  elevationM: number | null;
  stages: {
    dayNumber: number;
    distanceKm: number | null;
    elevationM: number | null;
  }[];
}): Promise<Result> {
  const user = await requireUser();
  const demandError = validateDemandInput(input);
  if (demandError) return { ok: false, error: demandError };

  const result = await createRace(user.id, {
    name: input.name,
    raceType: input.raceType,
    date: input.date,
    priority: input.priority,
    goalNote: input.goalNote ?? null,
  });
  if ("error" in result) return { ok: false, error: result.error };

  // `createRace` is deliberately left outside writeRaceDemand's transaction:
  // a failure there returns cleanly before any demand write happens.
  await writeRaceDemand(result.race.id, input);

  revalidatePath("/train");
  revalidatePath("/");
  return { ok: true };
}

/**
 * Corrects an existing race's demand fields without deleting and re-adding
 * it — final-review Finding I6 part 2. Ownership is checked explicitly
 * (rather than trusting the id) because this is a directly reachable
 * "use server" export: nothing stops a caller other than our own edit form
 * from passing another athlete's race id.
 */
export async function updateRaceDemand(
  id: string,
  input: {
    eventDays: number;
    distanceKm: number | null;
    elevationM: number | null;
    stages: {
      dayNumber: number;
      distanceKm: number | null;
      elevationM: number | null;
    }[];
  }
): Promise<Result> {
  const user = await requireUser();
  const demandError = validateDemandInput(input);
  if (demandError) return { ok: false, error: demandError };

  const existing = await db.query.races.findFirst({
    where: and(eq(schema.races.id, id), eq(schema.races.userId, user.id)),
    columns: { id: true },
  });
  if (!existing) return { ok: false, error: "Race not found." };

  await writeRaceDemand(id, input);

  revalidatePath("/train");
  revalidatePath("/");
  return { ok: true };
}

export async function removeRace(id: string): Promise<void> {
  const user = await requireUser();
  await deleteRace(user.id, id);
  revalidatePath("/train");
  revalidatePath("/");
}

export async function setRaceStatus(
  id: string,
  status: "upcoming" | "completed" | "skipped"
): Promise<void> {
  const user = await requireUser();
  await updateRace(user.id, id, { status });
  revalidatePath("/train");
  revalidatePath("/");
}

/**
 * Read-only what-if: projects race-day (or week-end, when no race is
 * upcoming) form before and after a candidate move/swap/skip. Saves
 * nothing — applyPlanChange is the only action that persists.
 */
export async function previewPlanChange(input: {
  action: "move" | "swap" | "skip";
  fromDate: string;
  toDate?: string;
}): Promise<
  | { ok: false; error: string }
  | {
      ok: true;
      insufficient: boolean;
      anchorDate: string;
      anchorRace: string | null;
      beforeTsb: number | null;
      afterTsb: number | null;
      beforeBand: string | null;
      afterBand: string | null;
      loadDelta: number;
    }
> {
  const user = await requireUser();
  if (input.action !== "skip" && !input.toDate) {
    return { ok: false, error: "missing_target" };
  }

  const race = await nextUpcomingRace(user.id);
  const assembled = await assembleForecastInputs(user.id, race);
  if (!assembled) return { ok: false, error: "no_open_week" };

  const change: PlanChange =
    input.action === "skip"
      ? { kind: "skip", fromDate: input.fromDate }
      : {
          kind: input.action,
          fromDate: input.fromDate,
          toDate: input.toDate!,
        };

  const sim = simulatePlanChange(assembled.inputs, change);
  const insufficient = sim.before.insufficient || sim.after.insufficient;

  return {
    ok: true,
    insufficient,
    anchorDate: assembled.inputs.targetDate,
    anchorRace: assembled.race?.name ?? null,
    beforeTsb: sim.before.insufficient ? null : sim.before.full.tsb,
    afterTsb: sim.after.insufficient ? null : sim.after.full.tsb,
    beforeBand: sim.before.insufficient ? null : sim.before.full.band,
    afterBand: sim.after.insufficient ? null : sim.after.full.band,
    loadDelta: sim.loadDelta,
  };
}

/** Commits a previewed move/swap. Skip has no persisted form (preview only). */
export async function applyPlanChange(input: {
  action: "move" | "swap";
  fromDate: string;
  toDate: string;
}): Promise<{ ok: boolean; error?: string }> {
  const user = await requireUser();
  const result =
    input.action === "move"
      ? await moveWorkout(user.id, input.fromDate, input.toDate)
      : await swapWorkouts(user.id, input.fromDate, input.toDate);

  if (result === "moved" || result === "swapped") {
    revalidatePath("/train");
    revalidatePath("/");
    return { ok: true };
  }
  return { ok: false, error: result };
}

/**
 * "Mark done" on Today's session card (2a). Records that the athlete did
 * the session; it never fabricates load or an activity, so the week's
 * load-based adherence still reflects only what actually synced.
 */
export async function markSessionDone(
  date: string
): Promise<{ ok: boolean; error?: string }> {
  const user = await requireUser();
  const result = await markDayDone(user.id, date);
  if (result === "completed") {
    revalidatePath("/");
    revalidatePath("/train");
    return { ok: true };
  }
  return { ok: false, error: result };
}

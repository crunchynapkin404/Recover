"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { requireUser } from "@/lib/session";
import { db, schema } from "@/lib/db";
import {
  applyAvailability,
  applyResolvedAvailability,
  markDayDone,
  moveWorkout,
  rolloverWeekPlan,
  swapWorkouts,
} from "@/lib/week-plan/service";
import { syncDateOverrides } from "@/lib/availability/sync-overrides";
import { parseDayBlocks } from "@/lib/availability/parse-day-blocks";
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

  await syncDateOverrides(user.id, blocksPerDay);

  const result = await applyAvailability(user.id, blocksPerDay);
  revalidatePlan();
  return {
    message:
      result === "applied"
        ? "Week updated around your availability."
        : "No open week to update yet.",
  };
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
  if (!Number.isInteger(input.eventDays) || input.eventDays < 1) {
    return { ok: false, error: "An event runs over at least one day." };
  }
  if (input.distanceKm != null && input.distanceKm < 0) {
    return { ok: false, error: "Distance cannot be negative." };
  }
  if (input.elevationM != null && input.elevationM < 0) {
    return { ok: false, error: "Elevation cannot be negative." };
  }

  const result = await createRace(user.id, {
    name: input.name,
    raceType: input.raceType,
    date: input.date,
    priority: input.priority,
    goalNote: input.goalNote ?? null,
  });
  if ("error" in result) return { ok: false, error: result.error };

  await db
    .update(schema.races)
    .set({
      eventDays: input.eventDays,
      distanceKm: input.distanceKm,
      elevationM: input.elevationM,
      updatedAt: new Date(),
    })
    .where(eq(schema.races.id, result.race.id));

  // Stages are replaced wholesale. `createRace` upserts on
  // (userId, date, name), so re-adding the same race reuses its row — a
  // partial write would leave a stale day 7 behind when an eight-day event is
  // re-entered as six.
  await db
    .delete(schema.raceStages)
    .where(eq(schema.raceStages.raceId, result.race.id));
  if (input.stages.length > 0) {
    await db.insert(schema.raceStages).values(
      input.stages.map((s) => ({
        raceId: result.race.id,
        dayNumber: s.dayNumber,
        distanceKm: s.distanceKm,
        elevationM: s.elevationM,
      }))
    );
  }

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

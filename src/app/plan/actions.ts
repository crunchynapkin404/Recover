"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { requireUser } from "@/lib/session";
import { db, schema } from "@/lib/db";
import {
  applyAvailability,
  getOpenWeekPlan,
  markDayDone,
  moveWorkout,
  rolloverWeekPlan,
  swapWorkouts,
} from "@/lib/week-plan/service";
import { resolveDay } from "@/lib/availability/resolve-day";
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

/**
 * One day's blocks out of a form field. Anything unparseable, malformed, or
 * failing validation degrades to an empty day — a rest day is the safe
 * reading of "I could not understand what you sent." Never write a
 * half-understood block.
 *
 * Pure and exported for its own tests: server actions need a session, this
 * does not.
 */
export function parseDayBlocks(
  raw: FormDataEntryValue | null
): AvailabilityBlock[] {
  if (raw == null) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(String(raw));
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const blocks = parsed as AvailabilityBlock[];
  return validateBlocks(blocks) === null ? blocks : [];
}

/**
 * True when two block lists are the same availability value: same length,
 * and every block equal on every field the athlete can actually set.
 * `sports: null` ("any sport") and `sports: []` ("admits nothing") are
 * deliberately never equal to each other — collapsing them would let a
 * day pinned "no sport allowed" silently re-merge with a weekday default
 * that means "anything goes".
 *
 * Pure and exported for its own tests.
 */
export function blocksEqual(
  a: AvailabilityBlock[],
  b: AvailabilityBlock[]
): boolean {
  if (a.length !== b.length) return false;
  return a.every((block, i) => oneBlockEqual(block, b[i]));
}

function oneBlockEqual(a: AvailabilityBlock, b: AvailabilityBlock): boolean {
  return (
    a.start === b.start &&
    a.end === b.end &&
    a.mins === b.mins &&
    a.energy === b.energy &&
    sportsEqual(a.sports, b.sports)
  );
}

function sportsEqual(a: string[] | null, b: string[] | null): boolean {
  if (a === null || b === null) return a === b;
  return a.length === b.length && a.every((s, i) => s === b[i]);
}

/** Monday = 0, matching availability_defaults.weekday. */
function weekdayOf(ymd: string): number {
  return (new Date(ymd + "T00:00:00").getDay() + 6) % 7;
}

/**
 * Keeps each date's override row honest with what was actually submitted.
 * A day whose blocks now differ from its weekday default is pinned, so the
 * edit survives the next re-materialization — the whole reason the override
 * table exists. A day that now matches the default again has its pin
 * removed, so editing a day back to standard is as valid a way to return it
 * to the standard week as the "Pinned" badge's own clear action.
 *
 * Skips any date the open week already marks completed or missed — those
 * are already lived, and a form resubmission must not retroactively pin
 * them. Never reads or writes availability_defaults itself beyond looking
 * up what it would resolve to; the standard week is never touched here.
 */
async function syncDateOverrides(
  userId: string,
  blocksPerDay: AvailabilityBlock[][]
): Promise<void> {
  const week = await getOpenWeekPlan(userId);
  if (!week) return;

  const defaults = await db.query.availabilityDefaults.findMany({
    where: eq(schema.availabilityDefaults.userId, userId),
  });
  const byWeekday = new Map<number, AvailabilityBlock[]>(
    defaults.map((d) => [d.weekday, d.blocks as AvailabilityBlock[]])
  );

  for (let i = 0; i < week.days.length; i++) {
    const day = week.days[i];
    if (day.status === "completed" || day.status === "missed") continue;

    const submitted = blocksPerDay[i] ?? [];
    const standard = resolveDay(byWeekday.get(weekdayOf(day.date)) ?? [], null);

    if (blocksEqual(submitted, standard)) {
      await db
        .delete(schema.availabilityOverrides)
        .where(
          and(
            eq(schema.availabilityOverrides.userId, userId),
            eq(schema.availabilityOverrides.date, day.date)
          )
        );
    } else {
      await db
        .insert(schema.availabilityOverrides)
        .values({ userId, date: day.date, blocks: submitted })
        .onConflictDoUpdate({
          target: [
            schema.availabilityOverrides.userId,
            schema.availabilityOverrides.date,
          ],
          set: { blocks: submitted, updatedAt: new Date() },
        });
    }
  }
}

export async function submitAvailability(
  _prev: IntakeState,
  formData: FormData
): Promise<IntakeState> {
  const user = await requireUser();

  const blocksPerDay = Array.from({ length: 7 }, (_, i) =>
    parseDayBlocks(formData.get(`blocks-${i}`))
  );

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

/** The swap menu's reset: an override of zero blocks means unavailable. */
export async function zeroDay(date: string): Promise<Result> {
  return setDayOverride(date, []);
}

// ── v0.14 Race Ready: races management + move/swap with preview ──────────

export async function addRace(input: {
  name: string;
  raceType: string;
  date: string;
  priority: "A" | "B" | "C";
  goalNote?: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await requireUser();
  const result = await createRace(user.id, {
    name: input.name,
    raceType: input.raceType,
    date: input.date,
    priority: input.priority,
    goalNote: input.goalNote ?? null,
  });
  if ("error" in result) return { ok: false, error: result.error };
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

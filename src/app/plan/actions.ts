"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/session";
import {
  applyAvailability,
  markDayDone,
  moveWorkout,
  rolloverWeekPlan,
  swapWorkouts,
} from "@/lib/week-plan/service";
import {
  assembleForecastInputs,
  createRace,
  deleteRace,
  nextUpcomingRace,
  updateRace,
} from "@/lib/race/service";
import { simulatePlanChange, type PlanChange } from "@/lib/race/forecast";
import type { IntakeState } from "@/components/plan/intake-form";

/**
 * v0.9.3 "Plan this week": materialize the current week on demand — for
 * plans created mid-week (or before this patch) that would otherwise wait
 * for the next weekly review. Safe to press twice: the rollover is
 * idempotent per user-week.
 */
export async function startWeek(): Promise<void> {
  const user = await requireUser();
  await rolloverWeekPlan(user.id);
  revalidatePath("/plan");
  revalidatePath("/");
}

export async function submitAvailability(
  _prev: IntakeState,
  formData: FormData
): Promise<IntakeState> {
  const user = await requireUser();

  const mins: number[] = [];
  for (let i = 0; i < 7; i++) {
    const raw = Number(formData.get(`mins-${i}`));
    mins.push(
      Number.isFinite(raw) ? Math.max(0, Math.min(720, Math.round(raw))) : 0
    );
  }

  const result = await applyAvailability(user.id, mins);
  revalidatePath("/plan");
  revalidatePath("/");
  return {
    message:
      result === "applied"
        ? "Week updated around your availability."
        : "No open week to update yet.",
  };
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
  revalidatePath("/plan");
  revalidatePath("/");
  return { ok: true };
}

export async function removeRace(id: string): Promise<void> {
  const user = await requireUser();
  await deleteRace(user.id, id);
  revalidatePath("/plan");
  revalidatePath("/");
}

export async function setRaceStatus(
  id: string,
  status: "upcoming" | "completed" | "skipped"
): Promise<void> {
  const user = await requireUser();
  await updateRace(user.id, id, { status });
  revalidatePath("/plan");
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
    revalidatePath("/plan");
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

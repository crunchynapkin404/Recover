import { and, eq } from "drizzle-orm";
import type { db as Db } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import { icuRequest, type IcuConnection } from "@/lib/connectors/intervals";
import { renderIcu } from "@/lib/interval/render-icu";
import { workoutForDay } from "@/lib/interval/for-day";
import type { WorkoutPin } from "@/lib/interval/pin";
import { normalizeDays, serializeDays } from "./serialize";

export type ExportResult =
  | { ok: true; workoutName: string }
  | {
      ok: false;
      reason: "no-connection" | "no-session" | "no-workout" | "icu-failed";
      message: string;
    };

/**
 * Send a day's structured workout to the athlete's intervals.icu calendar, and
 * pin it.
 *
 * LIVES HERE, NOT IN src/lib/interval/. It reaches the database and a third
 * party, and that module is pure by contract — its guard caught this file the
 * moment it was written there. The interval module supplies the renderers and
 * the pin's shape; deciding when to write one is week-plan's business, because
 * the pin lands on a ScheduledWorkout inside a week plan row.
 *
 * THIS IS THE ONE MOMENT PINNING IS GENUINE. Everything else about a library
 * workout is derived on read, because a %FTP structure is a pure function of
 * (purpose, durationMins) and storing it would buy only staleness. But once the
 * workout is on the athlete's calendar it syncs to their head unit, and a
 * silent re-derive after that means Recover disagrees with the device — which
 * the athlete discovers mid-ride. So export stores what it sent.
 *
 * THE PIN IS WRITTEN ONLY AFTER intervals.icu ACCEPTS THE EVENT. A pin without
 * a calendar entry would claim an export that never happened, and the athlete
 * would see "exported" for a workout their device has never heard of.
 */
export async function exportWorkoutToIcu(
  db: typeof Db,
  userId: string,
  date: string,
  sessionIdx: number,
  now: Date
): Promise<ExportResult> {
  const week = await db.query.weekPlans.findFirst({
    where: and(
      eq(schema.weekPlans.userId, userId),
      eq(schema.weekPlans.status, "open")
    ),
  });
  if (!week) {
    return { ok: false, reason: "no-session", message: "No open week." };
  }

  const days = normalizeDays(week.days);
  const dayIdx = days.findIndex((d) => d.date === date);
  const planned = dayIdx === -1 ? undefined : days[dayIdx].workouts[sessionIdx];
  if (!planned) {
    return { ok: false, reason: "no-session", message: "No such session." };
  }

  const structured = workoutForDay(planned, date);
  if (!structured) {
    return {
      ok: false,
      reason: "no-workout",
      message: "This session has no structured workout.",
    };
  }

  const conn = await db.query.connections.findFirst({
    where: and(
      eq(schema.connections.userId, userId),
      eq(schema.connections.provider, "intervals_icu")
    ),
  });
  if (!conn || conn.status !== "active") {
    return {
      ok: false,
      reason: "no-connection",
      message: "Connect intervals.icu first.",
    };
  }

  try {
    await icuRequest(conn as IcuConnection, "/athlete/{id}/events", {
      method: "POST",
      body: {
        start_date_local: `${date}T00:00:00`,
        category: "WORKOUT",
        type: "Ride",
        name: structured.workout.name,
        // The structure itself. intervals.icu parses this text out of the
        // description; renderIcu emits exactly what get-workout-syntax.ts
        // documents, and `why` gives the athlete the coaching intent above it.
        description: `${structured.workout.why}\n\n${renderIcu(structured.blocks)}`,
      },
    });
  } catch (err) {
    return {
      ok: false,
      reason: "icu-failed",
      message: err instanceof Error ? err.message : "intervals.icu refused it.",
    };
  }

  const pin: WorkoutPin = {
    workoutId: structured.workout.id,
    exportedAt: now.toISOString(),
    purpose: planned.purpose,
    durationMins: planned.durationMins,
  };
  const nextDays = days.map((d, i) =>
    i !== dayIdx
      ? d
      : {
          ...d,
          workouts: d.workouts.map((w, j) =>
            j !== sessionIdx ? w : { ...w, pin }
          ),
        }
  );
  await db
    .update(schema.weekPlans)
    .set({ days: serializeDays(nextDays) })
    .where(eq(schema.weekPlans.id, week.id));

  return { ok: true, workoutName: structured.workout.name };
}

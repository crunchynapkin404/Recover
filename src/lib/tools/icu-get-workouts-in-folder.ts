/**
 * List the workouts stored in one workout-library folder or training plan.
 * Ported from the standalone intervals-icu-mcp server's
 * workout_library.py:get_workouts_in_folder / client.py:get_workouts_in_folder
 * (~line 873, GET /athlete/{id}/folders/{folderId}/workouts).
 *
 * Deviation 1 (endpoint): openapi-spec.json documents only a PUT
 * (`updatePlanWorkouts`) on this path — no GET operation is listed for it —
 * yet client.py issues a GET here and the standalone's own server.py
 * registers/ships `icu_get_workouts_in_folder` on top of it, with
 * tests/test_workout_library_tools.py exercising it end-to-end. This is the
 * same class of spec-vs-reality gap as the histogram Bucket shape (see
 * icu-get-hr-histogram.ts) — the auto-generated openapi-spec.json is
 * incomplete here, not the client. We follow API reality (GET, per
 * client.py) over the incomplete spec.
 *
 * Deviation 2 (folderId type): the task brief's table suggested
 * `folderId: z.string()`, but openapi-spec.json's own `folderId` path
 * parameter (on the sibling PUT operation, and on Folder.id /
 * Workout.folder_id) is `integer/int32`. We use `z.number().int()`,
 * matching this repo's existing icu_get_event (`eventId: z.number().int()`)
 * and icu_apply_training_plan (`folderId: z.number().int()`) precedent for
 * numeric intervals.icu ids.
 *
 * Fields shaped against openapi-spec.json's Workout schema (id, name,
 * description, type, day, days, moving_time, distance, icu_training_load,
 * icu_intensity, joules, joules_above_ftp, indoor, color). `day`/`days`
 * carry a workout's day-offset within its plan, per the task brief's "trim
 * to id/name/description/day info" instruction.
 */
import { z } from "zod";
import { icuRequest } from "@/lib/connectors/intervals";
import { activeIcuConnection } from "./icu-connection";
import type { ToolDefinition, ToolContext } from "./registry";

const parameters = z.object({
  folderId: z
    .number()
    .int()
    .describe("Workout-library folder ID (from icu_get_workout_library)."),
});

function num(v: unknown): number {
  return typeof v === "number" ? v : 0;
}

function shapeWorkout(w: Record<string, unknown>) {
  const hasMetrics =
    w.moving_time != null ||
    w.distance != null ||
    w.icu_training_load != null ||
    w.icu_intensity != null ||
    w.joules != null ||
    w.joules_above_ftp != null;

  return {
    id: w.id,
    name: w.name ?? null,
    description: w.description ?? null,
    type: w.type ?? null,
    day: w.day ?? null,
    days: w.days ?? null,
    indoor: w.indoor ?? null,
    color: w.color ?? null,
    metrics: hasMetrics
      ? {
          durationS: w.moving_time ?? null,
          distanceM: w.distance ?? null,
          trainingLoad: w.icu_training_load ?? null,
          intensityFactor: w.icu_intensity ?? null,
          joules: w.joules ?? null,
          joulesAboveFtp: w.joules_above_ftp ?? null,
        }
      : null,
  };
}

async function execute(args: z.infer<typeof parameters>, ctx: ToolContext) {
  const conn = await activeIcuConnection(ctx);
  if (!conn) return { error: "No active intervals.icu connection" };
  const raw = (await icuRequest(
    conn,
    `/athlete/{id}/folders/${args.folderId}/workouts`
  )) as Array<Record<string, unknown>>;
  const workouts = raw.map(shapeWorkout);
  const totalDurationS = raw.reduce((sum, w) => sum + num(w.moving_time), 0);
  const totalTrainingLoad = raw.reduce(
    (sum, w) => sum + num(w.icu_training_load),
    0
  );
  const indoorWorkouts = raw.filter((w) => w.indoor === true).length;

  return {
    folderId: args.folderId,
    workouts,
    summary: {
      totalWorkouts: workouts.length,
      totalDurationS,
      totalTrainingLoad,
      indoorWorkouts,
    },
  };
}

export const icuGetWorkoutsInFolder: ToolDefinition<typeof parameters> = {
  name: "icu_get_workouts_in_folder",
  description:
    "List the workouts stored in one specific workout-library folder or training plan — name, type, day-of-plan, duration, distance, training load, intensity factor. Get folder ids from icu_get_workout_library.",
  parameters,
  execute,
};

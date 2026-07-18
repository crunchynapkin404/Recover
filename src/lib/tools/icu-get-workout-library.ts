/**
 * List workout-library folders and training plans the athlete has access
 * to. Ported from the standalone intervals-icu-mcp server's
 * workout_library.py:get_workout_library (GET /athlete/{id}/folders),
 * fields verified against openapi-spec.json's Folder schema (id, name,
 * type FOLDER|PLAN, description, num_workouts, start_date_local,
 * duration_weeks, hours_per_week_min/max). The `children` array (each
 * folder's full nested Workout objects) is intentionally dropped here —
 * use icu_get_workouts_in_folder for one folder's contents, shaped
 * separately and on demand.
 */
import { z } from "zod";
import { icuRequest } from "@/lib/connectors/intervals";
import { activeIcuConnection } from "./icu-connection";
import type { ToolDefinition, ToolContext } from "./registry";

const parameters = z.object({});

function shapeFolder(f: Record<string, unknown>) {
  const hoursMin = f.hours_per_week_min;
  const hoursMax = f.hours_per_week_max;
  const hasHours = hoursMin != null || hoursMax != null;
  return {
    id: f.id,
    name: f.name ?? null,
    type: f.type ?? null,
    description: f.description ?? null,
    numWorkouts: f.num_workouts ?? null,
    startDate: f.start_date_local ?? null,
    durationWeeks: f.duration_weeks ?? null,
    hoursPerWeek: hasHours
      ? { min: hoursMin ?? null, max: hoursMax ?? null }
      : null,
  };
}

async function execute(_args: z.infer<typeof parameters>, ctx: ToolContext) {
  const conn = await activeIcuConnection(ctx);
  if (!conn) return { error: "No active intervals.icu connection" };
  const raw = (await icuRequest(conn, "/athlete/{id}/folders")) as Array<
    Record<string, unknown>
  >;
  const folders = raw.map(shapeFolder);
  const trainingPlans = raw.filter((f) => f.duration_weeks != null).length;
  const totalWorkouts = raw.reduce((sum, f) => {
    const n = f.num_workouts;
    return sum + (typeof n === "number" ? n : 0);
  }, 0);

  return {
    folders,
    summary: {
      totalFolders: folders.length,
      trainingPlans,
      regularFolders: folders.length - trainingPlans,
      totalWorkouts,
    },
  };
}

export const icuGetWorkoutLibrary: ToolDefinition<typeof parameters> = {
  name: "icu_get_workout_library",
  description:
    "List all workout-library folders and training plans the athlete has access to (personal, shared, and followed). Each folder id can be passed to icu_get_workouts_in_folder to see its contents, or to icu_apply_training_plan to schedule it onto the calendar.",
  parameters,
  execute,
};

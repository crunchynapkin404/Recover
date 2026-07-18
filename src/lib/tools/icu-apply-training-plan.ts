/**
 * Applies an intervals.icu workout-library folder to your intervals.icu
 * calendar — NOT Recover's own `generate_training_plan` / living-week
 * system. This operates entirely within intervals.icu's own plan/calendar
 * feature and never touches Recover's local training plan.
 *
 * Payload ported from the standalone intervals-icu-mcp server's
 * event_management.py:apply_training_plan (~line 767) / client.py's
 * apply_training_plan (~line 601, POST /athlete/{id}/events/apply-plan),
 * verified against openapi-spec.json's ApplyPlanDTO: {folder_id,
 * start_date_local, extra_workouts?}. start_date_local is always normalized
 * to local midnight (event_management.py forces `T00:00:00` unconditionally
 * here), unlike icu_create_event/icu_update_event's normalizeLocalDate,
 * which only pads a bare date and preserves any time already supplied.
 */
import { z } from "zod";
import { icuRequest } from "@/lib/connectors/intervals";
import { activeIcuConnection } from "./icu-connection";
import type { ToolDefinition, ToolContext } from "./registry";

const parameters = z.object({
  folderId: z
    .number()
    .int()
    .describe(
      "Workout-library folder ID of the training plan to apply (from icu_get_workout_library)."
    ),
  startDate: z.string().describe("Date to start the plan on, YYYY-MM-DD."),
  extraWorkouts: z
    .array(z.record(z.string(), z.unknown()))
    .optional()
    .describe(
      "Optional additional workout objects to schedule alongside the plan."
    ),
});

function toLocalMidnight(date: string): string {
  return `${date.slice(0, 10)}T00:00:00`;
}

async function execute(args: z.infer<typeof parameters>, ctx: ToolContext) {
  const conn = await activeIcuConnection(ctx);
  if (!conn) return { error: "No active intervals.icu connection" };
  const body: Record<string, unknown> = {
    folder_id: args.folderId,
    start_date_local: toLocalMidnight(args.startDate),
  };
  if (args.extraWorkouts !== undefined)
    body.extra_workouts = args.extraWorkouts;
  const raw = await icuRequest(conn, "/athlete/{id}/events/apply-plan", {
    method: "POST",
    body,
  });
  return { folderId: args.folderId, startDate: args.startDate, result: raw };
}

export const icuApplyTrainingPlan: ToolDefinition<typeof parameters> = {
  name: "icu_apply_training_plan",
  description:
    "Applies an intervals.icu workout-library folder to your intervals.icu calendar, scheduling every workout in the plan starting on the given date. This operates on intervals.icu's own workout-library/plan feature — it is NOT Recover's `generate_training_plan` or living-week planner, and does not touch Recover's local training plan. Find the folderId with icu_get_workout_library first.",
  parameters,
  scope: "write:icu",
  execute,
};

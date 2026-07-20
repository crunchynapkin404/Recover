/**
 * Tool registry — Principle 2: one registry, two consumers (AI coach + MCP).
 *
 * Each tool is `{name, description, parameters (zod), scope?, execute({userId, db})}`.
 * Both consumers derive their tool wiring from `allTools` — never hand-list
 * tools elsewhere (that divergence shipped a broken Ollama path once already).
 */

import { tool as aiTool } from "ai";
import type { z } from "zod";
import type { Database } from "@/lib/db";
import type { Scope } from "@/lib/mcp/token-auth";

export interface ToolDefinition<T extends z.ZodType = z.ZodType> {
  name: string;
  description: string;
  parameters: T;
  /** Required token scope. Defaults to "read". */
  scope?: Scope;
  execute: (args: z.infer<T>, ctx: ToolContext) => Promise<unknown>;
}

export interface ToolContext {
  userId: string;
  db: Database;
  /** True when the request comes from a ghost (ephemeral) thread. */
  ephemeral?: boolean;
}

import { getReadiness } from "./get-readiness";
import { getReadinessHistory } from "./get-readiness-history";
import { getWellness } from "./get-wellness";
import { getFitnessSummary } from "./get-fitness-summary";
import { listActivities } from "./list-activities";
import { getActivity } from "./get-activity";
import { getAthleteProfile } from "./get-athlete-profile";
import { getTrainingLoadSummary } from "./get-training-load-summary";
import { getPowerCurve } from "./get-power-curve";
import { getPaceCurve } from "./get-pace-curve";
import { getBestEfforts } from "./get-best-efforts";
import { getPlannedWorkouts } from "./get-planned-workouts";
import { getCalendarAvailability } from "./get-calendar-availability";
import { logWellnessTool } from "./log-wellness";
import { rememberFact } from "./remember";
import { forgetFact } from "./forget";
import { renderChart } from "./render-chart";
import { generateTrainingPlanTool } from "./generate-training-plan";
import { getTrainingPlanTool } from "./get-training-plan";
import { updateTrainingPlanTool } from "./update-training-plan";
import { describeStravaActivityTool } from "./describe-strava-activity";
import { getWeekPlanTool } from "./get-week-plan";
import { setWeekAvailabilityTool } from "./set-week-availability";
import { getPlanDriftTool } from "./get-plan-drift";
import { icuGetCalendarEvents } from "./icu-get-calendar-events";
import { icuGetEvent } from "./icu-get-event";
import { icuCreateEvent } from "./icu-create-event";
import { icuUpdateEvent } from "./icu-update-event";
import { icuDeleteEvent } from "./icu-delete-event";
import { icuBulkCreateEvents } from "./icu-bulk-create-events";
import { icuBulkDeleteEvents } from "./icu-bulk-delete-events";
import { icuDuplicateEvents } from "./icu-duplicate-events";
import { icuUpdateActivity } from "./icu-update-activity";
import { icuAddActivityMessage } from "./icu-add-activity-message";
import { icuGetActivityMessages } from "./icu-get-activity-messages";
import { icuUpdateWellness } from "./icu-update-wellness";
import { icuGetSportSettings } from "./icu-get-sport-settings";
import { icuUpdateSportSettings } from "./icu-update-sport-settings";
import { icuApplyTrainingPlan } from "./icu-apply-training-plan";
import { icuGetHrHistogram } from "./icu-get-hr-histogram";
import { icuGetPowerHistogram } from "./icu-get-power-histogram";
import { icuGetPaceHistogram } from "./icu-get-pace-histogram";
import { icuGetGapHistogram } from "./icu-get-gap-histogram";
import { icuSearchActivities } from "./icu-search-activities";
import { icuGetActivityIntervals } from "./icu-get-activity-intervals";
import { icuGetWorkoutLibrary } from "./icu-get-workout-library";
import { icuGetWorkoutsInFolder } from "./icu-get-workouts-in-folder";
import { getWorkoutSyntax } from "./get-workout-syntax";
import { getBiomarkers } from "./get-biomarkers";
import { getRacesTool } from "./get-races";
import { upsertRaceTool } from "./upsert-race";
import { deleteRaceTool } from "./delete-race";
import { simulatePlanChangeTool } from "./simulate-plan-change";

/** All registered tools (53 — docs/PLAN.md MCP design + v0.4a memory + v0.4c depth + v0.5a artifacts + v0.5c calendar + v0.5d training plans + v0.6 strava describe + v0.9.2 living week + v0.9.6 absorbed icu_* tools + v0.9.6 workout-syntax reference tool + v0.13 get_biomarkers + v0.14 races/what-if). */
export const allTools: ToolDefinition[] = [
  getReadiness,
  getReadinessHistory,
  getWellness,
  getFitnessSummary,
  listActivities,
  getActivity,
  getAthleteProfile,
  getTrainingLoadSummary,
  getPowerCurve,
  getPaceCurve,
  getBestEfforts,
  getPlannedWorkouts,
  getCalendarAvailability,
  logWellnessTool,
  rememberFact,
  forgetFact,
  renderChart,
  generateTrainingPlanTool,
  getTrainingPlanTool,
  updateTrainingPlanTool,
  describeStravaActivityTool,
  getWeekPlanTool,
  setWeekAvailabilityTool,
  getPlanDriftTool,
  icuGetCalendarEvents,
  icuGetEvent,
  icuCreateEvent,
  icuUpdateEvent,
  icuDeleteEvent,
  icuBulkCreateEvents,
  icuBulkDeleteEvents,
  icuDuplicateEvents,
  icuUpdateActivity,
  icuAddActivityMessage,
  icuGetActivityMessages,
  icuUpdateWellness,
  icuGetSportSettings,
  icuUpdateSportSettings,
  icuApplyTrainingPlan,
  icuGetHrHistogram,
  icuGetPowerHistogram,
  icuGetPaceHistogram,
  icuGetGapHistogram,
  icuSearchActivities,
  icuGetActivityIntervals,
  icuGetWorkoutLibrary,
  icuGetWorkoutsInFolder,
  getWorkoutSyntax,
  getBiomarkers,
  getRacesTool,
  upsertRaceTool,
  deleteRaceTool,
  simulatePlanChangeTool,
];

/** Required scope for a tool (default "read"). */
export function requiredScope(tool: ToolDefinition): Scope {
  return tool.scope ?? "read";
}

/**
 * Build the AI SDK tools object for `streamText()` from the registry,
 * bound to the given context. The in-app coach runs under the user's own
 * session, so every registered tool is available regardless of scope.
 */
export function buildAiSdkTools(ctx: ToolContext) {
  return Object.fromEntries(
    allTools.map((t) => [
      t.name,
      aiTool({
        description: t.description,
        inputSchema: t.parameters,
        execute: async (args: unknown) => t.execute(args, ctx),
      }),
    ])
  );
}

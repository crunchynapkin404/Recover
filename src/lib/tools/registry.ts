/**
 * Tool registry — Principle 2: one registry, two consumers (AI coach + MCP).
 *
 * Each tool is `{name, description, parameters (zod), execute({userId, db})}`.
 * The registry exports both the raw tool definitions (for MCP) and an
 * AI SDK-compatible `tools` object (for /api/chat).
 */

import { tool as aiTool } from "ai";
import type { z } from "zod";
import type { Database } from "@/lib/db";

export interface ToolDefinition<T extends z.ZodType = z.ZodType> {
  name: string;
  description: string;
  parameters: T;
  execute: (args: z.infer<T>, ctx: ToolContext) => Promise<unknown>;
}

export interface ToolContext {
  userId: string;
  db: Database;
}

// Import all tools
import { getReadiness } from "./get-readiness";
import { getReadinessHistory } from "./get-readiness-history";
import { getWellness } from "./get-wellness";
import { getFitnessSummary } from "./get-fitness-summary";
import { listActivities } from "./list-activities";
import { getAthleteProfile } from "./get-athlete-profile";

/** All registered tools. */
export const allTools: ToolDefinition[] = [
  getReadiness,
  getReadinessHistory,
  getWellness,
  getFitnessSummary,
  listActivities,
  getAthleteProfile,
];

/**
 * Build AI SDK tools object for use with `streamText()`.
 * Each tool is bound to the given context (userId + db).
 */
export function buildAiSdkTools(ctx: ToolContext) {
  return {
    get_readiness: aiTool({
      description: getReadiness.description,
      inputSchema: getReadiness.parameters,
      execute: async (args) => getReadiness.execute(args, ctx),
    }),
    get_readiness_history: aiTool({
      description: getReadinessHistory.description,
      inputSchema: getReadinessHistory.parameters,
      execute: async (args) => getReadinessHistory.execute(args, ctx),
    }),
    get_wellness: aiTool({
      description: getWellness.description,
      inputSchema: getWellness.parameters,
      execute: async (args) => getWellness.execute(args, ctx),
    }),
    get_fitness_summary: aiTool({
      description: getFitnessSummary.description,
      inputSchema: getFitnessSummary.parameters,
      execute: async (args) => getFitnessSummary.execute(args, ctx),
    }),
    list_activities: aiTool({
      description: listActivities.description,
      inputSchema: listActivities.parameters,
      execute: async (args) => listActivities.execute(args, ctx),
    }),
    get_athlete_profile: aiTool({
      description: getAthleteProfile.description,
      inputSchema: getAthleteProfile.parameters,
      execute: async (args) => getAthleteProfile.execute(args, ctx),
    }),
  };
}

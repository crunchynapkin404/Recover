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
}

import { getReadiness } from "./get-readiness";
import { getReadinessHistory } from "./get-readiness-history";
import { getWellness } from "./get-wellness";
import { getFitnessSummary } from "./get-fitness-summary";
import { listActivities } from "./list-activities";
import { getActivity } from "./get-activity";
import { getAthleteProfile } from "./get-athlete-profile";
import { getTrainingLoadSummary } from "./get-training-load-summary";
import { logWellnessTool } from "./log-wellness";

/** All registered tools (9 — docs/PLAN.md MCP design). */
export const allTools: ToolDefinition[] = [
  getReadiness,
  getReadinessHistory,
  getWellness,
  getFitnessSummary,
  listActivities,
  getActivity,
  getAthleteProfile,
  getTrainingLoadSummary,
  logWellnessTool,
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

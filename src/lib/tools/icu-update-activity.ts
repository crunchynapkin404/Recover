/**
 * Update an existing intervals.icu activity's metadata. Field set ported
 * from the standalone intervals-icu-mcp server's activities.py:update_activity
 * (name, description, activity_type, trainer, commute, feel,
 * perceived_exertion), verified against openapi-spec.json's Activity schema.
 * The activity id is NOT the athlete id — `{activityId}` is interpolated
 * directly into the path; icuRequest only substitutes the `{id}` placeholder
 * for the athlete.
 */
import { z } from "zod";
import { icuRequest } from "@/lib/connectors/intervals";
import { activeIcuConnection } from "./icu-connection";
import type { ToolDefinition, ToolContext } from "./registry";

const parameters = z.object({
  activityId: z.string().describe("The intervals.icu activity ID to update."),
  name: z.string().optional().describe("Updated activity name."),
  description: z.string().optional().describe("Updated description."),
  type: z
    .string()
    .optional()
    .describe("Updated activity discipline, e.g. Ride, Run, Swim."),
  trainer: z.boolean().optional().describe("Mark as a trainer/indoor workout."),
  commute: z.boolean().optional().describe("Mark as a commute."),
  feel: z
    .number()
    .int()
    .min(1)
    .max(5)
    .optional()
    .describe("How you felt (1-5 scale)."),
  perceivedExertion: z
    .number()
    .min(1)
    .max(10)
    .optional()
    .describe("RPE rating (1-10 scale)."),
});

type Fields = Omit<z.infer<typeof parameters>, "activityId">;

function buildBody(fields: Fields): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  if (fields.name !== undefined) body.name = fields.name;
  if (fields.description !== undefined) body.description = fields.description;
  if (fields.type !== undefined) body.type = fields.type;
  if (fields.trainer !== undefined) body.trainer = fields.trainer;
  if (fields.commute !== undefined) body.commute = fields.commute;
  if (fields.feel !== undefined) body.feel = fields.feel;
  if (fields.perceivedExertion !== undefined)
    body.perceived_exertion = fields.perceivedExertion;
  return body;
}

function shapeActivity(a: Record<string, unknown>) {
  return {
    id: a.id,
    name: a.name,
    type: a.type ?? null,
    date: a.start_date_local ?? null,
    description: a.description ?? null,
    trainer: a.trainer ?? null,
    commute: a.commute ?? null,
    feel: a.feel ?? null,
    perceivedExertion: a.perceived_exertion ?? null,
  };
}

async function execute(args: z.infer<typeof parameters>, ctx: ToolContext) {
  const conn = await activeIcuConnection(ctx);
  if (!conn) return { error: "No active intervals.icu connection" };
  const { activityId, ...fields } = args;
  const body = buildBody(fields);
  if (Object.keys(body).length === 0) {
    return { error: "No fields provided to update." };
  }
  const raw = (await icuRequest(conn, `/activity/${activityId}`, {
    method: "PUT",
    body,
  })) as Record<string, unknown>;
  return { activity: shapeActivity(raw) };
}

export const icuUpdateActivity: ToolDefinition<typeof parameters> = {
  name: "icu_update_activity",
  description:
    "Update an existing intervals.icu activity's metadata — name, discipline, description, trainer/commute flags, feel (1-5), RPE (1-10). Only fields you pass are sent; everything else stays unchanged. Strava-sourced activities cannot be updated.",
  parameters,
  scope: "write:icu",
  execute,
};

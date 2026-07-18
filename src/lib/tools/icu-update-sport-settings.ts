/**
 * Update an existing per-sport threshold profile (FTP/FTHR/pace/zones).
 * Ported from the standalone intervals-icu-mcp server's
 * sport_settings.py:update_sport_settings (PUT
 * /athlete/{id}/sport-settings/{sportId}), with field names corrected
 * against openapi-spec.json's SportSettings schema — see
 * icu-sport-settings-shape.ts for the `fthr`->`lthr` /
 * `pace_threshold`+`swim_threshold`->`threshold_pace` deviations.
 *
 * `recalcHrZones` is a REQUIRED query parameter on this endpoint per
 * openapi-spec.json (PUT /athlete/{athleteId}/sport-settings/{id}), even
 * though client.py's update_sport_settings omits it entirely. We send it
 * explicitly (default false — don't force a zone recalc unless asked) to
 * satisfy the documented API contract.
 */
import { z } from "zod";
import { icuRequest } from "@/lib/connectors/intervals";
import { activeIcuConnection } from "./icu-connection";
import { shapeIcuSportSettings } from "./icu-sport-settings-shape";
import type { ToolDefinition, ToolContext } from "./registry";

const parameters = z.object({
  sportId: z.string().describe("ID of the sport-settings profile to update."),
  ftp: z
    .number()
    .int()
    .optional()
    .describe("Functional Threshold Power in watts (cycling)."),
  fthr: z
    .number()
    .int()
    .optional()
    .describe("Functional/Lactate Threshold Heart Rate in bpm."),
  maxHr: z.number().int().optional().describe("Maximum heart rate in bpm."),
  thresholdPace: z
    .number()
    .optional()
    .describe(
      "Threshold pace/speed for this sport, in the unit already configured for the profile (see paceUnits from icu_get_sport_settings)."
    ),
  wPrime: z
    .number()
    .int()
    .optional()
    .describe("W' (anaerobic work capacity) in joules."),
  hrZones: z
    .array(z.number().int())
    .optional()
    .describe("Heart-rate zone boundaries."),
  powerZones: z
    .array(z.number().int())
    .optional()
    .describe("Power zone boundaries."),
  paceZones: z.array(z.number()).optional().describe("Pace zone boundaries."),
  recalcHrZones: z
    .boolean()
    .default(false)
    .describe("Recalculate HR zones from the new threshold values."),
});

type Fields = Omit<z.infer<typeof parameters>, "sportId" | "recalcHrZones">;

function buildBody(fields: Fields): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  if (fields.ftp !== undefined) body.ftp = fields.ftp;
  if (fields.fthr !== undefined) body.lthr = fields.fthr;
  if (fields.maxHr !== undefined) body.max_hr = fields.maxHr;
  if (fields.thresholdPace !== undefined)
    body.threshold_pace = fields.thresholdPace;
  if (fields.wPrime !== undefined) body.w_prime = fields.wPrime;
  if (fields.hrZones !== undefined) body.hr_zones = fields.hrZones;
  if (fields.powerZones !== undefined) body.power_zones = fields.powerZones;
  if (fields.paceZones !== undefined) body.pace_zones = fields.paceZones;
  return body;
}

async function execute(args: z.infer<typeof parameters>, ctx: ToolContext) {
  const conn = await activeIcuConnection(ctx);
  if (!conn) return { error: "No active intervals.icu connection" };
  const { sportId, recalcHrZones, ...fields } = args;
  const body = buildBody(fields);
  if (Object.keys(body).length === 0) {
    return { error: "No fields provided to update." };
  }
  const raw = (await icuRequest(
    conn,
    `/athlete/{id}/sport-settings/${sportId}`,
    {
      method: "PUT",
      query: { recalcHrZones },
      body,
    }
  )) as Record<string, unknown>;
  return { sportSettings: shapeIcuSportSettings(raw) };
}

export const icuUpdateSportSettings: ToolDefinition<typeof parameters> = {
  name: "icu_update_sport_settings",
  description:
    "Update an existing per-sport threshold profile on intervals.icu (FTP, FTHR, threshold pace, W', zone boundaries). Only fields you pass are sent. Pass recalcHrZones=true to recompute HR zones from the new threshold.",
  parameters,
  scope: "write:icu",
  execute,
};

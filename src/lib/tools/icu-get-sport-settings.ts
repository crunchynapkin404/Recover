/**
 * Get all per-sport thresholds (FTP, FTHR, threshold pace, zones) for the
 * connected intervals.icu athlete. Ported from the standalone
 * intervals-icu-mcp server's sport_settings.py:get_sport_settings
 * (GET /athlete/{id}/sport-settings). See icu-sport-settings-shape.ts for
 * the field-name deviations from that server's stale models.py.
 */
import { z } from "zod";
import { icuRequest } from "@/lib/connectors/intervals";
import { activeIcuConnection } from "./icu-connection";
import { shapeIcuSportSettings } from "./icu-sport-settings-shape";
import type { ToolDefinition, ToolContext } from "./registry";

const parameters = z.object({});

async function execute(_args: z.infer<typeof parameters>, ctx: ToolContext) {
  const conn = await activeIcuConnection(ctx);
  if (!conn) return { error: "No active intervals.icu connection" };
  const raw = (await icuRequest(conn, "/athlete/{id}/sport-settings")) as Array<
    Record<string, unknown>
  >;
  const sportSettings = raw.map(shapeIcuSportSettings);
  return { sportSettings, count: sportSettings.length };
}

export const icuGetSportSettings: ToolDefinition<typeof parameters> = {
  name: "icu_get_sport_settings",
  description:
    "Get all per-sport thresholds — FTP (cycling watts), FTHR (heart rate), threshold pace (running/swimming), zone boundaries — for every sport-settings profile on the connected intervals.icu account.",
  parameters,
  execute,
};

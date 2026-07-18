/**
 * Shared zod field set + request-body builder for writing intervals.icu
 * calendar events, used by icu_create_event, icu_update_event, and
 * icu_bulk_create_events. Field set ported from the standalone
 * intervals-icu-mcp server's event_management.py create_event/update_event
 * (description, type, moving_time, distance, icu_training_load,
 * end_date_local, training_availability, color, show_as_note,
 * not_on_fitness_chart, show_on_ctl_line) with API's snake_case names
 * mapped from camelCase tool params.
 */
import { z } from "zod";

export const icuEventOptionalFields = {
  description: z
    .string()
    .optional()
    .describe(
      "Event description. For WORKOUT events, use intervals.icu structured workout syntax."
    ),
  type: z
    .string()
    .optional()
    .describe(
      "Activity discipline (not the category): Ride, Run, Swim, Walk, Hike, VirtualRide, VirtualRun, Other."
    ),
  durationSeconds: z
    .number()
    .int()
    .optional()
    .describe("Planned duration in seconds."),
  distanceMeters: z.number().optional().describe("Planned distance in meters."),
  trainingLoad: z.number().int().optional().describe("Planned training load."),
  endDate: z
    .string()
    .optional()
    .describe(
      "End date, YYYY-MM-DD. Use for ranged categories (INJURED, SICK, HOLIDAY, SEASON_START)."
    ),
  trainingAvailability: z.enum(["NORMAL", "LIMITED", "UNAVAILABLE"]).optional(),
  color: z.string().optional().describe("Custom display color (hex string)."),
  showAsNote: z
    .boolean()
    .optional()
    .describe("Show event as a note marker on the fitness chart."),
  notOnFitnessChart: z
    .boolean()
    .optional()
    .describe("Hide event entirely from the fitness chart."),
  showOnCtlLine: z
    .boolean()
    .optional()
    .describe("Render event on the CTL line."),
};

export interface IcuEventFields {
  date?: string;
  category?: string;
  name?: string;
  description?: string;
  type?: string;
  durationSeconds?: number;
  distanceMeters?: number;
  trainingLoad?: number;
  endDate?: string;
  trainingAvailability?: string;
  color?: string;
  showAsNote?: boolean;
  notOnFitnessChart?: boolean;
  showOnCtlLine?: boolean;
}

// intervals.icu wants a full local datetime for start/end dates
// (YYYY-MM-DDTHH:MM:SS); a bare YYYY-MM-DD is midnight-filled.
function normalizeLocalDate(input: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(input) ? `${input}T00:00:00` : input;
}

/** Build an intervals.icu event request body, including only fields present on `fields`. */
export function buildIcuEventBody(
  fields: IcuEventFields
): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  if (fields.date !== undefined)
    body.start_date_local = normalizeLocalDate(fields.date);
  if (fields.category !== undefined)
    body.category = fields.category.toUpperCase();
  if (fields.name !== undefined) body.name = fields.name;
  if (fields.description !== undefined) body.description = fields.description;
  if (fields.type !== undefined) body.type = fields.type;
  if (fields.durationSeconds !== undefined)
    body.moving_time = fields.durationSeconds;
  if (fields.distanceMeters !== undefined)
    body.distance = fields.distanceMeters;
  if (fields.trainingLoad !== undefined)
    body.icu_training_load = fields.trainingLoad;
  if (fields.endDate !== undefined)
    body.end_date_local = normalizeLocalDate(fields.endDate);
  if (fields.trainingAvailability !== undefined)
    body.training_availability = fields.trainingAvailability;
  if (fields.color !== undefined) body.color = fields.color;
  if (fields.showAsNote !== undefined) body.show_as_note = fields.showAsNote;
  if (fields.notOnFitnessChart !== undefined)
    body.not_on_fitness_chart = fields.notOnFitnessChart;
  if (fields.showOnCtlLine !== undefined)
    body.show_on_ctl_line = fields.showOnCtlLine;
  return body;
}

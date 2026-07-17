/**
 * Shared response shaping for a single intervals.icu calendar event, used by
 * icu_get_event, icu_create_event, icu_update_event, icu_bulk_create_events,
 * and icu_duplicate_events. Mirrors the field set the standalone
 * intervals-icu-mcp server's `_event_to_dict` surfaces (event_management.py),
 * normalized to camelCase for the LLM-facing tool output.
 */
export interface ShapedIcuEvent {
  id: unknown;
  date: unknown;
  endDate: unknown;
  category: unknown;
  name: unknown;
  description: unknown;
  type: unknown;
  durationSeconds: unknown;
  distanceMeters: unknown;
  trainingLoad: unknown;
  trainingAvailability: unknown;
  color: unknown;
  showAsNote: unknown;
  notOnFitnessChart: unknown;
  showOnCtlLine: unknown;
}

export function shapeIcuEvent(e: Record<string, unknown>): ShapedIcuEvent {
  return {
    id: e.id,
    date: e.start_date_local,
    endDate: e.end_date_local ?? null,
    category: e.category,
    name: e.name,
    description: e.description ?? null,
    type: e.type ?? null,
    durationSeconds: e.moving_time ?? null,
    distanceMeters: e.distance ?? null,
    trainingLoad: e.icu_training_load ?? null,
    trainingAvailability: e.training_availability ?? null,
    color: e.color ?? null,
    showAsNote: e.show_as_note ?? null,
    notOnFitnessChart: e.not_on_fitness_chart ?? null,
    showOnCtlLine: e.show_on_ctl_line ?? null,
  };
}

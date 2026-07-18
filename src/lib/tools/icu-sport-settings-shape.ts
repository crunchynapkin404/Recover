/**
 * Shared response shaping for an intervals.icu sport-settings profile, used
 * by icu_get_sport_settings and icu_update_sport_settings.
 *
 * Field names verified against openapi-spec.json's SportSettings schema —
 * NOT the standalone intervals-icu-mcp server's models.py/client.py, whose
 * SportSettings model (`fthr`, `pace_threshold`, `swim_threshold`, `type`)
 * uses field names that do not appear anywhere in the live API schema. The
 * real API uses `lthr` (Lactate/Functional Threshold Heart Rate), a single
 * `threshold_pace` field (unit indicated by `pace_units`, not a separate
 * pace vs. swim field), and a `types` array — one settings profile can cover
 * multiple disciplines (e.g. Ride + VirtualRide + GravelRide).
 */
export interface ShapedIcuSportSettings {
  id: unknown;
  types: unknown;
  ftpWatts: unknown;
  fthrBpm: unknown;
  maxHr: unknown;
  thresholdPace: unknown;
  paceUnits: unknown;
  wPrime: unknown;
  hrZones: unknown;
  powerZones: unknown;
  paceZones: unknown;
}

export function shapeIcuSportSettings(
  s: Record<string, unknown>
): ShapedIcuSportSettings {
  return {
    id: s.id,
    types: s.types ?? null,
    ftpWatts: s.ftp ?? null,
    fthrBpm: s.lthr ?? null,
    maxHr: s.max_hr ?? null,
    thresholdPace: s.threshold_pace ?? null,
    paceUnits: s.pace_units ?? null,
    wPrime: s.w_prime ?? null,
    hrZones: s.hr_zones ?? null,
    powerZones: s.power_zones ?? null,
    paceZones: s.pace_zones ?? null,
  };
}

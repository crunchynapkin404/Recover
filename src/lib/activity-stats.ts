import { formatDuration } from "@/lib/format";

/** Provenance, spelled the way the athlete would recognise it. */
const PROVIDER_LABEL: Record<string, string> = {
  intervals_icu: "intervals.icu",
  strava: "Strava",
  manual: "logged by hand",
};

export interface ActivityStat {
  label: string;
  value: string;
  /** Kept separate from `value` so a tile can set the unit smaller. */
  unit?: string;
}

/** The fields the tiles and the meta line read — structural, so both callers' rows fit. */
export interface StatSourceActivity {
  sport: string;
  provider: string;
  startDate: Date;
  startDateLocal?: Date | null;
  durationS?: number | null;
  distanceM?: number | null;
  load?: number | null;
  avgHr?: number | null;
  avgPower?: number | null;
  elevationM?: number | null;
}

/**
 * The six tiles an activity is described by, in their settled order.
 *
 * One builder, because there were two: `/activity/[id]` and Today's
 * "just landed" block each carried their own copy of this list, and
 * JustLandedCard's own doc comment asserted they could not disagree —
 * "Every figure here is one /activity/[id] already renders". They had
 * already disagreed. `activityMeta` is where the drift was visible; the
 * tiles were the pair still holding, which is exactly when to unify them.
 *
 * Only stats the activity actually carries are pushed — a missing field is
 * an absent tile, never a zero.
 */
export function activityStats(a: StatSourceActivity): ActivityStat[] {
  const stats: ActivityStat[] = [];
  if (a.durationS != null)
    stats.push({ label: "Duration", value: formatDuration(a.durationS) });
  if (a.distanceM != null)
    stats.push({
      label: "Distance",
      value: (a.distanceM / 1000).toFixed(1),
      unit: "km",
    });
  if (a.load != null)
    stats.push({ label: "Load", value: String(Math.round(a.load)) });
  if (a.avgHr != null)
    stats.push({
      label: "Avg HR",
      value: String(Math.round(a.avgHr)),
      unit: "bpm",
    });
  if (a.avgPower != null)
    stats.push({
      label: "Avg Power",
      value: String(Math.round(a.avgPower)),
      unit: "W",
    });
  if (a.elevationM != null)
    stats.push({
      label: "Climb",
      value: String(Math.round(a.elevationM)),
      unit: "m",
    });
  return stats;
}

/**
 * "Cycling · Tue Aug 11 · logged by hand" — sport, local day, provenance.
 *
 * The drift this fixes was live: `/activity/[id]` mapped the provider
 * through PROVIDER_LABEL while Today printed the raw enum, so one
 * hand-logged ride read "logged by hand" on one surface and "manual" on the
 * other. PROVIDER_LABEL is the considered spelling, so it is the one that
 * survives; an unknown provider still falls back to its own name.
 */
export function activityMeta(a: StatSourceActivity): string {
  return [
    a.sport,
    (a.startDateLocal ?? a.startDate).toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
    }),
    PROVIDER_LABEL[a.provider] ?? a.provider,
  ].join(" · ");
}

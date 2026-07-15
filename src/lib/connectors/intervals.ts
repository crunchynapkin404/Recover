/**
 * intervals.icu connector (ported from KOM-Wars, trimmed to what Recover needs).
 *
 * intervals.icu authenticates with a per-athlete **API key** over HTTP Basic
 * auth (username literal "API_KEY", password = the key) and has **no
 * webhooks** — sync is pull-only. It provides both wellness (HRV, RHR, sleep,
 * CTL/ATL) and activities, so it is Recover's primary data source.
 */

const INTERVALS_API_BASE = "https://intervals.icu/api/v1";

export type ConnectorErrorCode =
  "auth_expired" | "rate_limited" | "network_error" | "unknown";

export class ConnectorError extends Error {
  constructor(
    public readonly code: ConnectorErrorCode,
    message: string
  ) {
    super(message);
    this.name = "ConnectorError";
  }
}

/** A normalized daily wellness/fitness record from intervals.icu. */
export interface IntervalsWellnessDay {
  date: string; // YYYY-MM-DD
  hrv: number | null; // rMSSD
  restingHr: number | null;
  sleepSecs: number | null;
  sleepScore: number | null; // 0-100
  ctl: number | null;
  atl: number | null;
  eftp: number | null;
  weight: number | null;
  raw: Record<string, unknown>;
}

/** A normalized activity summary from intervals.icu. */
export interface IntervalsActivity {
  externalId: string;
  startDate: Date;
  sport: string;
  name: string | null;
  durationS: number | null;
  distanceM: number | null;
  load: number | null; // icu_training_load (TSS-like)
  avgHr: number | null;
  avgPower: number | null;
  elevationM: number | null;
  raw: Record<string, unknown>;
}

/** Minimal shape of the intervals.icu athlete object we read on connect. */
export interface IntervalsAthlete {
  id: string;
  name: string | null;
}

function authHeader(apiKey: string): string {
  const token = Buffer.from(`API_KEY:${apiKey}`).toString("base64");
  return `Basic ${token}`;
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

// Local date, not toISOString(): a self-hosted server's "today" must not
// shift to yesterday/tomorrow for timezones away from UTC.
function ymd(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

async function icuFetch(path: string, apiKey: string): Promise<Response> {
  const response = await fetch(`${INTERVALS_API_BASE}${path}`, {
    headers: { Authorization: authHeader(apiKey) },
  });
  if (response.status === 401 || response.status === 403) {
    throw new ConnectorError("auth_expired", "intervals.icu: invalid API key");
  }
  if (response.status === 429) {
    throw new ConnectorError("rate_limited", "intervals.icu: rate limited");
  }
  if (!response.ok) {
    throw new ConnectorError(
      "network_error",
      `intervals.icu: request failed (${response.status}) ${path}`
    );
  }
  return response;
}

/** Validate an API key and return the athlete it belongs to. */
export async function validateKey(apiKey: string): Promise<IntervalsAthlete> {
  const response = await icuFetch("/athlete/0", apiKey);
  const data = (await response.json()) as {
    id?: string | number;
    name?: string;
  };
  if (data.id == null) {
    throw new ConnectorError(
      "unknown",
      "intervals.icu: athlete response missing id"
    );
  }
  return { id: String(data.id), name: data.name ?? null };
}

/** Fetch raw daily wellness/fitness for a date range. */
export async function fetchDailyWellness(params: {
  apiKey: string;
  athleteId: string;
  startDate: Date;
  endDate: Date;
}): Promise<IntervalsWellnessDay[]> {
  const path =
    `/athlete/${encodeURIComponent(params.athleteId)}/wellness` +
    `?oldest=${ymd(params.startDate)}&newest=${ymd(params.endDate)}`;

  const response = await icuFetch(path, params.apiKey);
  const rows = (await response.json()) as Array<Record<string, unknown>>;

  return rows
    .filter((row) => typeof row.id === "string" && row.id.length > 0)
    .map((row) => {
      const sportInfo = Array.isArray(row.sportInfo)
        ? (row.sportInfo[0] as Record<string, unknown> | undefined)
        : undefined;
      return {
        date: String(row.id),
        hrv: num(row.hrv),
        restingHr: num(row.restingHR),
        sleepSecs: num(row.sleepSecs),
        sleepScore: num(row.sleepScore),
        ctl: num(row.ctl),
        atl: num(row.atl),
        eftp: num(sportInfo?.eftp),
        weight: num(row.weight),
        raw: row,
      };
    });
}

/** Fetch activity summaries for a date range. */
export async function fetchActivities(params: {
  apiKey: string;
  athleteId: string;
  startDate: Date;
  endDate: Date;
}): Promise<IntervalsActivity[]> {
  const path =
    `/athlete/${encodeURIComponent(params.athleteId)}/activities` +
    `?oldest=${ymd(params.startDate)}&newest=${ymd(params.endDate)}`;

  const response = await icuFetch(path, params.apiKey);
  const rows = (await response.json()) as Array<Record<string, unknown>>;

  const out: IntervalsActivity[] = [];
  for (const row of rows) {
    const externalId = str(row.id) ?? (row.id != null ? String(row.id) : null);
    const start = str(row.start_date_local) ?? str(row.start_date);
    if (!externalId || !start) continue;
    const startDate = new Date(start);
    if (Number.isNaN(startDate.getTime())) continue;
    out.push({
      externalId,
      startDate,
      sport: str(row.type) ?? "Workout",
      name: str(row.name),
      durationS: num(row.moving_time) ?? num(row.elapsed_time),
      distanceM: num(row.distance),
      load: num(row.icu_training_load),
      avgHr: num(row.average_heartrate),
      avgPower: num(row.icu_average_watts) ?? num(row.average_watts),
      elevationM: num(row.total_elevation_gain),
      raw: row,
    });
  }
  return out;
}

export interface IntervalsStream {
  type: string;
  data: (number | null)[];
}

const STREAM_TYPES = "time,heartrate,watts,velocity_smooth,altitude";

/** Fetch raw per-second streams for one activity (lazy, on first view). */
export async function fetchActivityStreams(params: {
  apiKey: string;
  externalId: string;
}): Promise<IntervalsStream[]> {
  const path =
    `/activity/${encodeURIComponent(params.externalId)}/streams` +
    `?types=${STREAM_TYPES}`;
  const response = await icuFetch(path, params.apiKey);
  const rows = (await response.json()) as Array<Record<string, unknown>>;
  return rows
    .filter((r) => typeof r.type === "string" && Array.isArray(r.data))
    .map((r) => ({
      type: r.type as string,
      data: (r.data as unknown[]).map((v) => num(v)),
    }));
}

export interface IntervalsLap {
  index: number;
  label: string | null;
  durationS: number | null;
  distanceM: number | null;
  avgHr: number | null;
  avgPower: number | null;
}

/** Fetch the activity's intervals/laps as analyzed by intervals.icu. */
export async function fetchActivityIntervals(params: {
  apiKey: string;
  externalId: string;
}): Promise<IntervalsLap[]> {
  const path = `/activity/${encodeURIComponent(params.externalId)}/intervals`;
  const response = await icuFetch(path, params.apiKey);
  const body = (await response.json()) as {
    icu_intervals?: Array<Record<string, unknown>>;
  };
  return (body.icu_intervals ?? []).map((row, i) => ({
    index: i + 1,
    label: str(row.label),
    durationS: num(row.elapsed_time) ?? num(row.moving_time),
    distanceM: num(row.distance),
    avgHr: num(row.average_heartrate),
    avgPower: num(row.average_watts),
  }));
}

export interface IntervalsPowerCurve {
  secs: number[];
  watts: number[];
  wattsPerKg: number[] | null;
}

export interface IntervalsPaceCurve {
  distanceM: number[];
  secsPerKm: number[];
}

export interface IntervalsBestEffort {
  label: string;
  sport: string;
  value: number;
  unit: string;
  activityExternalId: string | null;
  date: string | null;
}

/** intervals.icu wraps some athlete endpoints in `{ list: [...] }`. */
function unwrapList(body: unknown): Record<string, unknown> {
  if (
    body &&
    typeof body === "object" &&
    Array.isArray((body as { list?: unknown[] }).list)
  ) {
    return ((body as { list: unknown[] }).list[0] ?? {}) as Record<
      string,
      unknown
    >;
  }
  return (body ?? {}) as Record<string, unknown>;
}

function numArray(value: unknown): number[] | null {
  if (!Array.isArray(value)) return null;
  const out = value.map((v) => num(v));
  return out.every((v): v is number => v != null) ? (out as number[]) : null;
}

/** Athlete-level mean-max power curve, precomputed by intervals.icu. */
export async function fetchAthletePowerCurves(params: {
  apiKey: string;
  athleteId: string;
  days: number;
}): Promise<IntervalsPowerCurve> {
  const path =
    `/athlete/${encodeURIComponent(params.athleteId)}/power-curves` +
    `?days=${params.days}`;
  const response = await icuFetch(path, params.apiKey);
  const row = unwrapList(await response.json());
  const secs = numArray(row.secs);
  const watts = numArray(row.watts);
  if (!secs || !watts || secs.length !== watts.length) {
    throw new ConnectorError(
      "unknown",
      "intervals.icu: unexpected power-curves shape"
    );
  }
  const wattsPerKg = numArray(row.watts_per_kg);
  return {
    secs,
    watts,
    wattsPerKg:
      wattsPerKg && wattsPerKg.length === secs.length ? wattsPerKg : null,
  };
}

/** Athlete-level running pace curve, normalized to secs-per-km per distance. */
export async function fetchAthletePaceCurves(params: {
  apiKey: string;
  athleteId: string;
  days: number;
}): Promise<IntervalsPaceCurve> {
  const path =
    `/athlete/${encodeURIComponent(params.athleteId)}/pace-curves` +
    `?days=${params.days}&type=Run`;
  const response = await icuFetch(path, params.apiKey);
  const row = unwrapList(await response.json());
  const distances = numArray(row.distances);
  const secs = numArray(row.secs);
  if (!distances || !secs || distances.length !== secs.length) {
    throw new ConnectorError(
      "unknown",
      "intervals.icu: unexpected pace-curves shape"
    );
  }
  return {
    distanceM: distances,
    secsPerKm: distances.map((d, i) => (d > 0 ? secs[i] / (d / 1000) : 0)),
  };
}

/** Best-efforts listing (PRs) for the trailing window. */
export async function fetchBestEfforts(params: {
  apiKey: string;
  athleteId: string;
  days: number;
}): Promise<IntervalsBestEffort[]> {
  const path =
    `/athlete/${encodeURIComponent(params.athleteId)}/best-efforts` +
    `?days=${params.days}`;
  const response = await icuFetch(path, params.apiKey);
  const rows = (await response.json()) as Array<Record<string, unknown>>;
  if (!Array.isArray(rows)) return [];
  const out: IntervalsBestEffort[] = [];
  for (const row of rows) {
    const value = num(row.value);
    if (value == null) continue;
    const start = str(row.start_date_local) ?? str(row.start_date);
    out.push({
      label: str(row.name) ?? str(row.label) ?? "effort",
      sport: str(row.type) ?? "Workout",
      value,
      unit: str(row.unit) ?? "",
      activityExternalId:
        str(row.activity_id) ??
        (row.activity_id != null ? String(row.activity_id) : null),
      date: start ? start.slice(0, 10) : null,
    });
  }
  return out;
}

/** A normalized planned workout from intervals.icu events. */
export interface IntervalsPlannedWorkout {
  id: string;
  name: string;
  sport: string;
  date: string; // YYYY-MM-DD
  durationMins: number | null;
  targetLoad: number | null;
  description: string | null;
}

/** Fetch planned workouts (events) for a date range. */
export async function fetchPlannedWorkouts(params: {
  apiKey: string;
  athleteId: string;
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
}): Promise<IntervalsPlannedWorkout[]> {
  const path =
    `/athlete/${encodeURIComponent(params.athleteId)}/events` +
    `?oldest=${params.startDate}&newest=${params.endDate}&category=WORKOUT`;

  const response = await icuFetch(path, params.apiKey);
  const rows = (await response.json()) as unknown;
  if (!Array.isArray(rows)) return [];

  const out: IntervalsPlannedWorkout[] = [];
  for (const row of rows as Array<Record<string, unknown>>) {
    const dateStr = str(row.start_date_local) ?? str(row.start_date);
    if (!dateStr) continue;
    const movingTime = num(row.moving_time);
    const duration = num(row.duration);
    out.push({
      id: row.id != null ? String(row.id) : "",
      name: str(row.name) ?? str(row.description) ?? "Workout",
      sport: str(row.type) ?? "Workout",
      date: dateStr.slice(0, 10),
      durationMins:
        movingTime != null
          ? movingTime / 60
          : duration != null
            ? duration / 60
            : null,
      targetLoad: num(row.icu_training_load) ?? num(row.load_target) ?? null,
      description: str(row.description) ?? null,
    });
  }
  return out;
}

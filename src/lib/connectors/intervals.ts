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
  | "auth_expired"
  | "rate_limited"
  | "network_error"
  | "unknown";

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

function ymd(date: Date): string {
  return date.toISOString().slice(0, 10);
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
  const data = (await response.json()) as { id?: string | number; name?: string };
  if (data.id == null) {
    throw new ConnectorError("unknown", "intervals.icu: athlete response missing id");
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

  return rows.map((row) => {
    const sportInfo = Array.isArray(row.sportInfo)
      ? (row.sportInfo[0] as Record<string, unknown> | undefined)
      : undefined;
    return {
      date: String(row.id ?? ""),
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

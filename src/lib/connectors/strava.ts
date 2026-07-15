/**
 * Strava connector — written from scratch (Principle 1; KOM-Wars used only
 * as an API reference, its Redis-coupled refresh was not ported).
 *
 * Scope: activity:read_all + activity:write (v0.6). Write access is used
 * exclusively to push generated descriptions; Strava-sourced rows carry
 * provider="strava" and are excluded from all AI/MCP surfaces by default
 * (Nov 2024 Strava API agreement bars use of Strava data with AI models).
 * Display surfaces must show "Powered by Strava" attribution.
 */

const STRAVA_API = "https://www.strava.com/api/v3";
const STRAVA_OAUTH = "https://www.strava.com/oauth";

export class StravaError extends Error {
  constructor(
    public readonly code: "auth" | "rate_limited" | "network",
    message: string
  ) {
    super(message);
    this.name = "StravaError";
  }
}

export interface StravaTokens {
  accessToken: string;
  refreshToken: string;
  /** Unix seconds. */
  expiresAt: number;
}

export interface StravaAthlete {
  id: string;
  name: string | null;
}

export interface StravaActivitySummary {
  externalId: string;
  startDate: Date;
  sport: string;
  name: string | null;
  durationS: number | null;
  distanceM: number | null;
  load: number | null; // suffer_score when present
  avgHr: number | null;
  avgPower: number | null;
  elevationM: number | null;
  raw: Record<string, unknown>;
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function env(name: "STRAVA_CLIENT_ID" | "STRAVA_CLIENT_SECRET"): string {
  const value = process.env[name];
  if (!value) throw new StravaError("auth", `${name} is not configured`);
  return value;
}

export function buildAuthorizeUrl(redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    client_id: env("STRAVA_CLIENT_ID"),
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "activity:read_all,activity:write",
    approval_prompt: "auto",
    state,
  });
  return `${STRAVA_OAUTH}/authorize?${params}`;
}

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_at?: number;
  athlete?: { id?: number; firstname?: string; lastname?: string };
}

async function tokenRequest(
  body: Record<string, string>
): Promise<TokenResponse> {
  const response = await fetch(`${STRAVA_OAUTH}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: env("STRAVA_CLIENT_ID"),
      client_secret: env("STRAVA_CLIENT_SECRET"),
      ...body,
    }),
  });
  if (response.status === 401 || response.status === 400) {
    throw new StravaError(
      "auth",
      `Strava token request rejected (${response.status})`
    );
  }
  if (!response.ok) {
    throw new StravaError(
      "network",
      `Strava token request failed (${response.status})`
    );
  }
  return (await response.json()) as TokenResponse;
}

function parseTokens(data: TokenResponse): StravaTokens {
  if (!data.access_token || !data.refresh_token || !data.expires_at) {
    throw new StravaError("auth", "Strava token response missing fields");
  }
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: data.expires_at,
  };
}

export async function exchangeCode(
  code: string
): Promise<{ tokens: StravaTokens; athlete: StravaAthlete }> {
  const data = await tokenRequest({ code, grant_type: "authorization_code" });
  const tokens = parseTokens(data);
  if (data.athlete?.id == null) {
    throw new StravaError("auth", "Strava token response missing athlete");
  }
  const name =
    [data.athlete.firstname, data.athlete.lastname].filter(Boolean).join(" ") ||
    null;
  return { tokens, athlete: { id: String(data.athlete.id), name } };
}

export async function refreshTokens(
  refreshToken: string
): Promise<StravaTokens> {
  const data = await tokenRequest({
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });
  return parseTokens(data);
}

/** Fetch one page of activity summaries after a given time. */
export async function fetchActivities(params: {
  accessToken: string;
  afterEpochS: number;
  page?: number;
  perPage?: number;
}): Promise<StravaActivitySummary[]> {
  const query = new URLSearchParams({
    after: String(params.afterEpochS),
    page: String(params.page ?? 1),
    per_page: String(params.perPage ?? 100),
  });
  const response = await fetch(`${STRAVA_API}/athlete/activities?${query}`, {
    headers: { Authorization: `Bearer ${params.accessToken}` },
  });
  if (response.status === 401) {
    throw new StravaError("auth", "Strava: unauthorized");
  }
  if (response.status === 429) {
    throw new StravaError("rate_limited", "Strava: rate limited");
  }
  if (!response.ok) {
    throw new StravaError(
      "network",
      `Strava: activities fetch failed (${response.status})`
    );
  }

  const rows = (await response.json()) as Array<Record<string, unknown>>;
  const out: StravaActivitySummary[] = [];
  for (const row of rows) {
    const id = row.id != null ? String(row.id) : null;
    const start = str(row.start_date);
    if (!id || !start) continue;
    const startDate = new Date(start);
    if (Number.isNaN(startDate.getTime())) continue;
    out.push({
      externalId: id,
      startDate,
      sport: str(row.sport_type) ?? str(row.type) ?? "Workout",
      name: str(row.name),
      durationS: num(row.moving_time) ?? num(row.elapsed_time),
      distanceM: num(row.distance),
      load: num(row.suffer_score),
      avgHr: num(row.average_heartrate),
      avgPower: num(row.average_watts),
      elevationM: num(row.total_elevation_gain),
      raw: row,
    });
  }
  return out;
}

/** True when Strava's OAuth callback `scope` param includes activity:write. */
export function writeScopeGranted(scopeParam: string | null): boolean {
  return (scopeParam ?? "").split(",").includes("activity:write");
}

function mapWriteError(status: number, what: string): StravaError {
  if (status === 401 || status === 403) {
    return new StravaError("auth", `Strava: ${what} unauthorized (${status})`);
  }
  if (status === 429) {
    return new StravaError("rate_limited", "Strava: rate limited");
  }
  return new StravaError("network", `Strava: ${what} failed (${status})`);
}

/**
 * Read one activity's current description. Used ONLY for append/skip
 * mechanics — never as AI input (Strava API AI clause).
 */
export async function getStravaDescription(
  accessToken: string,
  activityId: string
): Promise<string | null> {
  const response = await fetch(`${STRAVA_API}/activities/${activityId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) throw mapWriteError(response.status, "activity fetch");
  const row = (await response.json()) as Record<string, unknown>;
  return str(row.description);
}

/** Overwrite one activity's description (requires activity:write). */
export async function updateStravaActivity(params: {
  accessToken: string;
  activityId: string;
  description: string;
}): Promise<void> {
  const response = await fetch(
    `${STRAVA_API}/activities/${params.activityId}`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${params.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ description: params.description }),
    }
  );
  if (!response.ok) throw mapWriteError(response.status, "activity update");
}

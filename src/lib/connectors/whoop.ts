/**
 * Whoop connector (v0.11) — OAuth2 against the v2 developer API.
 *
 * Instance-level app credentials come from env (WHOOP_CLIENT_ID /
 * WHOOP_CLIENT_SECRET — a self-hoster registers one app at
 * developer.whoop.com and points its redirect at their own domain).
 * Recovery (HRV, resting HR) and staged sleep are mapped per LOCAL date of
 * the sleep's end — the morning the reading represents. Naps are ignored.
 * All wellness writes go through wellness-merge's per-field policy.
 */
import type { WellnessPatch } from "@/lib/wellness-merge";

const WHOOP_API = "https://api.prod.whoop.com/developer/v2";
const WHOOP_OAUTH = "https://api.prod.whoop.com/oauth/oauth2";
export const WHOOP_SCOPES = "read:recovery read:sleep read:profile offline";
/** Whoop caps page size at 25; cap pages so one sync can't loop forever. */
const PAGE_LIMIT = 25;
const MAX_PAGES = 40;

export class WhoopError extends Error {
  constructor(
    public readonly code: "auth" | "rate_limited" | "network",
    message: string
  ) {
    super(message);
    this.name = "WhoopError";
  }
}

export interface WhoopTokens {
  accessToken: string;
  refreshToken: string;
  /** Unix seconds. */
  expiresAt: number;
}

function env(name: "WHOOP_CLIENT_ID" | "WHOOP_CLIENT_SECRET"): string {
  const value = process.env[name];
  if (!value) throw new WhoopError("auth", `${name} is not configured`);
  return value;
}

/** True when the instance has Whoop app credentials configured. */
export function whoopConfigured(): boolean {
  return !!process.env.WHOOP_CLIENT_ID && !!process.env.WHOOP_CLIENT_SECRET;
}

export function buildAuthorizeUrl(redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    client_id: env("WHOOP_CLIENT_ID"),
    redirect_uri: redirectUri,
    response_type: "code",
    scope: WHOOP_SCOPES,
    state,
  });
  return `${WHOOP_OAUTH}/auth?${params}`;
}

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
}

async function tokenRequest(
  body: Record<string, string>
): Promise<WhoopTokens> {
  const response = await fetch(`${WHOOP_OAUTH}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env("WHOOP_CLIENT_ID"),
      client_secret: env("WHOOP_CLIENT_SECRET"),
      ...body,
    }),
  });
  if (response.status === 400 || response.status === 401) {
    throw new WhoopError(
      "auth",
      `Whoop token request rejected (${response.status})`
    );
  }
  if (!response.ok) {
    throw new WhoopError(
      "network",
      `Whoop token request failed (${response.status})`
    );
  }
  const data = (await response.json()) as TokenResponse;
  if (!data.access_token || !data.refresh_token || !data.expires_in) {
    throw new WhoopError("auth", "Whoop token response missing fields");
  }
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Math.floor(Date.now() / 1000) + data.expires_in,
  };
}

export async function exchangeCode(
  code: string,
  redirectUri: string
): Promise<WhoopTokens> {
  return tokenRequest({
    code,
    grant_type: "authorization_code",
    redirect_uri: redirectUri,
  });
}

export async function refreshTokens(
  refreshToken: string
): Promise<WhoopTokens> {
  return tokenRequest({
    refresh_token: refreshToken,
    grant_type: "refresh_token",
    scope: "offline",
  });
}

export interface WhoopProfile {
  userId: string;
  name: string | null;
}

/** Fetch the athlete's basic profile (used to label the connection). */
export async function fetchProfile(accessToken: string): Promise<WhoopProfile> {
  const data = (await apiGet(accessToken, "/user/profile/basic")) as {
    user_id?: number | string;
    first_name?: string;
    last_name?: string;
  };
  if (data.user_id == null) {
    throw new WhoopError("auth", "Whoop profile response missing user_id");
  }
  const name =
    [data.first_name, data.last_name].filter(Boolean).join(" ") || null;
  return { userId: String(data.user_id), name };
}

async function apiGet(
  accessToken: string,
  path: string,
  query?: URLSearchParams
): Promise<unknown> {
  const qs = query ? `?${query}` : "";
  const response = await fetch(`${WHOOP_API}${path}${qs}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (response.status === 401 || response.status === 403) {
    throw new WhoopError("auth", `Whoop: unauthorized (${response.status})`);
  }
  if (response.status === 429) {
    throw new WhoopError("rate_limited", "Whoop: rate limited");
  }
  if (!response.ok) {
    throw new WhoopError(
      "network",
      `Whoop: ${path} failed (${response.status})`
    );
  }
  return response.json();
}

interface PagedResponse {
  records?: Array<Record<string, unknown>>;
  next_token?: string | null;
}

async function fetchAllPages(
  accessToken: string,
  path: string,
  start: Date,
  end: Date
): Promise<Array<Record<string, unknown>>> {
  const out: Array<Record<string, unknown>> = [];
  let nextToken: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const query = new URLSearchParams({
      start: start.toISOString(),
      end: end.toISOString(),
      limit: String(PAGE_LIMIT),
    });
    if (nextToken) query.set("nextToken", nextToken);
    const data = (await apiGet(accessToken, path, query)) as PagedResponse;
    out.push(...(data.records ?? []));
    if (!data.next_token) break;
    nextToken = data.next_token;
  }
  return out;
}

/** Sleep records (staged) in the window, naps included as returned. */
export function fetchSleeps(
  accessToken: string,
  start: Date,
  end: Date
): Promise<Array<Record<string, unknown>>> {
  return fetchAllPages(accessToken, "/activity/sleep", start, end);
}

/** Recovery records (HRV/RHR per cycle) in the window. */
export function fetchRecoveries(
  accessToken: string,
  start: Date,
  end: Date
): Promise<Array<Record<string, unknown>>> {
  return fetchAllPages(accessToken, "/recovery", start, end);
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function localYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Pure mapping: Whoop v2 sleep + recovery records → WellnessPatch per
 * local date. Sleep stages come from the night's (non-nap) sleep ending
 * that morning; HRV/RHR come from the recovery scored against that sleep
 * (joined on sleep_id). Unscored or calibrating records contribute
 * nothing — a placeholder score is not data.
 */
export function mapWhoopDays(
  sleeps: Array<Record<string, unknown>>,
  recoveries: Array<Record<string, unknown>>
): Map<string, WellnessPatch> {
  const recoveryBySleepId = new Map<string, Record<string, unknown>>();
  for (const r of recoveries) {
    if (r.score_state !== "SCORED") continue;
    const score = r.score as Record<string, unknown> | undefined;
    if (!score || score.user_calibrating === true) continue;
    const sleepId = typeof r.sleep_id === "string" ? r.sleep_id : null;
    if (sleepId) recoveryBySleepId.set(sleepId, score);
  }

  const out = new Map<string, WellnessPatch>();
  for (const s of sleeps) {
    if (s.nap === true) continue;
    if (s.score_state !== "SCORED") continue;
    const endRaw = typeof s.end === "string" ? s.end : null;
    if (!endRaw) continue;
    const end = new Date(endRaw);
    if (Number.isNaN(end.getTime())) continue;
    const startRaw = typeof s.start === "string" ? s.start : null;
    const start = startRaw ? new Date(startRaw) : null;

    const score = (s.score ?? {}) as Record<string, unknown>;
    const stages = (score.stage_summary ?? {}) as Record<string, unknown>;
    const lightMs = num(stages.total_light_sleep_time_milli);
    const deepMs = num(stages.total_slow_wave_sleep_time_milli);
    const remMs = num(stages.total_rem_sleep_time_milli);
    const awakeMs = num(stages.total_awake_time_milli);
    const asleepMs =
      lightMs != null || deepMs != null || remMs != null
        ? (lightMs ?? 0) + (deepMs ?? 0) + (remMs ?? 0)
        : null;

    const patch: WellnessPatch = {
      sleepSecs: asleepMs != null ? Math.round(asleepMs / 1000) : null,
      sleepLightSecs: lightMs != null ? Math.round(lightMs / 1000) : null,
      sleepDeepSecs: deepMs != null ? Math.round(deepMs / 1000) : null,
      sleepRemSecs: remMs != null ? Math.round(remMs / 1000) : null,
      sleepAwakeSecs: awakeMs != null ? Math.round(awakeMs / 1000) : null,
      bedStart: start != null && !Number.isNaN(start.getTime()) ? start : null,
      bedEnd: end,
      sleepScore: num(score.sleep_performance_percentage),
      respiratoryRate: num(score.respiratory_rate),
    };

    const sleepId = typeof s.id === "string" ? s.id : null;
    const recovery = sleepId ? recoveryBySleepId.get(sleepId) : undefined;
    if (recovery) {
      patch.hrvMs = num(recovery.hrv_rmssd_milli);
      patch.restingHr = num(recovery.resting_heart_rate);
    }

    const day = localYmd(end);
    // Two non-nap sleeps ending the same date: keep the longer one.
    const existing = out.get(day);
    if (
      existing == null ||
      (patch.sleepSecs ?? 0) > (existing.sleepSecs ?? 0)
    ) {
      out.set(day, patch);
    }
  }
  return out;
}

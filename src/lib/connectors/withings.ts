/**
 * Withings connector (v0.11) — OAuth2 against the Withings API, reusing the
 * connector framework (env app creds, encrypted tokens, refresh-on-expiry).
 * Provides body composition and blood pressure — the inputs v0.13 Deep
 * Biology needs. All wellness writes go through wellness-merge, where
 * withings outranks the wearables on body/BP fields (BODY ladder).
 *
 * Withings quirks handled here: token responses are wrapped in
 * `{ status, body }` (status 0 = ok), and measures are integers scaled by a
 * per-measure `unit` power of ten (value × 10^unit).
 */
import type { WellnessPatch } from "@/lib/wellness-merge";

const WITHINGS_OAUTH = "https://account.withings.com/oauth2_user/authorize2";
const WITHINGS_TOKEN = "https://wbsapi.withings.net/v2/oauth2";
const WITHINGS_MEASURE = "https://wbsapi.withings.net/measure";
export const WITHINGS_SCOPE = "user.metrics";

// Withings measure type codes we consume.
const TYPE_WEIGHT = 1;
const TYPE_FAT_RATIO = 6;
const TYPE_DIASTOLIC = 9;
const TYPE_SYSTOLIC = 10;
export const WITHINGS_MEASTYPES = [
  TYPE_WEIGHT,
  TYPE_FAT_RATIO,
  TYPE_DIASTOLIC,
  TYPE_SYSTOLIC,
];

export class WithingsError extends Error {
  constructor(
    public readonly code: "auth" | "rate_limited" | "network",
    message: string
  ) {
    super(message);
    this.name = "WithingsError";
  }
}

export interface WithingsTokens {
  accessToken: string;
  refreshToken: string;
  /** Unix seconds. */
  expiresAt: number;
  userId: string;
}

function env(name: "WITHINGS_CLIENT_ID" | "WITHINGS_CLIENT_SECRET"): string {
  const value = process.env[name];
  if (!value) throw new WithingsError("auth", `${name} is not configured`);
  return value;
}

export function withingsConfigured(): boolean {
  return (
    !!process.env.WITHINGS_CLIENT_ID && !!process.env.WITHINGS_CLIENT_SECRET
  );
}

export function buildAuthorizeUrl(redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: env("WITHINGS_CLIENT_ID"),
    scope: WITHINGS_SCOPE,
    redirect_uri: redirectUri,
    state,
  });
  return `${WITHINGS_OAUTH}?${params}`;
}

interface TokenEnvelope {
  status?: number;
  body?: {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    userid?: string | number;
  };
}

async function tokenRequest(
  body: Record<string, string>
): Promise<WithingsTokens> {
  const response = await fetch(WITHINGS_TOKEN, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      action: "requesttoken",
      client_id: env("WITHINGS_CLIENT_ID"),
      client_secret: env("WITHINGS_CLIENT_SECRET"),
      ...body,
    }),
  });
  if (!response.ok) {
    throw new WithingsError(
      "network",
      `Withings token request failed (${response.status})`
    );
  }
  const data = (await response.json()) as TokenEnvelope;
  const b = data.body;
  // Withings signals auth failure via status != 0, not HTTP codes.
  if (data.status !== 0 || !b?.access_token) {
    throw new WithingsError(
      "auth",
      `Withings token rejected (status ${data.status})`
    );
  }
  if (!b.refresh_token || !b.expires_in || b.userid == null) {
    throw new WithingsError("auth", "Withings token response missing fields");
  }
  return {
    accessToken: b.access_token,
    refreshToken: b.refresh_token,
    expiresAt: Math.floor(Date.now() / 1000) + b.expires_in,
    userId: String(b.userid),
  };
}

export function exchangeCode(
  code: string,
  redirectUri: string
): Promise<WithingsTokens> {
  return tokenRequest({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
  });
}

export function refreshTokens(refreshToken: string): Promise<WithingsTokens> {
  return tokenRequest({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });
}

interface MeasureEnvelope {
  status?: number;
  body?: {
    measuregrps?: Array<{
      date?: number;
      measures?: Array<{ value?: number; type?: number; unit?: number }>;
    }>;
  };
}

/** Fetch measure groups (body/BP) between two unix-second timestamps. */
export async function fetchMeasures(
  accessToken: string,
  startEpochS: number,
  endEpochS: number
): Promise<MeasureEnvelope["body"]> {
  const response = await fetch(WITHINGS_MEASURE, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      action: "getmeas",
      meastypes: WITHINGS_MEASTYPES.join(","),
      category: "1", // real measures, not user goals
      startdate: String(startEpochS),
      enddate: String(endEpochS),
    }),
  });
  if (response.status === 401 || response.status === 403) {
    throw new WithingsError("auth", "Withings: unauthorized");
  }
  if (response.status === 429) {
    throw new WithingsError("rate_limited", "Withings: rate limited");
  }
  if (!response.ok) {
    throw new WithingsError(
      "network",
      `Withings: getmeas failed (${response.status})`
    );
  }
  const data = (await response.json()) as MeasureEnvelope;
  if (data.status !== 0) {
    throw new WithingsError(
      data.status === 401 ? "auth" : "network",
      `Withings getmeas status ${data.status}`
    );
  }
  return data.body ?? {};
}

function localYmd(epochS: number): string {
  const d = new Date(epochS * 1000);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

/**
 * Pure mapping: Withings measure groups → WellnessPatch per local date.
 * Each measure's real value is `value × 10^unit`. When a day has several
 * groups for the same field, the latest group (highest `date`) wins.
 */
export function mapWithingsMeasures(
  body: MeasureEnvelope["body"]
): Map<string, WellnessPatch> {
  const groups = [...(body?.measuregrps ?? [])].sort(
    (a, b) => (a.date ?? 0) - (b.date ?? 0)
  );
  const out = new Map<string, WellnessPatch>();
  for (const grp of groups) {
    if (grp.date == null) continue;
    const day = localYmd(grp.date);
    const patch = out.get(day) ?? {};
    for (const m of grp.measures ?? []) {
      if (typeof m.value !== "number" || typeof m.type !== "number") continue;
      const real = m.value * 10 ** (m.unit ?? 0);
      switch (m.type) {
        case TYPE_WEIGHT:
          patch.weightKg = round1(real);
          break;
        case TYPE_FAT_RATIO:
          patch.bodyFatPct = round1(real);
          break;
        case TYPE_DIASTOLIC:
          patch.diastolic = Math.round(real);
          break;
        case TYPE_SYSTOLIC:
          patch.systolic = Math.round(real);
          break;
        default:
          break;
      }
    }
    if (Object.keys(patch).length > 0) out.set(day, patch);
  }
  return out;
}

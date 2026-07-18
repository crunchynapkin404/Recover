/**
 * Oura connector (v0.11) — Personal Access Token against the v2 API.
 *
 * A self-hoster creates a PAT at cloud.ouraring.com/personal-access-tokens
 * (no OAuth app, no redirect) and pastes it in Settings, exactly like the
 * intervals.icu key flow. Staged sleep, bed window, HRV/RHR, sleep score,
 * and temperature deviation are mapped per LOCAL sleep `day`. All wellness
 * writes go through wellness-merge's per-field policy.
 */
import type { WellnessPatch } from "@/lib/wellness-merge";

const OURA_API = "https://api.ouraring.com/v2";

export class OuraError extends Error {
  constructor(
    public readonly code: "auth" | "rate_limited" | "network",
    message: string
  ) {
    super(message);
    this.name = "OuraError";
  }
}

async function apiGet(
  token: string,
  path: string,
  query?: Record<string, string>
): Promise<unknown> {
  const qs = query ? `?${new URLSearchParams(query)}` : "";
  const response = await fetch(`${OURA_API}${path}${qs}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (response.status === 401 || response.status === 403) {
    throw new OuraError("auth", "Oura: invalid personal access token");
  }
  if (response.status === 429) {
    throw new OuraError("rate_limited", "Oura: rate limited");
  }
  if (!response.ok) {
    throw new OuraError("network", `Oura: ${path} failed (${response.status})`);
  }
  return response.json();
}

export interface OuraIdentity {
  id: string;
  email: string | null;
}

/** Validate a PAT and return the account it belongs to. */
export async function validateToken(token: string): Promise<OuraIdentity> {
  const data = (await apiGet(token, "/usercollection/personal_info")) as {
    id?: string;
    email?: string;
  };
  if (data.id == null) {
    throw new OuraError("auth", "Oura personal_info response missing id");
  }
  return { id: String(data.id), email: data.email ?? null };
}

/** Paginated collection fetch (Oura returns `{ data, next_token }`). */
async function fetchCollection(
  token: string,
  path: string,
  startDate: string,
  endDate: string
): Promise<Array<Record<string, unknown>>> {
  const out: Array<Record<string, unknown>> = [];
  let nextToken: string | undefined;
  for (let page = 0; page < 50; page++) {
    const query: Record<string, string> = {
      start_date: startDate,
      end_date: endDate,
    };
    if (nextToken) query.next_token = nextToken;
    const data = (await apiGet(token, path, query)) as {
      data?: Array<Record<string, unknown>>;
      next_token?: string | null;
    };
    out.push(...(data.data ?? []));
    if (!data.next_token) break;
    nextToken = data.next_token;
  }
  return out;
}

export function fetchSleep(token: string, startDate: string, endDate: string) {
  return fetchCollection(token, "/usercollection/sleep", startDate, endDate);
}

export function fetchDailySleep(
  token: string,
  startDate: string,
  endDate: string
) {
  return fetchCollection(
    token,
    "/usercollection/daily_sleep",
    startDate,
    endDate
  );
}

export function fetchDailyReadiness(
  token: string,
  startDate: string,
  endDate: string
) {
  return fetchCollection(
    token,
    "/usercollection/daily_readiness",
    startDate,
    endDate
  );
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function toDate(v: unknown): Date | null {
  if (typeof v !== "string") return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Pure mapping: Oura v2 sleep + daily_sleep + daily_readiness records →
 * WellnessPatch per `day`. Only the main nightly sleep (`type ==
 * "long_sleep"`) contributes stages; naps are dropped. Sleep score comes
 * from daily_sleep, temperature deviation from daily_readiness — both
 * joined on the same `day`.
 */
export function mapOuraDays(
  sleep: Array<Record<string, unknown>>,
  dailySleep: Array<Record<string, unknown>>,
  dailyReadiness: Array<Record<string, unknown>>
): Map<string, WellnessPatch> {
  const scoreByDay = new Map<string, number>();
  for (const d of dailySleep) {
    const day = typeof d.day === "string" ? d.day : null;
    const score = num(d.score);
    if (day && score != null) scoreByDay.set(day, score);
  }
  const tempByDay = new Map<string, number>();
  for (const r of dailyReadiness) {
    const day = typeof r.day === "string" ? r.day : null;
    const temp = num(r.temperature_deviation);
    if (day && temp != null) tempByDay.set(day, temp);
  }

  const out = new Map<string, WellnessPatch>();
  for (const s of sleep) {
    // Only the main sleep carries stages; drop naps and rests.
    if (s.type != null && s.type !== "long_sleep") continue;
    const day = typeof s.day === "string" ? s.day : null;
    if (!day) continue;

    const deep = num(s.deep_sleep_duration);
    const rem = num(s.rem_sleep_duration);
    const light = num(s.light_sleep_duration);
    const total = num(s.total_sleep_duration);

    const patch: WellnessPatch = {
      sleepSecs:
        total ??
        (deep != null || rem != null || light != null
          ? (deep ?? 0) + (rem ?? 0) + (light ?? 0)
          : null),
      sleepDeepSecs: deep,
      sleepRemSecs: rem,
      sleepLightSecs: light,
      sleepAwakeSecs: num(s.awake_time),
      bedStart: toDate(s.bedtime_start),
      bedEnd: toDate(s.bedtime_end),
      hrvMs: num(s.average_hrv),
      restingHr: num(s.lowest_heart_rate),
      respiratoryRate: num(s.average_breath),
      sleepScore: scoreByDay.get(day) ?? null,
      tempDeviationC: tempByDay.get(day) ?? null,
    };

    // Prefer the longest main sleep if the API returns more than one.
    const existing = out.get(day);
    if (
      existing == null ||
      (patch.sleepSecs ?? 0) > (existing.sleepSecs ?? 0)
    ) {
      out.set(day, patch);
    }
  }

  // Days that have a readiness/score but no sleep row still carry temp.
  for (const [day, temp] of tempByDay) {
    if (!out.has(day)) out.set(day, { tempDeviationC: temp });
  }
  return out;
}

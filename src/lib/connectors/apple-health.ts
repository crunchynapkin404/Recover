/**
 * Apple Health connector (v0.11) — ingest of Health Auto Export JSON, both
 * via a token-authed webhook (the iOS app POSTs on a schedule) and a
 * one-off file upload. There is no Apple API to pull from; Apple Health is
 * a push source. Data is mapped to WellnessPatch per date and written
 * through wellness-merge's per-field policy, where apple_health sits at the
 * bottom of every ladder (a dedicated wearable's reading wins).
 */
import type { WellnessPatch } from "@/lib/wellness-merge";

interface MetricPoint {
  date?: unknown;
  qty?: unknown;
  // sleep_analysis points carry stage durations + a bed window instead of qty
  sleepStart?: unknown;
  sleepEnd?: unknown;
  totalSleep?: unknown;
  asleep?: unknown;
  deep?: unknown;
  rem?: unknown;
  core?: unknown;
  light?: unknown;
  awake?: unknown;
  inBed?: unknown;
}

interface Metric {
  name?: unknown;
  units?: unknown;
  data?: unknown;
}

export interface HealthAutoExportPayload {
  data?: { metrics?: unknown };
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** Health Auto Export dates look like "2026-07-15 07:05:00 +0000". */
function toDate(v: unknown): Date | null {
  if (typeof v !== "string") return null;
  // Normalize the space-separated form to ISO-ish so Date can parse it.
  const iso = v.includes("T") ? v : v.replace(" ", "T").replace(" ", "");
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : new Date(v);
}

function localYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function ymdOf(v: unknown): string | null {
  const d = toDate(v);
  return d ? localYmd(d) : null;
}

function hoursToSecs(v: unknown): number | null {
  const n = num(v);
  return n != null ? Math.round(n * 3600) : null;
}

/** Set `field` on the patch for `day`, creating the entry if needed. */
function set(
  out: Map<string, WellnessPatch>,
  day: string,
  field: keyof WellnessPatch,
  value: number | Date | null
) {
  if (value == null) return;
  const patch = out.get(day) ?? {};
  (patch as Record<string, unknown>)[field] = value;
  out.set(day, patch);
}

/**
 * Pure mapping: a Health Auto Export payload → WellnessPatch per local
 * date. Scalar metrics (HRV, RHR, weight, body fat, BP, respiration) map
 * to the day of their timestamp; sleep_analysis maps staged durations and
 * the bed window to the wake date. Unknown metric names are ignored.
 */
export function mapAppleHealth(
  payload: HealthAutoExportPayload
): Map<string, WellnessPatch> {
  const out = new Map<string, WellnessPatch>();
  const metrics = payload.data?.metrics;
  if (!Array.isArray(metrics)) return out;

  for (const raw of metrics as Metric[]) {
    const name = typeof raw.name === "string" ? raw.name : null;
    const units = typeof raw.units === "string" ? raw.units.toLowerCase() : "";
    const points = Array.isArray(raw.data) ? (raw.data as MetricPoint[]) : [];
    if (!name) continue;

    if (name === "sleep_analysis") {
      for (const p of points) {
        const day = ymdOf(p.sleepEnd ?? p.date);
        if (!day) continue;
        const deep = hoursToSecs(p.deep);
        const rem = hoursToSecs(p.rem);
        // Health Auto Export calls light sleep "core".
        const lightHrs = p.core ?? p.light;
        const light = hoursToSecs(lightHrs);
        const asleep =
          hoursToSecs(p.totalSleep ?? p.asleep) ??
          (deep != null || rem != null || light != null
            ? (deep ?? 0) + (rem ?? 0) + (light ?? 0)
            : null);
        set(out, day, "sleepSecs", asleep);
        set(out, day, "sleepDeepSecs", deep);
        set(out, day, "sleepRemSecs", rem);
        set(out, day, "sleepLightSecs", light);
        set(out, day, "sleepAwakeSecs", hoursToSecs(p.awake));
        const bedStart = toDate(p.sleepStart);
        const bedEnd = toDate(p.sleepEnd);
        if (bedStart) set(out, day, "bedStart", bedStart);
        if (bedEnd) set(out, day, "bedEnd", bedEnd);
      }
      continue;
    }

    for (const p of points) {
      const day = ymdOf(p.date);
      const qty = num(p.qty);
      if (!day || qty == null) continue;
      switch (name) {
        case "heart_rate_variability":
          set(out, day, "hrvMs", qty);
          break;
        case "resting_heart_rate":
          set(out, day, "restingHr", qty);
          break;
        case "respiratory_rate":
          set(out, day, "respiratoryRate", qty);
          break;
        case "body_mass":
        case "weight_body_mass":
          set(
            out,
            day,
            "weightKg",
            units === "lb" || units === "lbs" ? qty * 0.453592 : qty
          );
          break;
        case "body_fat_percentage":
          // Apple reports a fraction (0–1); store as a percentage.
          set(out, day, "bodyFatPct", qty <= 1 ? qty * 100 : qty);
          break;
        case "blood_pressure_systolic":
          set(out, day, "systolic", qty);
          break;
        case "blood_pressure_diastolic":
          set(out, day, "diastolic", qty);
          break;
        default:
          break; // unknown metric — ignore
      }
    }
  }
  return out;
}

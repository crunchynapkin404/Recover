/**
 * Web-push pipeline: payload building, VAPID key management, delivery.
 * Morning readiness push guards live here too (see maybeSendMorningReadinessPush).
 */

export interface PushPayload {
  title: string;
  body: string;
  tag: string;
  url: string;
}

export interface MorningMetricsInput {
  readiness: number;
  band: "green" | "amber" | "red";
  hrvMs: number | null;
  restingHr: number | null;
  sleepSecs: number | null;
}

const BAND_LINES: Record<MorningMetricsInput["band"], string> = {
  green: "Green light — good day for intensity.",
  amber: "Moderate — keep quality controlled.",
  red: "Recovery day — keep it easy.",
};

export function buildMorningPayload(m: MorningMetricsInput): PushPayload {
  const parts: string[] = [];
  if (m.hrvMs != null) parts.push(`HRV ${Math.round(m.hrvMs)} ms`);
  if (m.restingHr != null) parts.push(`RHR ${Math.round(m.restingHr)}`);
  if (m.sleepSecs != null)
    parts.push(`Sleep ${(m.sleepSecs / 3600).toFixed(1)} h`);
  const metrics = parts.join(" · ");
  const band = m.band.charAt(0).toUpperCase() + m.band.slice(1);
  return {
    title: `Readiness ${Math.round(m.readiness)} · ${band}`,
    body: metrics ? `${metrics} — ${BAND_LINES[m.band]}` : BAND_LINES[m.band],
    tag: "morning-readiness",
    url: "/",
  };
}

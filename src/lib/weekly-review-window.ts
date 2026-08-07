/**
 * The day a weekly review's CTL delta is measured FROM.
 *
 * The review's load, sessions and average readiness all cover one calendar
 * week, and `weekly-review.ts:262` renders all four figures in a single
 * sentence. Before v0.46 the CTL delta alone used a rolling seven-day
 * lookback from `now`, so on any day but the week's first that sentence
 * carried two different definitions of "this week".
 *
 * Pure — no I/O, no clock. The caller supplies the week start.
 */
export function ctlBaselineYmd(weekStartYmd: string): string {
  // Parse at local midnight, not bare `new Date(ymd)`, which is UTC and
  // lands on the wrong day behind UTC — the same fix already applied in
  // race/debrief.ts, race/service.ts, race/taper.ts and volume-inputs.ts.
  const d = new Date(weekStartYmd + "T00:00:00");
  d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function formatDuration(seconds: number | null): string {
  if (seconds == null) return "—";
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return h > 0 ? `${h}h ${m.toString().padStart(2, "0")}m` : `${m}m`;
}

export function formatKm(meters: number | null): string {
  if (meters == null) return "—";
  return `${(meters / 1000).toLocaleString(undefined, {
    maximumFractionDigits: 1,
  })} km`;
}

export function formatDay(date: Date | string): string {
  const d = typeof date === "string" ? new Date(`${date}T00:00:00`) : date;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/**
 * An inclusive day span, saying the month once when it does not change:
 * "Sep 7-13", and "Sep 29 - Oct 5" when it does.
 *
 * Built on formatDay rather than beside it, so a week's dates and a single
 * day's are formatted by one function and cannot drift apart.
 */
export function formatDayRange(
  start: Date | string,
  end: Date | string
): string {
  const s = typeof start === "string" ? new Date(`${start}T00:00:00`) : start;
  const e = typeof end === "string" ? new Date(`${end}T00:00:00`) : end;
  const sameMonth =
    s.getMonth() === e.getMonth() && s.getFullYear() === e.getFullYear();
  return sameMonth
    ? `${formatDay(s)}\u2013${e.getDate()}`
    : `${formatDay(s)} \u2013 ${formatDay(e)}`;
}

export function formatSleepHours(secs: number | null): string {
  if (secs == null) return "—";
  const h = secs / 3600;
  return `${h.toLocaleString(undefined, { maximumFractionDigits: 1 })}h`;
}

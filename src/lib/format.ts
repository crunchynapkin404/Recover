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

export function formatSleepHours(secs: number | null): string {
  if (secs == null) return "—";
  const h = secs / 3600;
  return `${h.toLocaleString(undefined, { maximumFractionDigits: 1 })}h`;
}

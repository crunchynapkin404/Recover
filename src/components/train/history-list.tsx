import Link from "next/link";

export interface HistoryRow {
  id: string;
  name: string;
  sport: string | null;
  startDate: Date;
  durationS: number | null;
  load: number | null;
  distanceM: number | null;
  /** Sub-line detail: "RPE 7 · felt strong", "debrief pending", or null. */
  feedback: string | null;
}

export interface HistoryGroup {
  day: string;
  items: HistoryRow[];
}

// Sport hue for the rail. Anything that isn't a run reads as a ride — the
// same two-colour split the v0.21 log rows used, now sourced from the
// chart tokens so it follows the theme instead of being a dark-only rgba.
function railColor(sport: string | null): string {
  return sport === "Run" ? "var(--chart-2)" : "var(--chart-1)";
}

// The row's metric trio is mono and tight ("1:15 · 78 · 32km"), so it uses
// clock/compact forms rather than the prose-y shared format helpers.
export function clockDuration(seconds: number | null): string | null {
  if (seconds == null) return null;
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return `${h}:${String(m).padStart(2, "0")}`;
}

export function compactKm(meters: number | null): string | null {
  if (meters == null) return null;
  const km = meters / 1000;
  return `${km.toLocaleString("en-US", { maximumFractionDigits: km < 10 ? 1 : 0 })}km`;
}

function dayLabel(d: Date): string {
  return d
    .toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
    })
    .toUpperCase();
}

/**
 * History (1d) — day-grouped rows (≈64–68px, sized to their content) on one
 * grouped surface, replacing the ~300px card per activity. Everything an
 * athlete scans for (what, how it felt, how long/hard/far) is on one line;
 * the detail lives one tap away on /activity/[id].
 */
export function HistoryList({ groups }: { groups: HistoryGroup[] }) {
  return (
    <div className="space-y-5">
      {groups.map((g) => (
        <section key={g.day}>
          <h3 className="mb-2 px-1 text-label font-bold uppercase tracking-[0.15em] text-ink-muted">
            {dayLabel(g.items[0].startDate)}
          </h3>
          <div className="glass overflow-hidden rounded-[18px]">
            {g.items.map((a) => (
              <Link
                key={a.id}
                href={`/activity/${a.id}`}
                className="flex min-h-16 items-center gap-3 border-b border-hairline px-3 py-2.5 transition-colors last:border-0 hover:bg-surface-overlay"
              >
                <span
                  aria-hidden
                  className="h-7 w-2 shrink-0 rounded-full"
                  style={{ background: railColor(a.sport) }}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-caption font-semibold text-ink-primary">
                    {a.name}
                  </span>
                  <span className="block truncate text-label font-medium uppercase tracking-wider text-ink-muted">
                    {[a.sport, a.feedback].filter(Boolean).join(" · ")}
                  </span>
                </span>
                <span className="shrink-0 font-numeric text-label text-ink-secondary">
                  {[
                    clockDuration(a.durationS),
                    a.load != null ? String(Math.round(a.load)) : null,
                    compactKm(a.distanceM),
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </Link>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

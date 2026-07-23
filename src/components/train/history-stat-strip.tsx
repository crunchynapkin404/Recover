export interface HistoryStat {
  /** Mono figure — "8.4h", "412", "5". */
  value: string;
  /** Muted unit/noun that follows it — "load", "sessions", "km". */
  label?: string;
}

/**
 * The one-row summary above History (1d): scope, then the totals for the
 * window that's actually on screen. Every figure is a sum of the rows
 * below it, so the strip can never disagree with the list.
 */
export function HistoryStatStrip({
  scope,
  stats,
}: {
  scope: string;
  stats: HistoryStat[];
}) {
  return (
    <div className="mb-4 flex flex-wrap items-baseline gap-x-3 gap-y-1 rounded-[14px] border border-white/[0.08] bg-white/[0.03] px-4 py-2.5">
      <span className="text-[11px] text-white/45">{scope}</span>
      {stats.map((s) => (
        <span key={s.label ?? s.value} className="font-mono text-[11px]">
          <span className="font-bold text-white">{s.value}</span>
          {s.label && <span className="ml-1 text-white/40">{s.label}</span>}
        </span>
      ))}
    </div>
  );
}

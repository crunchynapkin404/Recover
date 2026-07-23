import type { TagInsight } from "@/lib/insights/correlations";

/**
 * Behaviour correlations as plain rows (1g) — the same numbers the v0.9.4
 * card carried, without the nested glass. An inconclusive result says so
 * and shows its sample size instead of being dressed up as a finding.
 */
export function CorrelationRows({ insights }: { insights: TagInsight[] }) {
  if (insights.length === 0) return null;
  return (
    <section className="mb-3 rounded-[18px] border border-white/[0.08] bg-white/[0.03] p-4">
      <h3 className="mb-2 text-[9.5px] font-bold uppercase tracking-[0.15em] text-white/40">
        90-day correlations
      </h3>
      <ul>
        {insights.map((c) => (
          <li
            key={`${c.emoji}${c.behavior}`}
            className="flex items-center justify-between gap-3 border-b border-white/[0.06] py-2.5 last:border-0"
          >
            <span className="flex min-w-0 items-center gap-2 text-[12px] text-white/85">
              <span aria-hidden>{c.emoji}</span>
              <span className="truncate capitalize">{c.behavior}</span>
              {c.auto && (
                <span className="shrink-0 text-[9px] font-bold uppercase tracking-wider text-white/30">
                  auto
                </span>
              )}
            </span>
            {c.conclusive ? (
              <span
                className={`shrink-0 text-[11.5px] font-bold ${
                  c.impactPct > 0 ? "text-emerald-400" : "text-red-400"
                }`}
              >
                {c.impactPct > 0 ? "+" : "−"}
                {Math.abs(c.impactPct)}% ± {c.ciHalfWidthPct} next-day
              </span>
            ) : (
              <span className="shrink-0 text-[11px] text-white/40">
                inconclusive · {c.events} events
              </span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

import type { TagInsight } from "@/lib/insights/correlations";
import { correlationFigure } from "@/lib/insights/correlations";
import { unavailableMessage } from "@/components/ui/unavailable";

/**
 * Behaviour correlations as plain rows (1g) — the same numbers the v0.9.4
 * card carried, without the nested glass. A thin sample renders as
 * calibrating; a strong sample with no effect renders as a real finding —
 * they must not read alike (docs/specs/2026-08-08-uncertainty-vocabulary-design.md).
 */
export function CorrelationRows({ insights }: { insights: TagInsight[] }) {
  if (insights.length === 0) return null;
  return (
    <section className="glass mb-3 rounded-[18px] p-4">
      <h3 className="label-micro mb-2">90-day correlations</h3>
      <ul>
        {insights.map((c) => (
          <li
            key={`${c.emoji}${c.behavior}`}
            className="flex items-center justify-between gap-3 border-b border-hairline py-2.5 last:border-0"
          >
            <span className="flex min-w-0 items-center gap-2 text-caption text-ink-secondary">
              <span aria-hidden>{c.emoji}</span>
              <span className="truncate capitalize">{c.behavior}</span>
              {c.auto && (
                <span className="shrink-0 text-label font-bold uppercase tracking-wider text-ink-muted">
                  auto
                </span>
              )}
            </span>
            <CorrelationBadge insight={c} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function CorrelationBadge({ insight: c }: { insight: TagInsight }) {
  const figure = correlationFigure(c);

  if (!figure.available) {
    return (
      <span className="shrink-0 text-label text-ink-muted">
        {unavailableMessage(figure)} · {c.events} events
      </span>
    );
  }

  if (figure.value.noEffect) {
    return (
      <span className="shrink-0 text-label font-medium text-ink-secondary">
        No detectable effect · {c.events} events
      </span>
    );
  }

  return (
    <span
      className={`shrink-0 text-label font-bold ${
        figure.value.impactPct > 0 ? "text-chart-2" : "text-chart-5"
      }`}
    >
      {`${figure.value.impactPct > 0 ? "+" : "−"}${Math.abs(figure.value.impactPct)}% ± ${figure.value.ciHalfWidthPct} next-day`}
    </span>
  );
}

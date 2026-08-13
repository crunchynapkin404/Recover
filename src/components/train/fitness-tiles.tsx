import type { Figure } from "@/lib/uncertainty";
import { unavailableMessage } from "@/components/ui/unavailable";

export interface FitnessTile {
  /** The short label the tile prints — "CTL", "ATL", "TSB". */
  label: string;
  /** The full name, announced but not printed — "Fitness". Required. */
  srLabel: string;
  /** The reading, or why it isn't available yet. */
  value: Figure<string>;
  color: string;
  /** One line of context under the value; null when there's nothing honest to say. */
  context: string | null;
  /**
   * Tints the context line when the context MEANS something (the CTL block
   * delta reads as a gain). Leave it unset otherwise: the default is the
   * `--ink-muted` text floor, and passing a muted colour by hand is how the
   * sub-AA `rgba(255,255,255,0.4)` came to be written in two places.
   */
  contextColor?: string;
}

/**
 * CTL / ATL / TSB as three tiles above the PMC chart (1e). The chart shows
 * the shape; these show today's number, which is what the athlete came for.
 *
 * The tile prints only the short label — "CTL", not "Fitness · CTL" — the
 * full name is announced via `srLabel`, not printed: the same three letters
 * as pmc-chart.tsx's own legend one panel below, which is where the full
 * name is stated once instead of three times.
 */
export function FitnessTiles({ tiles }: { tiles: FitnessTile[] }) {
  return (
    <div className="mb-4 grid grid-cols-3 gap-2">
      {tiles.map((t) => (
        <div
          key={t.label}
          className="rounded-[14px] border border-hairline bg-surface-overlay px-3 py-2.5"
        >
          <p className="text-label font-bold uppercase tracking-[0.15em] text-ink-muted">
            {t.label}
            <span className="sr-only">{t.srLabel}</span>
          </p>
          <p
            className="mt-1 font-numeric text-title font-bold leading-none"
            style={{ color: t.color }}
            title={!t.value.available ? unavailableMessage(t.value) : undefined}
          >
            {t.value.available ? t.value.value : "—"}
            {!t.value.available && (
              <span className="sr-only">{unavailableMessage(t.value)}</span>
            )}
          </p>
          {t.context && (
            <p
              className="mt-1.5 text-label font-medium"
              style={{ color: t.contextColor ?? "var(--ink-muted)" }}
            >
              {t.context}
            </p>
          )}
        </div>
      ))}
    </div>
  );
}

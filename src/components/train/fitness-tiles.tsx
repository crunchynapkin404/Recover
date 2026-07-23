export interface FitnessTile {
  /** "Fitness · CTL" */
  label: string;
  /** Mono value, already rounded — or "—" while load calibrates. */
  value: string;
  color: string;
  /** One line of context under the value; null when there's nothing honest to say. */
  context: string | null;
  /** Tints the context line (the CTL block delta reads as a gain). */
  contextColor?: string;
}

/**
 * CTL / ATL / TSB as three tiles above the PMC chart (1e). The chart shows
 * the shape; these show today's number, which is what the athlete came for.
 */
export function FitnessTiles({ tiles }: { tiles: FitnessTile[] }) {
  return (
    <div className="mb-4 grid grid-cols-3 gap-2">
      {tiles.map((t) => (
        <div
          key={t.label}
          className="rounded-[14px] border border-white/[0.09] bg-white/[0.04] px-3 py-2.5"
        >
          <p className="text-[8.5px] font-bold uppercase tracking-[0.15em] text-white/40">
            {t.label}
          </p>
          <p
            className="mt-1 font-mono text-[20px] font-bold leading-none"
            style={{ color: t.color }}
          >
            {t.value}
          </p>
          {t.context && (
            <p
              className="mt-1.5 text-[9.5px] font-medium"
              style={{ color: t.contextColor ?? "rgba(255,255,255,0.4)" }}
            >
              {t.context}
            </p>
          )}
        </div>
      ))}
    </div>
  );
}

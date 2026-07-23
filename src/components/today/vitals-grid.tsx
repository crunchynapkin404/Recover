import Link from "next/link";

export interface VitalTile {
  label: string;
  /** Pre-formatted display value, or "—" when there is no honest reading. */
  value: string;
  unit?: string;
  delta?: { text: string; tone: "good" | "warn" | "muted" } | null;
  /** "" → no line drawn (fewer than two real points). */
  sparkPath: string;
  sparkColor: string;
  href: string;
}

const TONE: Record<"good" | "warn" | "muted", string> = {
  good: "text-emerald-400",
  warn: "text-amber-400",
  muted: "text-white/45",
};

/**
 * Today's 2×2 vitals grid — replaces the RecoveryMetricsAccordion here. Each
 * tile is a tap target into Body's matching trend. Values are Geist Mono;
 * calibrating tiles show "—" with no sparkline (never an invented value).
 */
export function VitalsGrid({ tiles }: { tiles: VitalTile[] }) {
  return (
    <div className="mb-6 grid grid-cols-2 gap-2">
      {tiles.map((t) => (
        <Link
          key={t.label}
          href={t.href}
          className="flex items-center justify-between rounded-xl border border-white/[0.09] bg-white/[0.04] px-3 py-2.5 transition-colors hover:bg-white/[0.06]"
        >
          <div className="min-w-0">
            <div className="text-[9px] font-bold uppercase tracking-wider text-white/40">
              {t.label}
            </div>
            <div className="mt-0.5 font-mono text-[19px] font-bold leading-none text-white">
              {t.value}
              {t.unit && (
                <span className="ml-0.5 text-[10px] font-normal text-white/40">
                  {t.unit}
                </span>
              )}
            </div>
          </div>
          <div className="flex flex-col items-end gap-1">
            {t.delta && (
              <span
                className={`text-[9.5px] font-semibold ${TONE[t.delta.tone]}`}
              >
                {t.delta.text}
              </span>
            )}
            {t.sparkPath && (
              <svg
                aria-hidden
                width={42}
                height={14}
                viewBox="0 0 100 20"
                preserveAspectRatio="none"
                className="sparkline-animate"
              >
                <path
                  d={t.sparkPath}
                  fill="none"
                  stroke={t.sparkColor}
                  strokeWidth={1.5}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  vectorEffect="non-scaling-stroke"
                />
              </svg>
            )}
          </div>
        </Link>
      ))}
    </div>
  );
}

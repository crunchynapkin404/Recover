import { downsample } from "@/lib/charts";

interface Props {
  /** Micro label — "HRV vs baseline". */
  title: string;
  /** Series, oldest first; nulls are gaps, never zeroes. */
  values: (number | null)[];
  /** The athlete's own band, or null while baselines are calibrating. */
  band: { low: number; high: number } | null;
  color: string;
  /** Translucent fill for the band rect. */
  bandFill: string;
  unit: string;
  /** Decimals for the current reading; RHR and HRV are both whole numbers. */
  decimals?: number;
}

const VIEW_W = 300;
const VIEW_H = 90;

function polyline(
  values: (number | null)[],
  min: number,
  range: number
): string {
  const pts: string[] = [];
  const n = values.length;
  values.forEach((v, i) => {
    if (v == null) return;
    const x = n > 1 ? (i / (n - 1)) * VIEW_W : 0;
    const y = VIEW_H - ((v - min) / range) * VIEW_H;
    pts.push(`${x.toFixed(1)},${y.toFixed(1)}`);
  });
  return pts.join(" ");
}

/**
 * One trend against the athlete's own baseline band (1g). The band is a
 * translucent rect with a dashed centreline: the point isn't the absolute
 * number, it's whether today sits inside the athlete's normal range.
 *
 * Renders an honest empty state rather than a flat line when the range
 * holds fewer than two real readings.
 */
export function BaselineTrendCard({
  title,
  values,
  band,
  color,
  bandFill,
  unit,
  decimals = 0,
}: Props) {
  const series = downsample(values, 120);
  const nums = series.filter((v): v is number => v != null);
  const current = [...values].reverse().find((v) => v != null) ?? null;

  return (
    <section className="mb-3 rounded-[18px] border border-white/[0.08] bg-white/[0.03] p-4">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h3 className="text-[9.5px] font-bold uppercase tracking-[0.15em] text-white/40">
          {title}
        </h3>
        <p className="font-mono text-[11px] text-white/45">
          {current != null && (
            <>
              <span className="text-[12px] font-bold text-white">
                {current.toFixed(decimals)}
              </span>
              <span className="text-white/40">{unit}</span>
            </>
          )}
          {band && (
            <span className="ml-1.5">
              {current != null && "· "}
              {((band.low + band.high) / 2).toFixed(decimals)} ±
              {((band.high - band.low) / 2).toFixed(decimals)}
            </span>
          )}
        </p>
      </div>

      {nums.length < 2 ? (
        <p className="py-6 text-center text-[11px] text-white/40">
          Not enough readings in this range yet.
        </p>
      ) : (
        (() => {
          // The band has to fit inside the viewport too, or "inside your
          // normal range" would be drawn off-canvas.
          const lo = Math.min(...nums, band?.low ?? Infinity);
          const hi = Math.max(...nums, band?.high ?? -Infinity);
          const pad = (hi - lo) * 0.1 || 1;
          const min = lo - pad;
          const range = hi - lo + pad * 2;
          const yOf = (v: number) => VIEW_H - ((v - min) / range) * VIEW_H;
          return (
            <svg
              viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
              preserveAspectRatio="none"
              className="h-[90px] w-full"
              role="img"
              aria-label={`${title}${current != null ? `, currently ${current.toFixed(decimals)}${unit}` : ""}`}
            >
              {band && (
                <>
                  <rect
                    x="0"
                    y={yOf(band.high)}
                    width={VIEW_W}
                    height={Math.max(1, yOf(band.low) - yOf(band.high))}
                    fill={bandFill}
                  />
                  <line
                    x1="0"
                    y1={yOf((band.low + band.high) / 2)}
                    x2={VIEW_W}
                    y2={yOf((band.low + band.high) / 2)}
                    stroke={color}
                    strokeOpacity="0.35"
                    strokeWidth="0.8"
                    strokeDasharray="3 3"
                  />
                </>
              )}
              <polyline
                points={polyline(series, min, range)}
                fill="none"
                stroke={color}
                strokeWidth="0.8"
                vectorEffect="non-scaling-stroke"
              />
            </svg>
          );
        })()
      )}
    </section>
  );
}

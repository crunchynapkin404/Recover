import { downsample } from "@/lib/charts";
import { TREND_STROKE, type TrendTone } from "./trend-tone";

interface Props {
  /** Micro label — "HRV". Never carries a " vs baseline" suffix; see below. */
  title: string;
  /** Series, oldest first; nulls are gaps, never zeroes. */
  values: (number | null)[];
  /** The athlete's own band, or null while baselines are calibrating. */
  band: { low: number; high: number } | null;
  /** What the metric measures; resolves to a chart token. */
  tone: TrendTone;
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
 *
 * v0.99 slice 3 cut the visible " vs baseline" suffix four titles carried:
 * at the 12px floor an uppercase "RESTING HR VS BASELINE" plus its reading
 * overruns a phone's content width. The band rect and its centreline state
 * the comparison on screen and the ± readout states it numerically, so the
 * suffix was redundant for a sighted reader — and it moves into the SVG's
 * accessible name, which is the one channel that could not see the band.
 */
export function BaselineTrendCard({
  title,
  values,
  band,
  tone,
  unit,
  decimals = 0,
}: Props) {
  const series = downsample(values, 120);
  const nums = series.filter((v): v is number => v != null);
  const current = [...values].reverse().find((v) => v != null) ?? null;
  const stroke = TREND_STROKE[tone];

  return (
    <section className="glass mb-3 rounded-[18px] p-4">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 className="label-micro">{title}</h3>
        <p className="font-numeric text-label text-ink-muted">
          {current != null && (
            <>
              <span className="text-caption font-bold text-ink-primary">
                {current.toFixed(decimals)}
              </span>
              <span className="text-ink-muted">{unit}</span>
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
        <p className="py-6 text-center text-caption text-ink-muted">
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
              aria-label={`${title}${band ? " against your baseline" : ""}${current != null ? `, currently ${current.toFixed(decimals)}${unit}` : ""}`}
            >
              {band && (
                <>
                  {/* fill + fillOpacity rather than a second rgba() prop: one
                      token, one number, and no colour literal to go stale. */}
                  <rect
                    x="0"
                    y={yOf(band.high)}
                    width={VIEW_W}
                    height={Math.max(1, yOf(band.low) - yOf(band.high))}
                    fill={stroke}
                    fillOpacity="0.08"
                  />
                  <line
                    x1="0"
                    y1={yOf((band.low + band.high) / 2)}
                    x2={VIEW_W}
                    y2={yOf((band.low + band.high) / 2)}
                    stroke={stroke}
                    strokeOpacity="0.35"
                    strokeWidth="0.8"
                    strokeDasharray="3 3"
                  />
                </>
              )}
              <polyline
                points={polyline(series, min, range)}
                fill="none"
                stroke={stroke}
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

import { downsample, CHART_TOKENS, formatChartValue } from "@/lib/charts";

interface Props {
  label: string;
  unit: string;
  color: string;
  values: (number | null)[];
  format?: (v: number) => string;
  /** SVG height in px (2b: HR/Power 56, Elevation 44). */
  height?: number;
  /** Fills under the line — elevation reads as terrain, not a signal. */
  fill?: string;
}

/** Server-rendered SVG line chart in the app's hand-rolled style. */
export function StreamChart({
  label,
  unit,
  color,
  values,
  format,
  height = 56,
  fill,
}: Props) {
  const data = downsample(values, 300);
  const nums = data.filter((v): v is number => v != null);
  if (nums.length < 2) return null;
  const min = Math.min(...nums);
  const max = Math.max(...nums);
  const range = max - min || 1;
  const pts: string[] = [];
  data.forEach((v, i) => {
    if (v == null) return;
    const x = (i / (data.length - 1)) * 100;
    const y = 38 - ((v - min) / range) * 34;
    pts.push(`${x.toFixed(2)},${y.toFixed(2)}`);
  });
  const fmt = format ?? ((v: number) => formatChartValue(v));
  const avg = nums.reduce((s, v) => s + v, 0) / nums.length;

  // Closing the path along the baseline turns the same points into an area.
  const areaPts =
    fill && pts.length > 1 ? `0,40 ${pts.join(" ")} 100,40` : null;

  return (
    <div className="rounded-[18px] border border-white/[0.08] bg-white/[0.03] p-4">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <h3 className="text-[11px] font-bold">{label}</h3>
        <span className="text-[9.5px] font-bold uppercase tracking-[0.15em] text-white/40">
          avg {fmt(avg)} · max {fmt(max)} {unit}
        </span>
      </div>
      <svg
        viewBox="0 0 100 40"
        preserveAspectRatio="none"
        style={{ height }}
        className="w-full"
        role="img"
        aria-label={`${label}: average ${fmt(avg)}, max ${fmt(max)} ${unit}`}
      >
        {areaPts && <polygon points={areaPts} fill={fill} />}
        <polyline
          points={pts.join(" ")}
          fill="none"
          stroke={color}
          strokeWidth={CHART_TOKENS.strokeWidth.regular}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    </div>
  );
}

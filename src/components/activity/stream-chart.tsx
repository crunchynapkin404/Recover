import { downsample } from "@/lib/charts";

interface Props {
  label: string;
  unit: string;
  color: string;
  values: (number | null)[];
  format?: (v: number) => string;
}

/** Server-rendered SVG line chart in the app's hand-rolled style. */
export function StreamChart({ label, unit, color, values, format }: Props) {
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
  const fmt = format ?? ((v: number) => String(Math.round(v)));
  const avg = nums.reduce((s, v) => s + v, 0) / nums.length;

  return (
    <div className="glass rounded-[2rem] p-6">
      <div className="mb-3 flex items-baseline justify-between">
        <h3 className="text-sm font-bold">{label}</h3>
        <span className="text-[10px] font-bold uppercase tracking-widest text-white/50">
          avg {fmt(avg)} · max {fmt(max)} {unit}
        </span>
      </div>
      <svg
        viewBox="0 0 100 40"
        preserveAspectRatio="none"
        className="h-24 w-full"
        role="img"
        aria-label={`${label}: average ${fmt(avg)}, max ${fmt(max)} ${unit}`}
      >
        <polyline
          points={pts.join(" ")}
          fill="none"
          stroke={color}
          strokeWidth="0.8"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    </div>
  );
}

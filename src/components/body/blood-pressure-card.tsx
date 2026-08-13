import type { BpTrend, BpCategory } from "@/lib/blood-pressure";

interface Props {
  trend: BpTrend | null;
}

const BAND_COLOR: Record<BpCategory, string> = {
  normal: "text-chart-2",
  elevated: "text-chart-3",
  stage1: "text-chart-3",
  stage2: "text-chart-5",
  crisis: "text-chart-5",
};

const DIRECTION_LABEL = {
  rising: "▲ rising",
  falling: "▼ falling",
  steady: "→ steady",
} as const;

/**
 * Blood-pressure card (v0.13). Latest classification against the ACC/AHA
 * bands plus the recent average and direction. Renders nothing when there
 * are too few readings — the parent hides it.
 */
export function BloodPressureCard({ trend }: Props) {
  if (!trend) return null;
  return (
    <div className="glass rounded-[2rem] p-6">
      <div className="flex items-center justify-between">
        <span className="label-micro">Blood Pressure</span>
        <span className="text-label text-ink-muted">
          {trend.readings} readings · {DIRECTION_LABEL[trend.direction]}
        </span>
      </div>
      <div className="mt-3 flex items-baseline gap-2">
        <span className="text-figure font-bold font-numeric text-ink-primary">
          {trend.latest.systolic}/{trend.latest.diastolic}
        </span>
        <span className="text-label text-ink-muted">mmHg</span>
      </div>
      <p
        className={`mt-1 text-caption font-bold ${BAND_COLOR[trend.latest.category]}`}
      >
        {trend.latest.label}
      </p>
      <p className="mt-2 text-caption text-ink-muted">
        Recent average {trend.avgSystolic}/{trend.avgDiastolic} mmHg
      </p>
    </div>
  );
}

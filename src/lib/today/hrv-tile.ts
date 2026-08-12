/**
 * The Today HRV tile. Extracted from page.tsx so the metric-selection
 * behaviour is testable without rendering a server component.
 *
 * Everything comparative — the 7-day delta and the sparkline — reads the
 * SAME column as the displayed value. Comparing an SDNN reading against an
 * rMSSD 7-day mean would print a fictional 20-40% drop.
 */
import { Figure } from "@/lib/uncertainty";
import { sparkPath } from "@/lib/sparkline";
import type { HrvMetric } from "@/lib/hrv-source";
import type { VitalTile } from "@/components/today/vitals-grid";

export interface HrvRow {
  date: string;
  hrvMs: number | null;
  hrvSdnnMs: number | null;
}

const WHY_SDNN =
  "rMSSD hasn't arrived from your watch yet — scored against your SDNN baseline.";

const WHY_NOT_SCORED =
  "Readiness isn't scoring HRV yet — still learning your baseline.";

function column(row: HrvRow, metric: HrvMetric): number | null {
  return metric === "rmssd" ? row.hrvMs : row.hrvSdnnMs;
}

/**
 * Which column to DISPLAY when nothing scored the day — the same precedence
 * as scoring, minus the baseline requirement.
 *
 * hrv_metric is null in two very different situations: no reading at all, and
 * a real reading whose baseline is still short (the first 14 days). Blanking
 * both says "needs an HRV reading" to an athlete who took one that morning,
 * which is false, and it is the opposite of this release's point — the tile
 * would be claiming ignorance it does not have. It also regressed the old
 * behaviour and disagreed with the RHR tile beside it, which still shows its
 * value while calibrating.
 */
function displayMetric(row: HrvRow): HrvMetric | null {
  if (row.hrvMs != null && row.hrvMs > 0) return "rmssd";
  if (row.hrvSdnnMs != null && row.hrvSdnnMs > 0) return "sdnn";
  return null;
}

export function buildHrvTile(input: {
  latest: HrvRow | undefined;
  /** daily_metrics.hrv_metric for `latest.date`; null = the day was not scored. */
  metric: HrvMetric | null;
  window7: HrvRow[];
}): VitalTile {
  // Destructured to a const so the null check below narrows `metric` inside
  // the .map() closure further down — a property access on `input` would not.
  const { latest, metric, window7 } = input;

  const base = {
    label: "HRV",
    unit: "ms",
    sparkClass: "stroke-chart-2",
    href: "/body?tab=trends",
  };

  // `metric` is what SCORED the day; `shown` is what the tile displays. They
  // differ only while calibrating, and the `why` below says so out loud, so
  // the tile still cannot imply a number fed a ring that never saw it.
  const shown = metric ?? (latest ? displayMetric(latest) : null);
  const value = shown && latest ? column(latest, shown) : null;

  if (shown == null || value == null) {
    return {
      ...base,
      value: Figure.missingInput("an HRV reading"),
      delta: null,
      sparkPath: "",
    };
  }

  const series = window7.map((w) => column(w, shown));
  const present = series.filter((v): v is number => v != null);
  const avg7 =
    present.length > 0
      ? present.reduce((s, v) => s + v, 0) / present.length
      : 0;
  const good = value >= avg7;

  return {
    ...base,
    label: shown === "sdnn" ? "HRV · SDNN" : "HRV",
    value: Figure.available(
      String(Math.round(value)),
      metric == null ? "low" : shown === "sdnn" ? "medium" : "high",
      metric == null ? WHY_NOT_SCORED : shown === "sdnn" ? WHY_SDNN : undefined
    ),
    delta:
      avg7 > 0
        ? {
            text: `${good ? "▲" : "▼"} 7d ${Math.round(avg7)}`,
            tone: good ? ("good" as const) : ("muted" as const),
          }
        : null,
    sparkPath: sparkPath(series),
  };
}

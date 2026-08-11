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

function column(row: HrvRow, metric: HrvMetric): number | null {
  return metric === "rmssd" ? row.hrvMs : row.hrvSdnnMs;
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
    sparkColor: "#10b981",
    href: "/body?tab=trends",
  };

  const value = metric && latest ? column(latest, metric) : null;

  // A day the ring did not score must not display a number the ring does not
  // reflect — so the tile blanks with a reason rather than reaching for a
  // column nothing validated.
  if (metric == null || value == null) {
    return {
      ...base,
      value: Figure.missingInput("an HRV reading"),
      delta: null,
      sparkPath: "",
    };
  }

  const series = window7.map((w) => column(w, metric));
  const present = series.filter((v): v is number => v != null);
  const avg7 =
    present.length > 0
      ? present.reduce((s, v) => s + v, 0) / present.length
      : 0;
  const good = value >= avg7;

  return {
    ...base,
    label: metric === "sdnn" ? "HRV · SDNN" : "HRV",
    value: Figure.available(
      String(Math.round(value)),
      metric === "sdnn" ? "medium" : "high",
      metric === "sdnn" ? WHY_SDNN : undefined
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

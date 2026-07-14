"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatDay } from "@/lib/format";

export interface SleepPoint {
  date: string; // YYYY-MM-DD
  hours: number | null;
}

function SleepTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload: SleepPoint }>;
}) {
  if (!active || !payload?.length) return null;
  const point = payload[0].payload;
  if (point.hours == null) return null;
  return (
    <div className="rounded-md border bg-popover px-2.5 py-1.5 text-xs text-popover-foreground shadow-sm">
      <span className="text-muted-foreground">{formatDay(point.date)}</span>{" "}
      <span className="font-medium tabular-nums">{point.hours.toFixed(1)}h sleep</span>
    </div>
  );
}

/** Single-series bar chart — rounded data-ends, baseline-anchored. */
export function SleepChart({ data }: { data: SleepPoint[] }) {
  return (
    <div className="h-44 w-full" role="img" aria-label="Sleep duration per night">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -12 }} barCategoryGap="20%">
          <CartesianGrid stroke="var(--viz-grid)" vertical={false} />
          <XAxis
            dataKey="date"
            tickFormatter={formatDay}
            tick={{ fill: "var(--viz-muted-ink)", fontSize: 11 }}
            tickLine={false}
            axisLine={{ stroke: "var(--viz-axis)" }}
            minTickGap={32}
          />
          <YAxis
            tick={{ fill: "var(--viz-muted-ink)", fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            width={40}
            unit="h"
          />
          <Tooltip content={<SleepTooltip />} cursor={{ fill: "var(--viz-grid)", opacity: 0.4 }} />
          <Bar dataKey="hours" fill="var(--viz-series-5)" radius={[4, 4, 0, 0]} maxBarSize={18} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

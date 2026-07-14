"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatDay } from "@/lib/format";

export interface TrendPoint {
  date: string; // YYYY-MM-DD
  value: number | null;
}

interface Props {
  data: TrendPoint[];
  color: string; // CSS var, e.g. "var(--viz-series-1)"
  unit: string;
  /** Fixed decimals in the tooltip value. */
  decimals?: number;
}

function TrendTooltip({
  active,
  payload,
  unit,
  decimals,
}: {
  active?: boolean;
  payload?: Array<{ payload: TrendPoint }>;
  unit: string;
  decimals: number;
}) {
  if (!active || !payload?.length) return null;
  const point = payload[0].payload;
  if (point.value == null) return null;
  return (
    <div className="rounded-md border bg-popover px-2.5 py-1.5 text-xs text-popover-foreground shadow-sm">
      <span className="text-muted-foreground">{formatDay(point.date)}</span>{" "}
      <span className="font-medium tabular-nums">
        {point.value.toFixed(decimals)} {unit}
      </span>
    </div>
  );
}

/** Single-series line chart — no legend (the card title names the series). */
export function TrendChart({ data, color, unit, decimals = 0 }: Props) {
  return (
    <div className="h-44 w-full" role="img" aria-label={`Trend chart, ${unit}`}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
          <CartesianGrid stroke="var(--viz-grid)" strokeDasharray="0" vertical={false} />
          <XAxis
            dataKey="date"
            tickFormatter={formatDay}
            tick={{ fill: "var(--viz-muted-ink)", fontSize: 11 }}
            tickLine={false}
            axisLine={{ stroke: "var(--viz-axis)" }}
            minTickGap={32}
          />
          <YAxis
            domain={["auto", "auto"]}
            tick={{ fill: "var(--viz-muted-ink)", fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            width={40}
          />
          <Tooltip
            content={<TrendTooltip unit={unit} decimals={decimals} />}
            cursor={{ stroke: "var(--viz-axis)", strokeWidth: 1 }}
          />
          <Line
            type="monotone"
            dataKey="value"
            stroke={color}
            strokeWidth={2}
            dot={false}
            connectNulls
            activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--background)" }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

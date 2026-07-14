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

export interface FitnessPoint {
  date: string; // YYYY-MM-DD
  ctl: number | null; // fitness
  atl: number | null; // fatigue
}

function FitnessTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload: FitnessPoint }>;
}) {
  if (!active || !payload?.length) return null;
  const point = payload[0].payload;
  return (
    <div className="rounded-md border bg-popover px-2.5 py-1.5 text-xs text-popover-foreground shadow-sm">
      <div className="text-muted-foreground">{formatDay(point.date)}</div>
      <div className="mt-1 grid gap-0.5 tabular-nums">
        <div className="flex items-center gap-1.5">
          <span
            aria-hidden
            className="inline-block size-2 rounded-full"
            style={{ background: "var(--viz-series-1)" }}
          />
          Fitness (CTL){" "}
          <span className="font-medium">{point.ctl?.toFixed(0) ?? "—"}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span
            aria-hidden
            className="inline-block size-2 rounded-full"
            style={{ background: "var(--viz-series-2)" }}
          />
          Fatigue (ATL){" "}
          <span className="font-medium">{point.atl?.toFixed(0) ?? "—"}</span>
        </div>
      </div>
    </div>
  );
}

/** Two-series line chart: legend is always present for ≥2 series. */
export function FitnessChart({ data }: { data: FitnessPoint[] }) {
  return (
    <div>
      <div className="mb-2 flex items-center gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span
            aria-hidden
            className="inline-block h-0.5 w-4 rounded-full"
            style={{ background: "var(--viz-series-1)" }}
          />
          Fitness (CTL)
        </span>
        <span className="flex items-center gap-1.5">
          <span
            aria-hidden
            className="inline-block h-0.5 w-4 rounded-full"
            style={{ background: "var(--viz-series-2)" }}
          />
          Fatigue (ATL)
        </span>
      </div>
      <div
        className="h-52 w-full"
        role="img"
        aria-label="Fitness and fatigue trend"
      >
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={data}
            margin={{ top: 8, right: 8, bottom: 0, left: -12 }}
          >
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
              domain={["auto", "auto"]}
              tick={{ fill: "var(--viz-muted-ink)", fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              width={40}
            />
            <Tooltip
              content={<FitnessTooltip />}
              cursor={{ stroke: "var(--viz-axis)", strokeWidth: 1 }}
            />
            <Line
              type="monotone"
              dataKey="ctl"
              stroke="var(--viz-series-1)"
              strokeWidth={2}
              dot={false}
              connectNulls
              activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--background)" }}
            />
            <Line
              type="monotone"
              dataKey="atl"
              stroke="var(--viz-series-2)"
              strokeWidth={2}
              dot={false}
              connectNulls
              activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--background)" }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

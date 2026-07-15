"use client";

import { useState } from "react";
import type { ChartSpec } from "@/lib/tools/render-chart";

const PALETTE = ["#3b82f6", "#ef4444", "#34d399", "#f59e0b", "#a855f7"];

function getColor(index: number, explicit?: string): string {
  if (explicit) return explicit;
  return PALETTE[index % PALETTE.length];
}

function LineChart({ spec }: { spec: ChartSpec }) {
  const allY = spec.series.flatMap((s) => s.data.map((d) => d.y));
  const min = Math.min(...allY);
  const max = Math.max(...allY);
  const range = max - min || 1;

  return (
    <svg
      viewBox="0 0 100 40"
      preserveAspectRatio="none"
      className="h-full w-full"
      role="img"
      aria-label={spec.title}
    >
      {spec.series.map((s, si) => {
        const n = s.data.length;
        const pts = s.data
          .map((d, i) => {
            const x = n > 1 ? (i / (n - 1)) * 100 : 0;
            const y = 38 - ((d.y - min) / range) * 34;
            return `${x.toFixed(1)},${y.toFixed(1)}`;
          })
          .join(" ");

        const fill =
          spec.type === "area" || s.style === "area"
            ? getColor(si, s.color)
            : "none";
        const fillOpacity = fill !== "none" ? 0.12 : undefined;
        const areaPath =
          spec.type === "area" || s.style === "area"
            ? s.data
                .map((d, i) => {
                  const x = n > 1 ? (i / (n - 1)) * 100 : 0;
                  const y = 38 - ((d.y - min) / range) * 34;
                  return `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
                })
                .join(" ") + " L100 38 L0 38 Z"
            : null;

        return (
          <g key={si}>
            {areaPath && (
              <path
                d={areaPath}
                fill={getColor(si, s.color)}
                opacity={fillOpacity}
              />
            )}
            <polyline
              points={pts}
              fill="none"
              stroke={getColor(si, s.color)}
              strokeWidth="0.7"
              strokeDasharray={s.style === "dashed" ? "1.5 1" : undefined}
              vectorEffect="non-scaling-stroke"
            />
          </g>
        );
      })}
    </svg>
  );
}

function BarChart({ spec }: { spec: ChartSpec }) {
  const allY = spec.series.flatMap((s) => s.data.map((d) => d.y));
  const max = Math.max(...allY);
  const yRange = max || 1;
  const barCount = spec.series[0]?.data.length ?? 0;
  const barWidth = barCount > 0 ? 90 / barCount : 10;
  const gap = barCount > 1 ? (100 - barCount * barWidth) / (barCount + 1) : 5;

  return (
    <svg
      viewBox="0 0 100 40"
      preserveAspectRatio="none"
      className="h-full w-full"
      role="img"
      aria-label={spec.title}
    >
      {spec.series.map((s, si) =>
        s.data.map((d, di) => {
          const h = (d.y / yRange) * 34;
          const x = gap + di * (barWidth + gap);
          const y = 38 - h;
          return (
            <rect
              key={`${si}-${di}`}
              x={x}
              y={y}
              width={barWidth * 0.8}
              height={h}
              fill={getColor(si, s.color)}
              opacity={0.8}
              rx={0.5}
            />
          );
        })
      )}
    </svg>
  );
}

function TableChart({ spec }: { spec: ChartSpec }) {
  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="border-b border-white/10">
          <th className="px-2 py-1 text-left font-medium text-white/50">
            {spec.xLabel ?? ""}
          </th>
          {spec.series.map((s) => (
            <th
              key={s.label}
              className="px-2 py-1 text-right font-medium text-white/50"
            >
              {s.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {spec.series[0]?.data.map((d, i) => (
          <tr key={i} className="border-b border-white/5">
            <td className="px-2 py-1 text-white/70">{String(d.x)}</td>
            {spec.series.map((s) => (
              <td key={s.label} className="px-2 py-1 text-right tabular-nums">
                {s.data[i]?.y ?? "—"}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function ArtifactCard({ spec }: { spec: ChartSpec }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      className={`glass overflow-hidden rounded-2xl transition-all duration-200 ${expanded ? "h-80" : "h-20"}`}
    >
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        className="flex w-full items-center justify-between px-4 py-2"
      >
        <span className="text-sm font-bold">{spec.title}</span>
        <span className="text-[10px] text-white/40">
          {expanded ? "collapse" : "expand"}
        </span>
      </button>
      <div className="px-4 pb-4">
        {spec.type === "table" && <TableChart spec={spec} />}
        {spec.type === "bar" && <BarChart spec={spec} />}
        {(spec.type === "line" || spec.type === "area") && (
          <LineChart spec={spec} />
        )}
      </div>
    </div>
  );
}

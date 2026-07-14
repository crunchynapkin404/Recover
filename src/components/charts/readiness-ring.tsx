"use client";

import type { Band } from "@/lib/readiness";

interface Props {
  readiness: number | null;
  band: Band;
}

// Status palette (reserved status colors, not series colors).
const BAND_COLOR: Record<Band, string> = {
  green: "var(--viz-status-good)",
  amber: "var(--viz-status-warning)",
  red: "var(--viz-status-critical)",
  calibrating: "var(--muted-foreground)",
};

const BAND_LABEL: Record<Band, string> = {
  green: "Ready",
  amber: "Moderate",
  red: "Take it easy",
  calibrating: "Calibrating",
};

export function ReadinessRing({ readiness, band }: Props) {
  const r = 52;
  const c = 2 * Math.PI * r;
  const fraction = readiness != null ? readiness / 100 : 0;
  const color = BAND_COLOR[band];

  return (
    <div className="flex items-center gap-5">
      <svg
        width="128"
        height="128"
        viewBox="0 0 128 128"
        role="img"
        aria-label={
          readiness != null
            ? `Readiness ${readiness} out of 100 — ${BAND_LABEL[band]}`
            : "Readiness calibrating: not enough history yet"
        }
      >
        <circle
          cx="64"
          cy="64"
          r={r}
          fill="none"
          stroke="var(--border)"
          strokeWidth="10"
        />
        {readiness != null && (
          <circle
            cx="64"
            cy="64"
            r={r}
            fill="none"
            stroke={color}
            strokeWidth="10"
            strokeLinecap="round"
            strokeDasharray={`${fraction * c} ${c}`}
            transform="rotate(-90 64 64)"
          />
        )}
        <text
          x="64"
          y="60"
          textAnchor="middle"
          className="fill-foreground text-3xl font-semibold"
        >
          {readiness ?? "—"}
        </text>
        <text
          x="64"
          y="80"
          textAnchor="middle"
          className="fill-muted-foreground text-[10px] uppercase tracking-wide"
        >
          readiness
        </text>
      </svg>
      <div>
        <p className="flex items-center gap-2 font-medium">
          <span
            aria-hidden
            className="inline-block size-2.5 rounded-full"
            style={{ background: color }}
          />
          {BAND_LABEL[band]}
        </p>
        <p className="mt-1 max-w-[16rem] text-sm text-muted-foreground">
          {band === "calibrating"
            ? "Needs 14 days of HRV or resting-HR history to score."
            : "Scored against your own 60-day baselines."}
        </p>
      </div>
    </div>
  );
}

"use client";

import type { ComponentScores } from "@/lib/readiness";

interface Props {
  components: ComponentScores;
}

const ROWS: Array<{
  key: keyof ComponentScores;
  label: string;
  weight: string;
}> = [
  { key: "hrv", label: "HRV", weight: "40%" },
  { key: "rhr", label: "Resting HR", weight: "25%" },
  { key: "sleep", label: "Sleep", weight: "20%" },
  { key: "form", label: "Form (TSB)", weight: "15%" },
];

export function ReadinessBreakdown({ components }: Props) {
  return (
    <ul className="grid gap-2.5">
      {ROWS.map(({ key, label, weight }) => {
        const score = components[key];
        return (
          <li
            key={key}
            className="grid grid-cols-[7.5rem_1fr_2.5rem] items-center gap-3"
          >
            <span className="text-sm text-muted-foreground">
              {label}
              <span className="ml-1 text-xs opacity-60">{weight}</span>
            </span>
            <div className="h-1.5 rounded-full bg-border">
              {score != null && (
                <div
                  className="h-full rounded-full bg-[var(--viz-series-1)]"
                  style={{ width: `${score}%` }}
                />
              )}
            </div>
            <span className="text-right text-sm tabular-nums">
              {score != null ? Math.round(score) : "—"}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

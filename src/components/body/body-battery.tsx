"use client";

import type { BatteryPoint, BodyBatteryCheckpoint } from "@/lib/body-battery";
import type { Figure } from "@/lib/uncertainty";
import { unavailableMessage } from "@/components/ui/unavailable";

interface Props {
  /** Current charge 0-100, or why the model can't run yet. */
  current: Figure<number>;
  /** The modelled curve. Empty when current is null. */
  points: BatteryPoint[];
  /** Deterministic labels derived from the day shape. */
  tags: string[];
  /** Morning/midday/evening readouts derived from the curve. */
  checkpoints: BodyBatteryCheckpoint[];
}

const VIEW_W = 400;
const VIEW_H = 180;
const MINUTES_PER_DAY = 1440;

/** The day-shape tag pills. Was duplicated in both render branches. */
function BatteryTags({ tags }: { tags: string[] }) {
  if (tags.length === 0) return null;
  return (
    <div className="mt-4 flex flex-wrap gap-2">
      {tags.map((tag) => (
        <span
          key={tag}
          className="rounded-full border border-hairline bg-surface-overlay px-2.5 py-1 text-label font-bold uppercase tracking-[0.18em] text-ink-secondary"
        >
          {tag}
        </span>
      ))}
    </div>
  );
}

function toPath(points: BatteryPoint[]): string {
  return points
    .map((p, i) => {
      const x = (p.minutes / MINUTES_PER_DAY) * VIEW_W;
      const y = VIEW_H - (p.charge / 100) * VIEW_H;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
}

/**
 * Estimated energy through the day — a labelled model, not a measurement.
 * Renders nothing rather than inventing a curve when readiness is unavailable.
 */
export function BodyBatteryCurve({
  current,
  points,
  tags,
  checkpoints,
}: Props) {
  if (!current.available || points.length === 0) {
    return (
      <div className="glass rounded-[2rem] p-7">
        <span className="label-micro">Estimated Energy</span>
        <p className="mt-4 text-caption text-ink-muted">
          {current.available
            ? "Not enough data yet."
            : unavailableMessage(current)}
        </p>
        <BatteryTags tags={tags} />
      </div>
    );
  }

  const path = toPath(points);
  const lastX = ((points.at(-1)?.minutes ?? 0) / MINUTES_PER_DAY) * VIEW_W;
  const fillPath = `${path} L${lastX.toFixed(1)} ${VIEW_H} L0 ${VIEW_H} Z`;

  return (
    <div className="glass rounded-[2rem] p-7 overflow-hidden">
      <div className="mb-1 flex items-center justify-between">
        <span className="label-micro">Estimated Energy</span>
        <span className="text-caption font-bold text-ink-secondary">
          {current.value}% now
        </span>
      </div>
      <p className="mb-6 text-label text-ink-muted">
        Modelled from readiness and training load
      </p>
      <div className="mb-4">
        <BatteryTags tags={tags} />
      </div>
      <div className="relative h-[180px] w-full">
        <svg
          viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
          preserveAspectRatio="none"
          className="clip-reveal h-full w-full"
        >
          <defs>
            <linearGradient id="energy-grad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--chart-3)" stopOpacity="0.3" />
              <stop offset="100%" stopColor="var(--chart-3)" stopOpacity="0" />
            </linearGradient>
          </defs>
          <path
            d={path}
            fill="none"
            stroke="var(--chart-3)"
            strokeWidth="3"
            strokeLinecap="round"
          />
          <path d={fillPath} fill="url(#energy-grad)" />
        </svg>
      </div>
      {checkpoints.length > 0 && (
        <div className="mt-4 grid grid-cols-3 gap-2">
          {checkpoints.map((checkpoint) => (
            <div
              key={checkpoint.label}
              className="rounded-2xl border border-hairline bg-surface-overlay px-3 py-2"
            >
              <div className="text-label uppercase tracking-[0.16em] text-ink-muted">
                {checkpoint.label}
              </div>
              <div className="mt-1 text-caption font-bold text-ink-secondary">
                {checkpoint.charge}%
              </div>
            </div>
          ))}
        </div>
      )}
      <div className="mt-4 flex justify-between text-label font-bold uppercase tracking-widest text-ink-muted">
        <span>12 AM</span>
        <span>6 AM</span>
        <span>12 PM</span>
        <span>6 PM</span>
        <span>12 AM</span>
      </div>
    </div>
  );
}

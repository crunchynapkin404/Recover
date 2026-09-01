import { CHART_TOKENS } from "@/lib/charts";
import type { ProfileBar } from "@/lib/interval/render-profile";

/** The tallest target the chart draws to. Above this a bar is clipped flat. */
const CEILING_PCT = 130;

/**
 * The interval shape of a structured workout.
 *
 * ONE SERIES, HEIGHT CARRYING INTENSITY, rather than a zone palette. A
 * seven-colour zone scale would be seven design decisions with no guard behind
 * any of them, and the shape of a session is legible from its silhouette — the
 * thing an athlete reads off a profile is where the hard parts are and how long
 * they last, not which named zone they sit in. The numbers are in the
 * description directly beneath.
 *
 * The accessible name is the derived description, so it cannot drift from the
 * bars: both come from the same blocks.
 */
export function WorkoutProfile({
  bars,
  label,
}: {
  bars: ProfileBar[];
  label: string;
}) {
  if (bars.length === 0) return null;
  const y = (pct: number) =>
    40 - (Math.min(pct, CEILING_PCT) / CEILING_PCT) * 40;

  return (
    <svg
      data-workout-profile
      viewBox="0 0 100 40"
      preserveAspectRatio="none"
      className="mt-1.5 h-10 w-full"
      role="img"
      aria-label={label}
    >
      {bars.map((b, i) => {
        const x = b.x * 100;
        const w = b.w * 100;
        // A ramp is a trapezoid: its target climbs across the step, and drawing
        // it as a flat bar would show a 10-minute build as a 10-minute hold.
        return b.ramp ? (
          <polygon
            key={i}
            points={`${x},40 ${x},${y(b.lo)} ${x + w},${y(b.hi)} ${x + w},40`}
            fill={CHART_TOKENS.series[6]}
          />
        ) : (
          <rect
            key={i}
            x={x}
            y={y((b.lo + b.hi) / 2)}
            width={w}
            height={40 - y((b.lo + b.hi) / 2)}
            fill={CHART_TOKENS.series[6]}
          />
        );
      })}
    </svg>
  );
}

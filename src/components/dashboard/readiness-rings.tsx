import { AnimatedCounter } from "@/components/dashboard/animated-counter";

export interface MetricRing {
  label: string;
  value: number; // 0–100 (clamped)
  color: string; // any CSS color
  calibrating?: boolean; // no honest value yet → track only, no fill
}

interface Props {
  readiness: number;
  /** Colour of the centre readiness number (the band colour). */
  readinessColor: string;
  readinessCalibrating?: boolean;
  /** Metric rings, outer → inner. */
  rings: MetricRing[];
}

const SIZE = 200;
const CENTER = SIZE / 2;
const STROKE = 10;
// Outer → inner radii, matched to `rings` order.
const RADII = [88, 70, 52];

/**
 * Concentric readiness hero: the readiness score in the centre, nested metric
 * rings around it (Apple-Watch style). Each ring fills to its real value and
 * draws in via the `.ring-fill` CSS animation; a calibrating ring shows only
 * its empty track. No client state — the animation is pure CSS.
 */
export function ReadinessRings({
  readiness,
  readinessColor,
  readinessCalibrating,
  rings,
}: Props) {
  return (
    <div className="relative h-56 w-56 sm:h-60 sm:w-60">
      {/* Ambient band glow */}
      <div
        className="hero-pulse absolute inset-0 rounded-full blur-3xl"
        style={{ background: `${readinessColor}20` }}
      />
      {/* Glass medallion behind the centre number */}
      <div
        className="absolute top-1/2 left-1/2 h-24 w-24 -translate-x-1/2 -translate-y-1/2 rounded-full"
        style={{
          background: "rgba(255,255,255,0.04)",
          backdropFilter: "blur(8px)",
          WebkitBackdropFilter: "blur(8px)",
        }}
      />
      <svg
        aria-hidden
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        className="relative h-full w-full -rotate-90"
      >
        {rings.map((ring, i) => {
          const r = RADII[i] ?? RADII[RADII.length - 1];
          const circ = 2 * Math.PI * r;
          const filled = Math.max(0, Math.min(100, ring.value));
          const targetOffset = circ - (circ * filled) / 100;
          return (
            <g key={ring.label}>
              <circle
                cx={CENTER}
                cy={CENTER}
                r={r}
                fill="none"
                stroke="rgba(255,255,255,0.07)"
                strokeWidth={STROKE}
              />
              {!ring.calibrating && (
                <circle
                  cx={CENTER}
                  cy={CENTER}
                  r={r}
                  fill="none"
                  stroke={ring.color}
                  strokeWidth={STROKE}
                  strokeLinecap="round"
                  strokeDasharray={circ}
                  strokeDashoffset={targetOffset}
                  className="ring-fill"
                  style={
                    {
                      "--ring-circ": circ,
                      "--ring-offset": targetOffset,
                    } as React.CSSProperties
                  }
                />
              )}
            </g>
          );
        })}
      </svg>
      {/* Centre readiness number */}
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span
          aria-hidden
          className="text-5xl font-bold tracking-tighter sm:text-6xl"
          style={{
            color: readinessCalibrating
              ? "rgba(255,255,255,0.4)"
              : readinessColor,
          }}
        >
          {readinessCalibrating ? (
            "—"
          ) : (
            <AnimatedCounter target={Math.round(readiness)} />
          )}
        </span>
        <span aria-hidden className="label-micro mt-1">
          Readiness
        </span>
        <span className="sr-only">
          {`Readiness ${
            readinessCalibrating ? "calibrating" : Math.round(readiness)
          }`}
        </span>
      </div>
    </div>
  );
}

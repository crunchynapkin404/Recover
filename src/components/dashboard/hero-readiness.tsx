import { ReadinessRings } from "@/components/dashboard/readiness-rings";
import { HeroCard } from "@/components/ui/hero-card";
import type { Band } from "@/lib/readiness";

interface Props {
  readiness: number;
  band: Band;
  recoveryScore: number;
  strainFraction: number;
  sleepScore: number | null;
  loadCalibrating: boolean;
  loadComputed: boolean;
}

// The centre readiness number is keyed to the band; each ring to its own
// metric. Nothing here invents a value — a ring fills to the real number and
// stays an empty track (with "—" in the legend) when there is no honest value.
const BAND_VISUAL: Record<
  Band,
  { start: string; glow: string; headline: string }
> = {
  green: {
    start: "#10b981",
    glow: "rgba(16,185,129,0.45)",
    headline: "Optimal Recovery",
  },
  amber: {
    start: "#f59e0b",
    glow: "rgba(245,158,11,0.4)",
    headline: "Moderate Recovery",
  },
  red: {
    start: "#ef4444",
    glow: "rgba(239,68,68,0.4)",
    headline: "Low Recovery",
  },
  calibrating: {
    start: "rgba(255,255,255,0.4)",
    glow: "rgba(255,255,255,0.12)",
    headline: "Calibrating",
  },
};

// Ring identity colours — all from existing design tokens.
const RECOVERY_COLOR = "#10b981"; // emerald
const SLEEP_COLOR = "#3b82f6"; // blue (--viz-series-1)
const STRAIN_COLOR = "#f59e0b"; // amber

export function HeroReadiness({
  readiness,
  band,
  recoveryScore,
  strainFraction,
  sleepScore,
  loadCalibrating,
  loadComputed,
}: Props) {
  const v = BAND_VISUAL[band];

  const legend = [
    {
      label: "Recovery",
      color: RECOVERY_COLOR,
      value: loadCalibrating ? "—" : Math.round(recoveryScore),
    },
    {
      label: "Sleep",
      color: SLEEP_COLOR,
      value: sleepScore != null ? Math.round(sleepScore) : "—",
    },
    {
      label: "Strain",
      color: STRAIN_COLOR,
      value: loadCalibrating ? "—" : Math.round(strainFraction),
    },
  ];

  return (
    <section className="mb-8 flex flex-col items-center">
      <HeroCard className="w-full" glowColor={v.glow}>
        {/* Rings + legend: stacked on mobile, side-by-side on wider screens */}
        <div className="flex flex-col items-center gap-6 md:flex-row md:justify-center md:gap-12">
          <ReadinessRings
            readiness={readiness}
            readinessColor={v.start}
            readinessCalibrating={band === "calibrating"}
            rings={[
              {
                label: "Recovery",
                value: recoveryScore,
                color: RECOVERY_COLOR,
                calibrating: loadCalibrating,
              },
              {
                label: "Sleep",
                value: sleepScore ?? 0,
                color: SLEEP_COLOR,
                calibrating: sleepScore == null,
              },
              {
                label: "Strain",
                value: strainFraction,
                color: STRAIN_COLOR,
                calibrating: loadCalibrating,
              },
            ]}
          />

          {/* Legend — labels the ring colours and shows exact values */}
          <div className="flex flex-row flex-wrap justify-center gap-4 md:flex-col md:gap-4">
            {legend.map((m) => (
              <div key={m.label} className="flex items-center gap-2.5">
                <span
                  className="h-2.5 w-2.5 rounded-full"
                  style={{ backgroundColor: m.color }}
                  aria-hidden
                />
                <span className="text-sm font-medium text-white/70">
                  {m.label}
                </span>
                <span className="text-sm font-bold text-white">{m.value}</span>
              </div>
            ))}
          </div>
        </div>

        <p className="mt-6 text-xl font-bold tracking-tight text-white">
          {v.headline}
        </p>
        {band !== "calibrating" && (
          <p
            className={`mt-1 flex items-center gap-1.5 text-[13px] font-medium ${
              band === "green"
                ? "text-emerald-400"
                : band === "amber"
                  ? "text-amber-400"
                  : "text-red-400"
            }`}
          >
            {band === "green" && "✓ Recovery strong · Ready for intensity"}
            {band === "amber" && "⚡ Moderate recovery · Consider easy work"}
            {band === "red" && "⚠ Low recovery · Prioritize rest"}
          </p>
        )}
      </HeroCard>
      {loadComputed && !loadCalibrating && (
        <p className="mt-3 text-[10px] font-bold uppercase tracking-widest text-white/50">
          Load computed from your sessions
        </p>
      )}
    </section>
  );
}

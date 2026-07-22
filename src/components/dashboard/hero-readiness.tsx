import { ScoreRing } from "@/components/dashboard/score-ring";
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

// The central ring is keyed to the readiness band; each satellite to its own
// metric. Nothing here invents a value — every arc fills to the real number,
// and a ring shows "—" on an empty track when there is no honest value yet.
const BAND_VISUAL: Record<
  Band,
  { start: string; end: string; glow: string; headline: string }
> = {
  green: {
    start: "#10b981",
    end: "#84cc16",
    glow: "rgba(16,185,129,0.45)",
    headline: "Optimal Recovery",
  },
  amber: {
    start: "#f59e0b",
    end: "#fbbf24",
    glow: "rgba(245,158,11,0.4)",
    headline: "Moderate Recovery",
  },
  red: {
    start: "#ef4444",
    end: "#fb7185",
    glow: "rgba(239,68,68,0.4)",
    headline: "Low Recovery",
  },
  calibrating: {
    start: "rgba(255,255,255,0.3)",
    end: "rgba(255,255,255,0.3)",
    glow: "rgba(255,255,255,0.12)",
    headline: "Calibrating",
  },
};

// Satellite identity colours — all from existing design tokens.
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

  return (
    <section className="mb-8 flex flex-col items-center">
      <HeroCard className="w-full" glowColor={v.glow}>
        {/* Constellation: central readiness ring + 3 satellite metric rings.
            Flanking on md+, reflows to a row of three on narrow screens. */}
        <div className="relative flex w-full max-w-md flex-col items-center md:block md:h-96">
          <div className="md:absolute md:top-1/2 md:left-1/2 md:-translate-x-1/2 md:-translate-y-1/2">
            <ScoreRing
              value={readiness}
              label="Readiness"
              color={v.start}
              colorEnd={v.end}
              size="lg"
            />
          </div>
          <div className="mt-6 grid w-full grid-cols-3 gap-4 md:mt-0 md:contents">
            <div className="flex justify-center md:absolute md:top-0 md:left-0">
              <ScoreRing
                value={recoveryScore}
                label="Recovery"
                color={RECOVERY_COLOR}
                size="sm"
                calibrating={loadCalibrating}
              />
            </div>
            <div className="flex justify-center md:absolute md:top-0 md:right-0">
              <ScoreRing
                value={sleepScore ?? 0}
                label="Sleep"
                color={SLEEP_COLOR}
                size="sm"
                calibrating={sleepScore == null}
              />
            </div>
            <div className="flex justify-center md:absolute md:bottom-0 md:left-1/2 md:-translate-x-1/2">
              <ScoreRing
                value={strainFraction}
                label="Strain"
                color={STRAIN_COLOR}
                size="sm"
                calibrating={loadCalibrating}
              />
            </div>
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

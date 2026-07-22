import { ScoreRing } from "@/components/dashboard/score-ring";
import { HeroCard } from "@/components/ui/hero-card";
import { GlassTile } from "@/components/ui/glass-tile";
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

// All visuals below are keyed to the one real signal — the readiness band.
// Nothing here invents a value; width comes from the real metric, color from
// the band the score already resolved to.
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
        <ScoreRing
          value={readiness}
          label="Readiness"
          color={v.start}
          colorEnd={v.end}
          size="lg"
        />
        <p className="mt-5 text-xl font-bold tracking-tight text-white">
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
      <div className="mt-4 grid w-full grid-cols-3 gap-3">
        <GlassTile
          className="text-center"
          label="Recovery"
          value={loadCalibrating ? "—" : `${Math.round(recoveryScore)}%`}
          bar={
            loadCalibrating
              ? undefined
              : { value: recoveryScore, color: v.start }
          }
        />
        <GlassTile
          className="text-center"
          label="Sleep"
          value={sleepScore != null ? Math.round(sleepScore) : "—"}
          bar={
            sleepScore != null
              ? { value: sleepScore, color: v.start }
              : undefined
          }
        />
        <GlassTile
          className="text-center"
          label="Strain"
          value={loadCalibrating ? "—" : `${Math.round(strainFraction)}%`}
          bar={
            loadCalibrating
              ? undefined
              : { value: strainFraction, color: v.start }
          }
        />
      </div>
      {loadComputed && !loadCalibrating && (
        <p className="mt-3 text-[10px] font-bold uppercase tracking-widest text-white/50">
          Load computed from your sessions
        </p>
      )}
    </section>
  );
}

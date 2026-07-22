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

export function HeroReadiness({
  readiness,
  band,
  recoveryScore,
  strainFraction,
  sleepScore,
  loadCalibrating,
  loadComputed,
}: Props) {
  return (
    <section className="mb-8 flex flex-col items-center">
      <HeroCard className="w-full">
        <ScoreRing
          value={readiness}
          label="Readiness"
          color={
            band === "green"
              ? "#10b981"
              : band === "amber"
                ? "#f59e0b"
                : band === "red"
                  ? "#ef4444"
                  : "rgba(255,255,255,0.3)"
          }
          size="lg"
        />
        {band !== "calibrating" && (
          <p
            className={`mt-4 flex items-center gap-1.5 text-[13px] font-medium ${
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
        />
        <GlassTile
          className="text-center"
          label="Sleep"
          value={sleepScore != null ? Math.round(sleepScore) : "—"}
        />
        <GlassTile
          className="text-center"
          label="Strain"
          value={loadCalibrating ? "—" : `${Math.round(strainFraction)}%`}
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

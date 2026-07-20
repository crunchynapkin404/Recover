import { ScoreRing } from "@/components/dashboard/score-ring";
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
      <div className="mt-6 grid grid-cols-3 gap-3 self-stretch">
        <div className="glass rounded-2xl p-4 text-center">
          <span className="mb-1 block text-[9px] font-bold uppercase tracking-widest text-white/30">
            Recovery
          </span>
          <span className="text-xl font-bold text-white">
            {loadCalibrating ? "—" : `${Math.round(recoveryScore)}%`}
          </span>
        </div>
        <div className="glass rounded-2xl p-4 text-center">
          <span className="mb-1 block text-[9px] font-bold uppercase tracking-widest text-white/30">
            Sleep
          </span>
          <span className="text-xl font-bold text-white">
            {sleepScore != null ? Math.round(sleepScore) : "—"}
          </span>
        </div>
        <div className="glass rounded-2xl p-4 text-center">
          <span className="mb-1 block text-[9px] font-bold uppercase tracking-widest text-white/30">
            Strain
          </span>
          <span className="text-xl font-bold text-white">
            {loadCalibrating ? "—" : `${Math.round(strainFraction)}%`}
          </span>
        </div>
      </div>
      {loadComputed && !loadCalibrating && (
        <p className="mt-3 text-[10px] font-bold uppercase tracking-widest text-white/40">
          Load computed from your sessions
        </p>
      )}
      {band !== "calibrating" && (
        <p
          className={`mt-2 flex items-center gap-1.5 text-[13px] font-medium ${
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
    </section>
  );
}

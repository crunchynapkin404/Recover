interface Props {
  consistency: { score: number; sampleNights: number } | null;
  chronotype: {
    midpointHhMm: string;
    socialJetlagMins: number;
  } | null;
}

function consistencyReading(score: number): string {
  if (score >= 85) return "Very regular";
  if (score >= 70) return "Fairly regular";
  if (score >= 50) return "Somewhat irregular";
  return "Irregular — try anchoring your wake time";
}

function jetlagReading(mins: number): string {
  if (mins < 30) return "Barely any social jetlag";
  if (mins < 60) return "Mild social jetlag";
  return "Notable social jetlag — weekends shift your clock";
}

/**
 * Sleep regularity + chronotype (v0.12). Each half renders only when its
 * gated engine value exists (enough real bed/wake nights); the card as a
 * whole is mounted by the dashboard only when at least one is present.
 */
export function SleepQualityCard({ consistency, chronotype }: Props) {
  return (
    <div className="glass rounded-[2rem] p-7">
      <span className="label-micro">Sleep Quality</span>

      {consistency && (
        <div className="mt-4">
          <div className="flex items-baseline justify-between">
            <span className="text-sm text-white/60">Consistency</span>
            <span className="text-2xl font-bold tabular-nums text-white">
              {consistency.score}
              <span className="ml-1 text-sm font-normal text-white/40">
                /100
              </span>
            </span>
          </div>
          <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-white/5">
            <div
              className="h-full rounded-full bg-emerald-500"
              style={{ width: `${consistency.score}%` }}
            />
          </div>
          <p className="mt-2 text-[11px] text-white/50">
            {consistencyReading(consistency.score)} · {consistency.sampleNights}{" "}
            nights
          </p>
        </div>
      )}

      {chronotype && (
        <div className="mt-5 border-t border-white/5 pt-4">
          <div className="flex items-baseline justify-between">
            <span className="text-sm text-white/60">Sleep midpoint</span>
            <span className="text-lg font-bold tabular-nums text-white">
              {chronotype.midpointHhMm}
            </span>
          </div>
          <p className="mt-1 text-[11px] text-white/50">
            {jetlagReading(chronotype.socialJetlagMins)} (
            {chronotype.socialJetlagMins} min)
          </p>
        </div>
      )}
    </div>
  );
}

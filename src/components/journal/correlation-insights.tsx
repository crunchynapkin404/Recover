import { BrainCircuit } from "lucide-react";

interface Correlation {
  emoji: string;
  behavior: string;
  impact: string; // e.g. "+11%" or "-18%"
  positive: boolean;
  events: number;
}

interface Props {
  correlations: Correlation[];
}

export function CorrelationInsights({ correlations }: Props) {
  if (correlations.length === 0) return null;

  return (
    <div className="glass rounded-[2rem] border-emerald-500/20 p-6">
      <div className="mb-4 flex items-center gap-2">
        <BrainCircuit className="size-4 text-emerald-400" />
        <h3 className="label-micro">90-Day Correlations</h3>
      </div>

      <div className="space-y-4">
        {correlations.map((c) => (
          <div key={c.behavior} className="flex items-center gap-3">
            <div className="glass flex h-10 w-10 items-center justify-center rounded-xl text-xl">
              {c.emoji}
            </div>
            <div className="flex-1">
              <div className="mb-0.5 flex items-baseline justify-between">
                <span className="text-xs font-bold">{c.behavior}</span>
                <span
                  className={`text-xs font-bold ${c.positive ? "text-emerald-400" : "text-red-400"}`}
                >
                  {c.impact}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[9px] uppercase text-white/50">
                  Next-day readiness impact ({c.events} events)
                </span>
                <div className="flex gap-0.5">
                  {[0, 1, 2].map((i) => (
                    <div
                      key={i}
                      className={`h-2 w-1 rounded-full ${
                        i < Math.ceil(Math.abs(parseFloat(c.impact)) / 10)
                          ? c.positive
                            ? "bg-emerald-400"
                            : "bg-red-400"
                          : c.positive
                            ? "bg-emerald-400/20"
                            : "bg-red-400/20"
                      }`}
                    />
                  ))}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

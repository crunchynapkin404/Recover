import { BrainCircuit } from "lucide-react";
import type { SplitInsight, TagInsight } from "@/lib/insights/correlations";

function impactLabel(impactPct: number, ciHalfWidthPct: number): string {
  return `${impactPct > 0 ? "+" : ""}${impactPct}% ± ${ciHalfWidthPct}`;
}

function SplitRow({
  label,
  split,
}: {
  label: string;
  split: SplitInsight | null;
}) {
  return (
    <div className="flex items-center justify-between text-[10px]">
      <span className="uppercase text-white/50">{label}</span>
      {split == null ? (
        <span className="text-white/40">not enough data</span>
      ) : split.conclusive ? (
        <span
          className={split.impactPct > 0 ? "text-emerald-400" : "text-red-400"}
        >
          {impactLabel(split.impactPct, split.ciHalfWidthPct)} · {split.events}{" "}
          events
        </span>
      ) : (
        <span className="text-white/40">
          inconclusive · {split.events} events
        </span>
      )}
    </div>
  );
}

export function CorrelationInsights({ insights }: { insights: TagInsight[] }) {
  if (insights.length === 0) return null;

  return (
    <div className="glass rounded-[2rem] border-emerald-500/20 p-6">
      <div className="mb-4 flex items-center gap-2">
        <BrainCircuit className="size-4 text-emerald-400" />
        <h3 className="label-micro">90-Day Correlations</h3>
      </div>

      <div className="space-y-2">
        {insights.map((c) => (
          <details key={c.behavior} className="group">
            <summary className="flex cursor-pointer list-none items-center gap-3 py-1.5">
              <div className="glass flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-xl">
                {c.emoji}
              </div>
              <div className="flex-1">
                <div className="mb-0.5 flex items-baseline justify-between">
                  <span
                    className={`text-xs font-bold ${c.conclusive ? "" : "text-white/50"}`}
                  >
                    {c.behavior}
                    {c.auto && (
                      <span className="ml-1.5 rounded bg-white/10 px-1 py-px align-middle text-[8px] font-medium uppercase tracking-wider text-white/50">
                        auto
                      </span>
                    )}
                  </span>
                  {c.conclusive ? (
                    <span
                      className={`text-xs font-bold ${c.impactPct > 0 ? "text-emerald-400" : "text-red-400"}`}
                    >
                      {impactLabel(c.impactPct, c.ciHalfWidthPct)}
                    </span>
                  ) : (
                    <span className="text-xs text-white/40">inconclusive</span>
                  )}
                </div>
                <span className="text-[9px] uppercase text-white/50">
                  Next-day readiness impact ({c.events} events)
                </span>
              </div>
            </summary>
            <div className="mt-1 space-y-1 pb-1 pl-[52px]">
              <SplitRow label="Weekdays" split={c.splits.weekday} />
              <SplitRow label="Weekends" split={c.splits.weekend} />
            </div>
          </details>
        ))}
      </div>
    </div>
  );
}

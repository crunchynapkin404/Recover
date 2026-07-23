import type { BioAgeResult, BioAgeInsufficient } from "@/lib/biological-age";

interface Props {
  bioAge: BioAgeResult | BioAgeInsufficient;
  biomarkerCount: number;
  /** ISO date of the most recent draw, or null when there's been none. */
  lastDraw: string | null;
}

function drawLabel(iso: string): string {
  return new Date(iso + "T00:00:00").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

/**
 * The two Labs headline tiles (1g). Biological age keeps its honest
 * insufficient state — an estimate that can't be made says so rather than
 * printing a number, and the full breakdown stays in BioAgeCard below.
 */
export function LabsTiles({ bioAge, biomarkerCount, lastDraw }: Props) {
  const insufficient = "insufficient" in bioAge;
  const delta = insufficient ? null : bioAge.deltaYears;

  return (
    <div className="mb-3 grid grid-cols-2 gap-2">
      <div className="rounded-[16px] border border-white/[0.09] bg-white/[0.04] px-3.5 py-3">
        <p className="text-[8.5px] font-bold uppercase tracking-[0.15em] text-white/40">
          Biological age
        </p>
        {insufficient ? (
          <p className="mt-2 text-[11px] text-white/50">
            Not enough inputs yet
          </p>
        ) : (
          <p className="mt-1.5 flex items-baseline gap-2">
            <span className="font-mono text-[22px] font-bold leading-none text-white">
              {Math.round(bioAge.bioAge)}
            </span>
            {delta != null && (
              <span
                className={`font-mono text-[11px] font-bold ${
                  delta < 0 ? "text-emerald-400" : "text-white/50"
                }`}
              >
                {delta < 0 ? "▼" : "▲"} {Math.abs(delta).toFixed(1)} yr
              </span>
            )}
          </p>
        )}
      </div>

      <div className="rounded-[16px] border border-white/[0.09] bg-white/[0.04] px-3.5 py-3">
        <p className="text-[8.5px] font-bold uppercase tracking-[0.15em] text-white/40">
          Labs
        </p>
        <p className="mt-1.5 text-[12.5px] font-semibold text-white">
          {biomarkerCount} biomarker{biomarkerCount === 1 ? "" : "s"}
        </p>
        <p className="mt-0.5 text-[10.5px] text-white/45">
          {lastDraw ? `last draw ${drawLabel(lastDraw)}` : "no draw recorded"}
        </p>
      </div>
    </div>
  );
}

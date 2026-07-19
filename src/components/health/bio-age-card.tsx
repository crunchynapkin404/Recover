import type { BioAgeResult, BioAgeInsufficient } from "@/lib/biological-age";

interface Props {
  result: BioAgeResult | BioAgeInsufficient;
}

/**
 * Biological-age card (v0.13). Shows the estimate and its component
 * offsets, or an honest insufficient-inputs state listing what's missing —
 * never an invented number.
 */
export function BioAgeCard({ result }: Props) {
  if ("insufficient" in result) {
    return (
      <div className="glass rounded-[2rem] p-6">
        <span className="label-micro">Biological Age</span>
        <p className="mt-3 text-sm text-white/70">Not enough inputs yet.</p>
        <p className="mt-2 text-[11px] text-white/50">
          Add:{" "}
          {result.missing.length > 0 ? result.missing.join(", ") : "more data"}.
        </p>
      </div>
    );
  }

  const younger = result.deltaYears < 0;
  return (
    <div className="glass rounded-[2rem] p-6">
      <span className="label-micro">Biological Age</span>
      <div className="mt-3 flex items-baseline gap-3">
        <span className="text-4xl font-bold tabular-nums text-white">
          {result.bioAge}
        </span>
        <span
          className={`text-sm font-bold ${younger ? "text-emerald-400" : "text-amber-400"}`}
        >
          {younger ? "▼" : "▲"} {Math.abs(result.deltaYears)} yr
          {younger ? " younger" : " older"}
        </span>
      </div>
      <div className="mt-4 space-y-1">
        {result.components.map((c) => (
          <div
            key={c.key}
            className="flex items-center justify-between text-[11px]"
          >
            <span className="text-white/50">{c.label}</span>
            <span
              className={`tabular-nums ${c.offsetYears < 0 ? "text-emerald-400" : c.offsetYears > 0 ? "text-amber-400" : "text-white/40"}`}
            >
              {c.offsetYears > 0 ? "+" : ""}
              {c.offsetYears} yr
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

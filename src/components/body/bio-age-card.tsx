import type { BioAgeResult } from "@/lib/biological-age";
import type { Figure } from "@/lib/uncertainty";
import { unavailableMessage } from "@/components/ui/unavailable";

interface Props {
  result: Figure<BioAgeResult>;
  /**
   * Drops the headline figure, leaving only what drives it. Body's Labs
   * segment shows the estimate in its own tile, and printing the same age
   * twice on one screen is clutter.
   */
  hideHeadline?: boolean;
}

/**
 * Biological-age card (v0.13). Shows the estimate and its component
 * offsets, or an honest missing-input state naming what's needed — never
 * an invented number.
 */
export function BioAgeCard({ result, hideHeadline = false }: Props) {
  if (!result.available) {
    return (
      <div className="glass rounded-[2rem] p-6">
        <span className="label-micro">
          {hideHeadline ? "What's missing" : "Biological Age"}
        </span>
        {/* The tile above already says the estimate can't be made — don't
            say it twice, just say what would fix it. */}
        {!hideHeadline && (
          <p className="mt-3 text-sm text-white/70">Not enough inputs yet.</p>
        )}
        <p className="mt-2 text-[11px] text-white/50">
          {unavailableMessage(result)}
        </p>
      </div>
    );
  }

  const bioAge = result.value;
  const younger = bioAge.deltaYears < 0;
  return (
    <div className="glass rounded-[2rem] p-6">
      <span className="label-micro">
        {hideHeadline ? "What's driving it" : "Biological Age"}
      </span>
      {!hideHeadline && (
        <div className="mt-3 flex items-baseline gap-3">
          <span className="text-4xl font-bold tabular-nums text-white">
            {bioAge.bioAge}
          </span>
          <span
            className={`text-sm font-bold ${younger ? "text-emerald-400" : "text-amber-400"}`}
          >
            {younger ? "▼" : "▲"} {Math.abs(bioAge.deltaYears)} yr
            {younger ? " younger" : " older"}
          </span>
        </div>
      )}
      <div className="mt-4 space-y-1">
        {bioAge.components.map((c) => (
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

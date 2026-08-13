import type { BioAgeResult } from "@/lib/biological-age";
import type { Figure } from "@/lib/uncertainty";
import { unavailableMessage } from "@/components/ui/unavailable";
import { BioAgeCard } from "@/components/body/bio-age-card";

interface Props {
  bioAge: Figure<BioAgeResult>;
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
 * missing-input state — an estimate that can't be made says so rather than
 * printing a number, and the full breakdown stays in BioAgeCard below.
 */
export function LabsTiles({ bioAge, biomarkerCount, lastDraw }: Props) {
  const delta = bioAge.available ? bioAge.value.deltaYears : null;

  return (
    <div className="mb-3 grid grid-cols-2 gap-2">
      <div className="glass rounded-[16px] px-3.5 py-3">
        <p className="label-micro">Biological age</p>
        {!bioAge.available ? (
          <p className="mt-2 text-caption text-ink-muted">
            {unavailableMessage(bioAge)}
          </p>
        ) : (
          <p className="mt-1.5 flex items-baseline gap-2">
            <span className="font-numeric text-title font-bold leading-none text-ink-primary">
              {Math.round(bioAge.value.bioAge)}
            </span>
            {delta != null && (
              <span
                className={`font-numeric text-label font-bold ${
                  delta < 0 ? "text-chart-2" : "text-ink-muted"
                }`}
              >
                {delta < 0 ? "▼" : "▲"} {Math.abs(delta).toFixed(1)} yr
              </span>
            )}
          </p>
        )}
      </div>

      <div className="glass rounded-[16px] px-3.5 py-3">
        <p className="label-micro">Labs</p>
        <p className="mt-1.5 text-caption font-semibold text-ink-primary">
          {`${biomarkerCount} biomarker${biomarkerCount === 1 ? "" : "s"}`}
        </p>
        <p className="mt-0.5 text-label text-ink-muted">
          {lastDraw ? `last draw ${drawLabel(lastDraw)}` : "no draw recorded"}
        </p>
      </div>
    </div>
  );
}

/**
 * The Labs headline (F2, v0.102 task 12, browser pass): the two summary
 * tiles, plus the bio-age breakdown card — but only when there's an
 * estimate to break down. `unavailableMessage(bioAge)` is a single string;
 * calling it from both `LabsTiles` and `BioAgeCard` printed the identical
 * sentence twice, adjacent, on the missing-input path (Task 11's duplicate
 * scan checked the bio-age *figure* renders once and missed that the
 * *sentence* does not). In the unavailable case `BioAgeCard` has nothing to
 * add — no components to break down — so it's skipped rather than shown
 * with hideHeadline; the tile above already names what's missing. In the
 * available case both render, same as before: the tile carries the figure,
 * the card (hideHeadline) carries the component offsets that drive it.
 */
export function LabsHeadline(props: Props) {
  return (
    <>
      <LabsTiles {...props} />
      {props.bioAge.available && (
        <BioAgeCard result={props.bioAge} hideHeadline />
      )}
    </>
  );
}

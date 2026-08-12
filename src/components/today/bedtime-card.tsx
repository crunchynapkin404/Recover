import type { SleepDebtResult } from "@/lib/sleep-debt";
import { ConfidenceChip } from "@/components/ui/confidence-chip";

interface Props {
  /** "22:45" from sleepDebtFrom; null when it has no anchor to compute one. */
  bedtime: string | null;
  /** Wider than Confidence: sleepDebtFrom can also say "none". */
  confidence: SleepDebtResult["confidence"];
}

/**
 * The evening's closing block (v0.99 slice 1): tonight's bed-by target.
 *
 * `bedtime` is a field sleepDebtFrom already returns and Today already
 * computes — this block is a placement, not a new figure. No bedtime means
 * the model has no anchor for one (fewer than MIN_BEDTIME_SAMPLES real
 * bed-starts and no wake-time fallback), and the honest answer is silence.
 *
 * Carries no debt figure (I2, whole-branch review 2026-08-12): the vitals
 * Sleep tile already shows the same `formatSleepDebt(sleepDebt.debtSecs)`
 * under the same guard, and both blocks are in BLOCK_ORDER.evening — same
 * value, twice, one screen. This card's subject is the TIME to go to bed;
 * the debt belongs to the vital every state already shows.
 */
export function BedtimeCard({ bedtime, confidence }: Props) {
  if (!bedtime) return null;

  return (
    <section className="flex items-center justify-between gap-4 rounded-[20px] glass glass-no-hover p-4">
      <span className="font-numeric text-figure font-bold leading-none text-chart-1">
        {bedtime}
      </span>
      <span className="max-w-[60%] text-right text-caption text-ink-secondary">
        Bed by, to hold tonight&apos;s payback inside what one night can repay
        {confidence === "low" && (
          <span className="ml-1.5 inline-block align-middle">
            <ConfidenceChip level="low" />
          </span>
        )}
      </span>
    </section>
  );
}

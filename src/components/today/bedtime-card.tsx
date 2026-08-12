import type { SleepDebtResult } from "@/lib/sleep-debt";
import { ConfidenceChip } from "@/components/ui/confidence-chip";

interface Props {
  /** "22:45" from sleepDebtFrom; null when it has no anchor to compute one. */
  bedtime: string | null;
  debtSecs: number | null;
  /** Wider than Confidence: sleepDebtFrom can also say "none". */
  confidence: SleepDebtResult["confidence"];
}

/**
 * Sleep debt is a 14-night cumulative deficit, so it routinely runs to
 * hours. Minutes stay minutes while they read naturally; past 90 it
 * switches to hours rather than printing "debt 1359m".
 */
function fmtDebt(debtSecs: number): string {
  const mins = Math.round(debtSecs / 60);
  if (mins < 90) return `debt ${mins}m`;
  // Round to tenths-of-an-hour as an integer before dividing back to a
  // decimal string. `(mins / 60).toFixed(1)` looks equivalent but isn't:
  // for mins=1359, mins/60 is the double 22.649999999999998… (not exactly
  // representable), so toFixed rounds it down to "22.6" instead of the
  // mathematically correct "22.7". mins/6 lands exactly on the .5 boundary
  // when it matters, so Math.round resolves it correctly every time.
  const tenths = Math.round(mins / 6);
  return `debt ${(tenths / 10).toFixed(1)}h · 14d`;
}

/**
 * The evening's closing block (v0.99 slice 1): tonight's bed-by target.
 *
 * `bedtime` is a field sleepDebtFrom already returns and Today already
 * computes — this block is a placement, not a new figure. No bedtime means
 * the model has no anchor for one (fewer than MIN_BEDTIME_SAMPLES real
 * bed-starts and no wake-time fallback), and the honest answer is silence.
 */
export function BedtimeCard({ bedtime, debtSecs, confidence }: Props) {
  if (!bedtime) return null;
  const debt = debtSecs != null && debtSecs > 0 ? fmtDebt(debtSecs) : null;

  return (
    <section className="flex items-center justify-between gap-4 rounded-[20px] border border-hairline bg-surface-raised p-4">
      <span className="font-numeric text-figure font-bold leading-none text-chart-1">
        {bedtime}
      </span>
      <span className="max-w-[60%] text-right text-caption text-ink-secondary">
        Bed by, to hold tonight&apos;s payback inside what one night can repay
        {debt && ` · ${debt}`}
        {confidence === "low" && (
          <span className="ml-1.5 inline-block align-middle">
            <ConfidenceChip level="low" />
          </span>
        )}
      </span>
    </section>
  );
}

import Link from "next/link";
import type { Confidence, Figure } from "@/lib/uncertainty";
import { ConfidenceChip } from "@/components/ui/confidence-chip";
import { unavailableMessage } from "@/components/ui/unavailable";

export interface VitalTile {
  label: string;
  /** The reading, or why it isn't available yet. */
  value: Figure<string>;
  unit?: string;
  delta?: {
    text: string;
    tone: "good" | "warn" | "muted";
    /** Set only when the delta itself carries below-high confidence. */
    confidence?: Confidence;
  } | null;
  /** "" → no line drawn (fewer than two real points). */
  sparkPath: string;
  /** Tailwind stroke utility, e.g. "stroke-chart-2". */
  sparkClass: string;
  href: string;
}

const TONE: Record<"good" | "warn" | "muted", string> = {
  good: "text-chart-2",
  warn: "text-chart-3",
  muted: "text-ink-muted",
};

/**
 * Today's vitals — 2×2 whenever the row is narrow, one row of four once it
 * has room (3a). Replaces the RecoveryMetricsAccordion here. Each tile is a
 * tap target into Body's matching trend. Values are Geist Mono; calibrating
 * tiles show "—" with no sparkline (never an invented value).
 *
 * The four-across breakpoint is a CONTAINER query, not a viewport one (C2,
 * whole-branch review 2026-08-12). `lg:grid-cols-4` fired on viewport width
 * alone, but on desktop this grid sometimes sits in the morning state's 7fr
 * column (page.tsx's `lg:grid-cols-[7fr_5fr]` split) and sometimes in a full
 * single column (post-session/evening) — two very different widths behind
 * the exact same `lg` viewport breakpoint. At 1440px the 7fr column measures
 * ~613px; four 12px tiles there collide ("debt 8.6h ·" running into "14d",
 * "FORM · TSB" wrapping). A container query measures the space this grid
 * actually has, in either placement, instead of guessing from the viewport.
 * 700px sits above the widest the 7fr column reaches at any desktop viewport
 * (max-w-6xl caps it well under that) and below the narrowest the
 * single-column states offer at the lg breakpoint (~728px) — verified
 * against real captures, not just this arithmetic (see
 * .screenshots/slice1-fixes).
 */
export function VitalsGrid({ tiles }: { tiles: VitalTile[] }) {
  return (
    <div className="@container">
      <div className="grid grid-cols-2 gap-2 @min-[700px]:grid-cols-4">
        {tiles.map((t) => (
          <Link
            key={t.label}
            href={t.href}
            className="glass flex items-center justify-between rounded-xl px-3 py-2.5"
          >
            <div className="min-w-0">
              <div className="text-label font-bold uppercase tracking-wider text-ink-muted">
                {t.label}
              </div>
              <div
                className="mt-0.5 font-numeric text-title font-bold leading-none text-ink-primary"
                title={
                  t.value.available ? t.value.why : unavailableMessage(t.value)
                }
              >
                {t.value.available ? t.value.value : "—"}
                {t.unit && (
                  <span className="ml-0.5 text-caption font-normal text-ink-muted">
                    {t.unit}
                  </span>
                )}
                {!t.value.available && (
                  <span className="sr-only">{unavailableMessage(t.value)}</span>
                )}
                {t.value.available && t.value.why && (
                  <span className="sr-only">{t.value.why}</span>
                )}
              </div>
            </div>
            <div className="flex flex-col items-end gap-1">
              {t.delta && (
                <span
                  className={`flex items-center gap-1 text-label font-bold ${TONE[t.delta.tone]}`}
                >
                  {t.delta.text}
                  {t.delta.confidence && (
                    <ConfidenceChip level={t.delta.confidence} />
                  )}
                </span>
              )}
              {t.sparkPath && (
                <svg
                  aria-hidden
                  width={42}
                  height={14}
                  viewBox="0 0 100 20"
                  preserveAspectRatio="none"
                  className="sparkline-animate"
                >
                  <path
                    d={t.sparkPath}
                    fill="none"
                    className={t.sparkClass}
                    strokeWidth={1.5}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    vectorEffect="non-scaling-stroke"
                  />
                </svg>
              )}
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

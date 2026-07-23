import Link from "next/link";
import type { RaceCountdownProps } from "@/components/dashboard/race-countdown";

const signed = (n: number) => (n >= 0 ? `+${n}` : `${n}`);

// Honest form outlook only — a projection with an adherence range renders as
// "form +5 ±4"; a single projection as "form +5"; anything calibrating drops
// the form clause entirely rather than inventing a number.
function formLabel(outlook: RaceCountdownProps["outlook"]): string | null {
  if (outlook?.kind !== "projection") return null;
  const full = Math.round(outlook.full.tsb);
  if (outlook.adherence) {
    const a = Math.round(outlook.adherence.tsb);
    const mid = Math.round((a + full) / 2);
    const pm = Math.round(Math.abs(full - a) / 2);
    return `form ${signed(mid)} ±${pm}`;
  }
  return `form ${signed(full)}`;
}

/**
 * Today's race chip (2a) — compact stand-in for the full RaceCountdownCard,
 * shown only when a race is within 21 days (gated by the caller). Links into
 * Train's week view.
 */
export function RaceChip({ race, daysOut, outlook }: RaceCountdownProps) {
  if (!race) return null;
  const meta = [daysOut != null ? `${daysOut} days` : null, formLabel(outlook)]
    .filter(Boolean)
    .join(" · ");
  return (
    <Link
      href="/train?tab=week"
      className="mb-6 flex items-center justify-between rounded-[14px] border bg-white/[0.03] px-3.5 py-2.5 transition-colors hover:bg-white/[0.05]"
      style={{ borderColor: "rgba(232,121,249,0.25)" }}
    >
      <span className="text-[11px] text-white/85">
        <span aria-hidden>🏁 </span>
        <strong className="font-bold text-white">{race.name}</strong>
        <span className="text-white/50"> · {race.priority} race</span>
      </span>
      {meta && (
        <span className="text-[11px] font-bold" style={{ color: "#e879f9" }}>
          {meta}
        </span>
      )}
    </Link>
  );
}

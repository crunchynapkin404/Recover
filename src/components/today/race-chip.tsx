import Link from "next/link";
import { unavailableMessage } from "@/components/ui/unavailable";
import type { RaceCard } from "@/lib/race/outlook";

const signed = (n: number) => (n >= 0 ? `+${n}` : `${n}`);

/**
 * Honest form outlook only. A projection with an adherence range renders as
 * "form +5 ±4"; a single projection as "form +5"; an unavailable figure says
 * what it needs rather than dropping the clause.
 *
 * v0.87: a capped projection is marked. RaceCountdownCard used to say
 * "(projection ends at plan end)" and this component lost that when it
 * superseded it — an athlete saw a plan-end figure labelled as race-day form.
 */
function formLabel(outlook: RaceCard["outlook"]): string | null {
  if (!outlook) return null;
  if (!outlook.available) return unavailableMessage(outlook);

  const { full, adherence, capped } = outlook.value;
  const f = Math.round(full.tsb);
  const base = adherence
    ? `form ${signed(Math.round((Math.round(adherence.tsb) + f) / 2))} ±${Math.round(
        Math.abs(f - Math.round(adherence.tsb)) / 2
      )}`
    : `form ${signed(f)}`;
  return capped ? `${base} · to plan end` : base;
}

export function RaceChip({ race, daysOut, outlook }: RaceCard) {
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

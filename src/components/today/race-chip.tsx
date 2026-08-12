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
      className="flex items-center justify-between rounded-[14px] border border-hairline bg-surface-raised px-3.5 py-2.5 transition-colors hover:bg-surface-overlay"
    >
      <span className="text-caption text-ink-secondary">
        <span aria-hidden>🏁 </span>
        <strong className="font-bold text-ink-primary">{race.name}</strong>
        <span className="text-ink-muted"> · {race.priority} race</span>
      </span>
      {meta && (
        <span className="shrink-0 text-caption font-bold text-coach-ink">
          {meta}
        </span>
      )}
    </Link>
  );
}

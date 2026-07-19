import Link from "next/link";

export interface RaceCountdownProps {
  race: {
    name: string;
    date: string;
    priority: string;
    goalNote: string | null;
  } | null;
  daysOut: number | null;
  outlook:
    | {
        kind: "projection";
        full: { tsb: number; band: string };
        adherence: { tsb: number; band: string } | null;
        capped: boolean;
      }
    | { kind: "insufficient" }
    | { kind: "no_plan" }
    | null;
}

const BAND_TEXT: Record<string, string> = {
  green: "text-emerald-400",
  amber: "text-amber-400",
  red: "text-red-400",
};

function bandRange(o: {
  full: { tsb: number; band: string };
  adherence: { tsb: number; band: string } | null;
}): { label: string; cls: string } {
  if (!o.adherence || o.adherence.band === o.full.band) {
    return { label: o.full.band, cls: BAND_TEXT[o.full.band] ?? "" };
  }
  // worse band first, en dash between
  const order = ["red", "amber", "green"];
  const [a, b] = [o.adherence.band, o.full.band].sort(
    (x, y) => order.indexOf(x) - order.indexOf(y)
  );
  return { label: `${a}–${b}`, cls: BAND_TEXT[b] ?? "" };
}

export function RaceCountdownCard({
  race,
  daysOut,
  outlook,
}: RaceCountdownProps) {
  if (!race) return null;
  return (
    <section className="glass rounded-[2rem] p-6">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-white/50">
          Next race
        </h2>
        <span className="rounded-full border border-white/15 px-2 py-0.5 text-xs text-white/60">
          {race.priority} race
        </span>
      </div>
      <p className="mt-2 text-lg font-bold text-white/90">{race.name}</p>
      <p className="text-sm text-white/60">
        {race.date}
        {daysOut != null && (
          <>
            {" · "}
            <span className="font-semibold text-white/80">{daysOut}</span> days
          </>
        )}
      </p>
      {race.goalNote && (
        <p className="mt-1 text-xs text-white/50">Goal: {race.goalNote}</p>
      )}
      <div className="mt-4 border-t border-white/10 pt-3 text-sm">
        {outlook?.kind === "projection" && (
          <p className="text-white/70">
            Form outlook (projection):{" "}
            <span className={`font-semibold ${bandRange(outlook).cls}`}>
              {bandRange(outlook).label}
            </span>{" "}
            · TSB {outlook.adherence ? `${outlook.adherence.tsb} to ` : ""}
            {outlook.full.tsb}
            {outlook.capped && (
              <span className="text-white/40">
                {" "}
                (projection ends at plan end)
              </span>
            )}
          </p>
        )}
        {outlook?.kind === "insufficient" && (
          <p className="text-white/50">
            Form outlook still calibrating — not enough load history to project.
          </p>
        )}
        {outlook?.kind === "no_plan" && (
          <p className="text-white/50">
            No plan targets this race.{" "}
            <Link href="/plan" className="underline text-white/70">
              Plan it
            </Link>
          </p>
        )}
      </div>
    </section>
  );
}

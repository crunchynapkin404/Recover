import Link from "next/link";

const RANGES = [30, 90, 180, 365] as const;

/** Day-range pills for a trend panel (PMC or Wellness Trends). No client JS. */
export function RangeTabs({
  active,
  view,
}: {
  active: number;
  view: "training" | "wellness";
}) {
  return (
    <div className="flex gap-1">
      {RANGES.map((r) => (
        <Link
          key={r}
          href={`/log?panel=${view}&range=${r}`}
          aria-current={active === r ? "true" : undefined}
          className={`rounded-full px-2.5 py-1 text-[10px] font-bold ${
            active === r
              ? "bg-emerald-500/20 text-emerald-400"
              : "text-white/40"
          }`}
        >
          {r}d
        </Link>
      ))}
    </div>
  );
}

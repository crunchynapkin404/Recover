import Link from "next/link";

const RANGES = [30, 90, 180, 365] as const;

/** Link-based tab + range switcher for the Performance page (no client JS). */
export function LogTabs({
  active,
  range,
}: {
  active: "training" | "wellness";
  range: number;
}) {
  const tab = (t: "training" | "wellness", label: string) => (
    <Link
      href={`/log?tab=${t}&range=${range}`}
      aria-current={active === t ? "true" : undefined}
      className={`rounded-full px-4 py-2 text-[11px] font-bold uppercase tracking-widest ${
        active === t ? "bg-white/10 text-white" : "text-white/50"
      }`}
    >
      {label}
    </Link>
  );
  return (
    <div className="mb-6 flex items-center justify-between">
      <div className="flex gap-1">
        {tab("training", "Training")}
        {tab("wellness", "Wellness")}
      </div>
      <div className="flex gap-1">
        {RANGES.map((r) => (
          <Link
            key={r}
            href={`/log?tab=${active}&range=${r}`}
            aria-current={range === r ? "true" : undefined}
            className={`rounded-full px-2.5 py-1 text-[10px] font-bold ${
              range === r
                ? "bg-emerald-500/20 text-emerald-400"
                : "text-white/40"
            }`}
          >
            {r}d
          </Link>
        ))}
      </div>
    </div>
  );
}

import type { ActivityLap } from "@/lib/activity-streams";

/** "20:00" — laps are compared against each other, so they stay in clock form. */
function clock(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = Math.round(secs % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function LapsTable({ laps }: { laps: ActivityLap[] }) {
  if (laps.length === 0) return null;
  return (
    <div className="overflow-x-auto rounded-[18px] border border-white/[0.08] bg-white/[0.03] p-4">
      <h3 className="mb-2 text-[11px] font-bold">Laps &amp; intervals</h3>
      <table className="w-full min-w-[300px] text-left">
        <thead>
          <tr className="text-[9px] font-bold uppercase tracking-[0.15em] text-white/40">
            <th className="w-[18px] py-1.5">#</th>
            <th className="py-1.5">Label</th>
            <th className="w-11 py-1.5 text-right">Time</th>
            <th className="w-11 py-1.5 text-right">Dist</th>
            <th className="w-10 py-1.5 text-right">HR</th>
            <th className="w-12 py-1.5 text-right">Power</th>
          </tr>
        </thead>
        <tbody className="font-mono text-[10.5px]">
          {laps.map((lap) => {
            // Recovery laps are dimmed so the work stands out at a glance.
            const recovery = /recover|rest|cool|warm/i.test(lap.label ?? "");
            return (
              <tr
                key={lap.index}
                className={`border-t border-white/[0.06] ${recovery ? "text-white/75" : "text-white"}`}
              >
                <td className="py-1.5 text-white/35">{lap.index}</td>
                <td className="py-1.5 pr-2 font-sans">{lap.label ?? "—"}</td>
                <td className="py-1.5 text-right">
                  {lap.durationS != null ? clock(lap.durationS) : "—"}
                </td>
                <td className="py-1.5 text-right">
                  {lap.distanceM != null
                    ? (lap.distanceM / 1000).toFixed(1)
                    : "—"}
                </td>
                <td className="py-1.5 text-right">
                  {lap.avgHr != null ? Math.round(lap.avgHr) : "—"}
                </td>
                <td className="py-1.5 text-right">
                  {lap.avgPower != null ? `${Math.round(lap.avgPower)} W` : "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

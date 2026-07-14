import type { ActivityLap } from "@/lib/activity-streams";
import { formatDuration, formatKm } from "@/lib/format";

export function LapsTable({ laps }: { laps: ActivityLap[] }) {
  if (laps.length === 0) return null;
  return (
    <div className="glass overflow-x-auto rounded-[2rem] p-6">
      <h3 className="mb-3 text-sm font-bold">Laps & intervals</h3>
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="text-[10px] font-bold uppercase tracking-widest text-white/50">
            <th className="py-2 pr-3">#</th>
            <th className="py-2 pr-3">Label</th>
            <th className="py-2 pr-3">Time</th>
            <th className="py-2 pr-3">Dist</th>
            <th className="py-2 pr-3">HR</th>
            <th className="py-2">Power</th>
          </tr>
        </thead>
        <tbody>
          {laps.map((lap) => (
            <tr key={lap.index} className="border-t border-white/5">
              <td className="py-2 pr-3 text-white/50">{lap.index}</td>
              <td className="py-2 pr-3">{lap.label ?? "—"}</td>
              <td className="py-2 pr-3">
                {lap.durationS != null ? formatDuration(lap.durationS) : "—"}
              </td>
              <td className="py-2 pr-3">
                {lap.distanceM != null ? formatKm(lap.distanceM) : "—"}
              </td>
              <td className="py-2 pr-3">
                {lap.avgHr != null ? Math.round(lap.avgHr) : "—"}
              </td>
              <td className="py-2">
                {lap.avgPower != null ? `${Math.round(lap.avgPower)} W` : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

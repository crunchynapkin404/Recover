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
    <div className="overflow-x-auto rounded-[18px] border border-hairline bg-surface-raised p-4">
      <h3 className="mb-2 text-label font-bold">Laps &amp; intervals</h3>
      <table className="w-full min-w-[340px] text-left">
        <thead>
          <tr className="text-label font-bold uppercase text-ink-muted">
            <th className="w-[22px] py-1.5">#</th>
            <th className="py-1.5">Label</th>
            <th className="w-14 py-1.5 text-right">Time</th>
            <th className="w-14 py-1.5 text-right">Dist</th>
            <th className="w-12 py-1.5 text-right">HR</th>
            <th className="w-16 py-1.5 text-right">Power</th>
          </tr>
        </thead>
        <tbody className="font-mono text-label">
          {laps.map((lap) => {
            // Recovery laps are dimmed so the work stands out at a glance.
            const recovery = /recover|rest|cool|warm/i.test(lap.label ?? "");
            return (
              <tr
                key={lap.index}
                className={`border-t border-hairline ${recovery ? "text-ink-secondary" : "text-ink-primary"}`}
              >
                <td className="py-1.5 text-ink-muted">{lap.index}</td>
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

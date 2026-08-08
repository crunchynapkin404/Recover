/**
 * Owner-only. Instrumentation for the Phase 2b.2 IA decision, not an athlete
 * metric — it says what was opened, nothing about training.
 */
export function SurfaceViewsCard({
  rows,
}: {
  rows: { surface: string; total: number }[];
}) {
  return (
    <section className="glass rounded-2xl p-5">
      <h2 className="label-micro mb-3">Surface views</h2>
      {rows.length === 0 ? (
        <p className="text-xs text-white/50">No views recorded yet.</p>
      ) : (
        <ul className="space-y-1.5">
          {rows.map((r) => (
            <li
              key={r.surface}
              className="flex items-baseline justify-between text-xs"
            >
              <span className="text-white/70">{r.surface}</span>
              <span className="font-mono tabular-nums text-white">
                {r.total}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

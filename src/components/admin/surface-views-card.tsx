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
    <section className="glass rounded-[2rem] p-6">
      <h3 className="label-micro mb-4">Surface views</h3>
      {rows.length === 0 ? (
        <p className="text-caption text-ink-secondary">
          No views recorded yet.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {rows.map((r) => (
            <li
              key={r.surface}
              className="flex items-baseline justify-between text-label"
            >
              <span className="text-ink-secondary">{r.surface}</span>
              <span className="font-mono tabular-nums text-ink-primary">
                {r.total}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

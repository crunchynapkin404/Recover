/**
 * Owner-only. Instrumentation for the Phase 2b.2 IA decision, not an athlete
 * metric — it says what was opened, nothing about training.
 */

/** A parent surface and whatever tab rows belong under it. */
interface Group {
  surface: string;
  /** Views stored against the bare key. Pre-v0.121 for tabbed surfaces. */
  own: number;
  tabs: { tab: string; total: number }[];
  /** Sort weight: everything recorded under this surface, both eras. */
  total: number;
}

/**
 * Fold `train:week`-style keys under their parent.
 *
 * v0.121 began recording the tab for Train and Body (see SURFACE_TABS in
 * lib/telemetry.ts), so this card would otherwise show `train` and its four
 * tabs as five unrelated rows sorted by size, with the parent frozen at
 * whatever it had reached and the children climbing past it. Grouping keeps
 * the two eras of the same surface next to each other and legible.
 *
 * Exported for its own test: the folding is the part that can be wrong.
 */
export function groupSurfaces(
  rows: { surface: string; total: number }[]
): Group[] {
  const byParent = new Map<string, Group>();
  const get = (surface: string): Group => {
    let g = byParent.get(surface);
    if (!g) {
      g = { surface, own: 0, tabs: [], total: 0 };
      byParent.set(surface, g);
    }
    return g;
  };

  for (const r of rows) {
    // Split on the FIRST colon only. No current key has two, but a future
    // `train:history:month` should nest under `train`, not vanish.
    const i = r.surface.indexOf(":");
    if (i === -1) {
      const g = get(r.surface);
      g.own += r.total;
    } else {
      const g = get(r.surface.slice(0, i));
      g.tabs.push({ tab: r.surface.slice(i + 1), total: r.total });
    }
  }

  const groups = [...byParent.values()];
  for (const g of groups) {
    g.total = g.own + g.tabs.reduce((n, t) => n + t.total, 0);
    g.tabs.sort((a, b) => b.total - a.total || a.tab.localeCompare(b.tab));
  }
  return groups.sort(
    (a, b) => b.total - a.total || a.surface.localeCompare(b.surface)
  );
}

export function SurfaceViewsCard({
  rows,
}: {
  rows: { surface: string; total: number }[];
}) {
  const groups = groupSurfaces(rows);

  return (
    <section className="glass rounded-[2rem] p-6">
      <h3 className="label-micro mb-4">Surface views</h3>
      {groups.length === 0 ? (
        <p className="text-caption text-ink-secondary">
          No views recorded yet.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {groups.map((g) => (
            <li key={g.surface}>
              <div className="flex items-baseline justify-between text-label">
                <span className="text-ink-secondary">{g.surface}</span>
                <span className="font-mono tabular-nums text-ink-primary">
                  {g.total}
                </span>
              </div>
              {g.tabs.length > 0 && (
                <ul className="mt-1 space-y-1 border-l border-hairline pl-3">
                  {g.tabs.map((t) => (
                    <li
                      key={t.tab}
                      className="flex items-baseline justify-between text-label"
                    >
                      <span className="text-ink-muted">{t.tab}</span>
                      <span className="font-mono tabular-nums text-ink-secondary">
                        {t.total}
                      </span>
                    </li>
                  ))}
                  {/* Only shown when both eras have counts. Without it the
                      tab totals do not add up to the parent and the gap
                      looks like a bug rather than the release boundary it
                      is. */}
                  {g.own > 0 && (
                    <li className="flex items-baseline justify-between text-label">
                      <span className="text-ink-muted">
                        untabbed · before v0.121
                      </span>
                      <span className="font-mono tabular-nums text-ink-secondary">
                        {g.own}
                      </span>
                    </li>
                  )}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

# Design system — as built

Descriptive, not prescriptive: what exists at this commit. Phase 2b.1
(`docs/ROADMAP.md`). Living — Phase 2c's number slices push small deltas
back into this file as they land; it is not re-derived from scratch.

The artifact v0.21 and v0.23 were each supposed to leave behind and neither
did (`.superdesign/` is empty).

## Tokens

83 CSS custom properties in `src/app/globals.css` (verified via
`grep -cE '^\s*--[a-zA-Z0-9-]+:' src/app/globals.css`), one dark theme (no
light mode — "Dark-first: the only theme"). Grouped:

| Group                   | Tokens                                                                                                                                     | Example                           |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------- |
| Core surface            | `--background`, `--foreground`, `--card`, `--popover`                                                                                      | `--background: #0a0a0a`           |
| Semantic                | `--primary`, `--secondary`, `--muted`, `--accent`, `--destructive` (+ their `-foreground` pairs)                                           | `--primary: #10b981`              |
| Border/ring             | `--border`, `--input`, `--ring`                                                                                                            | `--border: rgba(255,255,255,0.1)` |
| Charts                  | `--chart-1` … `--chart-5`                                                                                                                  | `--chart-2: #10b981`              |
| Sidebar                 | `--sidebar`, `--sidebar-foreground`, `--sidebar-primary`, `--sidebar-accent`, `--sidebar-border`, `--sidebar-ring` (+ `-foreground` pairs) | `--sidebar: #121212`              |
| Radius                  | `--radius` + 6 derived scales (`sm` → `4xl`)                                                                                               | `--radius: 1rem`                  |
| Viz (charts, line ~358) | `--viz-series-1/2/3/5`, `--viz-grid`, `--viz-axis`, `--viz-muted-ink`, `--viz-status-good/warning/critical`                                | `--viz-status-critical: #ef4444`  |

`@theme inline` remaps most of these to Tailwind's `--color-*`/`--radius-*`
namespace for utility classes; the glassmorphic look layers translucent
white (`bg-white/5`, `border-white/10`) on top rather than its own tokens.

## Primitives (`src/components/ui/`)

16 files: `badge`, `bottom-sheet`, `button`, `card`, `collapsible`,
`confidence-chip`, `empty-state`, `hero-card`, `inline-markdown`, `input`,
`label`, `separator`, `skeleton`, `sonner`, `tabs`, `unavailable`. The last
two are the uncertainty-vocabulary primitives added alongside this doc
(`docs/plans/2026-08-08-uncertainty-vocabulary.md`).

## IA — as built

Two navs, same 5 routes, never both visible (`SidebarNav` is `lg:` only,
`BottomNav` is `lg:hidden`):

| Route       | Label | Icon          |
| ----------- | ----- | ------------- |
| `/`         | Today | Clock         |
| `/train`    | Train | CalendarRange |
| `/coach`    | Coach | Sparkles      |
| `/body`     | Body  | Activity      |
| `/settings` | Menu  | Settings2     |

`src/lib/telemetry.ts`'s `SURFACES` — the full closed set of authenticated
pages, including ones reached by drilling in rather than from the nav —
is: `today`, `train`, `coach`, `body`, `settings`, `admin`, `import`, `activity`, `activity-log`.
`admin`, `import`, `activity` and `activity-log` have no nav entry of their own.

Whether this is the right shape is Phase 2b.2's question, deferred until
four weeks of `surface_views` data exists (on or after 2026-09-05).

## Uncertainty vocabulary

`src/lib/uncertainty.ts` (Phase 2b.3, first slice —
`docs/plans/2026-08-08-uncertainty-vocabulary.md`). A number's owner returns
`Figure<T>`:

- `{ available: true, value, confidence, why? }` — confidence is
  `"low" | "medium" | "high"`; `<ConfidenceChip>` renders anything below
  `"high"`, nothing at `"high"`.
- `{ available: false, ...Unavailable }` — one of three kinds, rendered by
  `<Unavailable>` (inline by default, `full` for an empty-panel treatment):
  - `calibrating` — machinery works, history is short, resolves itself.
    Carries `have`/`need`/`unit`.
  - `missing_input` — a required input is absent and won't arrive alone.
    Carries `needs` and an optional `fix` link.
  - `not_applicable` — does not apply here. Carries `why`.

**Migrated so far:** the 90-day correlation rows
(`src/components/body/correlation-rows.tsx`) — the surface where
"limited evidence" (calibrating) and "inconclusive" (a real finding of no
effect) used to render identically.

**Still on the six-dialect strings, not yet migrated:** the em-dash
placeholder (`—`), the `calibrating` label text on the readiness hero/rings/
race-countdown/day-actions/morning-insight/coach-context, `insufficient`
(bio-age, race forecast, race-countdown), bare `unknown` copy, `no data`/
`not enough data` (body battery, PMC chart, wellness trends), and the
ad-hoc `· limited data` (sleep debt). Tracked as a backlog, not a task, in
`docs/plans/2026-08-08-uncertainty-vocabulary.md`.

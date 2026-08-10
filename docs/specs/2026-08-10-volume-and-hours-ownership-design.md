# Volume and Hours — Ownership Design (Phase 2c, second number slice)

## Scope

Investigated broadly (producers, MCP tools, dashboard, Train) before
writing this. Most of "volume and hours" is **already single-owner**:

- **Planned minutes**: `plannedMins(days)` (`week-plan/fill.ts`) — fixed in
  v0.38.0, no duplication found anywhere in this survey.
- **Target hours**: `weeklyTargetHours()` / `weeklyDisplayTarget()` /
  `assembleWeeklyTarget()` (`week-plan/volume.ts`, `volume-inputs.ts`) —
  already the sole producer for both `/train` and the dashboard
  (`week-row.tsx`'s own comment cites this as "final-review Finding I5").
- **`constraints.hoursPerWeek`**: a stored plan configuration value, read
  in ~60 places for its own purpose (a fallback input, or "what the plan
  says," a genuinely different question from "what this week holds") —
  no confusion found matching the `targetLoadTotal` pattern.

**One real duplication found**, the same bug class `plannedMins` was
created to prevent, recurring for availability instead of planned minutes:
`src/app/page.tsx:228` and `src/app/train/page.tsx:440` both compute

```ts
week.days.reduce((s, d) => s + d.availableMins, 0) / 60;
```

independently, as the `availabilityHours` input to `assembleWeeklyTarget`.
Two inline reduces computing the same quantity is exactly criterion 2's
violation ("no consumer recomputes it") — today they agree only because
both authors happened to write the same expression.

## Fix

`availableMins(days: DaySlot[]): number` in `week-plan/fill.ts`, directly
beside `plannedMins` (same shape, same file, same doc-comment style).
Both call sites become `availableMins(days) / 60`.

No `Figure<T>` needed: unlike `weekTargetLoad`, a materialized week's
`days` array always exists and reducing over it always yields a real
number — zero available minutes is a real, known state, not an unknown
one — matching `plannedMins`'s own plain `number` return.

No persisted column duplication (criterion 3 is moot — nothing about
"available minutes" is stored at the week level, only per-day, and this
is a pure derivation from already-persisted per-day data).

## Out of scope

- `constraints.hoursPerWeek`'s ~60 reads — audited, no confusion found,
  no change needed.
- `offeredMins` in `train/page.tsx`'s `resolveWeekIntake` — a different
  question (calendar availability for a not-yet-materialized week), not
  a duplicate of `availableMins(days)`.
- Any load-based quantity — that's the closed "Week target load" slice.

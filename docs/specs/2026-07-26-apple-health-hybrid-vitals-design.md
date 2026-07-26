# Apple Health Hybrid Vitals: Design

**Date:** 2026-07-26
**Status:** Approved

## Goal

intervals.icu's wellness sync runs once a day (~05:00 server time, ±10min
jitter). Apple Health, via Health Auto Export, can push every 15 minutes.
But `apple_health` currently ranks _lowest_ in both the `PHYSIOLOGY` and
`BODY` priority ladders in `wellness-merge.ts` — so any same-day freshness
advantage it has gets silently wiped out the next morning when
intervals_icu's once-daily, better-ranked sync "heals" over it. Separately,
several HealthKit metrics Apple Health can supply have no mapping at all in
`src/lib/connectors/apple-health.ts` — including `vo2max`, which already has
a live schema column and priority-ladder entry (added in v0.22) but no
source ever writes it from Apple Health.

Done when: an athlete syncing Apple Health every 15 minutes sees same-day
HRV/sleep/vitals stay fresh all day instead of reverting to stale
intervals_icu values each morning, and VO2max, blood oxygen, wrist
temperature, BMI, lean body mass, and waist circumference all flow from
Apple Health into `wellness_daily` and onto the `/body` page.

## Decisions

| Decision                    | Choice                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ladder reorder              | `apple_health` moves to rank just above `intervals_icu` in both `PHYSIOLOGY` and `BODY` (still below manual entry and any dedicated wearable/scale — Whoop, Oura, Withings). `LOAD` is untouched.                                                                                                                                                                                                                                                                                                                      |
| Schema change               | Migration adds 5 nullable `real` columns to `wellness_daily`: `blood_oxygen_pct`, `wrist_temp_c`, `bmi`, `lean_mass_kg`, `waist_cm` — mirrors the v0.22 `vo2max`/`rampRate` migration exactly.                                                                                                                                                                                                                                                                                                                         |
| New field buckets           | `bloodOxygenPct`, `wristTempC` → `PHYSIOLOGY`. `bmi`, `leanMassKg`, `waistCm` → `BODY`. `vo2max` already exists in `PHYSIOLOGY` (v0.22) — this spec only adds `apple_health` as a source for it.                                                                                                                                                                                                                                                                                                                       |
| Wrist temperature semantics | Stored as its own **absolute** `wristTempC` field, never written into `tempDeviationC`. `tempDeviationC` is Oura's baseline-relative deviation (small delta, e.g. ±0.5°C); Apple's wrist-temp reading is an absolute skin temperature (~33–35°C). Conflating them would silently corrupt the column. No baseline-deviation calculation is built in this phase.                                                                                                                                                         |
| Apple Health metric names   | `vo2_max`, `blood_oxygen_saturation`, `apple_sleeping_wrist_temperature`, `body_mass_index`, `lean_body_mass`, `waist_circumference` — follow the same HealthKit-identifier-derived naming convention already proven correct for the 8 currently-mapped metrics (`heart_rate_variability`, `resting_heart_rate`, etc.), but are unverified against a real payload (the app has never stored/logged full raw payloads).                                                                                                 |
| Unit conversion             | `blood_oxygen_saturation`: Apple reports a 0–1 fraction like `body_fat_percentage` — ×100 if ≤1. `apple_sleeping_wrist_temperature`: convert °F→°C if `units` says fahrenheit, mirroring the existing lb→kg pattern for `body_mass`. `lean_body_mass`: kg/lb conversion, same as `body_mass`. `waist_circumference`: cm/in conversion (Apple may report either).                                                                                                                                                       |
| UI surface                  | `/body` page's Trends tab — new stat rows for VO2max, blood oxygen, wrist temperature, BMI, lean mass, waist circumference, following the exact "latest non-null value" lookup pattern already used for weight/body-fat.                                                                                                                                                                                                                                                                                               |
| Verification                | After deploy, check the user's next real Health Auto Export sync's logs and `wellness_daily` row to confirm the metric names actually appear and populate — same rigor as the just-shipped proxy-405 fix, since a wrong guessed name silently drops data exactly like the ladder-priority bug does. The unit-string values used in conversion checks (e.g. `"degf"`, `"in"`) are equally best-effort guesses at Health Auto Export's convention and get the same live-payload confirmation, not just the metric names. |

## Architecture

### Merge policy — `src/lib/wellness-merge.ts`

`PHYSIOLOGY` and `BODY` arrays both get `apple_health` moved to immediately
before `intervals_icu`:

```ts
const PHYSIOLOGY: WellnessSource[] = [
  "manual",
  "whoop",
  "oura",
  "apple_health",
  "intervals_icu",
];
const BODY: WellnessSource[] = [
  "manual",
  "withings",
  "oura",
  "whoop",
  "apple_health",
  "intervals_icu",
];
```

`WellnessPatch` gains `bloodOxygenPct`, `wristTempC`, `bmi`, `leanMassKg`,
`waistCm` (all `number | null`). `FIELD_PRIORITY` assigns `bloodOxygenPct`/
`wristTempC` to `PHYSIOLOGY`, `bmi`/`leanMassKg`/`waistCm` to `BODY`.

### Schema — `src/lib/db/schema.ts`

New additive migration: `blood_oxygen_pct`, `wrist_temp_c`, `bmi`,
`lean_mass_kg`, `waist_cm` as nullable `real` columns on `wellnessDaily`,
positioned next to the existing `vo2max`/`body_fat_pct` columns. No backfill.

### Connector — `src/lib/connectors/apple-health.ts`

`mapAppleHealth()`'s scalar-metric switch statement gains 6 new cases,
following the exact shape of the existing `body_mass`/`body_fat_percentage`
cases:

- `vo2_max` → `set(out, day, "vo2max", qty)`
- `blood_oxygen_saturation` → `set(out, day, "bloodOxygenPct", qty <= 1 ? qty * 100 : qty)`
- `apple_sleeping_wrist_temperature` → `set(out, day, "wristTempC", units === "degf" ? (qty - 32) / 1.8 : qty)`
- `body_mass_index` → `set(out, day, "bmi", qty)`
- `lean_body_mass` → `set(out, day, "leanMassKg", units === "lb" || units === "lbs" ? qty * 0.453592 : qty)`
- `waist_circumference` → `set(out, day, "waistCm", units === "in" ? qty * 2.54 : qty)`

No changes to `ingestAppleHealth()` or the route — the existing pipeline
already carries any `WellnessPatch` field through `applyWellnessPatch`
generically.

### UI — `src/app/body/page.tsx`

Add "latest non-null" lookups for the 5 new fields plus `vo2max` (which
already has a lookup for Bio-Age but not a Trends-tab display), following
the exact pattern already used for `latestBodyFat`/`latestWellness`. Each
renders as an independent stat that hides itself when null — no fabricated
zero defaults, consistent with the project's honesty principle.

## Batches (each ends green and reviewable)

1. **Data layer**: migration, `WellnessPatch`/`FIELD_PRIORITY` extension,
   ladder reorder, connector mapping + unit tests, merge-policy reorder
   tests.
2. **UI**: `/body` page Trends-tab stat rows for the 6 fields; component
   tests including the null/partial data case.
3. **Release chores**: version bump, CHANGELOG entry, ROADMAP tick.
4. **Live verification**: after deploy, trigger a real Health Auto Export
   sync and confirm the new fields actually populate in `wellness_daily`
   (metric-name guess check) and that a same-day Apple Health update
   survives the next intervals_icu nightly sync (ladder-reorder check).

## Testing

- Connector: fixture-based tests for each of the 6 new metric mappings,
  including unit-conversion cases (lb/kg, in/cm, °F/°C, 0–1 fraction),
  mirroring the existing `apple-health.test.ts` structure.
- Merge policy: a reorder test proving `apple_health` now outranks
  `intervals_icu` in both `PHYSIOLOGY` and `BODY` (a same-day `apple_health`
  value is not overwritten by a later, lower-ranked `intervals_icu` sync),
  and that `manual`/`whoop`/`oura`/`withings` still outrank `apple_health`
  unchanged.
- Schema/migration smoke test (existing pattern — new columns nullable,
  additive only).
- `/body` page: new stat rows render when present, hide individually when
  null, don't break the page when no Apple Health connection exists at all.

## Out of scope

- Daily activity/workouts (steps, active energy, exercise/stand time,
  flights climbed, distance walked/run) — no home in the current schema or
  UI; a separate future spec once this phase ships, per the user's own
  sequencing choice.
- Wrist-temperature baseline-deviation scoring (an Oura-style "deviation
  from your personal average" computed from the new absolute
  `wristTempC` readings) — a real future enhancement, not built now.
- Coach/MCP tool exposure for any of the 5 new fields.
- Backfilling historical rows — migration only adds columns for new syncs
  going forward.
- Any new chart or visualization — stat numbers only, matching the v0.22
  precedent.

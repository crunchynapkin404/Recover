# HRV source fallback — score whichever HRV metric arrived

**Date:** 2026-08-11
**Status:** Design, approved
**Scope:** Today HRV tile + readiness. Not the coach, MCP tools, or `/body` trends.

## Problem

The athlete's HRV reaches Recover by two independent paths from the same watch,
at different speeds and in different units:

```text
Zepp → Apple Health → intervals.icu Companion → intervals.icu → Recover
   field: hrvSDNN → wellness_daily.hrv_sdnn_ms      lands ~06:14 every morning
Zepp → intervals.icu direct                       → Recover
   field: hrv (rMSSD) → wellness_daily.hrv_ms      lands the NEXT morning
```

Recover reads only `hrv_ms`. Two consequences, both measured on the live
instance on 2026-08-11:

1. **The Today tile blanks every morning.** `src/app/page.tsx` picks `latest`
   as the newest wellness row carrying HRV _or_ resting HR, then prints
   `latest.hrvMs`. Resting HR arrives on time and rMSSD does not, so `latest`
   flips to today's row at ~06:14 and the tile goes from yesterday's real
   number to "no HRV reading" — the sync is what makes HRV disappear.
2. **Readiness silently drops its heaviest input.** HRV carries weight `0.40`
   (`src/lib/readiness.ts`); `computeReadiness` renormalizes over the surviving
   components and says nothing. On 2026-08-11 the day scored 68 without HRV and
   77 once rMSSD landed.

`hrv_sdnn_ms` is already stored and already present at 06:14. It is currently
read by exactly one chart, `src/app/body/page.tsx:371`.

### The two metrics are not interchangeable

Over the 17 days carrying both (2026-07-26 → 08-11), log-correlation between
rMSSD and SDNN is **r = 0.67** — under half the variance explained. The ratio
ranges 0.96–1.67. On 2026-08-11: rMSSD 152 sits ~2.5σ above its own baseline
and maxes the HRV component at 100, while SDNN 91 is ~0.9σ above its own and
scores ~68.

**Therefore each metric must be scored against a baseline built from itself.**
Substituting SDNN into an rMSSD baseline reads as a crash. This mirrors the
existing rule in `resolveEffectiveLoad` (`src/lib/training-load.ts:307`):
_"Pairs are never mixed — CTL and ATL from different series make a fictional
TSB."_

### A pre-existing mislabel

`src/lib/connectors/apple-health.ts:134` maps HealthKit
`heart_rate_variability` — which is SDNN, the only HRV quantity type HealthKit
defines — into `hrvMs`, the rMSSD column. Four live rows (2026-07-25 → 07-29,
`field_sources.hrvMs = 'apple_health'`, mean 105.7) carry SDNN posing as rMSSD.
They sit inside the live 60-day baseline window and are skewing rMSSD z-scores
today. The connector is dormant only because its Health Auto Export feed died
on 2026-07-29; reviving it would resume the corruption.

## Decisions

| Question                                    | Decision                       | Consequence                                                                                                                                       |
| ------------------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Late rMSSD for a day already scored on SDNN | **Recompute — best data wins** | No new storage, no freeze guard; matches `computeDailyMetrics` already rebuilding its window on every sync. A published score can move overnight. |
| Reach                                       | **Tile + readiness only**      | Coach, MCP tools and `/body` inherit a corrected readiness without their own changes.                                                             |
| Labelling                                   | **Label + reason**             | Tile names the metric; `Figure.why` carries the explanation; `confidence` drops to `medium` on fallback.                                          |
| The four mislabelled rows                   | **Fix connector + migrate**    | One row relocates to `hrv_sdnn_ms`, three are cleared because a Companion value already holds the slot; the rMSSD baseline loses all four.        |

Derived from the labelling decision, not separately asked: the tile's 7-day
delta and its sparkline must be computed **within the displayed metric**.
Comparing SDNN 91 against an rMSSD 7-day mean of ~97 would print a fictional
40% drop.

## Architecture

New module `src/lib/hrv-source.ts` — one pure function, no I/O:

```ts
export type HrvMetric = "rmssd" | "sdnn";

export interface HrvCandidate {
  value: number | null;
  baseline: number[]; // trailing window, today excluded, day-flags applied
}

export interface EffectiveHrv {
  value: number | null;
  baseline: number[];
  metric: HrvMetric | null;
}

export function resolveEffectiveHrv(
  rmssd: HrvCandidate,
  sdnn: HrvCandidate
): EffectiveHrv;
```

Precedence, in order:

| #   | Condition                                                          | Result                                        |
| --- | ------------------------------------------------------------------ | --------------------------------------------- |
| 1   | `rmssd.value > 0` and `rmssd.baseline.length >= MIN_BASELINE_DAYS` | rMSSD                                         |
| 2   | `sdnn.value > 0` and `sdnn.baseline.length >= MIN_BASELINE_DAYS`   | SDNN                                          |
| 3   | otherwise                                                          | `{ value: null, baseline: [], metric: null }` |

Baseline arrays are filtered to `> 0` before the length test, matching the
existing filter in `computeReadiness`.

**Source: Invented.** rMSSD is preferred over SDNN because it is the metric
this athlete's history is denominated in (237 days vs 17) and the one the
readiness engine's log-normal treatment was designed against — not because
literature ranks it above SDNN for recovery. Confidence: Low.

Its own module rather than living in `readiness.ts`: this is source-precedence
policy, not scoring maths, and `page.tsx` should not import from the engine to
get a label. It imports `MIN_BASELINE_DAYS` from `readiness.ts` rather than
redefining it.

**`computeReadiness` does not change.** Its `ReadinessInput.hrv` +
`hrvBaseline` are already "one value, one baseline"; the resolver decides which
pair to hand it. The engine never learns there are two metrics, the
`calibrating` guard at `readiness.ts:203` still holds, and the returned
`hrvLnMean`/`hrvLnSd` are automatically the stats of whichever baseline won.

## Data flow

### `computeDailyMetrics` (`src/lib/metrics.ts`)

The existing `baseline` row set — already 60-day windowed and day-flag
filtered — yields two arrays instead of one:

```ts
const rmssdBaseline = baseline.map((r) => r.hrvMs).filter(nonNull);
const sdnnBaseline  = baseline.map((r) => r.hrvSdnnMs).filter(nonNull);

const hrv = resolveEffectiveHrv(
  { value: day?.hrvMs ?? null,     baseline: rmssdBaseline },
  { value: day?.hrvSdnnMs ?? null, baseline: sdnnBaseline }
);

computeReadiness({ ...,  hrv: hrv.value, hrvBaseline: hrv.baseline });
```

`hrv.metric` is persisted alongside the score as `daily_metrics.hrv_metric`,
exactly as `effective.source` is persisted as `load_source`.

### Today tile (`src/app/page.tsx`)

The tile reads the **persisted** `hrv_metric` for `latest.date` rather than
re-resolving. Re-resolving on the page would require replicating the 60-day
window and the day-flag filter, giving two code paths that must agree; reading
the stored decision makes tile-versus-ring divergence structurally impossible.

- `latest`'s predicate gains `w.hrvSdnnMs != null`, so a day carrying only SDNN
  and no resting HR still selects.
- Displayed value, 7-day delta and sparkline all read the column named by
  `hrv_metric`.
- When no metric row exists for `latest.date`, or its `hrv_metric` is null, the
  tile shows the existing `Figure.missingInput` state. A day that was not
  scored must not display a number the ring does not reflect.

`calibrationProgress` (`src/lib/calibration.ts`) also counts `hrvSdnnMs` as a
signal. Without it, an SDNN-only athlete would show "day N of 14" while
readiness was already scoring them.

## Schema and data

**Migration `drizzle/0041_hrv_source.sql`** — additive only, per house style:

```sql
ALTER TABLE daily_metrics ADD COLUMN hrv_metric text;
```

Drizzle: `hrvMetric: text("hrv_metric", { enum: ["rmssd", "sdnn"] })`, matching
`loadSource`'s shape at `schema.ts:351`.

**Connector fix:** `apple-health.ts:134` writes `hrvSdnnMs`, not `hrvMs`.
`WellnessPatch` already carries `hrvSdnnMs` with `PHYSIOLOGY` priority, so the
merge needs no change.

**Data repair — `scripts/repair-apple-health-hrv.ts`**, a script rather than a
migration: this is user data on a database shared with the live app, not
schema. Requirements:

- Dry-run by default; `--apply` to write.
- Scoped by explicit `--user`, never DB-wide. This project has written
  fabricated rows into two real accounts before by pairing a DB-wide query with
  a caller-supplied payload.
- Targets rows where `field_sources->>'hrvMs' = 'apple_health'`.
- Moves `hrv_ms` → `hrv_sdnn_ms` **only when the target is null**, otherwise
  clears `hrv_ms` alone. On the live owner account the four affected rows split
  1 / 3:

  | date       | `hrv_ms` | `hrv_sdnn_ms`       | action         |
  | ---------- | -------- | ------------------- | -------------- |
  | 2026-07-25 | 107.54   | —                   | relocate       |
  | 2026-07-26 | 109.14   | 106 (intervals_icu) | clear `hrv_ms` |
  | 2026-07-28 | 96.89    | 87 (intervals_icu)  | clear `hrv_ms` |
  | 2026-07-29 | 109.14   | 78 (intervals_icu)  | clear `hrv_ms` |

  A Companion value already in place is the better-attributed measurement and
  must never be overwritten by the relocated one.

- Rewrites `field_sources` as a jsonb delta (drop `hrvMs`, add `hrvSdnnMs`),
  never a whole-map overwrite — concurrent writers would otherwise erase each
  other's ownership.
- Prints a before/after table and requires the operator to confirm the row
  count matches expectation.
- Followed by `computeDailyMetrics(userId, '2026-07-25')` to rebuild.

## Testing

1. **`hrv-source.test.ts`** — the precedence table exhaustively: both present →
   rMSSD; rMSSD null → SDNN; rMSSD present but its baseline short while SDNN is
   calibrated → SDNN; neither calibrated → null metric; zero and negative values
   treated as absent.
2. **Baseline-binding mutation check.** Fixtures must make the two baseline
   arrays numerically distinct, and assertions must check the returned
   `baseline` contents, not only `metric`. A resolver that returns the right
   metric with the wrong baseline has to fail — a test whose fixture lets the
   wrong binding produce the right number proves nothing.
3. **`metrics` integration** — a day carrying only SDNN produces non-null
   `readiness` and `hrv_metric = 'sdnn'`, and the stored `hrv_baseline_mean`
   equals the ln-stats of the SDNN series, not the rMSSD one.
4. **Retro-flip** — score a day on SDNN, add rMSSD, recompute: readiness moves
   and `hrv_metric` flips to `'rmssd'`.
5. **Tile** — label, delta and sparkline all read the chosen column; the
   missing-input state renders when `hrv_metric` is null.
6. **Repair script** — on scoped fixtures, including the both-columns-populated
   case where the target must not be overwritten.

DB-backed suites run in CI (Postgres service since 2026-08-04), so these are
real gates, not skipped ones.

## Risks

- **Published numbers move.** A day scored on SDNN and recomputed on rMSSD
  changes after the athlete has seen it, and the coach may already have quoted
  the old value. Accepted deliberately. Recover has been bitten by the inverse —
  a corrected DB with a stale athlete-facing message — so recompute is the
  lesser evil, but the coach-facing surfaces are out of scope here and will
  still quote whatever was current when they wrote.
- **Live data repair.** Mitigated by dry-run, explicit user scoping, and a
  before/after snapshot.
- **The SDNN baseline is thin.** 17 days against a `MIN_BASELINE_DAYS` of 14.
  Day-flag exclusions can push it under the floor, at which point the fallback
  silently stops and the tile blanks again. That is correct behaviour — an
  uncalibrated baseline must not score — but it needs a test so it is not
  mistaken for a regression.
- **Build gate.** The repo's verification gate omits `npm run build`, the only
  check that catches a sync export from a `"use server"` file. Run it explicitly.

## Non-goals

- Anything upstream of Recover. The Zepp → intervals.icu pull not firing on its
  own is a real problem, but it is not fixable in this codebase.
- Coach context, `brief-completeness`, MCP wellness tools, `/body` trends.
- Merging the two series into one chart or one history.
- Reweighting readiness because SDNN is a weaker proxy. Measured against its own
  baseline a z-score is a z-score; inventing a discount would be another
  uncited constant.

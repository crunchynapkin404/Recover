# Wellness History Backfill: Design

**Date:** 2026-08-02
**Status:** Approved
**Target release:** v0.36.0

## Goal

Recover holds far less wellness data than intervals.icu has already given it.
Two independent losses, measured against the live database on 2026-08-02:

**Unmapped fields on rows we already hold.** Every one of the owner's 385
`wellness_daily` rows stores the provider's full payload in `raw`, but the
columns were written by the pre-v0.33 patch shape. v0.33 added the mappings and
only the incremental overlap window ever flowed through them, so the data sits
in `raw`, unread:

| Field           | present in `raw` | present in column | recoverable |
| --------------- | ---------------- | ----------------- | ----------- |
| `steps`         | 253              | 8                 | 245 days    |
| `sleepQuality`  | 238              | 8                 | 230 days    |
| `spO2`          | 156              | 9                 | 147 days    |
| `vo2max`        | 86               | 9                 | 77 days     |
| `avgSleepingHR` | 41               | 8                 | 33 days     |
| `bodyFat`       | 22               | 1                 | 21 days     |
| `hydration`     | 12               | 2                 | 10 days     |

`hrv`, `restingHR`, `sleepSecs` and `ctl` are already 1:1 — this loss is
specific to the fields v0.33 introduced. Sleep stages, `respiration` and
`hrvSDNN` genuinely have no history (Companion-only, ~8 days) and are not
recoverable by any means.

**Days never fetched at all.** `BACKFILL_DAYS = 365` in `intervals-sync.ts`
capped the first sync; every sync since has re-fetched a 7-day overlap. Local
data starts **2025-07-14**, exactly 365 days before that first sync.

A dry run against a copy of production data (2026-08-02) found intervals.icu
holds far more history than this design originally estimated, and that most
of it is not real: the walk pulled **385 → 5,882 rows**, reaching all the way
back to **2010-06-26**. The reason is that intervals.icu synthesizes a
wellness row for **every calendar day back to account creation**, carrying
only CTL/ATL decay values — not just days with real measurements. A naive
"stop at the first chunk that returns zero rows" walk never encounters an
empty chunk on data like this; it stops at account creation, not at the
athlete's actual history floor.

Measured breakdown of what came back, per year:

- **2010–2018: 3,111 rows of pure filler** — `ctl` exactly 0.0, zero sleep,
  zero resting HR, one stray weight reading in 2010.
- **2019 onward: real signal** — 2019 has 231 sleep rows and real CTL (avg
  2.2, max 7.2); 2020 has 316 sleep + 16 weight; 2021 has 261 sleep + 19
  weight.

Real history starts in **2019**; everything before it is noise a backfill
must not keep.

Done when: an athlete can press one button in Settings and end up with every
wellness day that carries real signal — plus every mappable field on it —
that intervals.icu has ever held for them, with the pre-history CTL/ATL
filler an old-enough account carries excluded rather than written.

## Decisions

| Decision            | Choice                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Provider scope      | intervals.icu only. The live instance has no Whoop/Oura/Withings connections, `apple_health` has been dead since 2026-07-29 and never carried history, and Strava supplies activities, not wellness.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Trigger             | A button on the intervals.icu Settings card, enqueuing a `sync_jobs` row. Not a script: it must work for the other athlete on the instance, who has no shell. Not automatic-on-upgrade: thousands of requests against a free service, unprompted.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Job kind            | The existing `sync_jobs.kind` enum value `backfill`, which nothing currently writes. `defaultProcessor` branches only on `job.provider` today and gains a `kind` branch.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Enqueue, don't run  | The server action returns immediately. A backfill runs for minutes; a server action cannot.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Re-entrancy         | Refuse to enqueue when a backfill is already `pending`/`running` for that user, mirroring `scheduleIntervalsSync`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Two phases, one job | Phase A (remap `raw`) needs no network; Phase B (fetch history) does. Running them in one job means one metrics recompute instead of two, and the recompute is the expensive part.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Mapping location    | The `raw` → `IntervalsWellnessDay` mapping is extracted from inside `fetchDailyWellness` into an exported pure function. Phase A cannot reuse it otherwise, and a duplicated copy would drift from the fetch path within one release.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Write path          | `applyWellnessPatch`, same as every other wellness write. No direct upserts — the merge is what stops a backfill from overwriting a better-ranked provider's field.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `lastSyncAt`        | Untouched by the backfill. That cursor decides the incremental window; moving it would silently widen or skip the daily sync.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Chunking            | One request per calendar year rather than one all-history response, with a delay between chunks. intervals.icu is free and run by one developer.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| History floor       | **Not** "walk back until a chunk returns zero rows" — the dry run showed that rule never fires on real data, because intervals.icu synthesizes CTL/ATL-only filler for every calendar day back to account creation. The real rule: stop at the first chunk that is either empty **or** carries nothing beyond intervals.icu's own training-load model outputs (`ctl`, `atl`, `rampRate`, `eftp`, `pMax`, `wPrime` — see `LOAD_ONLY_FIELDS` in `intervals-backfill.ts`). That load-only chunk is discarded, not written; a chunk with any other field populated is written in full, filler days included, and the walk continues. `MAX_BACKFILL_YEARS = 20` remains the hard safety stop for an account where even this rule never fires; `BackfillResult.truncated` reports whether the walk hit it instead of a real stop condition. Hardcoding 2019 would be correct for this athlete and wrong for the next. |
| Stale reclaim       | The job heartbeats `sync_jobs.updated_at` between chunks, **and now during Phase C too** — `computeDailyMetrics` takes an optional `onProgress` callback, fired every 250 processed dates, that the backfill wires to the same heartbeat. Phase C alone is thousands of sequential upserts at real-account scale, by far the single largest unheartbeated span in the job before this; `runSchedulerTick` reclaims jobs idle >15 min and re-runs them, which would have started a second, concurrent backfill for the same user.                                                                                                                                                                                                                                                                                                                                                                                |
| Readiness shift     | Accepted and surfaced, not hidden. Recomputing from the real history floor re-derives the trailing baselines readiness scores against, so today's number will move. That is the point of having the history, but it is a visible change and the UI should say so.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |

## Architecture

### Connector — `src/lib/connectors/intervals.ts`

The raw-row mapping currently lives inline in `fetchDailyWellness`'s `.map()`
callback. Extract it verbatim:

```ts
export function normalizeWellnessRow(
  row: Record<string, unknown>
): IntervalsWellnessDay | null;
```

Returns `null` for a row without a usable string `id`, which is the filter
`fetchDailyWellness` already applies. `fetchDailyWellness` keeps its
`missingStages` counter and its logging; only the per-row mapping moves.

This is the enabling change. It is a pure extraction with no behaviour
difference, and the existing connector tests must pass unmodified.

### Backfill engine — `src/lib/sync/intervals-backfill.ts` (new)

```ts
export async function runIntervalsBackfill(
  userId: string,
  opts?: {
    fetcher?: WellnessFetcher;
    onProgress?: () => Promise<void>;
    delayMs?: number;
  }
): Promise<{
  remapped: number;
  fetched: number;
  earliestDate: string | null;
  truncated: boolean;
}>;
```

`onProgress` is the heartbeat hook, called between Phase B chunks and passed
through to Phase C's own `onProgress` (see below); the scheduler passes one
that bumps `sync_jobs.updated_at`. `fetcher` is the test seam, matching the
`WellnessFetcher` type `wellness-refresh.ts` already exports. `truncated` is
`true` only when Phase B exhausted `MAX_BACKFILL_YEARS` instead of ending via
a real stop condition.

**Phase A — remap.** Read the user's `wellness_daily` rows where `raw` is
non-null and `raw->>'id' = date`. That equality is the discriminator:
intervals.icu wellness rows carry the date as `id`, so an Apple Health payload
that last wrote the `raw` column on the same row is excluded rather than
misparsed. Each surviving row goes through `normalizeWellnessRow` →
`wellnessDayToPatch` → `applyWellnessPatch(userId, date, patch,
"intervals_icu", raw)`.

Safe by construction: `mergeWellnessPatch` skips null patch fields, so Phase A
can only add values and never erase one, and where `apple_health` outranks
`intervals_icu` for a field the merge keeps Apple's.

**Phase B — fetch.** Determine the local earliest date, then request whole
calendar years backwards from it via the existing `oldest`/`newest` params.
Stop after the first chunk that either returns zero rows **or** contains
nothing beyond intervals.icu's own training-load model outputs (see "History
floor" above) — that chunk is discarded, not written. A chunk with any other
field populated is written in full, filler days included, and the walk
continues. Every written day goes through the identical `wellnessDayToPatch`
→ `applyWellnessPatch` path as the daily sync, so a backfilled day is
indistinguishable from a synced one.

**Phase C — recompute.** A single `computeDailyMetrics(userId,
earliestTouchedDate, { onProgress: heartbeat })` after both phases.
`computeDailyMetrics` gained an optional `onProgress` parameter (backward
compatible — every other caller omits it) fired every 250 processed dates,
since at real-account scale this recompute is thousands of sequential
upserts — the single largest unheartbeated span in the job before this.

### Scheduler — `src/lib/sync/scheduler.ts`

`defaultProcessor` gains a `kind` branch before its provider dispatch:

```ts
if (job.kind === "backfill" && job.provider === "intervals_icu") {
  const { runIntervalsBackfill } =
    await import("@/lib/sync/intervals-backfill");
  await runIntervalsBackfill(job.userId, {
    onProgress: () => heartbeat(job.id),
  });
  return;
}
```

`heartbeat(jobId)` is a new module-private helper setting `updatedAt: new
Date()` on that row — the same field the stale-reclaim query reads.

A `backfill` job for any other provider throws, as an unknown provider already
does — silently succeeding on work that never ran is the worse failure.

The tick's existing post-job behaviour is unchanged: a completed backfill
chains the next `incremental` job and fires `onWellnessDataChanged` like any
other, which is correct — five years of new history is exactly when the morning
brief should be reconsidered.

### Server action — `src/app/settings/actions.ts`

`backfillHistory(): Promise<ActionResult>` alongside `syncNow()`. Resolves the
session user, refuses when a backfill is already pending or running, inserts
the job with `runAfter: now`, and revalidates `/settings`.

### Settings card — `src/components/settings/intervals-card.tsx`

A "Backfill full history" button below the existing sync controls, with copy
stating that it fetches the athlete's full wellness history (skipping years
that are nothing but intervals.icu's own calculated training-load numbers,
with no real data of theirs) and that recovery scores may shift once older
history informs the baselines. While a backfill job
is `pending` or `running` the button is disabled and reads "Backfilling…"; the
job's `lastError` surfaces the same way the connection's does.

## Testing

- `normalizeWellnessRow` — unit tests against two real captured payload shapes:
  a 2021 row (sleep duration and CTL/ATL only) and a 2026 row (the full
  Companion set). No DB, so these run in CI.
- Phase A — a fixture row with a rich `raw` and empty columns fills those
  columns; a field owned by `apple_health` in `field_sources` is **not**
  overwritten; a row whose `raw->>'id'` does not equal its `date` is skipped.
- Phase B — with an injected fetcher: asserts year-sized chunks, asserts it
  stops after an empty chunk, asserts `connections.lastSyncAt` is unchanged
  afterwards.
- Load-only stop rule — with an injected fetcher: a year of load-only rows
  (`ctl`/`atl`/etc. only) is discarded and ends the walk without being
  written, including when it is the first (partial-year) chunk; a year with
  even one real measurement among filler is written in full and the walk
  continues past it.
- Truncation — `BackfillResult.truncated` is `false` when the walk ends via
  a real stop condition, and `true` when it instead exhausts
  `MAX_BACKFILL_YEARS`.
- Heartbeat — `onProgress` is invoked at least once per Phase B chunk, and
  `computeDailyMetrics`'s own `onProgress` (Phase C) is proven to fire once
  it crosses its 250-date batch boundary.
- Every DB-touching file carries `describe.skipIf(!hasDb)` per the house
  pattern; a file that omits it crashes CI instead of skipping.

## Verification

- Run the full suite with `DATABASE_URL` **unset** before pushing. A green
  local run with `.env` sourced cannot prove the CI guard works.
- Run the backfill against the dev database (5435, a copy of live) first and
  diff `wellness_daily` field counts before and after. Expected, after the
  load-only stop rule: the Phase A column counts above rise to match their
  `raw` counts, the row count rises toward the mid-hundreds as 2019 onward is
  pulled, and the walk does **not** write the ~3,111 pre-2019 filler rows a
  zero-rows-only stop condition would have let through.
- Confirm `connections.last_sync_at` is byte-identical before and after.
- Load `/body` and confirm multi-year trends render, then confirm the next
  daily sync still runs on its normal window.
- Apply nothing to the live database until the dev run is clean — the two are
  separate databases and a migration or backfill on one does not reach the
  other.

## Out of scope

- **Activity history.** Activities hit the identical 365-day cliff (135 rows,
  first 2025-07-15), but backfilling them pulls in the Strava-stub dedupe path
  across five years of rows and belongs in its own release. CTL/ATL/eFTP come
  straight off the wellness endpoint, so multi-year fitness trends work without
  it.
- **Bed/wake times and awake time.** Unavailable on this route at any depth —
  intervals.icu has no bed/wake window, and the sleep stages sum to the total
  by construction.
- **Other providers' backfill windows.** Whoop, Oura, Withings and Strava keep
  their current caps; no connection on this instance uses them for wellness.
- **Raising `STALE_RUNNING_MINUTES`.** The heartbeat solves this job's problem
  without weakening the stale-job guard for every other job.

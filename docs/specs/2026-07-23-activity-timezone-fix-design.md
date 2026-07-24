# Activity Timezone Fix — Design

## Problem

`activities.start_date` is stored wrong for every activity that syncs through
intervals.icu (the majority of activities in this app — Garmin, Zwift, Strava,
etc. all funnel through it). The root cause is one line in
`src/lib/connectors/intervals.ts`'s `fetchActivities()`:

```ts
const start = str(row.start_date_local) ?? str(row.start_date);
const startDate = new Date(start);
```

`start_date_local` is the athlete's wall-clock time with no timezone suffix
(e.g. `"2026-07-21T18:50:01"`). `new Date()` parses a string with no offset
suffix as UTC, so a ride that really started at 18:50 local (16:50 true UTC,
this athlete is UTC+2) gets stored as if it started at 18:50 UTC — two hours
in the future relative to the truth.

This went unnoticed for a long time because of a second, compounding fact:
**Recover has no per-athlete timezone field anywhere**, and every "what
day/hour did this happen" computation in the app (18 separate local
implementations of a `localYmd()` helper, plus a handful of raw
`.getHours()`/`.getDate()` calls) reads JS Date's _local_ getters, which
report the _server's_ timezone — UTC, in this container. The storage bug
(local time mislabeled UTC) and the reading pattern (UTC-container local
getters) cancel out by coincidence and happen to recover the athlete's
correct local day/hour for exactly this deployment's timezone.

The cancellation only holds for **local-day bucketing**. It breaks the moment
something needs a real elapsed-time comparison against `Date.now()` — which
is exactly what surfaced this session: `debriefEligible()`
(`src/lib/debrief/lifecycle.ts:44-45`) rejects any activity whose computed
`age` is negative, and a 2-hours-in-the-future `startDate` makes `age`
negative for roughly two hours after every single ride lands. That's the
proximate cause of tonight's "webhook didn't trigger" report (the webhook
worked fine; the debrief promotion that gates the push notification and
review popup didn't). It's also the underlying cause of two earlier
incidents this session (`isAwaitingReview`'s future-date check,
auto-describe racing the debrief).

This was investigated and deliberately deferred earlier in the same session,
specifically because fixing storage precedence without also fixing every
local-day read site would trade one bug (occasional false "not eligible yet")
for a worse one (wrong-day bucketing for any ride near local midnight). This
spec is that dedicated follow-up.

## Goals

- Fix `activities.startDate` to store the true UTC instant, so every
  `Date.now()`-relative comparison (freshness windows, eligibility age,
  "is this in the future" checks, recency ordering) is correct.
- Do not regress any of the ~20 call sites that currently compute the
  athlete's local calendar day/hour from `activities.startDate` — they must
  keep returning the athlete's real local day, unchanged.
- No new settings UI, no new dependency, no schema-breaking change. Scoped to
  activity start times only — not wellness dates (separate, date-keyed model,
  not affected by this bug).
- Backfill existing rows so historical data (weekly reviews, correlations,
  milestones) isn't left in a mixed-correctness state.

## Non-goals

- Real per-athlete IANA timezone tracking (auto-detected, stored on the
  user, used via a proper tz-aware library). This is the "textbook correct"
  long-term direction and remains compatible with everything below, but is
  strictly more scope than this fix needs — explicitly deferred, not part of
  this spec.
- Deduplicating the 18 separate `localYmd()` implementations into one shared
  utility. A legitimate cleanup, but unrelated to this bug — each call site
  gets a mechanical one-line input swap, not a rewrite.
- Fixing manual activity entry's `new Date("YYYY-MM-DD")` date-only parsing
  (`src/lib/activity-write.ts`). A separate, much smaller, pre-existing
  quirk (deterministic, at most an off-by-one-day edge case for very
  negative-UTC-offset athletes) that this bug's investigation surfaced but
  did not cause.

## Design

### Data model

Add one nullable column: `activities.start_date_local`
(`timestamp with time zone`). Purely additive — no change to the existing
`start_date` column's type or constraints, no default, no backfill required
by the migration itself (handled by a separate script, see below).

### Ingest — `connectors/intervals.ts::fetchActivities()`

New precedence for the two fields:

- `startDate` (true UTC instant): prefer `row.start_date` (has a real `Z`
  suffix). If absent — the only case observed is the Strava-sourced stub
  payload intervals.icu returns when it withheld real data (`"STRAVA
activities are not available via the API"`) — fall back to the sibling
  `strava`-provider row's already-correct `startDate`, matched by
  `externalId` (Strava's own connector has never had this bug — it already
  parses `start_date`, the true-UTC field, directly). If no sibling row
  exists yet, fall back to today's local-as-UTC parse as a last resort; it
  self-corrects on the next sync once the sibling row lands.
- `startDateLocal`: parsed from `row.start_date_local` exactly as today's
  code parses its single `start` value — i.e., identical value, just no
  longer conflated with the "true instant" field.

### Ingest — `connectors/strava.ts`

Already correct for `startDate`. Add `startDateLocal`, sourced from Strava's
own `start_date_local` field, for symmetry — low-traffic path today since
every local-day consumer already excludes `provider === "strava"` rows (the
existing AI-firewall filter), but keeps the two connectors' output shapes
consistent.

### Write paths

`sync/intervals-sync.ts` and `sync/strava-sync.ts` pass `startDateLocal`
through on insert/upsert alongside the existing `startDate`.

### Call-site migration

Every current reader of `activities.startDate` falls into one of three
buckets:

1. **Local-day/hour bucketing** — the 18 `localYmd()` implementations plus
   raw `.getHours()`/`.getDate()` calls on activity rows
   (`insights/auto-tags.ts`, `app/body/page.tsx`). One-line swap at each
   call site: `localYmd(a.startDate)` → `localYmd(a.startDateLocal ??
a.startDate)`. No rewrite of `localYmd` itself.
2. **Local-day-boundary DB range queries** — the few places filtering
   "today"/"yesterday" directly in SQL: `week-plan/service.ts:308-309`,
   `app/body/page.tsx:288`, `race/debrief.ts:181-182`. Swap their `gte`/`lt`
   boundary comparisons to `schema.activities.startDateLocal`.
3. **True-instant consumers** — age/freshness checks (`debriefEligible`,
   `isAwaitingReview`), recency ordering, "last N days" windows
   (`weekly-review.ts`, `coach-context.ts`, `strava-describer.ts`, and
   others). **No code change** — they keep reading `startDate` and are
   corrected automatically once it holds the true instant.

### Backfill

One-off script, `scripts/backfill-start-date-local.ts`, run manually after
the migration lands:

- Iterates existing `activities` rows and re-derives `startDate` /
  `startDateLocal` from each row's own already-stored `raw` JSON, using the
  same precedence logic as the connector fix above (including the
  sibling-row lookup for Strava stubs). No external API calls.
- Dry-run mode first: prints a count of rows that would change and the
  largest few deltas, writes nothing.
- Real run updates only rows whose recomputed values actually differ from
  what's stored.
- Idempotent — safe to re-run; a second run reports zero changes.

## Error handling / edge cases

- `start_date_local` missing from a raw payload (not observed, but
  defensive): `startDateLocal` stored `null`; every local-day call site's
  `?? a.startDate` fallback preserves today's exact behavior for that row.
- True `start_date` missing (Strava-sourced stub, no sibling row yet):
  falls back to local-as-UTC parse for that pass, self-corrects on the next
  sync once the native Strava sync has written its own row.
- Manual entries and any provider without a real local-wall-clock concept:
  `startDateLocal` stays `null`, same fallback behavior — unaffected by this
  bug both before and after the fix.
- Backfill script: a row with insufficient raw data is left with
  `startDateLocal = null` and `startDate` unchanged — same safe fallback,
  never a hard failure.

## Testing

- `intervals.ts::fetchActivities()` — unit tests for the new precedence
  order (true `start_date` preferred; stub-with-sibling fallback; last-resort
  local-as-UTC).
- `debriefEligible()` / `isAwaitingReview()` — regression test proving a
  future-appearing `startDateLocal` no longer blocks eligibility once
  `startDate` holds the real instant (directly targets tonight's symptom).
- One local-day-boundary regression test (e.g. `week-plan/service.ts`'s
  same-day check) for a ride near local midnight — the exact scenario the
  original deferral was worried about, proving no day-bucketing shift.
- Backfill script: dry-run count test + idempotency test (second run is a
  no-op).

## Live verification

After deploying, re-check the real test ride from tonight
(`externalId 19435415759`) directly against the live DB: confirm it promotes
to pending, the push notification fires, and the review popup appears —
closing the loop on the actual reported symptom, not just passing tests.

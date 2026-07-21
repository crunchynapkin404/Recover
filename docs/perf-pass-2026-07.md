# Performance pass — 2026-07 (v0.20, Task 16)

Scope: define a cold-load budget for the dashboard, audit the dashboard's
data-loading path plus the hot query paths it touches for N+1s and missing
indexes, fix what's real, and record the before/after honestly.

## The budget

**Committed budget: query-count / round-trip, not wall-clock.** The
sandbox's `DATABASE_URL` here points at `localhost:5434` — a loopback
Postgres with no network hop. Wall-clock numbers measured against it (below)
are real and useful as a *lower bound* / sanity check that no individual
query is pathological, but they understate what production sees once every
query pays a real network round trip (Neon, same-region TCP). So the number
this task is accountable to is:

> **The dashboard's server-side cold-load data fetch issues a bounded,
> fixed number of database round trips — independent of how much history a
> user has accumulated — and every one of those round trips hits an index
> for its filter/sort columns (or scans a result set small enough by
> construction that an index wouldn't change the plan).**

Concretely, for a user with an active plan, an open week, and an upcoming
race (the busiest real path through the page — everything is populated):
**26 round trips**, none of which grow with table size (all are `findFirst`,
`limit`-bounded, or filtered to a tight date window). That count is the
number to watch in future dashboard work — a change that pushes it into the
30s+ or, worse, makes it scale with a `for` loop, should get the same
scrutiny this pass gave the current code.

Supplementary wall-clock evidence (same 26-round-trip sequence, timed
end-to-end against the live loopback dev DB, real user data — 91 wellness
rows over 90d, 177 activities total, an open week plan, an active training
plan, an upcoming race): **56ms on a cold connection, 17–23ms once the
connection is warm.** Per-query cost was submillisecond to a few ms across
the board; nothing stood out as slow. (Measured with a temporary,
read-only timing script against user `b.abraas@gmail.com`'s real data,
scoped to `getLatest*`/`get*` read-only helpers only — no writes, no
generation calls. The script was deleted after use; it is not part of this
commit.)

## What was audited

Read `src/app/page.tsx` in full (752 lines) and traced every `db.query.*`
call it makes directly, plus every data-loading function it calls, into
their own source:

| Path | File | What it does |
|---|---|---|
| Connections + last sync | `page.tsx` inline | `connections.findFirst` (userId+status), `connections.findMany` (userId, columns-only) |
| Wellness (90d) | `page.tsx` inline | `wellnessDaily.findMany` (userId + date range), ordered by date |
| Recent activities (8) | `page.tsx` inline | `activities.findMany` (userId), `limit 8`, ordered desc |
| Morning insight | `src/lib/morning-insight.ts` → `getLatestMorningInsight` | `chatThreads.findFirst` (userId+kind), then `chatMessages.findMany` (threadId, `limit 10`, filtered in JS for non-debrief) |
| Weekly review | `src/lib/weekly-review.ts` → `getLatestWeeklyReview` | `chatThreads.findFirst` (userId+kind), `chatMessages.findFirst` (threadId+role) |
| Open week plan | `src/lib/week-plan/service.ts` → `getOpenWeekPlan` | `weekPlans.findFirst` (userId+status) |
| Today's plan adjustment | `src/lib/week-plan/service.ts` → `listAdjustments` | `planAdjustments.findMany` (weekPlanId), filtered/sliced in JS |
| Milestones | `src/lib/insights/milestones.ts` → `getMilestones` | 3 queries run via `Promise.all` (wellnessDaily select, trainingBlocks⋈trainingPlans, trainingPlans count) |
| Next race | `src/lib/race/service.ts` → `nextUpcomingRace` | `races.findFirst` (userId+status+date) |
| Race forecast inputs | `src/lib/race/service.ts` → `assembleForecastInputs` | up to 6 queries: open week (was: always re-fetched — see Finding 1), trainingPlans, dailyMetrics, trainingBlocks×2, weekPlans (lastClosed) |
| Daily metrics (30d) | `page.tsx` inline | `dailyMetrics.findMany` (userId + date range), ordered by date |
| Body prefs | `page.tsx` inline | `bodyPrefs.findFirst` (userId, unique) |
| Today's + month's activities | `page.tsx` inline | 2× `activities.findMany` (userId + date range) |
| Active plan + current block | `page.tsx` inline | `trainingPlans.findFirst` (userId+status), conditionally `trainingBlocks.findFirst` (planId+weekNumber) |

Also cross-checked every filter/sort column above against
`src/lib/db/schema.ts`'s existing `index(`/`uniqueIndex(` declarations
(listed in full below) before proposing anything, per the task's explicit
instruction not to duplicate existing indexes.

### Existing indexes (schema.ts, before this pass)

```
connections_user_provider_uq        (userId, provider)          unique
activities_provider_external_uq     (activityId... )             unique
activities_user_start_idx           (userId, startDate)
activities_user_debrief_idx         (userId, debriefState)
activity_streams_activity_type_uq   (activityId, type)           unique
wellness_user_date_uq               (userId, date)                unique
wellness_user_date_idx              (userId, date)
wellness_search_idx                 gin(search)
daily_metrics_user_date_uq          (userId, date)                unique
coach_memories_user_idx             (userId)
chat_messages_thread_idx            (threadId, createdAt)
chat_messages_search_idx            gin(search)
sync_jobs_due_idx                   (status, runAfter)
biomarkers_user_name_date_uq        (userId, name, date)          unique
biomarkers_user_name_idx            (userId, name)
llm_usage_user_created_idx          (userId, createdAt)
athlete_curves_user_kind_params_uq  (userId, kind, params)        unique
training_plans_user_status_idx      (userId, status)
training_blocks_plan_week_uq        (planId, weekNumber)          unique
races_user_date_name_uq             (userId, date, name)          unique
races_user_status_date_idx          (userId, status, date)
week_plans_user_week_uq             (userId, weekStart)           unique
week_plans_user_status_idx          (userId, status)
plan_adjustments_week_idx           (weekPlanId, date)
webhook_subscriptions_user_idx      (userId)
webhook_deliveries_subscription_idx (subscriptionId, ...)
```

Every filter in the table above lands on one of these — with one exception
(Finding 2).

## Findings

### No classic N+1s

Read every `db.query.*` call in the audited path end to end: **none of them
run inside a loop, and none of them issue a per-row follow-up query.** The
closest thing to a fan-out is `getMilestones`'s 3 queries, but those run in
parallel via `Promise.all`, not sequentially per-row, and are each a single
aggregate/select over the whole user, not one per record. This matches what
the task brief predicted was plausible — prior releases (v0.10 Honest Load,
v0.14 Race Ready, v0.15) already touched these exact query paths under
review, and it shows.

### Finding 1 (fixed) — redundant `getOpenWeekPlan` re-fetch

`page.tsx` fetches the open week plan once (`const weekPlan = await
getOpenWeekPlan(user.id)`, line 159) for the living-week card. Later, when
there's an upcoming race, it calls `assembleForecastInputs(user.id, race,
todayDate)` — which **internally called `getOpenWeekPlan(userId)` again**
(`src/lib/race/service.ts`, was line 193), silently re-fetching identical
data already sitting in a local variable one screen up. Not an N+1 (it
doesn't scale with anything), but a genuine duplicate round trip on every
cold load that has both an open week and an upcoming race — the exact
combination that's the busiest, most-worth-optimizing case.

**Fix:** `assembleForecastInputs` gained an optional 4th parameter,
`preloadedWeek?: OpenWeekPlan | null`. Passing it (as `page.tsx` now does)
skips the internal fetch entirely; omitting it (as `src/lib/tools/
simulate-plan-change.ts` and `src/app/plan/actions.ts` still do — neither
has the week plan in hand at their call sites) preserves the exact original
behavior. `null` is distinguished from `undefined` so a caller can also
assert "there is definitely no open week" without paying for a query — this
distinction is exercised by the second test.

- Changed: `src/lib/race/service.ts` (`assembleForecastInputs` signature +
  body), `src/app/page.tsx` (call site now passes `weekPlan` through).
- Equivalence test: `src/lib/race/service.test.ts` — seeds a real
  `test-race-service-user` training plan / block / week plan / daily
  metric, then asserts `assembleForecastInputs(user, null, now)` (fetch
  fresh) and `assembleForecastInputs(user, null, now, week)` (preloaded)
  return `toEqual` identical output, plus a second test that
  `preloadedWeek=null` matches the natural "no such user" miss. Both pass
  (`npx vitest run src/lib/race/service.test.ts` → 2 passed).
- Net effect: −1 round trip on the busiest real path (26 → 25 in the
  "everything populated" case; unconditionally −1 whenever `race` is
  non-null, since that's the only branch that called
  `assembleForecastInputs`).

This is a small win — one query out of ~26 — and is reported as such, not
inflated. It's the one clean, safe, no-schema-change fix Step 3 asked to be
preferred, and it was real, so it's included.

### Finding 2 (fixed, migration `0022`) — `chat_threads` has zero indexes

Every other per-user table in the schema (`wellness_daily`, `activities`,
`daily_metrics`, `coach_memories`, `training_plans`, `races`, `week_plans`,
`biomarkers`, `llm_usage`, `webhook_subscriptions`, ...) carries at least one
index on `userId` or `(userId, <hot filter column>)`. **`chat_threads` had
none** — not even on `userId` alone. It's queried by `(userId, kind)` in four
places, two of them on this dashboard's cold-load path:

- `src/lib/morning-insight.ts` — `findOrCreateMorningThread` +
  `getLatestMorningInsight`, both `(userId, kind='morning')`
- `src/lib/weekly-review.ts` — `findOrCreateWeeklyThread` +
  `getLatestWeeklyReview`, both `(userId, kind='weekly')`
- `src/lib/monthly-report.ts` — same pattern, `kind='monthly'`
- `src/app/coach/page.tsx` — lists **all** threads for a user, `userId`
  alone, ordered by `updatedAt desc`

Confirmed via `EXPLAIN (ANALYZE, BUFFERS)` against the live dev DB before
adding the index:

```
explain (analyze, buffers) select * from chat_threads
  where user_id = '<real user>' and kind = 'morning' limit 1;
->  Seq Scan on chat_threads (actual time=0.012..0.012 rows=1 loops=1)
      Filter: ((user_id = ...) AND (kind = 'morning'))
      Rows Removed by Filter: 35
```

Row counts on this dev DB are small (61 `chat_threads` total; the real user
already has 58 of them — this is a per-conversation table with no cap, so it
grows with usage, not with time alone). At today's size Postgres correctly
prefers a seq scan over an index scan regardless — re-running the same
`EXPLAIN` on `wellness_daily`, which *does* have a `(userId, date)` index,
shows the planner picking a seq scan there too, at a similar row count. That
is the honest caveat: **this index will not change today's query plan.** It
is the same forward-looking bet every other index in this schema already
made — added because the access pattern is real and the table has no
natural cap, not because `EXPLAIN` shows a win today.

Per this task's explicit migration constraint (the plan's own guidance:
"add indexes only for a demonstrated missing index on a hot path, prefer
query-shape fixes otherwise" — and the dispatching agent's clarified
constraint that `0022` is the correct, available next migration number,
superseding the brief's now-stale placeholder text about "no migration
beyond 0020/0021" since both of those already exist as merged files on this
branch), this qualifies: real column, real hot path, zero existing index,
purely additive.

- Added: `chat_threads_user_kind_idx` on `(userId, kind)` —
  `src/lib/db/schema.ts`.
- Generated via `npm run db:generate` → `drizzle/0022_typical_tattoo.sql`:
  ```sql
  CREATE INDEX "chat_threads_user_kind_idx" ON "chat_threads" USING btree ("user_id","kind");
  ```
  Single statement, purely additive, no data change — confirmed no
  collision with `0020`/`0021` (both already present on this branch;
  `0022` is genuinely the next free number).
- Applied via `npm run db:migrate` — confirmed live:
  ```
  select indexname from pg_indexes where tablename = 'chat_threads';
  → chat_threads_pkey, chat_threads_user_kind_idx
  ```
- No test needed for the index itself (additive index changes no query
  results — nothing to prove equivalent). The existing test suite (843
  tests, unchanged) still passes with it in place.

### Checked and found not material

- **`listAdjustments`** orders by `createdAt` but the only index on
  `plan_adjustments` is `(weekPlanId, date)` — technically a sort the index
  doesn't cover. Not fixed: adjustment rows per week plan are a handful at
  most (one per rollover/adaptation event in a single week), so this never
  becomes a real scan regardless of overall table growth.
- **`chatMessages.findFirst`** in `getLatestWeeklyReview` filters
  `(threadId, role='assistant')` against an index on `(threadId,
  createdAt)` — role isn't in the index. Same reasoning: message count per
  thread is small and bounded (the weekly thread gets ~1 message per
  review cycle), so the leftmost `threadId` equality already does the real
  work.
- **`getMilestones`'s trainingBlocks⋈trainingPlans join** filters on
  `trainingPlans.userId` (indexed) and `trainingBlocks.adherencePct`
  (unindexed) — but blocks per plan are bounded (a plan has at most
  `weeksTotal` blocks, typically ≤ 52), so this is a small in-memory-scale
  join regardless of total table size.

None of these are "hot paths" in the sense the task asked to hunt for — they
don't scale with total data volume, only with a single user's bounded
per-entity row count. Flagging them here so a future pass doesn't have to
re-derive the same reasoning, but not touching them.

## Commands run

```
npm run db:generate          # → drizzle/0022_typical_tattoo.sql
npm run db:migrate           # applied to the live dev DB
npx tsc --noEmit             # clean
npm run lint                 # 0 errors (pre-existing unrelated warnings only)
npx vitest run                # 154 files / 843 tests passed
npx vitest run src/lib/race/service.test.ts   # 2/2 passed (equivalence)
npm run build                 # next build — compiled + typechecked clean
```

## Self-review

- Query-shape change (Finding 1): equivalence test added and passing —
  `preloadedWeek` fetch-fresh vs. preloaded paths return `toEqual`-identical
  output; a perf fix that changed results would be a bug, and this doesn't.
- Index migration (Finding 2): confirmed `0022` doesn't collide with
  `0020`/`0021` (both already exist as separate files), confirmed the
  generated SQL is a single additive `CREATE INDEX` with no data mutation,
  and confirmed it's live via `pg_indexes`.
- No pointless micro-optimization was fabricated. The audit's honest
  headline is: **the dashboard path was already close to clean** — no
  classic N+1s, no scaling-with-data-volume queries, and 24 of 26 hot-path
  filter/sort columns were already indexed by prior releases. The two
  findings above are real (a genuine duplicate query, a genuinely
  unindexed hot-path table) but both are modest in impact, and this doc
  says so rather than dressing them up.

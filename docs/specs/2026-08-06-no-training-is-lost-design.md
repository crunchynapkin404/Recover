# v0.44 — No training is lost

The week plan's actuals are supposed to record what the athlete did. On the
live instance they record less than half of it.

The week of 2026-07-27 closed with `actualLoad: 314`. The athlete's real
intervals.icu load that week was **783**. Nothing was estimated wrong and no
sync failed — 469 units of real training were simply written nowhere.

This release makes the stored actuals a function of the activities table
rather than of the order in which a day's status happened to change.

---

## 1. What is actually broken

`runDailyAdaptation` (`src/lib/week-plan/service.ts`) books activity load in
two branches, and only ever for yesterday:

1. yesterday's status is `planned` / `moved` / `adapted` → look for an activity
   whose sport matches that slot's planned sport; on a hit, book its load
2. yesterday's status is `rest` / `race` → sum every activity that day and book
   it as `unplannedLoad`

`DayStatus` has seven members: `planned`, `completed`, `adapted`, `moved`,
`missed`, `rest`, `race`. The two branches cover five. **`completed` and
`missed` are covered by neither**, so a day in either state books nothing.

That is not an edge case. `markDayDone` — the app's own "Mark done" button —
sets `status: "completed"`. Pressing the button the interface offers deletes
that day's load from the week.

`markDayDone`'s doc comment states the opposite:

> a manual tick moves the week's session count and nothing else — if the ride
> later syncs, adaptDay attaches the real load and the day is already where it
> belongs.

`adaptDay` cannot attach anything. No branch will look at that day again. The
guarantee was never true.

### The live evidence

Week of 2026-07-27, as stored, against the same week's non-Strava activities:

| date  | day status | planned | real activity  | booked           |
| ----- | ---------- | ------- | -------------- | ---------------- |
| 07-27 | completed  | Bike    | Ride, load 184 | `actualLoad` 184 |
| 07-28 | completed  | Bike    | Ride, load 155 | **nothing**      |
| 07-29 | rest       | —       | —              | —                |
| 07-30 | rest       | —       | Rides 63 + 67  | `unplanned` 130  |
| 07-31 | rest       | —       | —              | —                |
| 08-01 | completed  | Bike    | Ride, load 314 | **nothing**      |
| 08-02 | rest       | —       | —              | —                |

Stored total 314. Real total 783.

It feeds forward. `materialize.ts` clamps the next week's target to
`prevWeek.actualLoad ± RAMP_CLAMP_PCT` (20 %), so a week under-reported by 60 %
produces a target computed from the wrong base. Off an `actualLoad` of 314 that
clamp admits 251–377, and the current open week (2026-08-03) carries
`effective_target: 259`. Off 783 it would admit 626–940. Which `materialize`
branch produced 259 has not been traced; the point is the range it was allowed
to land in.

### The five holes, all one shape

| #   | Hole                                                     | Consequence                                          |
| --- | -------------------------------------------------------- | ---------------------------------------------------- |
| 1   | `completed` days book nothing                            | live: 469 load lost in one week                      |
| 2   | `missed` days book nothing                               | work done after a day was written off is lost        |
| 3   | a planned day trained as a different sport books nothing | the original F2; a cross-training day disappears     |
| 4   | branch 1 takes `findFirst`; branch 2 sums                | a second session on a planned day is dropped         |
| 5   | only yesterday is booked, once                           | an activity that syncs two days late is lost forever |

A sixth surfaced while designing the fix: `rolloverWeekPlan` computes the
closing week's actuals from the **stored day fields**, so if no adaptation pass
ran between the week's last day and the rollover, that day closes at zero. The
two are triggered independently — `runDailyAdaptation` from
`onWellnessDataChanged`, `rolloverWeekPlan` from the weekly review — with no
ordering guarantee between them.

### The root cause

One query is answering two unrelated questions:

- **Did the planned session happen?** Needs sport matching, needs the
  `activitiesSettled` guard, applies to yesterday alone, and exists to feed
  `adaptDay`'s missed-workout handling.
- **What work happened?** Needs neither sport matching nor a status gate, and
  applies to every past day of the week.

Tangling them is why five defects share one shape. Separating them is the fix;
the rest is consequence.

---

## 2. Design

### 2.1 One derivation

New module `src/lib/week-plan/actuals.ts`:

```ts
export interface DayActuals {
  count: number;
  secs: number;
  load: number;
  /** That day's most recent activity — what branch 2 already stores today. */
  activityId: string;
}

export async function deriveDayActuals(
  userId: string,
  fromYmd: string, // inclusive
  toYmd: string // inclusive
): Promise<Record<string, DayActuals>>;
```

Selects the user's activities with `provider != 'strava'` (the Nov 2024 API
agreement firewall, and the reason every ride exists twice with diverging
loads), windowed and bucketed on `coalesce(start_date_local, start_date)`.

The existing `/train` copy of this query windows on bare `start_date` with no
`coalesce`, which silently drops rows predating the `start_date_local`
backfill. The shared version takes the service's form.

Both the window bound and the bucketing read **local** time, which is the
container's `TZ=Europe/Amsterdam`. That coupling carries a comment: it is what
breaks if the container timezone moves again.

### 2.2 One booking rule, pure

```ts
export function bookWeekActuals(
  days: DaySlot[],
  actuals: Record<string, DayActuals>,
  throughYmd: string // inclusive
): DaySlot[];
```

For every day at or before `throughYmd`, the stored fields become a pure
function of the derivation:

- activities present → book the day's summed load, and set `activityId` to the
  most recent of them
- no activities → clear `actualLoad`, `unplannedLoad` and `activityId`

Clearing is deliberate. It is what makes the pass idempotent and self-healing:
re-running writes the same JSON, the change detection sees nothing, and the
pass reports `skipped`. It also means a deleted activity correctly stops
counting.

Which field receives the load is the rule already in the codebase —
`recordUnplannedLoad` books to `unplannedLoad` when the day has no workouts and
to `actualLoad` when it does. It is renamed **`bookDayLoad`**, because it now
books both and the old name describes half of it. No new branch is needed for
the cross-sport case: `adaptDay` runs first, and `handleMissedYesterday` empties
a missed day's `workouts`, so a cross-sport day routes to `unplannedLoad` on its
own.

Three callers, one rule:

| caller               | `throughYmd`        |
| -------------------- | ------------------- |
| `runDailyAdaptation` | yesterday           |
| `rolloverWeekPlan`   | the week's last day |
| the repair script    | the week's last day |

### 2.3 `runDailyAdaptation` splits

The sport-matched lookup stays exactly as it is — `providerSportAliases`, the
`activitiesSettled` bound, yesterday only, only when yesterday is `planned` /
`moved` / `adapted` — but it now returns only a boolean. It no longer carries
the load.

After `adaptDay` returns, `bookWeekActuals` books every day before today.

Today is deliberately not booked: its load is still accumulating, and
`/train` already renders today live from the activities table. The week's final
day is covered by the rollover change below.

### 2.4 `rolloverWeekPlan` closes from the table

`weekActuals` currently sums whatever the day slots hold. Rollover now re-derives
the full week and books it before summing, which closes hole 6 permanently: the
closing numbers no longer depend on whether an adaptation pass happened to run
first. It iterates every open row, so each derives over its own week's dates.

`actualSessions` stays status-driven. It counts sessions on `completed` days —
a question about the plan, not about load.

### 2.5 `/train` loses its copy

`src/app/train/page.tsx` drops its inline bucketing loop and calls
`deriveDayActuals`. Its comment already says why it exists — _"read from the
activities table rather than the day slot's own `unplannedLoad` ... which is
exactly the gap this closes"_. The display was right all along; it was the
stored value that was wrong. After this release the two agree by construction
rather than by coincidence.

### 2.6 `markDayDone`'s comment becomes true

No code change. The claim that a later sync attaches the real load is accurate
once every past day is booked on every pass.

---

## 3. Repairing what is already stored

`scripts/repair-week-actuals.ts`.

**Dry run by default.** `--apply` writes. User scoping is mandatory:
`--user <id|email>`, or `--all` spelled out in full. A pass that walks
`week_plans` DB-wide with no scope is the exact shape that has written
fabricated rows into real accounts in this project before.

For each of the user's week rows it derives, books, diffs against what is
stored, and prints the per-day delta. On `--apply` it writes the `days` JSON
and, for closed weeks, recomputes `training_blocks.actual_load`,
`actual_sessions` and `adherence_pct` through the existing `weekAdherencePct`.

It never touches `activities`, and it never re-materialises or re-targets a
week. Correcting history is in scope; rewriting a week the athlete is midway
through is not.

**Expect a startling number.** Correcting 2026-07-27 from 314 to 783 against
its target of 244 moves that week's adherence from 129 % to 321 %. That is the
honest figure, and it says this athlete trains well above plan. It feeds
`project.ts`'s forecast and the coach's weekly review once applied, which is
why the diff is read before anything is written.

---

## 4. Deliberately out of scope

**The completion judgement is still one-shot.** If the activity sync has not
settled on the morning a day is "yesterday", `yesterdayCompleted` stays null and
no later pass asks again. That day sits in the past still marked `planned`.

Consequences, stated so they are not rediscovered as a surprise:

- its load books correctly, so no training is lost — this release's claim holds
- but a cross-sport day whose sync was late books to `actualLoad` rather than
  `unplannedLoad`, because its `workouts` were never emptied
- and `actualSessions` under-reports, because the day never reached `completed`

Fixing it means judging every unjudged past day, which raises a second question
this release should not answer: whether a session missed four days ago may still
move forward into the remaining week. **Carried to v0.45.**

Also untouched: the live instance has two `week_plans` rows in status `open`
(2026-07-13 with a null `effective_target`, and 2026-08-03). `getOpenWeekPlan`
orders by `week_start desc` and `rolloverWeekPlan` closes every open row, so the
stale row is inert. Recorded, not fixed.

---

## 5. Testing

`deriveDayActuals` — Strava exclusion; multiple activities on one day summed;
null `load` treated as zero; the `start_date_local → start_date` fallback; local
midnight bucketing at both edges of the window.

`bookWeekActuals`, pure and therefore directly assertable — a `completed` day
with workouts books `actualLoad`; a day with no workouts books `unplannedLoad`;
a day with no activities has both fields cleared; **a day that is already
correct comes out byte-identical**, which is the property the repair script's
safety rests on.

**The regression.** Reproduce the live week: four days with planned Bike
sessions, two of them flipped to `completed` through `markDayDone`, one rest day
carrying two rides. Assert `weekActuals` returns 783.

That test is **mutation-checked against the pre-fix booking code** and must fail
there. A regression test for a silent defect that passes on the broken version
proves nothing, and this repository has shipped that mistake before.

Then one test each for: cross-sport booking to `unplannedLoad`; an activity
syncing two days late still booking; rollover closing correctly with no prior
adaptation pass; and running the pass twice returning `skipped` the second time.

DB-gated files keep `describe.skipIf(!hasDb)` even though CI has run a Postgres
service since v0.40.

---

## 6. Release

No migration — `actualLoad` and `unplannedLoad` already exist on the day slot
and nothing changes shape.

Version 0.44.0, "No training is lost". CHANGELOG entry, `docs/ROADMAP.md` tick,
and the v0.44 row in `docs/specs/2026-08-05-ai-coaching-landscape.md` marked
shipped.

**Live verification is owed and is part of the release, not after it:** run the
repair dry run against the live database and read the diff before applying
anything, then confirm after deploy that the open week books a real day. Several
recent releases have carried unpaid verification debt of exactly this shape.

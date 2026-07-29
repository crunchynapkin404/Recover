# HANDOFF — 2026-07-29

**Read this first.** It is the complete state of play for a fresh session. Two
releases shipped today; one feature is designed but unwritten; several defects
are known and deliberately deferred.

---

## Where things stand right now

|                                     |                                                                     |
| ----------------------------------- | ------------------------------------------------------------------- |
| `main`                              | `3ed947d`, CI green (checks + docker)                               |
| Latest tag                          | `v0.28.1`, Release workflow green (amd64 + arm64)                   |
| Gate                                | format:check ✓ typecheck ✓ lint 0 errors ✓ **1472 tests** ✓ build ✓ |
| Working tree                        | clean                                                               |
| Branch `fix/adaptation-idempotency` | merged, can be deleted                                              |

**The gate for this repo is all five, in this order.** Two consecutive releases
each dropped a different member and each omission broke `main`:

```bash
npm run format:check && npm run typecheck && npm run lint && npm test && npm run build
```

`docs/ROADMAP.md` needs **two** `prettier --write` passes to converge — one
leaves it still failing `--check`.

---

## THE NEXT TASK: next-week preview + availability horizon

This is what the user asked for and what the next session should build. The
brainstorm is **complete through step 5** of `superpowers:brainstorming` (design
presented, user approved the scope). **Still owed: write the spec doc, spec
self-review, user review of the spec, then `superpowers:writing-plans`.**

### The problem, in the user's words

> "on sunday you cant see what you need to do the next week"

### Decisions already made — do not re-litigate

1. **Approach A — compute on render, never persist.** Rejected: a `status:'draft'`
   week row (breaks `getOpenWeekPlan`'s single-open-week assumption and rollover
   idempotency, and a stored forecast going stale is _exactly_ the defect v0.28.0
   existed to kill). Also rejected: availability-horizon only, with no preview.
2. **Full days, plus the ability to pin next week's availability early.** Not
   "shape only" (phase/session-count/hours), which would not answer "what am I
   doing Monday".
3. **Next week only.** Beyond that the projection stacks assumption on
   assumption, since each week's shape depends on how the previous one closed.
4. **Rolling day list**: completed days fall off; the list runs from today into
   next week with a **visible week boundary**.
5. **The weekly panels stay weekly** — "Why this week", adherence and the weekly
   review all describe the closing Mon–Sun week; making them rolling would break
   the arithmetic they report.

### Verified facts — these were checked against the code, trust them

- **`computeWeekRepair(userId, now)` in `src/lib/week-plan/repair.ts:122` already
  computes a full week without persisting it**, via
  `assembleVolumeInputs → weeklyTargetHours → hoursForMaterialize → periodize →
materializeWeek`. It is hardwired to `getOpenWeekPlan`. **Generalise it to
  `projectWeek(userId, weekStart, now)` and have the repair script, the rollover
  and the preview all call that one derivation.** Same pattern as
  `assembleWeeklyTarget` — one producer, several consumers, structurally unable
  to disagree.
- `resolveWeek(userId, dates)` in `src/lib/availability/resolve.ts:16` takes
  **arbitrary dates**. It has no notion of "this week".
- `availability_defaults` is keyed by **weekday**, so the standard week already
  applies to every future week. `StandardWeek` writes only that table. **No
  change needed there.**
- `availability_overrides` is keyed by **date** and is date-generic.
- **The single point of week-scoping is `syncDateOverrides`
  (`src/lib/availability/sync-overrides.ts:77`)**, which calls
  `getOpenWeekPlan(userId)` and iterates `week.days`. Generalising this to accept
  a target week start is Phase 1's core change.
- `submitAvailability` (`src/app/plan/actions.ts`) feeds it; the form lives at
  `src/app/train/page.tsx:593`.

### Suggested shape

**Phase 1 — availability horizon.** Generalise `syncDateOverrides` and let the
editor address next week. Useful on its own and it is the real unlock: a day
pinned on Thursday **is** honoured by Monday's rollover, because `resolveWeek`
already reads those overrides.

**Phase 2 — the projection and the rolling list.** `projectWeek` for next
Monday; render the rolling list with the week boundary marked.

### Honesty rules the design commits to

Three inputs feed the projection and only one is known:

- next week's availability — **known** once pinned, standard-week otherwise
- **how this week finally closes** — unknown until Sunday
- readiness bands — unknown

So: pinned days render firm, unpinned days render provisional **and say why they
might move**. This app's whole character is saying what it knows and refusing to
guess; the preview must not imply more certainty than it has.

### Hard constraints

- **Never persist the projection.** No second `week_plans` row, ever.
- The preview must never trigger adaptation or replan as a side effect of
  rendering.
- Availability remains a **ceiling, never a target**.

---

## Research already done — do not redo it

**JOIN Cycling has NOT solved this.** "Availability beyond one week ahead" is an
open request on their public roadmap with **152 votes, 6 comments, not shipped**;
their changelog reads "No changes published". JOIN today does what Recover does:
availability for the upcoming week, plan built around it, re-adapts mid-week.
There is no wheel to copy. 152 voters does confirm the gap is real and
widely felt.

**JOIN's fill rule, extracted from their help centre** (relevant to the deferred
fill rung below): _"if a training session today would prevent a session tomorrow
(because it would be too many consecutive days) and tomorrow has more time
available, JOIN may recommend skipping today's session to better utilise the
coming days."_ Their logic is **week-optimising, not greedy-today**, and it also
weighs muscle soreness and fatigue.

**TrainerRoad** separates the two concerns: Adaptive Training adapts the plan;
TrainNow answers "I have time right now, give me something" in three categories
(endurance / climbing / attacking) — and manually adding a workout _disables_
adaptive suggestions.

**Training science, for the fill rung.** A large load spike roughly **doubles
injury risk**, and the injury typically appears **7–28 days later**, so the
athlete can never connect it back to the app — the guard has to live in the
software. ACWR sweet spot 0.8–1.3 (Recover's `HEADROOM 1.3` matches its upper
bound); practitioners often limit weekly increases to <10%, more conservative
than Recover's `RAMP_CLAMP_PCT` of 20%. Spikes are most dangerous when volume,
intensity and terrain rise together — so added _endurance_ volume is far safer
than added intensity.

`help.join.cc` returns **403 to WebFetch**; use search snippets instead.
`joincycling.featurebase.app` is a JS SPA and fetches as an empty shell.

---

## Deferred work, in priority order

### 1. The replan "fill" rung — the user's original request

`replanWeek`'s own first line: _"Unlike materializeWeek this never regenerates
the week: it recomputes each day's availability, then walks only the sessions
that no longer fit — move, compress, substitute, drop."_ **Every rung shrinks.**
Adding availability mid-week cannot produce training, by construction.

That property exists for a good reason — stability, so sessions you planned
around do not shuffle. **The fix is a fifth rung that adds, not a
re-materialisation.** After the existing rungs settle, if the week is materially
short of target _and_ there is admitting availability, generate the extra
session — existing sessions never move, bounded by target, ramp guard and ACWR
ceiling.

It needs the **live** target, not the frozen one (see #2). `assembleWeeklyTarget`
already exists for that.

**This was deliberately not built yet**, because while sessions were being
wrongly written off as missed it would have filled the athlete from a
"fully missed" week straight into the load spike above.

### 2. Late-load reconciliation

`rolloverWeekPlan` closes last week and builds the next from whatever load is
booked _at that instant_. If load arrives late (a backfill, a delayed sync), the
closed week's adherence is corrected but **the week built from it never is**.
Observed live: week 2026-07-20 closed with `bookedLoad=0`, was rebuilt at
2026-07-28T08:19 to 496, and this week still carries a 60% restart from the
false reading.

Also frozen-vs-live: `week.days` are stored, while the target shown by
`WeekRationale` is recomputed on every render. The user saw "4h planned against a
12.5h target" where the two numbers came from different states.

### 3. Stale open weeks and multiple active plans

Live data shows **two `week_plans` rows for `2026-07-13`** — one `open`, one
`closed`, different plans. The user has **three `status='active'` training
plans**, and `activePlan` does `findFirst`, so it picks one arbitrarily. Latent
for a while; worth closing before it bites.

### 4. Minors

- `low_readiness` adjustment is logged before a trailing `fitAvailability` may
  move or drop that session — log noise only, week is correct.
- `readinessBase.workouts` snapshots the whole day's array while only
  `workouts[0]` is readiness-adapted; a multi-session day where availability
  removes the first workout is handled conservatively, not generally.
- Four rides on 2026-07-23 have `load = null` and are therefore unbookable.
- No FTP sanity floor: a real user with `eftp = 62 W` gets the Dolomites priced
  at 140.8h total / 56.35 h/week.
- `EventReadiness` and `RaceChip` can name **different races** — priority-first
  vs date-first selection.
- No horizon on target-race selection: an A race 50 weeks out drives this week's
  volume at full ceiling immediately.

### 5. Owed manual check

The v0.28.0 **inertness check**: a plan with no event distance must materialise
identically to before. The calibration check already **passed** (8 days / 900 km
/ 20,000 m → "asks about 15.7h a week", inside the 15–19 band).

### 6. Running and triathlon still discard the remainder

v0.30 fixed cycling: `generateCyclingWorkouts` no longer throws away whatever
a session bound clamps off — `distributeRemainder` pushes it onto sessions
that still have headroom instead
(`docs/specs/2026-07-29-cycling-session-distribution-design.md`).
`generateRunningWorkouts` and `generateTriathlonWorkouts` were deliberately
left untouched and still carry the identical defect: a clamped session's
lost minutes are dropped, not redistributed.

**Do not port cycling's fix across sports.** That is exactly the mistake
that produced the original bug — a flat 240/90-minute cap borrowed without
regard for what each sport's own evidence says. Running's correct rule is
athlete-relative, not event-relative: a study of 5,200+ runners found that
exceeding your own recent longest run by 10–30% raises injury risk by 64%.
Cycling has no equivalent single-session spike rule to borrow — its safety
bound is cumulative (the ACWR ceiling and the ramp clamp, both already
applied upstream of the generator), which is why bounding the long ride by
event demand was safe for cycling specifically. Running needs its own spec
built around the longest-run rule, not a copy of `longRideBoundMins` /
`distributeRemainder`.

---

## What shipped today

**v0.28.0 — race-driven training volume.** Weekly hours derive from the event
being trained for, bounded by measured capacity (ceiling 1.3× rolling peak, floor
0.6×), suppressed entirely with no history. `WeekRationale` and `EventReadiness`
explain the result.

**v0.28.1 — the adaptation hotfix.** Three live defects:

1. `adaptDay` read its own output as its input, so readiness scaling compounded
   on every wellness event (five call sites, one an hourly Apple Health push). A
   real 137-minute ride reached **60 minutes in five runs and 8 in twelve**.
2. Sessions written off as missed **before the ride could sync** (04:50, the
   morning after an 18:50 ride). Three consecutive weeks closed as "fully missed"
   while the athlete rode ~7 h/week, each cutting the next to 60% of skeleton.
3. No-op availability changes re-running the replan.

Review then caught two more before merge: `unplannedLoad` accumulating on every
run (the write loop was still open, and it inflates the next week's ramp target),
and a regression of ours that **deleted a quality session outright** when a band
change coincided with an availability collapse.

**The repair was applied to live data** (scoped `--user`, rollback point taken,
idempotency verified). `2026-08-01` went from `Recovery 90m` → `Long 215m`;
settled days kept their `actualLoad` and activity ids.

`scripts/repair-corrupted-week.ts` is dry-run by default. **It recomputes from
_current_ inputs, so unscoped it will rewrite other users' weeks — always pass
`--user`.**

---

## Traps

- **CI never sets `DATABASE_URL`**, so every `describe.skipIf(!hasDb)` suite
  skips there. Reverting the Task 9 _call site_ from v0.28.0 is caught by nothing
  that runs in CI. Locally: `set -a; . ./.env; set +a`.
- **`@testing-library/react` is NOT installed** — only `jsdom`. Three separate
  tasks planned tests against it. Stateless components use `renderToString`;
  interactive ones use hand-rolled `react-dom/client` + `act()`
  (`tests/journal-form.test.tsx`).
- `.env` / `.env.local` point at the **dev** DB (port 5435). **Port 5434 is LIVE
  user data.** `.env.live-restore` holds the live URL; treat it as read-only
  unless the user has explicitly consented to a write.
- `psql` is **not installed**; run DB work through `npx tsx scripts/…`.
- Vitest only scans `src/**` and `tests/**` — a test in `scripts/` is silently
  never run.
- `.superpowers/sdd/` accumulates `task-N-*.md` across _different_ plans and they
  actively mislead. Check a brief is actually yours.

## The lesson this project keeps teaching

Across v0.28.0 and v0.28.1, **every defect found was in the plan or the
instructions, not in the code the implementer wrote** — and the test suite was
green throughout. Three times in one day my own instructions were wrong:

- a reproduction test asserting a value that would mean the feature never applies
- a repair spec that would have **deleted real load** from a `rest` day carrying
  620 unplanned load
- a page-wiring justification asserting a variable was out of scope when it was
  one line above

**Keep the standing instruction in every implementer dispatch:** _if a numeric
expectation does not hold, STOP and report rather than loosening it._ It has now
fired more than a dozen times and the plan was wrong every single time.

And **read the output of agents that die mid-run** — a reviewer cut off by a
session limit had, in its last partial sentence, the question that found the
availability-vs-restore ordering bug.

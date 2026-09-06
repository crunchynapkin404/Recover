# Fixtures that key on the real calendar

_2026-09-06. Answers the question v0.139.0 left open: "worth checking whether
any other fixture keys on the date this way."_

## Why this was worth a day

`npm test` runs in `ci.yml`, and `ci.yml` is a release gate. A test that is red
on certain dates therefore does not merely fail — it stops anything shipping,
on days nobody chose and nobody can see coming.

That is not hypothetical. `fuelling-open-day.test.tsx` picked Saturday of the
current week as its "open day" and threw when today WAS that Saturday. It
blocked v0.139.0 on 2026-09-05: one day in seven, no release possible. The
fixture was fixed in that release. Whether it was the only one was written
down and not answered.

It was not the only one. **Nine more, across five files** — and the Saturday
bug was the mild version of the class, because it cleared the next morning.
Four of these do not.

## The instrument

`tests/setup/shift-clock.ts`. Inert unless `CLOCK_SHIFT_DAYS` is set; a normal
run pays nothing.

It shifts **only** the no-argument forms, `new Date()` and `Date.now()`, by a
whole number of days. Every other constructor form and every static passes
straight through, so a fixture that names an absolute date still gets that
date — which is the point, since pinned dates are half of what this hunts.
Offset-based rather than frozen, so time still advances and timers behave.

```bash
CLOCK_SHIFT_DAYS=3 npm test     # as if today were three days from now
```

**A null result from an unvalidated instrument is worth nothing, so the
instrument was validated first.** Restoring the pre-fix `fuelling-open-day`
fixture from `8c4e9bf6` and running it under the shim reproduces the original
release-blocker exactly:

| fixture                | +5 (Friday) | +6 (Saturday)                                  |
| ---------------------- | ----------- | ---------------------------------------------- |
| pre-fix (`8c4e9bf6`)   | 2 passed    | **`fixture collision: OPEN_DAY equals TODAY`** |
| as shipped in v0.139.0 | 2 passed    | 2 passed                                       |

## What the sweep covered

Against a database migrated from scratch and `ci.yml`'s own env, so the run
matches the gate rather than the dev box.

- **Every weekday**: +1 through +6, with **+7 as a control** — same weekday,
  different date.
- **Calendar positions a weekday sweep cannot reach**: month ends (Sep 30,
  Oct 31, Nov 30), the year boundary (Dec 31, Jan 1), a short month (Feb 28)
  and a leap day (2028-02-29).

## Finding 1: no weekday-dependent fixture remains

All six weekdays produced a **byte-identical** failing set, and so did the +7
control. There is no fixture left in the suite whose result depends on which
day of the week the run lands on. The class v0.139.0 hit is closed.

## Finding 2: ten tests that expire

These are not weekday-sensitive, which is why the weekday sweep could not see
them and why they are worse. Each was green the day it was written and each
turns red on a date, permanently, with no run in between to warn anyone.

| test                                           | mechanism                                                                                                                          | red from         |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| `plan/actions.test.ts` (2)                     | week pinned to `"2026-09-07"`; the engine will not replan a session onto days already past                                         | **2026-09-14**   |
| `tools/get-fitness-summary.test.ts` (2)        | row dated `"2026-08-05"`, read back through a `today - 42 days` window                                                             | **2026-09-17**   |
| `race/outlook.test.ts` (1)                     | `simulateRaceForm` called without its third argument, so it read the real clock while every date around it was pinned to July 2026 | **2026-10-02**   |
| `training-plan.test.ts` (3)                    | races pinned to `"2026-12-01"` / `"2026-12-15"`, which stop being races to plan for                                                | **2026-11-09**   |
| `train/structured-workout-wiring.test.tsx` (1) | see below                                                                                                                          | **22% of weeks** |

Every fuse date above was bisected under the shim, not estimated: green on the
day before, red on the day named, red on every date after.

**The last one is the interesting one, because "relative to today" did not
save it.** Its dates are computed from `mondayOf(new Date())`. But which
structured workout a day gets is a _hash of that day's date_ —
`interval/match.ts:154` picks the family with `seed(date) % families.length`,
and `:160` picks within it. The test asserted the SHAPE of the rendered line,
`/\d+ × \d+ min at \d+/`, which holds only when the seed lands on an
interval-shaped family. Its open day is always the Wednesday of the current
week, so across a year of those Wednesdays: **12 of 54 weeks red, a whole week
at a time**, next the week of 2026-09-30.

It now asserts against the line the app itself derives, through
`workoutForDay` — the same entry point the page uses — which keeps it a test
of the wiring without pinning what the library chose.

**That fix was mutation-tested, and the first version of it failed the test.**
Deleting the derived line from `week-day-list.tsx` left the assertion passing,
because the description is also the profile SVG's `aria-label`, so a bare
`toContain` still found it — a hole the original regex had too. Anchoring both
assertions to `>…</p>` makes the mutation fail, which is what makes them
assertions.

## Finding 3: the class is not confined to `npm test`

Found by this branch's own CI, which is the part worth keeping.
`capture (production build, cycling owner)` failed on the pull request, and
not because of anything in it — `scripts/seed-cycling-owner.ts` refused:

```
no day in the open week is both empty and still addable, so
train-pick-workout would have nothing to photograph. The week is:
2026-08-31:0 ... 2026-09-06:1.
```

The seed needs one day with a session (for `train-workout`) and one empty day
the picker can still open (for `train-pick-workout`). It got there by clearing
the last **future** day holding a session. On a Sunday there is no future day
in the open week: the generator can only reach today, so the week is one
session on today, nothing to clear, and the seed refuses.

**One day in seven, and it is the same shape as the bug that blocked
v0.139.0** — measured by driving the seed through the same shim, the original
refuses on Sunday and only on Sunday. Every pull request opened on a Sunday
fails that check. The last green Surfaces run before this was 2026-09-05, the
Saturday.

Today's sessions now MOVE to the nearest earlier day rather than being
deleted, because late in the week today may be carrying the only session there
is and `train-workout` still needs one. Verified by running the seed on all
seven weekdays: every day now yields at least one structured workout and at
least one day that can take a picked one.

**The lesson generalises past this repo's test suite.** The audit above swept
`npm test` because that is where the known instance was. The capture seeds run
the same risk and were not swept — this one surfaced by accident, on the one
day of the week that shows it.

## The rule these all break

**A fixture may pin absolute dates, or it may lean on "now". Not both.**

Pinning is fine when the clock is injected with it — `race/outlook.test.ts`
pins July 2026 throughout and passes `NOW` to `raceCard` fourteen times. It
broke on the two calls that forgot.

## What is excluded, and what that costs

Eight files under `tests/` are skipped while the clock is shifted, listed with
the reason in `vitest.config.ts`. Each compares a timestamp **Postgres**
wrote against a window **JavaScript** computed — "is this row from today", "has
this thread been idle 24h", "is this job due", "is this usage row in this
month". Shifting only the JS clock puts those two clocks days apart, which no
real date ever does. They produced sixteen identical failures at every shift
including the control, which is how they were identified as the instrument
rather than the code.

This is not a production defect: the app and its database share a host. It is
a testability limit, and the cost is honest — **a fixture inside those eight
files that genuinely keys on the calendar is invisible to this sweep.**

Closing it means letting each of those state when its row landed rather than
leaving it to the database — the fix v0.139.0 already made to
`debrief-lifecycle.test.ts` — after which the file comes off the list. The
seam is real and worth naming: `morning-insight.ts` computes "start of today"
from an injected `now` (`todaysBrief`, :115-119) and then filters
`chatMessages.createdAt`, a column its own insert (:490) leaves to the
database. The injected clock is honoured for the read and ignored for the
write.

## The standing guard

`.github/workflows/clock-drift.yml`, weekly and dispatchable. Weekly rather
than per-pull-request because these fixtures are written green and rot on a
timer: what matters is finding them before their date, not within the minute.
A red leg is not a broken branch — it is a fixture with a fuse, and the run
names the date.

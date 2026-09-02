# One step after a ride — design

The athlete's own words, 2026-09-02: _"at the end of a ride, on a ride review,
I want the ability to mark that day's training done. Now I have to do a ride
review and after that mark the training done. I want this in 1 step, where I
can mark if that session was the planned training or not. Preferably add a
score on how good I adhered to the plan."_

Written 2026-09-02. Every claim below about existing behaviour was read out of
the file that implements it.

## What actually happens today

Three things happen after a ride, and only two of them are joined up.

1. **The load books itself.** `bookWeekActuals` (`week-plan/actuals.ts`) sets
   `actualLoad` and `activityId` on the day from the activities table, on every
   pass, for every day at or before yesterday. Nothing manual.
2. **The review is a sheet.** `DebriefSheet` asks three things — RPE, feel, and
   a note — and `submitDebrief` stores them and generates the ride review.
3. **The status is a separate button.** `markDayDone` flips `status` to
   `completed`, from Today's session card, and is reached nowhere else.

So the athlete answers questions in one place and ticks a box in another, and
the app already knew the load before either.

## Why the split exists, which is the part not to break

`bookWeekActuals` deliberately does **not** touch `status`. Today's page says
why, in a comment naming the defect:

> "post-session" means only that some activity ended in the last few hours —
> it says nothing about whether TODAY'S PLANNED SESSION is the one that
> happened. Claiming "Done" from the state alone, regardless of `slot.status`,
> told an athlete who rode a 20-minute commute that their 90-minute threshold
> session was complete.

**The app refuses to guess because it genuinely cannot know.** That refusal is
correct and this design keeps it. What changes is that the athlete is now
asked, in the one place they are already answering questions about that ride.

## Decisions

| #   | Decision                                                                                   | Why                                                                                                                                                                                                                                |
| --- | ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | **One new question in the debrief sheet**, not a new surface                               | The sheet is already the post-ride destination and already writes through one action. A second surface would be a third place to keep in sync with the first two.                                                                  |
| D2  | **The athlete answers it; the app never infers it**                                        | This is the fact defect C1 proved the app cannot derive. Asking is not a fallback — it is the only correct source.                                                                                                                 |
| D3  | **Three answers, not two: yes / no / unset**                                               | "No, this was not my planned session" is real information nothing records today, and it is not the same as not answering. An unanswered debrief must leave the day exactly as it is.                                               |
| D4  | **"Yes" routes through `markDayDone`**, not through a second status write                  | It already refuses a day with no workout, an already-completed or missed day, and a race day — and its doc records that v0.44 had to fix booking for exactly this button. Bypassing it would reintroduce that.                     |
| D5  | **Adherence is LOAD-based**, `actualLoad` against the day's target                         | It captures duration and intensity in one number, and it is the same formula `weekAdherencePct` uses. A duration-based figure scores an easy spin in place of a threshold session as near-perfect.                                 |
| D6  | **The day's target comes from the week's rate**, `weekLoadPerMin × the day's planned mins` | That rate is what `openWeekPlannedLoads` already projects days with, so the day's score and the week's projection cannot disagree. Deriving a second per-day target would be two answers to one question.                          |
| D7  | **The score is a `Figure`, and refuses when it cannot be computed**                        | `weekLoadPerMin` returns null with no `effectiveTarget` or no `materializedMins`, and a day can have no `actualLoad` yet. A percentage invented from a missing target is exactly what this project's vocabulary exists to prevent. |

| D8 | **The score lives on Today's session card's done state** | It is where the athlete lands immediately after answering, it is deterministic, and it is recomputed on every visit rather than being a moment that scrolls away. The card is compact and this is a short figure: `Done · 96% of plan`. |
| D9 | **"No" is recorded on the activity**, one nullable boolean | It is a fact only the athlete can supply, and throwing it away means asking again forever and never being able to answer "I rode five times, three were the plan". Nullable and additive, so old rows and old code are unaffected — `null` means "never asked", which is exactly true of every row written before this. |

## The score, precisely

```
planned = weekLoadPerMin({ effectiveTarget, materializedMins }) × plannedMins(day)
adherence% = round(actualLoad / planned × 100)
```

Same shape as `weekAdherencePct`, one level down. It is reported, never acted
on: nothing in the engine reads a per-day adherence figure, and this design
does not give it one. A number the plan reacts to is a number worth gaming.

**Confidence: it inherits the target's.** The rate is a week-level average
applied to a day, which is an assumption the athlete should see stated — the
same assumption `openWeekPlannedLoads` already makes when it draws the week
ahead, and it says so there.

## What the sheet asks

A third control between "how did you feel" and the note:

```
Was this your planned session?     [ Yes ]  [ No ]
```

Unset by default. **Answering is not required to submit** — the sheet's
existing contract is that every field is optional, and a debrief that refuses
to save because one question went unanswered would be a worse sheet than the
one that exists.

On **yes**, and only then, the same submit calls `markDayDone` for that
activity's local date. On **no** or unset, the day is untouched.

## When it refuses, and what it must not do

- **No open week, no workout that day, day already completed or missed, or a
  race day** → `markDayDone` returns `invalid` or `no_open_week`. The debrief
  still saves. A failed status flip must never lose the athlete's RPE, feel and
  note, which is the whole reason this routes through one action rather than
  two independent writes.
- **The activity is not on a planned day at all** (an unplanned ride) → the
  question is not shown. Asking "was this your planned session?" about a day
  with no planned session is a question with no true answer.
- **A Strava-sourced activity** is unaffected: the day's status is the
  athlete's own statement about their own plan, not a fact derived from
  provider data, so the firewall has nothing to say here. Worth stating
  because every other post-ride path in this codebase has to check it.

## Testing

- **The refusal cases each get a test**, asserting the debrief still saved.
  That is the regression that would actually hurt.
- **Assert at the surface**, through the real action — a component test proves
  the checkbox renders, not that submitting it flips a day.
- **The score is pure and table-driven**, including its two null branches.
- **Mutation-check the target derivation**: swap `weekLoadPerMin` for a
  constant and confirm a test fails, so the day and the week cannot silently
  drift apart.
- **A test that "no" does not complete the day**, which is the answer most
  likely to be wired to the wrong branch.

## What this deliberately does not do

- **No auto-completion, ever.** See D2 and defect C1.
- **The engine does not read the per-day score.** It is reported only.
- **No change to `bookWeekActuals`.** The load already books itself correctly;
  this is about status and a figure, not about load.
- **No backfill.** Days already completed or missed keep their status, and past
  debriefs are not reopened to ask a question they were never shown.

## Migration

**One additive, nullable column** — `activities.was_planned_session boolean`.
Old rows read `null`, old code never selects it, and a rollback to the previous
image leaves a column nobody reads. Classified additive per `docs/RELEASING.md`
step 5; an image rollback is safe.

`null` is load-bearing and not the same as `false`: it means the question was
never asked, which is true of every row written before this and of every
activity on a day with no planned session.

# Changelog

## v0.34.0 — 2026-08-02 — Wellness Sync Interval

v0.33's morning re-pull solved sleep arriving a day late, and did it with a
stop condition: done for the day once yesterday has a duration and a stage.
Correct for sleep, wrong for everything else — it halted wellness polling
around 07:00 while the Companion kept writing steps, SpO2, respiratory rate
and hydration all day, none of which reached Recover until the next morning.

- **How often wellness syncs is now yours to choose.** A select on the
  intervals.icu settings card: daily only, or every 60 / 30 / 15 minutes,
  stored per connection alongside the poll cursor. The card also shows when
  wellness was last checked, so the cadence is visible rather than implied.
- **The stop condition is gone.** `yesterdaySettled()` and its query are
  deleted. Sleep arrival is still served — any interval polls more often in
  the morning than the old fixed 30-minute throttle did.
- **The window covers the waking day.** 05:00–23:00 instead of 05:00–12:00,
  still quiet overnight, where polling buys nothing: the athlete is asleep,
  the Companion has not written the night yet, and the 05:00 daily sync covers
  the boundary.
- **The default stays at 30 minutes.** Upgrading an instance never silently
  increases load on intervals.icu, which is free and run by one developer.
  "Daily only" is offered for anyone who wants none of this.
- **Awake sleep time is documented as underivable, not computed.** It is
  tempting to derive it as total minus the three stages. On this feed that
  residual is exactly zero on 31 of 31 nights, because the total _is_ asleep
  time rather than in-bed time — so the subtraction would render a guaranteed
  0 as though a night with no awakenings had been measured. Real awake time
  needs an in-bed window, which only a direct HealthKit push carries.
- Migration 0036 adds one nullable column. Additive-only, no backfill.
- The activity poll is untouched: still 15 minutes, still quiet 23:00–06:00.

## v0.33.0 — 2026-08-02 — Wellness Expansion

Health Auto Export's REST automation is a paid feature. The trial ended on
2026-07-29 and the Apple Health connector went quiet — five days of sleep
stages, blood oxygen and respiratory rate, then nothing. The replacement
sender is the free Intervals.icu Companion iOS app, which reads HealthKit via
background delivery and writes into the intervals.icu wellness log Recover
already syncs. That exposed how much of that log Recover was throwing away.

- **Twelve wellness fields now arrive instead of none.** `fetchDailyWellness`
  mapped 13 fields and dropped the rest into `raw`. Six of the discarded ones
  already had live columns waiting for them — blood oxygen (166 days of it),
  respiratory rate, body fat, and the three sleep stages. Six more now have
  columns: sleeping HR, HRV SDNN, readiness, hydration, steps, sleep quality.
  Every key, unit and scale was read off the live account rather than guessed.
- **Sleep stages, from a platform that has no sleep stages.** intervals.icu
  has no native stage model, so the Companion writes them as custom wellness
  fields. Those are renameable in the intervals.icu UI, and a rename would
  turn the mapping into permanent nulls with no other symptom — so a row with
  a sleep duration but no stages now logs a warning once per sync.
- **Last night's sleep arrives this morning, not tomorrow.** The daily sync
  runs at 05:00; the Companion writes around 06:40. A bounded morning re-pull
  (05:00–12:00, at most every 30 min, last 3 days, stopping once yesterday has
  a duration and a stage) closes the ~95-minute miss and fires the same
  wellness-changed hook, so the morning brief reflects the night it describes.
- **A silent push connector stops looking healthy.** The Apple Health card
  reported "Push via Health Auto Export" for days after the trial lapsed,
  because "connected" only ever meant "a connection row exists". After three
  days of silence it now says so. A push source has no failure signal of its
  own; it just stops.
- **Blood oxygen is stored as the percentage it already is.** intervals.icu
  reports 95.9–97.5; Apple Health reports the same measurement as a 0–1
  fraction needing ×100. Applying the Apple rule to the intervals feed would
  have stored 9650%.
- **Sleep quality is stored but not shown.** Its 1–5 scale direction is
  contested between intervals.icu's own metadata and this project's notes, and
  rendering it inverted would flip a recovery signal rather than merely look
  wrong.
- Migration 0035 adds six nullable columns plus a wellness-poll cursor.
  Additive-only, no backfill.

## v0.32.0 — 2026-08-01 — One Plan, One Answer

Three `active` training plans sat on one account, left by a single plan
creation retried twice on 2026-07-15. Seven code paths ask which plan the
athlete is on; five of them asked with an unordered query, which Postgres
answers in heap order.

- **The coach and the training engine agreed on a plan again.** The coach
  reported week 1 of a nine-week century block while the week engine was
  running week 4 — not a display bug, two different rows. Every surface now
  resolves the athlete's plan through one `getActivePlan`, which takes the
  most recently created active plan. That was already the rule the engine
  paths used, so the engine's behaviour is unchanged and the coach and
  dashboard moved onto its answer.
- **Asking the coach to change your plan changes your plan.**
  `update_training_plan` resolved the same arbitrary way, so its writes could
  land on a row nothing else read: it reported success and the athlete saw
  nothing. It now writes to the plan the engine runs.
- **Duplicate plans leave a trace.** The resolver logs a warning naming the
  count and the row it chose, rather than silently picking. The ambiguity here
  was invisible for two weeks precisely because nothing said anything.
- **The stored data agrees with the code.** Migration 0034 archives every
  active plan except the newest per athlete — exactly what the resolver
  already decides, so nothing observable changes; the ambiguity behind it goes
  away. Plan creation has archived the previous plan since 2026-07-15, ten
  hours after these rows were made, so this is a one-time cleanup rather than
  a recurring repair.
- **A backfill script for the four missing release pages is staged, not run.**
  `v0.28.0`, `v0.28.1`, `v0.29.0` and `v0.30.0` are tagged and deployed with no
  GitHub release object; `scripts/backfill-release-objects.sh` creates all
  four, but nothing in this branch or in CI calls it — it is a hand-run
  follow-up, not a completed fix.

## v0.31.0 — 2026-07-30 — Rides Get Counted

Reported: "the trainings of today do not show in the train agenda of today."
Today's slot read `status: rest, workouts: []` while two rides sat in the
activities table. Three defects behind it, one of them counting load wrong
for every multi-ride day.

- **A day you trained on no longer reads as an empty rest day.** The week
  agenda renders planned workouts, and an unplanned ride is by definition not
  one — so a rest day with two rides on it looked exactly like a rest day
  spent on the couch. Days the plan left empty now carry a line saying what
  actually happened (`✓ 2 sessions · 1:37 · 130 load`). It is read from the
  activities table, not from the day slot's stored `unplannedLoad`, because
  `runDailyAdaptation` books that onto YESTERDAY — a ride done today would
  otherwise not reach its own row until tomorrow. Planned days are untouched:
  a completed session already says so through its status chip, and repeating
  the ride underneath it would be the duplicated-data problem this project
  keeps having to undo.
- **Every ride of a multi-ride day is counted, not just the last one.** The
  unplanned-load matcher was a `findFirst` ordered by `startDate desc`.
  Because the pass runs the following day, every ride has long since synced by
  then, so it saw only the most recent and dropped the rest — permanently.
  Live evidence 2026-07-30: two rides, loads 63 and 67, of which only 67 would
  ever have counted. It now sums the day. There _was_ a test for the second
  ride, but it inserted the two activities with an adaptation run in between,
  which is not how a real day arrives — so it passed throughout.
- **The booking is now idempotent by recomputation rather than by refusing to
  look.** `recordUnplannedLoad` SETS the day's total instead of adding to it,
  and the caller recomputes that total from the activities table on every
  pass. This replaces an `activityId` guard that kept the figure from
  compounding (a real run reached `unplannedLoad` 600 over six invocations)
  but did so by never looking again — which is the same reason a second ride
  could never be added once the first had claimed the slot.
- **The week plan no longer books Strava-derived load.** Neither matcher
  filtered `provider='strava'`. Every ride exists twice, once per connector,
  with an identical `start_date` and no tie-break — so which row won came down
  to heap order, and the two loads diverge badly (live: 184 vs 83, 67 vs 95).
  Beyond being the wrong number, the week plan is read by the coach through
  `get_week_plan`, making this the same firewall class as the v0.5
  weekly-review and v0.12.2 metrics fixes. Both matchers now exclude Strava.

## v0.30.1 — 2026-07-30 — Pushes Leave a Trace

Reported symptom: two identical "Ride synced — how did it go?" notifications
for a single ride, minutes apart. This release does not claim to have fixed
that — it makes it diagnosable, and closes the one hole the investigation
did prove.

- **Every push now logs a line.** `sendToUser` is the single chokepoint all
  notifications funnel through, but logging was bolted on per-caller and only
  two of its four callers did it: the morning readiness push and the weekly
  availability prompt logged `{sent, pruned}`, while the ride-debrief push and
  the settings test push logged nothing at all on success. A debrief
  notification therefore left no trace whatsoever, which is exactly why "why
  did I get two?" could not be answered from `docker logs`. The record now
  lives in `sendToUser` itself — `{userId, tag, subscriptions, sent, pruned}`,
  plus any caller context (the debrief send passes its `activityId`) — so
  every push type gets it for free. Payload content stays out: ride names and
  debrief notes are personal data, and the tag is enough to tell sends apart.
- **A pruned subscription no longer disappears silently.** `sendToUser`
  deletes a subscription on 404/410 or an unrecoverable VAPID mismatch, and
  did so with no log line anywhere — the athlete simply stops receiving
  notifications and nothing says why. This is very close to the silent push
  death chased twice in v0.25. Each prune now logs a warning naming the
  endpoint's owner, the status, and whether it was `gone` or
  `vapid-mismatch`.
- **Promoting a ride to a pending debrief is now a compare-and-swap.** The
  promotion read "is anything pending?", then ran `UPDATE ... WHERE id = X`
  with no state guard, then sent the push — a check-then-set. A single ride
  starts several lifecycle passes within minutes of each other (Strava fires
  `create` and `update` webhooks and each schedules its own intervals
  catch-up sync; the 15-minute activity poll sweeps independently; both
  provider sync jobs run the post-sync chain; and `/api/sync/now` runs a full
  scheduler tick on pull-to-refresh), so two overlapping passes could each
  clear that read and each notify for the same ride. The new
  `claimPendingDebrief` makes the state transition itself decide, and the
  push only fires for the pass that won the row. The window this closes is
  narrow — microseconds between the read and the write, which is why two
  in-process passes could not be made to reproduce it deterministically, and
  why it does not on its own explain notifications arriving minutes apart.
  The logging above is what will settle that.

## v0.30.0 — 2026-07-29 — The Whole Target

- **Cycling weeks now schedule the hours they were actually targeting.**
  `generateCyclingWorkouts` capped every endurance ride at 90 minutes and the
  long ride at a flat 240, and whatever a cap removed was simply discarded
  rather than moved anywhere else. Live evidence: a 12.5h target was landing
  as an 8.75h week — roughly 30% gone before the athlete ever saw a session.
  Minutes a cap removes are now redistributed onto rides that still have
  room, so the week delivers the number it was already given. Intensity
  sessions (intervals, tempo) never absorb this — stretching a VO2max block
  to soak up volume would change what the session is.
- **Long rides now build toward the hardest day of your event, not a fixed
  four hours.** The long ride's cap is derived from `queenStageHours` — the
  single hardest day your target race actually demands — within a
  documented 120–360 minute range, instead of an unsourced flat 240. An
  8-day mountain tour raises the cap to 294 minutes; a criterium's short
  queen stage keeps it down near the 120-minute floor rather than
  stretching to fill four hours it doesn't need.
- **Redistribution, not the long-ride bound, is why this affects every
  athlete.** With no race entered, or no FTP on file, there's no event
  evidence to size the long ride against, so its cap keeps exactly the
  previous 240 minutes. But redistribution — the fix above — doesn't check
  for a race before it runs, and it's the larger source of the extra volume.
  A 4-session build week targeting 10.3h/week scheduled 526 minutes before
  this release (a 235-minute long ride, 111-minute intervals, and two
  endurance rides clamped from 136 down to 90 each) and schedules the full
  618 after — a ~17% increase in weekly volume for an athlete with no race
  and no FTP at all.
- **The weekly total itself is unchanged — only whether the week actually
  delivers it.** The hours a week aims for are already bounded before the
  session generator sees them (the ACWR ceiling, the ramp guard); this
  release doesn't raise that number, it stops throwing part of it away.
- **The next-week preview now says what it planned against its target**,
  the same line the current week's rationale panel already showed.

**Cycling only.** Running and triathlon workout generation still discard
whatever a cap removes — that's deliberately untouched here. Running's
correct fix is a different rule entirely: a study of over 5,200 runners
found that exceeding your own recent longest run by 10–30% raises injury
risk by 64%, which is an athlete-relative spike rule, not an event-relative
one. Borrowing cycling's fix across sports is the same mistake that
produced this defect in the first place.

## v0.29.0 — 2026-07-29 — Past Sunday

- **The week doesn't end at Sunday anymore.** `/train`'s day list now rolls
  from today straight into next week, with a visible boundary marking where
  one ends and the other begins — no more staring at a blank Monday wondering
  what's coming. Days before today drop off the list; today never does.
- **Next week is a forecast, and it says so.** Every day in next week's
  section renders provisional, because it is one: the projection assumes
  this week closes out to plan rather than reacting to what you've actually
  done so far this week — reacting to a half-finished week would otherwise
  drag the forecast downward early on, for reasons that have nothing to do
  with anything you decided. It firms up for real the moment Monday's
  rollover runs. A day you've already pinned availability for renders firm
  instead of provisional, because that part genuinely is decided.
- **You can set next week's availability now, not just this week's.** A
  `This week | Next week` switcher on the availability form — also reachable
  directly at `?availability=next` — lets you pin next week's days early.
  Next week gets its own resolved availability, its own pinned days, and its
  own verdict; it is not this week's numbers with the date changed.
  Submitting availability for a future week writes your overrides and
  replans nothing. Only submitting for the current week replans, same as
  always.
- **The next-week entry point survives the week.** Availability for next
  week stays enterable all the way through, even after this week's own
  availability has frozen for the week already underway (unchanged: that
  freeze has always happened once Monday's session completes). An early
  entry point that vanished by Wednesday wouldn't be one.
- **Nothing is persisted for a week that hasn't happened.** The preview is
  computed fresh on every render from your plan, your standard week, and any
  pinned overrides — there is no draft row quietly going stale in the
  database while nobody's looking.

**Deliberately not in this release:** projecting more than one week out;
editing next week's individual sessions; a "fill" rung that adds training
back once availability opens up mid-week; reconciling a week's plan against
load that arrives after the week has already closed; and cleaning up stale
open weeks or the rare account carrying more than one active plan.

## v0.28.1 — 2026-07-29 — Stopping The Compounding

- **Fixed: the daily adaptation was compounding readiness scaling on every
  run instead of applying it once.** `onWellnessDataChanged` calls
  `runDailyAdaptation` from five call sites by design — every wellness
  write, every scheduler sync job, the 09:00 backstop, every Apple Health
  push ("roughly hourly" per its own comment), and CSV import. The readiness
  scaler read its own already-shrunk output back as its input each time it
  ran, so amber (×0.85) and red (×0.70) kept multiplying onto a session that
  had already been multiplied. A separate bug judged yesterday "missed"
  before the day's ride had a chance to sync, and a third rebooked a
  rest-day bonus ride's load on every repeat run instead of once.
- **What that cost a real athlete.** A 137-minute Long ride was ground down
  to 8 minutes on 2026-07-24 (six amber scalings then six red — 0.85⁶ ×
  0.70⁶ = 0.0445) and to 60 minutes on 2026-07-28 (five amber runs, 0.85⁵ =
  0.4437). The missed-too-early bug dropped a session the athlete had
  actually ridden — 1.94h at 18:50 the evening before — because the
  adaptation ran at 04:50, ahead of the sync. That closed three consecutive
  weeks (2026-07-13, -20, -27) as "fully missed" while the athlete was
  riding roughly 7 hours a week, each one restarting the next at 60% of
  skeleton. The rebooking bug counted a single rest-day ride's load
  anywhere from 5 to 15× over, depending on how many runs hit it before the
  ride was replaced by something else, inflating the following week's
  ramp-clamp target with the inflated total.
- **The readiness adaptation is now a function of the originally planned
  session and today's band — never of its own previous output.** Each day
  remembers what it was adapted from; a second run for the same band is a
  no-op, a worsening band recomputes from the original rather than scaling
  what's already scaled, and a recovery to green restores the session
  outright. A session is only judged missed once activity data for that day
  is actually settled — an activity-providing connection has synced since,
  or the athlete has none at all — and a connection that will provably
  never sync again, or has gone quiet for 3 days, no longer freezes that
  judgement forever. A rest/race-day activity is now booked once, guarded
  on its own id. An availability resolution that hasn't actually changed no
  longer triggers a replan or logs a no-op adjustment.
- **Already-corrupted weeks have a way back.**
  `scripts/repair-corrupted-week.ts` recomputes what an open week should
  hold using the exact same derivation the weekly rollover uses, and
  replaces every day that isn't already completed, missed, or a race —
  clearing the stale readiness anchor so the next adaptation starts from the
  restored session, not the corrupted one. Real synced activity load is
  never touched, on any day. Dry-run by default and prints a per-day
  before/after table; `--apply` writes, `--user` scopes to one athlete;
  running it twice makes no further change the second time.
- **This corruption was ours.** The adaptation re-derived itself from its
  own output for multiple release cycles without anyone noticing, because
  any single run looked reasonable in isolation — it was the accumulation
  across five call sites firing all day, every day, that ground a real
  athlete's week down to nothing.

## v0.28.0 — 2026-07-29 — The Race Sets the Week

- **Your weekly hours now come from the event you're training for**, not from a
  number typed once when the plan was created. Enter a race's days, distance and
  climbing — optionally day by day — and the app estimates what it physically
  asks, then derives a weekly target from it.
- **Bounded by your own history, in both directions.** The target is capped at
  1.3× your rolling 12-week peak (the acute:chronic workload ratio's safe-zone
  bound) and floored at 0.6× it, so a low-volume event like a criterium can't
  prescribe a detraining week. **With no measured history there is no ceiling and
  no race-driven target at all** — the plan's own figure stands. Absent evidence,
  the app says nothing rather than guessing.
- **Availability is a ceiling, never a target.** A free week does not become a
  bigger prescription.
- **The week now explains itself.** The engine has always logged its own
  arithmetic accurately — "last week was fully missed — restarting at 60% of the
  skeleton target", "3.1h available instead of 6.0h" — and nothing ever showed
  it. A small week read as a bug. Those reasons now appear under the week grid,
  alongside what was planned against what was targeted.
- **A readiness verdict for the event itself**: ready / on track / tight / not
  realistic, judged on volume _and_ on longest ride, because eleven hours a week
  ridden as five short sessions does not prepare anyone for a seven-hour mountain
  day. It informs and never blocks — you can still enter anything you like,
  having been told plainly what it asks.
- **The skeleton is recomputed every rollover** rather than read from the stored
  plan. A stored target going stale is what this release exists to end.
- **The dashboard and Train now show the same target.** They previously
  disagreed, and the dashboard's was the stale number.

**Honest about its limits.** `HEADROOM` and the maintenance floor come from
published research; `REAL_WORLD_FACTOR` and `CLIMB_GRADIENT` are calibration
constants with **no published basis**, and the longest-ride fraction is
**contested** — sources contradict each other, so it can soften a verdict but
never declare an event impossible on its own. Every constant and its confidence
level is recorded in `docs/specs/2026-07-28-training-volume-evidence.md`.

**One known gap, deliberately not closed here.** The workout generator caps
individual sessions, so a week saturates around 9.8 hours no matter how high the
target goes. The engine now _says so_ when that happens rather than showing an
unexplained deficit; actually lifting the cap means rewriting the generator, and
that is its own release.

**Caught before it shipped.** The final review found that an athlete with no
recent training and a logged event would have been prescribed a **zero-hour
week** — the "no measured ceiling" safety branch was unreachable, because the
hours-history builder returns twelve zeros rather than an empty list, so a peak
of zero read as a real measurement. It would have hit new users and anyone
returning from injury: exactly who that ceiling protects.

## v0.27.0 — 2026-07-28 — The Planner Can See You Ride

- **Fixed: no cycling session was ever recorded as completed.** The plan
  describes a bike session as `Bike`; every provider stores the ride itself as
  `Ride` (or `VirtualRide`). The completion matcher compared the two with a raw
  equality, so across 219 rides it never matched once. Runners were unaffected —
  `Run` happened to equal `Run` — which is why it survived every review.
- **What that cost.** With nothing ever matched, each day kept `actualLoad`
  empty, so every week closed with zero actual load and was read as "last week
  was fully missed". The next week then restarted at 60% of its target. Week
  after week, compounding. Landing on a scheduled recovery week (a further 60%)
  it produced a **4.9-hour plan for an athlete training ~9 hours and offering
  12.5**. The reasons were logged accurately the whole time; nothing surfaced
  them.
- **Sport is now read through one shared vocabulary**
  (`src/lib/canonical-sport.ts`), used by the matcher and its tests alike.
  Unfamiliar activity types pass through untouched rather than being forced into
  the nearest training sport — a tennis match must never book as a completed
  ride.
- **Days already behind you have been repaired.**
  `scripts/backfill-day-load.ts` books the open and most recently closed week
  using exactly the rules the daily adaptation uses, collapsing rides synced from
  both intervals.icu and Strava so they count once. It leaves a matched activity
  whose load has not yet been computed for a later run rather than booking a
  zero. Idempotent.
- **Expect a gradual recovery, not a jump.** Week-over-week load is still
  clamped to ±20% of what you actually did, so a plan climbs back over two to
  three weeks. The difference is that the figure it climbs from is now real.

## v0.26.1 — 2026-07-28 — Editing Your Standard Week Replans It

- **Fixed: changing your standard week updated the availability card but not
  the plan.** The card shows your standard week merged with any pinned dates,
  so it moved the moment you saved — while the week below it still showed the
  sessions from before. Zeroing a Friday made Friday read "Rest" with a
  session still sitting on it. Saving a weekday now replans the open week the
  same way editing a single date already did; pinned dates keep winning, and
  nothing else in the week moves. The same gap is fixed in the coach's
  `set_standard_week` tool.

## v0.26.0 — 2026-07-28 — Availability, Block By Block

- **Your availability is a standard week now, with per-date exceptions on
  top.** You set each weekday once — that's the shape of a normal week — and
  a change to a single date is pinned to that date. The pin always beats the
  default and survives later changes to it, so a one-off is a one-off again:
  moving next Tuesday's ride no longer quietly becomes every Tuesday's new
  normal. Editing a pinned date back to match the standard week un-pins it.

- **A day is a list of time blocks, not a bucket of minutes.** Forty-five
  minutes before work and an hour in the evening are two training
  opportunities, not one 105-minute one — and the planner no longer pretends
  otherwise. Sessions are placed into a specific block and must fit _that_
  block whole. Two blocks can carry two sessions on the same day.

- **Each block carries the energy you expect to have, and optionally which
  sport.** An easy block will take a recovery, endurance or long ride;
  a normal one adds threshold work; only a full block gets intervals or a
  brick. A block marked for one sport won't be handed a session from
  another. Both constrain what may be scheduled there — they are not hints.

- **Changing your availability no longer regenerates the week.** Only the
  sessions actually displaced by the change move, along a fixed ladder: move
  to another day that fits it whole, shorten it while keeping its purpose,
  substitute a session that still works at the length available, and only
  then drop it. Everything the change didn't touch stays exactly where it
  was, and every automatic change is logged with the reason it happened.

- **A session is never truncated below the point where it stops working.**
  Twenty minutes of a ninety-minute long ride is not a short long ride, it's
  nothing — so the planner substitutes something that does deliver at that
  length instead of shipping you a stub.

- **Unplanned work counts toward the week without eating the plan.** A bonus
  ride on a rest day is recorded against the week's actuals; it never
  removes a session you were meant to do.

- **One prompt a week to confirm your training time**, and a warning when
  the time you gave can't hold the fitness you have — measured against your
  own CTL, not a generic table. It stays silent until there are 28 days of
  load history behind it, and it stops asking once you've answered or once
  the week is more than half gone.

- **"No time today"** on a day's action menu pins that date to zero and
  replans around it.

- **The coach can manage all of this too.** `set_week_availability` now
  takes time blocks (and still accepts the old seven-integers form, so
  existing conversations keep working), joined by two new tools:
  `set_standard_week` for one weekday of the standard week, and
  `clear_availability_override` to un-pin a date. A change the coach makes
  is pinned exactly as one of yours is, so it survives the next replan.

- **Breaking, for MCP clients only: `get_week_plan` and
  `set_week_availability` changed their output shape.** Each day now reports
  `availableBlocks` (a list of blocks) instead of `availableMins`, and
  `workouts` (a list) instead of a single `workout`. Anything reading those
  two fields must be updated. Tool _inputs_ are unaffected — the frozen
  surface grows from 54 to 56 tools and `set_week_availability`'s schema
  change is additive, so existing calls keep working (see
  `docs/API-STABILITY.md`).

## v0.25.19 — 2026-07-27 — Every Trend Against Your Own Normal

- **Every chart on Body now shows the band it's being judged against.** HRV
  and resting HR have always been drawn against your own baseline; sleep
  duration, sleep score, weight, VO2max, blood oxygen, wrist temperature,
  BMI, lean body mass and waist circumference were bare lines you had to
  eyeball. They now carry the same shaded band and dashed centreline, with
  `mean ± sd` in the card header. The band is your own trailing 60 days,
  under the same rules the readiness engine uses: days you flagged (🤒 ill,
  ✈️ travel, 🏔️ altitude) are left out, and the current reading is not
  counted in the normal it's compared to. Nothing here is a population norm.

  Two deliberate silences: fewer than 14 readings shows no band rather than
  inventing a normal from four days, and a perfectly flat history (a VO2max
  that hasn't moved in two months) shows no band rather than a hairline you
  fall outside of every day.

- **The 30-day view no longer shrinks the baseline to fit.** The band is a
  fixed 60-day reference, so the shorter ranges now read the full window
  instead of whatever happened to be on screen — the same metric no longer
  reports a different "normal" at 30d than at 90d.

## v0.25.18 — 2026-07-27 — Notifications, Clocks And Language

- **One way push notifications could die silently is closed off.** A missing
  or malformed `ENCRYPTION_KEY` — a configuration hiccup, with the stored key
  itself perfectly intact — was enough to make the app throw away the
  instance's push keypair, which unsubscribed every device at once. Recovery
  meant re-enabling notifications by hand, and nothing announced that it had
  happened. That fault is now told apart from a genuinely unreadable key:
  the keypair is kept and the error surfaces instead.

  _Corrected after release:_ this was **not** the cause of the repeated
  orphaning actually seen in the wild. That turned out to be a test
  overwriting the live instance's keypair on every full-suite run, fixed
  separately in `ae0d1df` — after v0.25.18 had already shipped, and not part
  of it. The guard above is still right, but it does not by itself mean push
  can no longer be orphaned silently.

- **Bed and wake times now show your clock, not the server's.** A 23:32
  bedtime was displayed as "21:32" and a 07:53 wake as "05:52". The times
  were recorded correctly all along — they were being read back in the
  wrong timezone. Sleep midpoint, chronotype, consistency, social jetlag
  and the recommended bedtime were shifted by the same amount. Set `TZ` in
  your `.env` (defaults to UTC, so existing installs are unchanged); it
  also puts the daily sync, the morning brief and the 09:00 backstop on
  your local clock rather than the server's.
- **The coaching language setting now holds on the coach's own messages.**
  With the language pinned to Dutch, a morning brief could still come back
  in English — the setting was applied, but the instruction behind it was
  written in English and the model followed that instead. The chosen
  language now travels with the instruction on all five coach-written
  surfaces: morning brief, weekly review, monthly report, ride debrief and
  race debrief. Automatic mode is unchanged.

## v0.25.17 — 2026-07-27 — Brief Waits For Real Data

- **The morning brief now waits until last night's HRV and sleep have
  actually arrived.** Those two carry 60% of the readiness weight between
  them, but the engine would happily score without either — so a brief
  could fire on resting heart rate alone and read "green, good day for
  intensity" while the completed data said amber. It now holds until the
  overnight measurement is in.
- **When it can't wait, it says so.** For athletes with a connected data
  source, if the data still hasn't arrived by the 09:00 backstop, the brief
  still appears but names exactly which signals are missing and what the
  number leans on instead, rather than presenting a partial reading as a
  whole one.
- **An incomplete brief gets one silent correction.** If the real data
  lands later that morning, the brief is replaced in place — one message,
  no second notification — so the day never ends on advice the app already
  knows is wrong. A brief that was complete to begin with is never touched.

## v0.25.16 — 2026-07-26 — Event-Driven Sync Triggers

- **The morning brief no longer waits on the fixed 05:00 provider sync.**
  It now fires as soon as enough of today's data has landed — from an
  Apple Health push, any provider sync, or a manual wellness entry,
  whichever arrives first — instead of only reacting to the once-daily
  intervals.icu/Strava/Whoop/Oura/Withings sync. A new 09:00 server-local
  backstop still posts a brief with whatever's available if nothing has
  fired by then, so the athlete never goes without one.
- **Weekly and monthly review now land on the day they're actually due,
  not a day late.** Both already defaulted to 07:00 (unchanged by this
  release) — but the old sync-only trigger only checked whether a review
  was due when the once-daily sync ran, at 05:00, two hours before that
  07:00 slot on the due day itself. Checked at 05:00, the slot always read
  as "not due yet," so detection silently deferred to the _next_ day's
  sync: the weekly review landed every Tuesday instead of Monday, and the
  monthly report on the 2nd instead of the 1st. Both are now also
  re-checked on every scheduler tick past the new 09:00 backstop hour —
  safely after 07:00 — so the due check runs on the correct day for the
  first time. A user-set `weeklyReviewHour` preference still overrides the
  default exactly as before.

## v0.25.15 — 2026-07-26 — Apple Health Metric-Name Diagnostic

- **Temporary diagnostic logging** for the Apple Health ingest endpoint: logs
  the metric type identifiers present in each Health Auto Export payload
  (never values). v0.25.14's VO2max mapping isn't populating despite the
  athlete confirming VO2 data is tracked and selected for sync, while the
  same release's blood-oxygen mapping works correctly — this log will show
  the real metric name Health Auto Export sends so the guessed `"vo2_max"`
  case can be corrected if wrong. To be removed once confirmed.

## v0.25.14 — 2026-07-26 — Apple Health Hybrid Vitals

- **Apple Health now outranks intervals_icu for physiology and body-composition
  fields.** intervals.icu's wellness sync runs once a day; Apple Health can
  push every 15 minutes via Health Auto Export. Previously `apple_health`
  ranked lowest in the wellness merge-priority ladder, so any same-day
  freshness advantage got silently overwritten each morning by the next
  intervals_icu sync. `apple_health` now ranks just above `intervals_icu` in
  both the physiology (HRV, sleep, resting HR, etc.) and body-composition
  (weight, body fat, blood pressure) priority ladders — still below manual
  entry and any dedicated wearable/scale.
- **Six new Apple Health metrics mapped**: VO2max, blood oxygen, wrist
  temperature, BMI, lean body mass, and waist circumference now flow from
  Health Auto Export into `wellness_daily` and appear as new trend cards on
  the `/body` page. Wrist temperature is stored as its own absolute value —
  not conflated with Oura's baseline-relative temperature deviation, which
  uses a different scale entirely.
- **Fixed a GDPR export/import round-trip gap**: the account-import path was
  silently dropping 9 `wellness_daily` columns on restore (this release's 5
  new fields, plus 4 from an earlier release — `vo2max`, `rampRate`, `pMax`,
  `wPrime` — that had the same gap since v0.22). Export already carried every
  column; import now does too.

## v0.25.13 — 2026-07-26 — Apple Health Ingest 405 Fix

- **Fixed the Apple Health (Health Auto Export) ingest endpoint returning
  405 to the iOS app.** `src/proxy.ts`'s session-cookie auth guard excludes
  token-authenticated external endpoints (`/api/mcp`, `/api/cron`,
  `/api/webhooks`) since they have no browser session to check — but
  `/api/connections/apple-health/ingest` (authenticated by a per-user
  ingest token, not a cookie) was never added to that list. An
  unauthenticated POST got 307-redirected to `/login`, which preserves the
  POST method; `/login` is a GET-only page route, so the redirected
  request came back as 405 — the symptom the app actually showed, not
  anything from the ingest handler itself. Added the route to the proxy's
  bypass list (matcher regex + inline check), matching how the other
  token-authenticated endpoints are handled.

## v0.25.12 — 2026-07-25 — Availability Sheet Can Be Closed

- **Added a visible "Done" button to the weekly-availability bottom
  sheet.** It previously only closed by tapping the dim backdrop, which
  the preset chips and hour/minute wheels left little to no visible room
  for — there was no discoverable way to close it after entering hours
  for a day.

## v0.25.11 — 2026-07-25 — Lock Mobile Pinch-Zoom

- **Disabled pinch-to-zoom and double-tap zoom on mobile.** The viewport
  meta tag now sets `maximum-scale=1, user-scalable=no` (in addition to
  the existing `viewport-fit=cover`), and `html` gets
  `touch-action: pan-x pan-y` as a backup for browsers that don't fully
  honor the meta tag's scale lock. Layout now stays fixed at its intended
  scale regardless of touch gestures.

## v0.25.10 — 2026-07-25 — Coaching Language Actually Saves

Live-testing v0.25.9's new Coaching language setting immediately after
release surfaced two real bugs in it.

- **Fixed the Personality/Coaching-language dropdowns appearing to not
  save.** They used `defaultValue` inside a `<form action={...}>` bound
  via `useActionState`. React 19's form-action submission path calls the
  DOM's native `form.reset()` once the action settles, which snaps every
  `<select>` back to whichever `<option>` has no explicit HTML `selected`
  attribute (the first option in the list) — not whatever was just picked.
  The save always persisted correctly server-side; only the displayed
  value was wrong, making the setting look impossible to save. Fixed by
  submitting imperatively instead of via the form's `action` prop, which
  avoids the native reset path entirely.
- **Fixed chat suggestion chips staying in English regardless of the
  pinned coaching language**, and — because the save bug above meant the
  language setting was never actually sticking — using one of those
  English-worded suggestions always got an English reply even with a
  language pinned, which read as "the pinned language doesn't work" when
  the underlying prompt rule was fine all along. Suggestion chip text is
  now localized to the pinned language (21 languages, "auto" or an
  unrecognized code falls back to English).

## v0.25.9 — 2026-07-25 — Coach Language Setting

- **New "Coaching language" setting in Settings**, next to Personality,
  using the same dropdown pattern and saving in one submit. Previously the
  coach only ever matched whatever language the athlete last typed in
  chat — with no way to pin it, and no signal at all for the five
  proactive/no-input surfaces (morning insight, weekly review, monthly
  report, ride debrief, race debrief), whose output language was an
  unconstrained LLM guess. Defaults to "Automatic" (today's match-the-
  athlete behavior); once pinned to a specific language, the coach replies
  in it everywhere, chat included, even if the athlete writes in a
  different language. Supports 21 languages. An unrecognized/stale
  language code anywhere falls back to the automatic rule rather than
  erroring. Round-trips through GDPR export/import like every other coach
  setting. Spec: `docs/specs/2026-07-24-coach-language-setting-design.md`.

## v0.25.8 — 2026-07-24 — Availability Picker, Bigger Health Exports, and Chart Fixes

- **New tap-to-open Availability Picker.** The weekly plan intake step's
  7-day "minutes available" grid used raw `<input type="number">` fields —
  slow and fiddly on a mobile numeric keypad. Each day is now a tap target
  showing its value as a pill ("1h 30m" / "Rest"); tapping opens a bottom
  sheet with one-tap preset chips (Rest, 30m, 45m, 1h, 1h30, 2h, 2h30) plus
  a scroll-snap hour/minute wheel for anything else, both auto-saving with
  no Done button, and a live weekly-total footer. 15-minute granularity
  throughout, replacing the old 5-minute step. Spec:
  `docs/specs/2026-07-24-availability-picker-design.md`.
- **Apple Health ingest cap raised 10MB → 50MB.** Health Auto Export's
  all-metric/multi-day exports were hitting the old cap on both Next's
  middleware body limit and the route's own `MAX_BODY_BYTES`, silently
  dropping every sync attempt (`last_sync_at` never advanced, zero new
  `wellness_daily` rows, no error surfaced to the user).
- **Fixed the bar chart's invisible weekly-load bars.** Train → Fitness →
  Weekly load rendered every bar at `0px`, even though the underlying data
  was correct. Each week's bar wrapper sat in a row-flex container using
  `items-end` (not `stretch`), so the wrapper never inherited a definite
  height — its own height stayed intrinsic, which for a single child whose
  height is itself a percentage resolves to `0`. The bar's `height: X%` was
  then a percentage of a `0px` box, so it also rendered at `0px` regardless
  of the (correct) load value or color. Fixed by giving each wrapper
  `h-full` so it takes the full height of the chart's fixed-height
  container, letting the inline percentage heights resolve against a real
  number.
- **Fixed sync gaps compressing instead of showing as gaps** on the Body
  page's HRV/RHR/weight/sleep trend charts. `BaselineTrendCard` positions
  points by array index, but the Sleep/Trends tabs built values by mapping
  over the sparse wellness query result — days with no synced row were
  silently omitted rather than represented as gaps, so any sync hole
  compressed that stretch of time in the chart instead of showing a break.
  A new `fillDailyGaps()` helper now builds one entry per calendar day
  across the window, with explicit nulls for missing days.

## v0.25.7 — 2026-07-24 — Activity Times Are Stored in True UTC, Not Local-Time-Mislabeled-As-UTC

The root cause behind this session's whole run of timezone symptoms
(v0.25.2 through v0.25.6): `activities.startDate` was never storing a true
UTC instant. `fetchActivities()` preferred intervals.icu's
`start_date_local` — the athlete's wall-clock time with no offset suffix
(e.g. `"2026-07-21T18:50:01"`) — and `new Date()` parses an unsuffixed
string as UTC, so a ride that really started at 18:50 local (16:50 true
UTC for a UTC+2 athlete) got stored as if it started at 18:50 UTC: two
hours in the future relative to reality. This canceled out by coincidence
for local-day/hour bucketing, because every reader in the app also ran
`.getHours()`/`.getDate()` in the same always-UTC production container —
but it broke outright for any real elapsed-time comparison against
`Date.now()`, which is what actually produced the debrief-promotion delay,
the future-dated `isAwaitingReview` gate, and auto-describe racing ahead
of the debrief.

- **New `activities.start_date_local` column** (additive-only) stores the
  athlete's wall-clock string separately from `start_date`, so the two
  concerns — "what instant did this happen" and "what was the athlete's
  local day/hour" — are no longer conflated in one field.
- **`start_date` now stores the true UTC instant** for both the
  intervals.icu and Strava connectors (Strava attaches a misleading
  trailing `Z` to its own `start_date_local`, which is stripped before
  parsing rather than trusted).
- **Every local-day/hour call site across the app** (training load, debrief
  lifecycle, scheduling boundaries, insights auto-tagging, the weekly
  train view, activity display) now reads `startDateLocal` instead of
  reading local getters off `startDate` — the fix that actually closes the
  loop without regressing calendar-day bucketing.
- **GDPR export/import** round-trips `startDateLocal` too, so a
  re-imported account doesn't silently lose the distinction.
- **New backfill script** (`scripts/backfill-start-date-local.ts`)
  recomputes both fields for existing rows from each activity's stored raw
  provider JSON, using the same precedence as the connector fix. Its
  wall-clock parse is anchored explicitly to UTC
  (`parseWallClockAsUtc`) rather than relying on the parsing process's
  host timezone, since — unlike the always-UTC production container — the
  script may be run from any operator machine.

## v0.25.6 — 2026-07-23 — Auto-Describe No Longer Races the Debrief

Auto-describe's `isAwaitingReview` gate assumed a null `debriefState` always
meant "this activity was never debrief-eligible" — true for historical
imports, but no longer true now that the webhook (v0.25.1) syncs a ride
within seconds. A Strava-sourced stub's `startDate` can still land in the
future for a while (the timezone quirk noted in v0.25.2/v0.25.3 — real
`start_date` is withheld, and the local-time fallback lands ~the athlete's
UTC offset ahead), which blocks debrief promotion until real time catches
up. Auto-describe raced ahead of that delay, describing the ride before it
ever had a chance to be promoted — and because a description write is
permanent (the marker blocks all future writes), that ride's Strava
description could never be updated with RPE/feel once the athlete actually
answered the debrief later.

- `isAwaitingReview` now also waits for a Strava-sourced stub whose
  `startDate` is still in the future — bounded, not indefinite: once real
  time passes it, the lifecycle has had its fair shot either way and
  describing proceeds exactly as before.

## v0.25.5 — 2026-07-23 — Push Notifications Actually Deliver

The test-notification button reported nothing failing, but no push ever
arrived. Root cause: the server's VAPID key pair had changed at some point
(exact trigger unconfirmed — no error was ever logged for it, so it
predates the retention window), which cryptographically orphaned every
existing browser subscription. Apple and Mozilla each reported this
clearly (`VapidPkHashMismatch` / `"VAPID public key mismatch"`) — but
`sendToUser` only ever pruned a subscription on 404/410, so these just
failed silently on every send, forever, with `sendTestNotification`
reporting the misleading "no active subscription" message.

- **`sendToUser` now also prunes on an unrecoverable VAPID key mismatch**
  (matched specifically, not a blanket "any 400/401" — a generic 400 stays
  logged-and-retried, since it might be transient).
- **The bigger fix: re-enabling notifications couldn't actually fix this.**
  The browser's Push API silently returns an _existing_ subscription from
  `pushManager.subscribe()` rather than creating a new one — even when it
  no longer matches the server's key — so clicking "Enable" again kept
  saving the same broken subscription. It now unsubscribes any existing
  one first, guaranteeing a fresh subscription tied to the current key.

## v0.25.4 — 2026-07-23 — Deleted Activities Don't Linger

An activity removed at the source stayed in Recover forever — nothing ever
told it the ride was gone.

- **Deleting an activity on Strava now deletes it here too.** Strava's
  webhook already sends `aspect_type: "delete"` events; Recover received
  them but silently did nothing. It now removes both the native
  `provider: "strava"` sync row and any `provider: "intervals_icu"` row
  sourced from that same Strava activity (matched the same way
  auto-describe resolves a Strava id from an intervals.icu row — see
  v0.25.3).
- **New manual "Delete activity" action** on the activity page (trash icon
  next to the title, confirm-before-delete) covers what no webhook ever
  can: intervals.icu itself has no webhooks at all, so a ride removed there
  can only be caught by hand.

## v0.25.3 — 2026-07-23 — Auto-Describe Reaches Strava-Sourced Rides

Same root cause as v0.25.2's debrief gap, this time hitting Strava
auto-describe: intervals.icu withholds `strava_id`/`strava_activity_id` for
any activity it sourced from Strava, so a completed ride review could never
find where to write the description — `describeActivityOnStrava` silently
skipped every one with `reason: "no_strava_id"`, and would have forever.

- **New `resolveStravaId()`** falls back to the activity's own
  intervals.icu `externalId` when `raw.source === "STRAVA"` — confirmed 1:1
  against the sibling native `provider: "strava"` sync row's `externalId`
  for the same ride, since intervals.icu borrows the Strava id as its own
  for activities it can't otherwise access. Used by both the post-sync
  auto-describe path and the `describe_strava_activity` coach tool.
- **The settings preview no longer picks a Strava-sourced stub** as its
  "most recent activity" sample — those carry almost no fields to render
  (only CTL/TSB survive, from wellness data, not the activity itself),
  which made the preview look broken even with every field enabled. It now
  skips straight to a real data-bearing ride, same as before this gap was
  introduced.

## v0.25.2 — 2026-07-23 — Ride Review Actually Pops Up

Two gaps kept the post-ride debrief from ever reaching the athlete in
practice: it only ever showed as a Today-dashboard chip or push-notification
deep link, never on the ride's own page, and rendered as a form buried in
the page flow rather than the bottom-sheet popup used everywhere else in the
app. Opening a ride with a pending debrief now pops the same sheet.

- **`debriefEligible` no longer permanently excludes Strava-sourced rides.**
  intervals.icu withholds `duration`/`load` for any activity it sourced from
  Strava (own API note: "STRAVA activities are not available via the API"),
  which previously failed the 15-minute-minimum check forever, with no
  retry that could ever fix it. A real webhook-triggered create event is
  already proof of a genuine ride, so an unknowable duration no longer
  blocks it — a plain not-yet-synced null duration (any other provider)
  still waits its turn as before.
- **The activity page now mounts the real `DebriefSheet` popup** for a
  pending debrief instead of the old inline `DebriefForm`, matching the
  sheet already used for the dashboard chip and push-notification deep
  link. Metric formatting (`formatActivityMetrics`) is now shared between
  both entry points instead of duplicated.

## v0.25.1 — 2026-07-23 — Webhook Callback Fix

v0.25.0 added `/api/webhooks/strava` but never actually made it reachable:
the session-redirect proxy 307'd every unauthenticated request to `/login`,
including Strava's own verification handshake and every subsequent event
POST — so the webhook shipped dead on arrival.

- **`/api/webhooks/*` now bypasses the session gate**, alongside the
  existing `/api/mcp`/`/api/cron` bearer-auth routes — verified live via
  Strava's actual push-subscription creation, not just a local curl.

## v0.25.0 — 2026-07-23 — Strava-Triggered Intervals Sync

intervals.icu has no webhooks, so a new ride only ever showed up after the
daily 5am sync, the 15-min ride-debrief poll, or a manual "Sync now" click
— nothing pushed a fresh ride to an open dashboard tab.

- **New `/api/webhooks/strava` endpoint.** Strava does support push
  subscriptions; on an activity-create event we now schedule an
  intervals.icu catch-up sync ~90s later (giving intervals.icu's own
  Strava ingestion a head start) instead of waiting on the poll or daily
  sync. intervals.icu stays the ride source of truth — Strava rows are
  still excluded from every AI/MCP surface, unchanged.
- **The sync chip now polls `/api/sync/status` every 45s** and refreshes
  the dashboard when a background or webhook-triggered sync lands, so a
  new ride shows up without a manual reload.
- New `STRAVA_WEBHOOK_VERIFY_TOKEN` env var; one-time subscription
  registration `curl` documented in the webhook route's file header.

## v0.24.0 — 2026-07-23 — Strava Auto-Describe Fixes & Fields

VO2max was effectively always blank on Strava descriptions — it only ever
read the per-activity intervals.icu payload, which rarely carries an
estimate. Worse, auto-describe used to write the Strava description in
the same tick a ride was promoted to a pending debrief, before the
athlete had even seen the popup; because the write is append-once
(marker-gated), that meant the ride review could never be added
afterward, no matter when the athlete answered.

- **VO2max now falls back to the daily wellness value** (`wellnessDaily.vo2max`)
  when the activity itself doesn't carry an estimate — same pattern as the
  existing eFTP fallback. The coach's `get_biomarkers` tool had the same
  bug (hardcoded `vo2max: null`) despite already fetching the data; fixed.
- **Auto-describe now waits for the debrief to resolve.** `describeActivityOnStrava`
  gates on `debriefState`/`reviewedAt`; the Strava write fires the moment
  the ride review actually posts (from the popup submit, the debrief
  lifecycle retry, or a race debrief) instead of racing it or waiting for
  the next daily sweep.
- **Two new opt-in description fields**, same per-field settings toggle as
  the rest: **Ride review** (short AI-generated summary, ~140 chars) and
  **RPE / feel** (the athlete's own debrief answer, shown alongside it).

## v0.23.1 — 2026-07-23 — Coach Composer & History

Follow-up to v0.23.0's inbox. The composer was `fixed left-0 w-full`, so
it could slide under the desktop sidebar or sit off-center; it now lives
in normal flow (`h-svh` column: header → scrollable messages →
composer), so it can't drift regardless of viewport width.

- **Chat|Inbox segments, the Chat History and Quick Context
  collapsibles, and the pill row above the composer are gone.**
  Suggestions now show only on an empty chat (max 3), and clicking one
  sends it immediately instead of just filling the input.
- **Inbox merges into one History surface**: "From your coach"
  (system-thread messages, unread dots, kind tiles) above "Chats" — a
  bottom sheet on mobile, a dropdown from the thread-title button on
  desktop. `/coach?tab=inbox` now redirects to `/coach`.
- Input is now an auto-growing textarea (Enter sends, Shift+Enter
  newlines) instead of a single-line field.

## v0.23.0 — 2026-07-23 — IA & Navigation Redesign

Every route gets a job, duplicated modules get one home, and the nav is
renamed to match: `Home / Plan / Log / Coach / Journal / Menu` becomes
`Today / Train / Coach / Body / Menu`. Handoff:
`docs/design_handoff_ia_redesign/README.md` (mockups, rationale, screen
specs for every screen below).

- **Today rebuilt**: one glass hero (readiness ring, band verdict, a
  numeric why-line, Recovery/Sleep legend), a 2×2 (4-across on desktop)
  vitals grid with 7-day sparklines, a session card whose **Mark done**
  button is now real — `markDayDone` records the athlete's word as status
  only (no invented load, no synthetic activity), so week adherence still
  reflects only what actually synced.
- **`/plan` and `/log` merge into `/train`** (Week · History · Fitness
  tabs): the week becomes one grouped hairline-row surface instead of
  seven glass cards; History gets a 7-day stat strip over compact rows;
  Fitness gets CTL/ATL/TSB tiles above the PMC chart. `/plan` and `/log`
  retire as framework-level 308s to `/train`.
- **`/journal`, `/health`, and `/log`'s wellness half merge into `/body`**
  (Trends · Sleep · Journal · Labs): HRV/RHR trends render against the
  athlete's own baseline band instead of a population norm; sleep gets its
  real stage breakdown, consistency, chronotype and tonight's recommended
  bedtime. `/journal` and `/health` retire as 308s to `/body`.
- **Coach gains an inbox** (`Chat | Inbox · n`): a chronological rail of
  every morning brief, ride debrief, weekly review, and overtraining
  warning the coach has written, sourced from the existing system-thread
  messages — no new tables. Migration `0024` adds one additive column,
  `chat_messages.read_at`.
- **Two new URL-driven bottom sheets** replace the morning check-in and
  post-ride debrief inline forms: `?sheet=checkin` and
  `?sheet=debrief&activity=…`, so both push notifications now deep-link
  straight into an open sheet instead of the dashboard or the activity
  page.
- **Menu and activity detail restyled**: collapsed settings groups now
  carry a real summary line (`Claude · deep · 1 memory`,
  `push on · wake 06:00 · FTP 310`); activity detail gets a 3×2 stat-tile
  grid and an emerald-tinted debrief card quoting the athlete and the
  coach in turn.
- **A real desktop layout**: Today splits into a 7fr/5fr grid at `lg+`
  (150px readiness ring, a week-progress row, an inbox teaser on the
  coach brief), and the sidebar gets its spec'd 216px width with a pinned
  account row.
- **Duplicate data removed** along the way: the PMC chart's own CTL/ATL/TSB
  readout (now redundant with the tiles above it), biological age printed
  in both a new tile and `BioAgeCard`'s headline, and the next race
  appearing both as a chip and as a list row on Train.
- **Fixed while touching the surfaces that exposed them**: the coach
  writes markdown that had never been rendered anywhere in the app (chat,
  ride reviews, inbox previews all showed raw `**`); TSB and sleep-debt
  tiles that printed raw floats and triple-digit minute counts; a sheet
  backdrop that was unclickable on desktop (a stacking-context bug that
  trapped it under the sidebar); a malformed activity id in a sheet URL or
  route param that 500'd instead of 404ing; neither nav marking its
  active item `aria-current`.

## v0.22.0 — 2026-07-22 — Wellness Fitness Metrics

intervals.icu was already sending `vo2max`, `rampRate`, and per-sport
`pMax`/`wPrime` in the daily wellness payload we fetch nightly — none of
the four made it into a typed column. Design:
`docs/specs/2026-07-22-v0.22-wellness-fitness-metrics-design.md`.

- **Bio-Age's dormant VO2max slot filled**: the health page's `vo2max`
  input was hardcoded `null` with a comment claiming no provider carried
  it — the data has been in the raw payload since day one. Now wired from
  the athlete's most recent Garmin-synced reading.
- **New Log page stat row**: eFTP, max power, and W′ (anaerobic capacity)
  now render next to the PMC chart, alongside a sign-aware CTL ramp-rate
  trend label (Ramping / Tapering / Steady). Each stat hides itself when
  the athlete has no real value for it — no zero, no placeholder.
- **Data layer**: `vo2max`/`rampRate`/`pMax`/`wPrime` added to
  `wellness_daily`, the intervals.icu connector, and the per-field wellness
  merge policy (`vo2max` under the physiology priority ladder, the other
  three under the intervals.icu-only training-load ladder, same bucket as
  `eftp`).

## v0.21.0 — 2026-07-22 — Design Consistency

A second Superdesign pass extends v0.19's dark-glass visual language to
every remaining route, including the five pages v0.19 already restyled.
Presentation only — no new data, metrics, features, or migrations. Design:
`docs/specs/2026-07-21-full-design-update-design.md`, implementation:
`docs/specs/2026-07-22-full-design-update-implementation.md`.

- **Dashboard hero rebuilt**: concentric Apple-Watch-style `ReadinessRings`
  (center readiness number, nested Recovery/Sleep/Strain rings, each
  independently calibrating) replace the old single ring. `StrainBudget`
  (a duplicate of `strainFraction`) and the now-superseded `ScoreRing` are
  both deleted.
- **Hairline-restraint tier** (Settings, Health, Admin, Import): a new
  `.hairline-list` CSS utility flattens nested glass-in-glass card stacks
  into hairline-divided rows. Applied to Settings and Import; Health and
  Admin's existing structure was already consistent and left unchanged.
- **Glass-tile tier** (Log, Activity detail, Coach, Journal, Plan): dedup
  and header-consistency pass. Log's duplicate TSB display and Journal's
  duplicate logging streak are resolved — the streak now hides on the
  shared `MilestonesCard` via a `hideStreak` prop (still shown on
  Dashboard, its other consumer).
- **Login copy fix**: removed invented "Premium Athlete Edition" /
  "Forgot Access Key?" language that didn't correspond to any real
  feature. Join was already honest and needed no change.
- **Final whole-branch review fixes**: closed a pre-existing SSR/hydration
  relative-time mismatch in the dashboard's sync chip
  (`useSyncExternalStore`-backed mount gate, avoiding the
  `react-hooks/set-state-in-effect` trap a naive effect-based fix would
  hit); deleted the `GlassTile` primitive, which ended up with no
  production consumer once the concentric-rings direction was chosen;
  restored three `WeeklySummary` regression tests that had been dropped
  as collateral damage of the `ScoreRing` cleanup.

## v0.20.0 — 2026-07-21 — Final Sweep

Closes out the current roadmap in one release: cross-cutting polish, the
v0.17 operations track, and the remainder of v0.18's 1.0-hardening list.
Nothing net-new in user-facing scope — every item here finishes a
half-done backlog line or makes what already exists more trustable.
Stronger Together (v0.16, social/sharing) is explicitly deferred to a new
roadmap rather than squeezed in here. Design:
`docs/specs/2026-07-21-v0.20-final-sweep-design.md`.

### Track 1 — Polish

- **Empty states and loading skeletons** on the four pages v0.19's
  restructuring skipped (`plan`, `activity/[id]`, `activity/log`,
  `health`, `import`) — reusing the shared `EmptyState` primitive and
  matching layout-stable skeletons, including a fix for `plan/loading.tsx`
  missing `RacesSection`'s always-rendered "add race" bar (content would
  otherwise shift on stream-in).
- **Chart consistency**: one shared token + axis/legend grammar
  (`CHART_TOKENS`, `formatChartValue` in `src/lib/charts.ts`) across
  `stream-chart`, `wellness-trends`, `weekly-load-bars`, the dashboard
  sparklines, and the coach `artifact-card` — hand-rolled SVG stays
  hand-rolled, this is a token unification, not a chart-engine rewrite.
  An unwired `axisTicks` helper and an unused `fontSize.tick` token added
  during the migration were caught in review and removed rather than left
  as dead code.
- **Default journal entries**: frequent _behavioural_ tags now pre-toggle
  from a "remember these as usual" setting — the energy/soreness/stress
  sliders are untouched by this and still write nothing when left
  unanswered, preserving the v0.7 score-integrity contract.
- **Performance-log filters**: verified end-to-end (view/month/range/sport
  all round-trip through one shared href-builder, extracted to
  `src/lib/log-href.ts` with a new regression test) — confirmed already
  correct since v0.19, no functional gap found.

### Track 2 — Ops / Self-Hosted Citizen

- **Prometheus `/metrics`** (`METRICS_TOKEN`-gated, timing-safe compare,
  404 when unset) and a richer `/api/health`: sync staleness, sync-job
  queue depth (pending/running/failed), backup age, and push-subscription
  count — all instance-wide aggregates, backed by one shared
  `getOpsSnapshot()` helper so the two endpoints can't drift.
- **`POST /api/internal/backup-complete`**: `BACKUP_NOTIFY_SECRET`
  shared-secret gate (timing-safe), called by `scripts/backup.sh` after
  every successful rotation; records backup freshness and fires the new
  `backup_completed` webhook.
- **Signed outbound webhooks** (migration `0021`,
  `webhook_subscriptions` / `webhook_deliveries`): HMAC-SHA256-signed
  POSTs on `readiness_computed`, `band_changed`, and `backup_completed`,
  with bounded retry (4 attempts, capped exponential backoff) and a
  per-attempt fetch timeout so a hung target can't stall the scheduler's
  sequential tick loop. Per-user dispatch is strictly scoped to the
  subscription owner's `userId`; `backup_completed` alone is deliberately
  instance-wide (it's not per-user data). Create/revoke are self-service
  and now audit-logged, matching the existing API-token audit pattern.
- **Sync-jobs admin panel**: owner-only view of every user's sync jobs
  (queue/running/failed) with manual retry (resets `runAfter` to now, not
  just `status`, so a backed-off job is actually picked up again) and a
  per-user "kick" — both re-gated independently of the page-level guard.
- **Complete GDPR export** across every user-owned table (journal,
  biomarkers, coach memories, chat messages, connections/settings, races,
  training plans, week plans, adjustments, token metadata — secrets
  stripped, never decrypted) plus a matching **import** path
  (`POST /api/import-account`, session-gated, always writes to
  `session.user.id`). `scripts/export-import-drill.sh` proves the
  export → wipe → import round trip is lossless against an ephemeral
  scratch database — never the live DB.
- **Native `ubuntu-24.04-arm` release runners**: multi-arch images
  restored (amd64 + arm64 native + manifest merge) without the ~50-minute
  QEMU cost that got arm64 dropped in v0.8.
- **Vercel + Neon deployment guide** (`docs/DEPLOY-VERCEL.md`): corrects
  prior guidance that told Neon deployers to omit `DATABASE_DRIVER`
  (which silently disables the scheduler's advisory locks); documents the
  correct pooled-connection + `DATABASE_DRIVER=pg` setup and a known gap
  (Vercel's native GET-only Cron Jobs can't reach `/api/cron`, which is
  POST-only — use an external scheduler).

### Track 3 — Hardening

- **Accessibility sweep**: a check-and-close pass over navigation,
  `ScoreRing`, the dashboard hero, journal form, settings accordions, and
  the coach composer — real, targeted gaps fixed (a missing
  `aria-hidden` on `ScoreRing`'s decorative subtree, three unlabeled
  icon-only buttons in the chat composer, several sub-AA-contrast text
  labels bumped `/30`→`/50`, three textareas/inputs with `outline-none`
  and zero replacement focus style). Full writeup and contrast math in
  `docs/a11y-sweep-2026-07.md`.
- **Session-management UI**: list active sessions/devices and revoke one
  or all-others, backed by Better Auth's own `sessions` table and
  `revokeSession`/`revokeOtherSessions` APIs, with an explicit
  self-ownership check and a guard against revoking your own current
  session. No 2FA/passkeys — deliberately out of scope for this
  deployment model (self-hosted, invite-only, behind a tunnel; see
  `docs/ROADMAP.md`'s v0.18 section for the reasoning).
- **Upgrade guarantees**: `scripts/migration-drill.sh` restores a real
  nightly `pg_dump` into a scratch Postgres and runs migrations against
  it, plus runs the full migration chain against an empty scratch DB —
  both scratch-only, never the live database. Documented rollback
  procedure and a backup-compatibility matrix in `docs/UPGRADING.md`.
- **Performance pass**: a dashboard cold-load budget plus a query audit
  found and fixed real N+1/missing-index gaps on the hot path. Findings
  and methodology in `docs/perf-pass-2026-07.md`.
- **API/MCP stability freeze**: the 54-tool surface in
  `src/lib/tools/registry.ts` (names and schemas, including per-field
  descriptions) is now frozen with a snapshot test and a published
  deprecation policy — see `docs/API-STABILITY.md`.
- **Docs reviewed end-to-end**: doc claims re-verified against code
  rather than trusted as-is (tool count, connector list, env-var names);
  fixed a real drift (`.env.example` was missing the Whoop and Withings
  OAuth env vars entirely) and filled gaps in `docs/SELF-HOSTING.md` for
  every surface this release added.
- **Final security review**: re-ran the v0.18.0 per-user-isolation lens
  over every surface this release added — `/metrics`,
  `/api/internal/backup-complete`, webhook dispatch, the account-import
  route, and the sync-jobs admin panel. **Zero gaps found** — full
  evidence trail in `docs/security/2026-07-21-v0.20-review.md`. The
  import route in particular was re-confirmed to write only to
  `session.user.id`, never a caller-supplied target.

## v0.18.0 — 2026-07-21 — Security Hardening

The first slice of the roadmap's "1.0 Hardening" epic — shipped after
v0.19.0 because v0.19 jumped this slot's place in the queue for a design
pass (see that entry below). Cheap high-value web-security fixes, a light
auth/token/connection audit log, and an exhaustive per-user isolation and
input audit over the full post-v0.19 codebase. Design:
`docs/specs/2026-07-20-v0.18-security-hardening-design.md`.

### Added

- **HTTP security headers** on every response: `X-Frame-Options: DENY`,
  `X-Content-Type-Options: nosniff`, `Referrer-Policy:
strict-origin-when-cross-origin`, HSTS, a pragmatic
  `Content-Security-Policy` (`frame-ancestors 'none'`), and a
  Permissions-Policy that deliberately does not deny microphone — v0.15's
  voice dictation needs it. `src/middleware.ts` renamed to `src/proxy.ts`
  per Next.js 16's convention.
- **Login rate-limiting** (20 requests/60s) and boot-time
  `BETTER_AUTH_SECRET` validation — the app now fails loud at startup on a
  missing or too-short secret instead of silently degrading session
  security, mirroring the existing `ENCRYPTION_KEY` check.
- **Security event audit log**: a new `audit_log` table records
  login success/failure, API token creation/revocation, and connection
  add/remove events (7 providers) — never a secret value, only labels and
  provider names. Owner-only "Recent security events" list on `/admin`.
- **Exhaustive per-user isolation & input audit**: every route handler,
  server action, MCP tool (all 54), OAuth callback, and webhook checked
  for cross-user data leaks; the LLM biomarker-extraction and file-upload
  paths re-confirmed against their original no-tools/bounded-parsing
  guarantees. Zero gaps found — the full checklist and reasoning live at
  `docs/security/2026-07-20-isolation-audit.md`. Backed by new regression
  tests proving MCP token isolation, export-endpoint scoping, and a
  representative server action's cross-user denial.

### Fixed

- **Apple Health ingest**: `Referrer-Policy: no-referrer` and
  `Cache-Control: no-store` on every response (the ingest token can arrive
  via a `?token=` URL parameter), and the size cap is now enforced by
  actually counting bytes read instead of trusting the client-supplied
  `content-length` header, which can be omitted or understated.
- Two moderate `npm audit` advisories (a nested build-time `postcss` copy
  in `next`, a dev-only `esbuild` pulled in transitively by `drizzle-kit`)
  investigated to root cause and confirmed unreachable at runtime; not
  forced via a breaking major downgrade.

Deferred past this slice, still open in the roadmap: passkeys/TOTP 2FA,
full session-management UI, a strict `script-src` CSP.

## v0.19.0 — 2026-07-20 — Design Refresh

A Superdesign pass rethought the dashboard, coach, log, journal, and
settings screens around progressive disclosure — collapsed-by-default
sections instead of everything rendered flat. Purely structural: same data,
same queries, same features. Design:
`docs/specs/2026-07-20-v0.19-design-refresh-design.md`.

### Added

- **Shared `Collapsible` and `EmptyState` primitives** (`@base-ui/react`,
  the `render`-prop convention) — one disclosure grammar used consistently
  across all five restructured pages instead of five ad hoc ones.
- **Dashboard**: one animated Readiness ring as the page's single focal
  metric; Recovery/Sleep/Strain demoted to a compact stat row; "Recovery
  Metrics" and "Recent Sessions" become collapsed-by-default accordions.
- **Settings**: one accordion per domain (Integrations, AI & Tech,
  Advanced/API, App, About) — only Profile stays always-open. Closes the
  "Settings information architecture" backlog item.
- **Log**: Today/Week/Month time-range navigation (plus a month strip)
  replaces the old Training/Wellness content toggle; the Performance Trends
  (PMC) and Wellness Trends panels are now always-present, independently
  collapsible sections instead of one being reachable only via a tab.
- **Journal**: stepped check-in (mood → wellness sliders → vitals, one step
  open at a time, completed steps collapse to a checkmark); correlation
  insights promoted above the form; the honest-input contract (v0.7) is
  unchanged — no step can force-fill an untouched field.
- **Coach**: collapsible Chat History and Quick Context panels; quick-reply
  chips above the composer (fill the input, never auto-send, matching the
  voice-dictation rule).
- Honest empty states and layout-stable loading skeletons on all five
  touched pages.

### Fixed

- Screen-reader heading navigation for every new collapsible section (all
  five pages) — the shared trigger now sits inside a semantic heading.

## v0.15.0 — 2026-07-20 — The Coach Remembers

Coach memory held structured facts; it still couldn't recall what was
actually said, and every ride ended in silence. Design:
`docs/specs/2026-07-19-v0.15-coach-remembers-design.md`.

### Added

- **Recall over history**: `recall_history` coach tool (53 → 54) — Postgres
  full-text search ('simple' config for mixed Dutch/English) across past
  conversations, weekly/monthly reviews, ride debriefs, and journal notes.
  The coach cites results with dates and says so when it finds nothing.
  Ghost threads are excluded — they were promised to vanish.
- **Post-ride loop**: a 15-minute intervals.icu activity poll (no webhooks
  exist; quiet 23:00–06:00) detects a fresh ride, a debrief card asks RPE /
  feel / notes (untouched fields write nothing; intervals.icu RPE prefills),
  and the coach writes a ride review reconciling the numbers with the
  athlete's own words — quoted, never paraphrased. Skipped or expired
  debriefs get a data-only review that says no feedback was given. Strava
  activities are excluded end-to-end (API AI clause). Opt-in push.
- **Monthly report**: the weekly review's big sibling — load vs previous
  month, readiness trend, milestones, biomarkers logged, races — at-most-once
  per calendar month, sections omitted when the data isn't there.
- **Voice input**: mic in the chat composer (Web Speech API) — dictation
  fills the box, never auto-sends, with an honest note that the browser
  vendor may process the audio. Recover never sees or stores audio.
- **Token transparency**: `llm_usage` rows at every real LLM call site;
  settings shows this and last month by model and purpose. Tokens, never
  cost estimates.

### Changed

- Cycle-Aware Readiness deferred (roadmap): no athlete on a running instance
  generates cycle data; later versions renumbered (v0.16 Stronger Together,
  v0.17 Good Self-Hosted Citizen, v0.18 1.0 Hardening).
- Migration 0018: FTS columns + GIN indexes, debrief state on activities,
  `llm_usage`, poll cursor, debrief prefs.

## v0.14.0 — 2026-07-19 — Race Ready

The adaptive week manages training; race day is why it exists. Everything
here stands on v0.10's honest load engine — forecasting from fabricated CTL
would be fabrication with extra steps. Design:
`docs/specs/2026-07-19-v0.14-race-ready-design.md`.

### Added

- **Race calendar**: a `races` table (migration 0016) makes A/B/C races
  first-class entities, with `training_plans.race_id` linking a plan to its
  goal race. Generating a plan without an explicit race implicitly creates
  the A race from the plan's target date, so coach memory's informal race
  knowledge finally has a real row behind it.
- **Taper engine** (`materializeWeek`): the living week reshapes into a taper
  as race day approaches — window length by race distance (21/14/10 days)
  and weekly load fractions (45%/65%/80%) — and the ramp guard's downward
  clamp steps aside during taper weeks so the drop isn't fought as an
  anomaly. Race-week openers keep the taper from feeling like a dead stop,
  and race-day slots are untouchable by adaptation or manual moves.
- **B/C race convention**: B races get a protected pre-race ease-off (a rest
  day the day before, no quality work two days out); C races are training
  days like any other and the plan trains straight through them.
- **Readiness forecast** (`src/lib/race/forecast.ts`): a pure EMA
  forward-simulation of CTL/ATL over the planned week, reported as an honest
  two-scenario band — full execution vs trailing-adherence-scaled, floored
  at 50% — and only ever FORM (TSB), never a projected readiness score. Falls
  back to an explicit `insufficient` state when load history isn't
  calibrated yet instead of guessing.
- **What-if simulator** (`simulatePlanChange`): move/swap/skip previews on
  `/plan` show the load and TSB impact before the change is saved, gated
  behind a confirmation dialog when the delta is material, plus a read-only
  `simulate_plan_change` coach tool for the same preview in chat.
- **Race-day brief & post-race debrief**: the morning coach thread leads
  with the race on race day; afterward, a debrief links the result activity,
  closes the race, and — if no result has landed after 48 hours — says so
  honestly instead of stalling silently. Both are transactional and
  idempotent. The debrief links to Strava's results but keeps Strava's own
  stats out of the AI narrative, per the existing firewall.
- **Dashboard `RaceCountdownCard`**: next race, days out, and a projected
  form-outlook band range, with honest `insufficient`/no-plan states instead
  of a blank or fabricated card.
- 4 new coach/MCP tools (49 → 53 total): `get_races`, `upsert_race`,
  `delete_race`, `simulate_plan_change`.

## v0.13.0 — 2026-07-19 — Deep Biology

Long-horizon health metrics, finally data-backed: v0.11's Withings
connector and this release's blood-test extraction fix the input side that
kept this deferred. Design:
`docs/specs/2026-07-18-v0.13-deep-biology-design.md`.

### Added

- **Health Records** (`/health`): upload a blood-test PDF/photo or paste
  the values → your own LLM extracts biomarkers with a per-value confidence
  → an editable review screen → the `biomarkers` table. Nothing is stored
  unconfirmed. With no LLM configured, pasted text still parses via a
  deterministic line parser. Migration 0015 (additive).
- **Biological age** (`src/lib/biological-age.ts`): a transparent composite
  — chronological age plus a small capped offset per honest signal (resting
  HR, HRV, sleep consistency, VO₂max, body fat). Below three signals or
  without a birth year it shows an "insufficient inputs" state naming
  what's missing, never a guessed number.
- **Blood pressure** (`src/lib/blood-pressure.ts`): manual entry plus
  Withings sync (v0.11), classified against the 2017 ACC/AHA bands with a
  recent-average trend and direction.
- **Coach visibility**: a `get_biomarkers` tool (registry 48 → 49) surfaces
  latest values, BP classification, and the bio-age summary to the coach,
  bounded to reference trends only — it never diagnoses or recommends
  treatment.

## v0.12.2 — 2026-07-19 — Audit Fixes

A post-merge audit of v0.10–v0.12 (which shipped without the usual
per-task review trail) and a pre-merge review of v0.13. The engines held
up; four fixes came out of it.

### Fixed

- **Strava firewall**: the v0.10 native load engine fed
  `provider='strava'` activities into the stored CTL/ATL series, which
  reaches coach context and MCP tools through readiness — the aggregate
  path the Nov-2024 Strava agreement closes. Strava rows are now excluded
  from the native series (the dashboard-only weekly rings still count
  them); a Strava-only athlete honestly stays `calibrating`.
- **Concurrent wellness writes**: `field_sources` ownership is written as
  a jsonb union of the changed fields instead of a full-map overwrite, so
  an Apple Health webhook landing mid-sync can no longer erase another
  provider's ownership records.
- **EMA decay**: a scheduler pass recomputes today's metrics once per day
  for users no sync touches — a manual-only athlete's CTL/ATL now decay
  through restful days instead of freezing at the last entry.
- **Apple Health ingest**: payloads over 10 MB are rejected before
  parsing.

## v0.12.1 — 2026-07-18

Packaging release, no code changes: the first tagged image since v0.9.5,
delivering v0.10.0, v0.11.0, and v0.12.0 (merged without tags) to
Watchtower-updated instances.

## v0.12.0 — 2026-07-18 — Sleep Intelligence

v0.9.0 deleted the fabricated sleep cards; v0.11 started ingesting real
stage data. This release earns the cards back — only for athletes whose
provider actually sends them — and gives the whole app a desktop layout.
Design: `docs/specs/2026-07-18-v0.12-sleep-intelligence-design.md`.

### Added

- **Sleep stages, for real** (`src/lib/sleep-insights.ts` + `SleepStagesCard`):
  a stacked deep/REM/light/awake bar with per-stage minutes and the bed
  window, rendered only when the provider sent stage data. A manual athlete
  sees nothing invented — the card doesn't mount.
- **Sleep consistency**: a 0–100 regularity score from the circular SD of
  sleep midpoint over the trailing month — the metric the literature ranks
  above duration — gated on enough real bed/wake nights.
- **Chronotype & social jetlag**: mean sleep midpoint plus the weekday vs
  free-day gap, so a shifting weekend schedule shows its cost.
- **Bedtime target v2**: when a provider sends real bed times, the nightly
  bedtime target anchors on the athlete's habitual bedtime nudged by sleep
  debt; the manual wake-time path is unchanged for everyone else.
- **Desktop shell**: a persistent sidebar nav and a wider, two-column
  dashboard at `lg`+, replacing the phone-stripe-on-a-monitor `max-w-lg`
  layout. The floating bottom tab bar stays on small screens.

## v0.11.0 — 2026-07-18 — Wearable Connectors

intervals.icu stops being the only automatic pipe. Whoop and Oura bring
back the staged sleep and bed/wake data v0.9.0 had to delete cards for,
Withings adds body composition and blood pressure, and Apple Health lets
anything on an iPhone push in. Two providers reporting the same morning
now resolve by an explicit per-field priority instead of last-writer-wins.
Design: `docs/specs/2026-07-18-v0.11-wearable-connectors-design.md`.

### Added

- **Per-field wellness merge** (`src/lib/wellness-merge.ts`): every
  provider write goes through one priority policy that records which
  source owns each field (`wellness_daily.field_sources`). Manual entry
  always wins; dedicated wearables beat intervals.icu on physiology;
  Withings wins body composition & BP; training-load fields stay
  intervals.icu-only; a null from any provider never erases existing data.
  Migration 0014 is additive (staged-sleep, bed-window, temperature,
  respiration, BP, and body-fat columns plus `field_sources`).
- **Whoop** (OAuth2, `WHOOP_CLIENT_ID`/`WHOOP_CLIENT_SECRET`): recovery
  HRV & resting HR joined to staged sleep, mapped to the wake date.
- **Oura** (Personal Access Token pasted in Settings — no OAuth app
  needed): staged sleep, HRV/RHR, sleep score, and temperature deviation.
- **Apple Health**: token-authed Health Auto Export webhook plus a one-off
  JSON file upload — sleep stages, HRV, resting HR, respiration, blood
  pressure, and body composition, no Apple API required.
- **Withings** (OAuth2, `WITHINGS_CLIENT_ID`/`WITHINGS_CLIENT_SECRET`):
  weight, body-fat ratio, and blood pressure.
- **Guided first run**: the onboarding screen is now a source picker
  (connect a device / log manually / import CSV), and the calibrating
  readiness ring shows an honest "day N of 14" progress bar with a
  next-step prompt instead of a bare label.

### Changed

- The intervals.icu sync and the manual journal writer now route through
  the per-field merge, so a second provider can no longer clobber their
  fields on the same day.

## v0.10.0 — 2026-07-18 — Honest Load

Recover stops borrowing its training-load math. CTL/ATL/TSB are now
computed natively from the athlete's own sessions when intervals.icu
doesn't provide them, and every score that used to be invented from
missing data now says `calibrating` instead. Design:
`docs/specs/2026-07-18-v0.10-honest-load-design.md`.

### Added

- **Native load engine** (`src/lib/training-load.ts`): per-activity load
  in TSS-like units via a first-match ladder — provider load → power TSS
  (needs FTP) → heart-rate TSS (needs max HR + resting-HR baseline) →
  honest duration fallback (an unlabeled hour counts as easy) — with
  cross-provider dedup, then CTL (42d) / ATL (7d) EMAs over the daily
  sums. Works for every source: manual, CSV, Strava, intervals.icu.
- **Source precedence**: intervals.icu's precomputed ctl/atl keep winning
  when present; native values fill the gaps and are labelled `computed`
  on the new `daily_metrics.ctl/atl/load_source` columns (migration 0013,
  additive). Readiness's form component now works for manual-only
  athletes.
- **Training thresholds** in Settings → Body: optional max HR and FTP
  feed the HR/power rungs; changing them recomputes the recent window.
- **"This Week" rings wired**: the hardcoded `0.7`/`0.8` fractions are
  replaced by real targets — planned week volume and the active block's
  target load, falling back to trailing 28-day averages — and the rings
  simply don't render when no honest target exists.

### Fixed

- **Recovery & Strain are no longer invented**: the dashboard read
  `latest?.atl ?? 0` / `latest?.ctl ?? 0`, giving a no-integration
  athlete a hero "Recovery 60" and "Strain 0.0" from zero data. Both
  rings, the strain budget, and the narrative now use the effective
  (provider-or-computed) values and show `calibrating` until at least 7
  activity days exist in the trailing 6 weeks. Closes the last two
  honesty-debt items.
- The Training Status tile's fabricated "Optimal load intensity" caption
  now shows the real CTL (marked `computed` when native) or nothing.
- Manual activity logging and CSV import now recompute daily metrics, so
  a logged workout shows up in load immediately (imports batch into one
  recompute).

## v0.9.6 — 2026-07-18 — Absorb intervals-icu MCP

24 new intervals.icu tools (23 `icu_*` tools plus a `get_workout_syntax`
reference) bring the standalone intervals-icu-mcp server's capabilities
into Recover's own MCP endpoint and the in-app coach, so the separate
server can be retired. Design:
`docs/specs/2026-07-17-v0.9.6-absorb-intervals-mcp-design.md`.

### Added

- **Live intervals.icu tools** (registry 24 → 48): calendar events
  (list/get/create/update/delete/bulk/duplicate), activity edits and
  messages, wellness push, sport settings, an apply-training-plan action,
  per-activity histograms (HR/power/pace/GAP), activity search and
  intervals, the workout library, and a workout-syntax reference. Writes
  require a new `write:icu` MCP token scope; the in-app coach can use them
  under your session.

### Changed

- The standalone `intervals-icu-mcp` server is no longer needed — its
  curated tool set now ships inside Recover. The standalone repos
  (`intervals-icu-mcp` and its `-deploy` counterpart) can be decommissioned.

## v0.9.5 — 2026-07-17 — Nightly Backups

The database now backs itself up, and one command proves a backup
restores. Design: `docs/specs/2026-07-17-v0.9.5-backups-design.md`.

### Added

- **Nightly backups**: a default-on `backup` sidecar (`postgres:16-alpine`
  and crond) runs `pg_dump -Fc` at 03:30 into the new `recover-backups`
  volume, keeping the newest 14 dumps (`BACKUP_KEEP` to change). Dumps
  write to a temp name and rename on success; rotation runs only after a
  successful dump, so a failing backup can never eat the old ones.
- **Restore drill**: `scripts/restore-drill.sh` restores the latest dump
  into a disposable scratch Postgres, verifies core tables and row
  counts, prints data freshness, and tears everything down — unattended,
  exit 0/1. Documented in `docs/SELF-HOSTING.md` alongside the real
  disaster-recovery procedure.

### Changed

- Roadmap: the old v0.9.5 "Infrastructure" is split — backups shipped
  here; absorbing the standalone `intervals-icu-mcp` server moves to
  v0.9.6.

## v0.9.4 — 2026-07-17 — Deeper Insights

Auto-tags, honest confidence intervals, and real streaks. Everything is
pure and computed on read — no new tables, nothing stored that the data
could stop supporting. Design:
`docs/specs/2026-07-17-v0.9.4-deeper-insights-design.md`.

### Added

- **Auto-tags from activities** (never stored, Strava excluded):
  🔥 Hard session (own top-quartile load, silent under 20 training days),
  2️⃣ Double day, 😴 Rest day, 🌅 Morning training, 🌙 Late training. They
  join the journal's manual tags in the correlation analysis, marked
  "auto".
- **Correlations v2**: per-tag two-sample comparison (tagged vs untagged
  days) with a t-based 95% confidence interval. Rows whose CI crosses
  zero say "inconclusive · n events" instead of asserting an impact. Each
  row expands into weekday/weekend splits, gated at 5 events per side.
- **Milestones card** (dashboard + journal): real logging streak with
  best-ever, plan weeks completed at ≥70% adherence, plans completed.

### Fixed

- **The streaks are real now.** The dashboard's "N-day logging streak"
  was `Math.min(days logged in last 30, 30)` and the journal's was a
  7-day count — both now show the true consecutive run (today not yet
  logged doesn't break yesterday's run). Closes the honesty-debt item.

## v0.9.3 — 2026-07-17 — Week Starts Now

Patch release for the Adaptive Week: a plan's living week now begins the
moment the plan exists, not at the next Monday's weekly review. Claims the
v0.9.3 number, so the planned feature releases shift one patch digit
(Deeper Insights → v0.9.4, Infrastructure → v0.9.5).

### Fixed

- **New plans materialize their week immediately**: `generateTrainingPlan`
  rolls the current week over as its last step, so a plan created on a
  Thursday shows a living week that Thursday instead of a skeleton-only
  `/plan` page until Monday.
- **"Plan this week" button**: for plans that predate this patch (or any
  state where the current week is missing), the `/plan` empty state now
  offers to materialize the week on demand. Safe to press twice — the
  rollover stays idempotent per user-week.
- **Regenerating a plan mid-week no longer shadows it**: the archived plan's
  open week row used to block the new plan's week until next Monday; the
  rollover now replaces that row (adjustments cascade) and logs a
  "plan changed" adjustment so the timeline explains the swap.
- **Mid-week starts don't invent the past**: days already behind the clock
  get zero availability, so a Thursday start plans Thu–Sun instead of
  backfilling fictional workouts onto Mon–Wed. On the normal Monday
  rollover this is a no-op.

## v0.9.2 — 2026-07-17 — Adaptive Week

JOIN-style rolling week on the v0.5d skeleton: workouts materialize one week
at a time from an availability intake and adapt every morning to measured
readiness and available time, with every automatic change logged and
explainable. Design: `docs/specs/2026-07-17-v0.9.2-adaptive-week-design.md`.

### Added

- **Living week tables**: `week_plans` (one open row per user-week, 7 JSON
  day slots) and `plan_adjustments` (one row per automatic change — trigger,
  action, before/after, deterministic reason). Purely additive migration.
- **Two pure engines** in `src/lib/week-plan/`: `materializeWeek` lays the
  skeleton week onto real availability (adherence rule below 70%, readiness
  suppression at ≥4 amber-or-worse days, ±20% ramp guard, a fully missed
  week restarts at 60% of skeleton instead of freezing at ±20%-of-zero);
  `adaptDay` handles each morning (missed quality sessions move once then
  drop with capped redistribution; red replaces quality with 30min recovery
  and shortens endurance 30%; amber steps intensity down at 85% duration;
  `calibrating` never triggers readiness changes; availability always wins
  first).
- **Weekly rollover** wired into the weekly review: closes last week's plan,
  writes actual load/sessions/adherence back to its skeleton block, and
  materializes the new week. **Daily adaptation** runs in the post-sync
  morning pipeline before the morning insight, so the insight quotes today's
  adjustment reasons verbatim instead of inventing them.
- **Availability intake with calendar prefill**: `/plan` suggests minutes
  per day from last week's pattern, halving days with ≥8h of calendar
  meetings (Google Calendar connection optional — a hint, never a blocker).
- **Coach tools**: `get_week_plan`, `set_week_availability` (write:plan),
  `get_plan_drift`; `update_training_plan` gains day-level
  `move_workout`/`swap_workout` actions with the same adjacency and
  availability checks the engines use.
- **`/plan` page**: the living week day-by-day, an adjustments timeline
  ("what changed and why"), the remaining skeleton, and the intake form.
  Dashboard gains a Today card and a 7-dot week strip.

## v0.9.1 — 2026-07-16 — Honest Pixels

Small fixes in the same defect class v0.9.0 worked through: things on screen
claiming to be something they are not. No schema or behavior changes beyond
the pixels below. (The roadmap's planned "v0.9.1 — Smarter Coach" feature
release moves to v0.9.2; subsequent planned versions shift accordingly.)

### Fixed

- **The favicon was still the stock Next.js logo.** `src/app/favicon.ico`
  had never been replaced since project scaffolding, so browser tabs showed
  the Next triangle instead of the Recover ring (Safari masked this by
  preferring the apple-touch icon, which was correct). Replaced with a
  proper multi-size ICO (16/32/48) rendered from the logo on the app's dark
  tile, matching the home-screen icon.
- **The Sleep Score sparkline plotted the wrong series.** The tile's value
  read `sleepScore` (fixed in v0.9.0), but the sparkline under it still
  plotted raw `sleepSecs` — real data, wrong series. It now plots the
  7-day `sleepScore` history the label promises.
- **Sparklines fabricated a flat line from no data.** Fewer than two real
  data points rendered a horizontal line — a visual claim of stability made
  from nothing (the last dashboard item on the honesty-debt list that was
  fixable without the strain/recovery rework). `sparkPath` moved to
  `src/lib/sparkline.ts`, returns an empty path below two points, and the
  vitals grid renders no sparkline at all for an empty path.
- **`package.json` version drift**: it still said `0.8.0` while v0.8.1 and
  v0.9.0 were tagged. Now `0.9.1` and part of the release checklist.

## v0.9.0 — 2026-07-16 — Honest Body Intelligence

v0.7 fixed fabricated data in the database. It never reached the dashboard:
a hardcoded body-battery curve every athlete saw identically, a sleep card
showing a 47%-REM stage breakdown every night no matter what, a
`"22:30 – 23:00"` bedtime string literal, and a "Sleep Score" tile that was
actually `sleepHours / 9 * 100` — while the real `sleepScore` column the
provider sends (populated on the large majority of days) was read nowhere on
the dashboard. Verified against the live DB: intervals.icu's 46-key wellness
payload carries no sleep stages and no bed/wake times at all, so those cards
could not be fixed, only removed.

### Added

- **Body battery, for real**: the energy curve is now modelled from the
  day's actual readiness score and real activity loads at the times they
  happened, instead of a fixed decorative SVG path. Labelled "Estimated
  Energy"; renders an empty state instead of a curve when readiness is
  `calibrating`.
- **Sleep debt**: cumulative deficit over the last 14 recorded nights of
  real `sleepSecs`, measured against the athlete's own sleep-need target.
  Nights with no sleep row are skipped, never counted as a perfect night; a
  surplus night does not offset a prior deficit.
- **Bedtime target**: computed from tonight's debt repayment (capped at
  1h/night) plus the athlete's own wake time. No wake time set means a
  prompt to set one in Settings — never a guessed time.
- **`body_prefs`**: per-user wake time and sleep-need target.

### Fixed

- **The sleep card invented a stage breakdown.** "47% REM / 25% Core / 20%
  Deep / 8% Awake" was a hardcoded literal shown identically to every
  athlete, every night — no connected provider, intervals.icu included,
  returns sleep stages. Removed entirely; the `stages` prop no longer
  exists.
- **"Efficiency" was actually `sleepHours / 8`.** Removed from both the
  sleep card and the vitals grid — there is no time-in-bed data anywhere to
  compute a real efficiency from.
- **"Sleep Score" was actually `sleepHours / 9 * 100`,** never the real
  `sleep_score` column the provider returns. The vitals grid and sleep card
  now both read `latest.sleepScore` and show "—" when the provider gave
  none, rather than a formula standing in for a measurement.
- **The bedtime recommendation was a string literal**, `"22:30 – 23:00"`,
  shown to every athlete regardless of schedule. Replaced by a target
  computed from real sleep debt and the athlete's own wake time.
- **The body-battery curve was a fixed decorative SVG path**
  (`M0 40 Q50 30 80 45 ...`) that no caller ever overrode — every athlete
  saw the same fictional day regardless of readiness or training.

**Done when:** the five sleep/energy fabrications above — the stage
breakdown, the `"22:30 – 23:00"` bedtime literal, "Efficiency", the
`sleepHours / 9 * 100` Sleep Score, and the fixed body-battery SVG path,
spanning eight code sites — are gone from the dashboard; a day with training
shows a curve that drops when the athlete actually trained; an athlete with
no wake time set sees a prompt, not a bedtime.

This release deliberately scoped itself to the sleep and energy cards. It
does **not** claim the dashboard is now free of invented numbers — see below.

**Known remaining work — the dashboard still fabricates elsewhere.** These
are pre-existing on `main`, untouched by this release, and named here so the
ledger is honest rather than flattering:

- **Recovery and Strain are already fabricated for manual-only athletes.**
  `recoveryScore` and `strainFraction` (`src/app/page.tsx`) derive from
  `latest?.atl ?? 0` / `latest?.ctl ?? 0`. `atl`/`ctl` are nullable and
  written only by the intervals.icu sync, so an athlete on v0.8's
  no-integration path has both `null` — and the `?? 0` coalesce renders a
  hero **"Recovery 60"** and **"Strain 0.0"** built from zero training data.
  This is live today, in the page's most prominent cards (`ScoreRing`,
  `StrainBudget`) and in the narrative text. Fixing it needs an honest
  null-propagation path for CTL/ATL — the same `calibrating` treatment
  readiness already gets — which is a larger change than this release.
- **The "This Week" rings are hardcoded** to `ringOuter={0.7}` /
  `ringInner={0.8}` for every athlete, forever — the same defect class as
  the body-battery path removed above. They were left alone rather than
  wired to `recoveryScore`/`strainFraction`, because doing so would only
  propagate the fabrication above into two more rings.
- **The logging "streak" is a count, not a streak** — `Math.min(window30.length, 30)`
  counts rows in a 30-day window, so 22 scattered days renders "22-day streak".
  Proper streak semantics land with Achievements in v0.9.2.

## v0.8.0 — 2026-07-16 — Data Freedom

Use Recover without any integrations. Log vitals and activities manually,
import CSV data, and unlock your readiness score from day one — no
intervals.icu required.

### Added

- **Manual-first onboarding**: the dashboard now offers three paths — start
  logging manually, connect intervals.icu, or import CSV data. No
  integration is required to begin.
- **Manual vitals entry**: when no integration is active, the journal form
  shows HRV, resting HR, sleep, and weight input fields. Synced values
  still auto-populate when an integration is connected.
- **Manual activity logging** (`/activity/log`): log rides, runs, swims, and
  other sessions with sport type, duration, distance, HR, power, elevation,
  and training load.
- **CSV import** (`/import`): upload wellness or activity CSVs with flexible
  column name mapping (supports common formats from Apple Health, Garmin,
  Whoop, and spreadsheets). Drag-and-drop upload, row preview, batch
  upsert.
- CSV parser tests (7 cases covering both wellness and activity formats).

### Fixed

- **Middleware was dead code**: `src/proxy.ts` exported a function named
  `proxy()` instead of `middleware()`, so Next.js never called it — no
  session redirects worked. Renamed to `src/middleware.ts` with the correct
  export. The route guard matcher (which correctly excludes `/api/mcp`,
  `/api/cron`, and public assets) is now active.
- **Behavior tag buttons did nothing**: dashboard tags were `<button>`
  elements with no click handler. Now link to the journal page.

## v0.7.0 — 2026-07-16 — Score Integrity

Stop the app from knowing things it doesn't know. Both fixes protect the
readiness score's foundation, which everything after this consumes.

### Fixed

- **The journal no longer invents answers.** Energy/soreness/stress
  initialized to 7/4/4 and were submitted on every save, so ticking a single
  behavior tag wrote three subjective numbers the athlete never gave —
  stored indistinguishably from real ones. Unanswered sliders now submit
  nothing, read `—`, and announce "not answered" to screen readers. A
  deliberate tap on the resting value is still kept.
- No existing data is deleted or altered: pre-v0.7 rows can't be separated
  from genuine answers, and destroying truth to hide a lie is worse.

### Added

- **Day flags** (🤒 ill, ✈️ travel, 🏔️ altitude): facts that invalidate a day
  as a baseline reference. Flagged days are excluded from the 60-day rolling
  baselines, so a week of flu no longer makes you read falsely green for the
  next two months.
- Flagged days are **still scored** — exclusion governs baseline membership
  only; an ill day should read red, it just shouldn't redefine "normal".
- Flagging a past day **retroactively repairs** every score after it.
- Over-flagging degrades honestly to `calibrating` rather than a confident
  wrong number.
- `get_wellness` returns day flags — the coach knowing you were ill changes
  its advice.

The readiness engine itself is unchanged: exclusion happens where the
baseline array is assembled, and `readiness.ts` and its tests are untouched.

## v0.6.2 — 2026-07-16 — Strava description fields

- **Field selection**: choose which metrics appear in your Strava descriptions, with a live preview rendered against your most recent activity
- Users who never customize keep the full v0.6 template unchanged
- Disabling every field skips the Strava write instead of publishing a bare marker

## v0.6.1 — 2026-07-15

Post-review fixes for v0.2–v0.5.

### Fixed

- **Strava AI firewall**: Strava-sourced activities were reaching two AI surfaces (coach context injection and weekly-review aggregates) — now excluded everywhere, per the Strava API terms.
- **Weekly review scheduling**: never fired under default settings (exact-hour match against the overnight sync). Now uses due-since-slot logic; default review slot Monday 04:00.
- **Weekly review visibility**: was stored with a role the thread view hides, so the dashboard link opened an empty thread. Now rendered.
- **Google Calendar**: access token now refreshes on expiry (the tool broke ~1 h after connecting); OAuth scope narrowed to FreeBusy-only.
- **Training plan**: removed adjustment actions that reported success without changing anything; plan writes made idempotent (at most one active plan; guarded week advance).
- **MCP tokens**: `write:plan` and `write:memory` scopes are now mintable, so all write-capable tools are authorizable.
- **OAuth redirects** use the public origin / `BETTER_AUTH_URL` rather than the container hostname; coach responses match the athlete's language.

## v0.6.0 — 2026-07-15 — Strava AI Descriptions

- **Strava write-back**: opt-in `activity:write` OAuth upgrade; auto-generates an emoji-rich metrics block (load, IF, TRIMP, form, PRs) from intervals.icu data and appends it below a `---` separator after sync, with a skip marker to prevent double-writes. Manual `describe_strava_activity` coach tool.

## v0.5.0 — Training Intelligence

- **Artifacts engine**: coach can output inline SVG charts (line, bar, area, table) in chat — collapsed preview with expand-on-click
- **Weekly review**: proactive weekly training summary with load comparison chart, configurable day/time
- **Calendar integration**: intervals.icu planned workouts visible to coach; Google Calendar OAuth for busy/free awareness
- **Training plan generation**: periodized multi-week plans from race goals (4–52 weeks, multi-sport, periodization guardrails)
- **20 MCP tools** (was 14): `render_chart`, `get_planned_workouts`, `get_calendar_availability`, `generate_training_plan`, `get_training_plan`, `update_training_plan`

## v0.4.0 — Unreleased

Coach intelligence.

### Added

- MCP depth: `get_power_curve`, `get_pace_curve`, `get_best_efforts` (intervals.icu precomputed, 6 h cache, stale-if-error) and weekly-bucket `get_training_load_summary`.

## v0.3.0 — 2026-07-14

Analytics depth.

### Added

- **Activity detail page** (`/activity/[id]`): stream charts (heart rate,
  power, pace, elevation) and a laps/intervals table. Streams are fetched
  lazily from intervals.icu on first view and cached; Strava/manual
  activities show the summary with a "no detailed data" note.
- **Performance page tabs** (Training | Wellness) with a 30/90/180/365-day
  range selector, both linkable via URL params.
- **Training tab**: PMC chart now spans the selected range and draws TSB as
  a filled area around zero; 12-week load bars; history list grouped by day
  with "load more", each row linking to the activity detail.
- **Wellness tab**: HRV and resting-HR trends (daily line, 7-day rolling
  average, personal 60-day baseline band) and a sleep chart (duration bars,
  score line, 8 h guide).
- Dashboard recent activities now link to their detail pages.

## v0.2.0 — 2026-07-14

Phone & daily loop.

### Added

- **Installable PWA**: web manifest, app icons, minimal service worker with
  offline fallback.
- **Morning readiness push** (web-push/VAPID): sent right after the overnight
  sync computes the day's score — at most once per day, only when a score
  exists, skipped while calibrating. VAPID keys are auto-generated and stored
  in the database (private key encrypted); no new configuration.
- **Notifications settings card**: per-device subscribe/unsubscribe, morning
  push preference, send-test-notification, iOS install hint.
- **Manual resync**: dashboard sync chip ("Synced 12m ago ⟳") and
  pull-to-refresh in the installed app, backed by a rate-limited
  `/api/sync/now` (one per 2 minutes per user).

## v0.1.0 — 2026-07-14

First tagged release: the core loop works end-to-end, self-hosted.

### Added

- **intervals.icu sync** — wellness (HRV, resting HR, sleep), activities, and
  precomputed CTL/ATL, kept fresh by an in-process scheduler with idempotent
  jobs and a `/api/cron` fallback for serverless deploys.
- **Readiness engine** — daily score from 60-day rolling personal baselines
  (HRV 40%, resting HR 25%, sleep 20%, form/TSB 15%), with a calibrating
  state below 14 days of history and a persisted component breakdown.
- **Dashboard, performance log, and behavior journal** — readiness/recovery/
  strain rings, strain budget, training stress balance chart, wellness
  sliders, mood/tags/notes.
- **AI coach** — streaming chat with an evidence-based endurance-coach
  persona that cites real numbers via a shared tool registry. Bring your own
  key: Anthropic or any OpenAI-compatible endpoint (Ollama included). Keys
  encrypted at rest (AES-256-GCM).
- **MCP server** — stateless streamable-HTTP endpoint at `/api/mcp` with
  hashed, scoped (`read` / `write:wellness`), revocable bearer tokens and
  rate limiting, exposing nine tools shared with the coach.
- **Multi-user** — invite-only signup, owner/member roles, full per-user data
  isolation across web and MCP.
- **Strava OAuth** — second activity source with provenance tracking;
  excluded from AI/MCP context by default per Strava's API terms.
- **Self-hosting** — multi-stage Docker image (published to GHCR for
  amd64/arm64), docker-compose with Postgres 16 and optional Cloudflare
  tunnel profile, migrations applied automatically on boot.
- **Demo seed** — `SEED_DEMO=1 npm run db:seed-demo` generates 90 days of
  deterministic, plausible training history for demos and screenshots.

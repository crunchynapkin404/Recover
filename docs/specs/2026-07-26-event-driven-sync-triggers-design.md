# Event-Driven Sync Triggers: Design

**Date:** 2026-07-26
**Status:** Draft (pending user review)

## Problem

The morning brief (`generateMorningInsight`) already fires as a _side effect_
of an event — `sync_jobs` completing (`scheduler.ts:276-279`) — not on its
own clock. The problem is it only listens to one event: the daily
`sync_jobs` cycle for intervals.icu/Strava/Whoop/Oura/Withings, pinned to a
single fixed **05:00±10min server-local** slot (`scheduler.ts:46-53`).

Apple Health export (Health Auto Export, push-based, fires on the athlete's
own phone-side schedule — confirmed fixed-interval, roughly hourly) is a
second, faster, independent channel for exactly the fields the brief needs
most (sleep, HRV, RHR) and, as of v0.25.14
(`docs/specs/2026-07-26-apple-health-hybrid-vitals-design.md`, shipped
today), it now also outranks intervals.icu in the wellness merge-priority
ladder for physiology/body fields. But nothing reacts to it: `POST
/api/connections/apple-health/ingest` → `ingestAppleHealth()` recomputes
`daily_metrics` and stops — it never calls `generateMorningInsight()`. So
even when Apple Health hands over last night's sleep+HRV+RHR well before
05:00, the brief still waits on the `sync_jobs` side effect. This is the
"90% of the data isn't there at 5am" symptom, one level removed from where
it looks like it's coming from.

Separately: HRV/RHR are not a distinct computation step anywhere in
Recover's own pipeline. intervals.icu already returns them bundled with
sleep in one API row (`intervals.ts:141-178`); Apple Health's HealthKit
export does the same. "HRV/RHR only available after sleep" is a fact about
the underlying physiology (overnight computation by the source device), not
something this app's code splits apart — so one trigger condition ("a
payload landed for last night, from either source") covers sleep, HRV, and
RHR together.

Done when: the morning brief (and the daily-adaptation pass that rides
alongside it) fires as soon as enough data has landed for today — from
whichever source supplies it first — instead of waiting on the fixed 05:00
provider sync, while every other scheduled pass keeps working exactly as it
does today.

## Current state (for reference)

| Pass                                                                  | Current trigger                                                                                                                                                                           |
| --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Provider sync (`sync_jobs`: intervals.icu/Strava/Whoop/Oura/Withings) | Daily 05:00±10min server-local, `nextMorning()` jitter; pulled forward by manual "Sync now" or Strava-webhook catch-up (+90s)                                                             |
| Morning brief + readiness push                                        | Side effect of `sync_jobs` completion only (`scheduler.ts:276-289`); internal at-most-once/day guard; skips while `daily_metrics.band === "calibrating"` unless a race is scheduled today |
| Daily plan adaptation (`runDailyAdaptation`)                          | Same call site as the brief                                                                                                                                                               |
| Weekly review                                                         | Same call site, internally gated to Monday ~04:00 slot                                                                                                                                    |
| Monthly report                                                        | Same call site, at-most-once/month guard                                                                                                                                                  |
| Race debrief / ride debrief (activity poll + Strava webhook)          | Already event-driven: 15-min intervals.icu poll (06:00–23:00) + Strava webhook catch-up                                                                                                   |
| Ghost thread purge, daily EMA decay refresh                           | Every scheduler tick, unconditional                                                                                                                                                       |
| Apple Health ingest                                                   | Push (webhook or manual upload), recomputes `daily_metrics`, does **not** call any of the above                                                                                           |

## Decisions

| Decision                                    | Choice                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Trigger mechanism                           | New shared function `onWellnessDataChanged(userId, date)`. Called from every wellness-writing path: `ingestAppleHealth()`, each provider's sync completion (`intervals-sync.ts` and the Whoop/Oura/Withings equivalents), and manual wellness entry. Recomputes `daily_metrics(date)`, then — if `date === today`, readiness is non-calibrating (or a race is scheduled today), and no brief has been sent yet today — calls `generateMorningInsight()` + `maybeSendMorningReadinessPush()`, same as today. |
| Daily plan adaptation                       | Folded into `onWellnessDataChanged` alongside the brief — same "data changed, react" shape currently tied to `sync_jobs` completion; no reason to leave it on the old path while the brief moves off it.                                                                                                                                                                                                                                                                                                    |
| Idempotency / dedup                         | No new locking. `generateMorningInsight()`'s existing at-most-once-per-day guard is the sole dedup mechanism — safe by construction when multiple sources race to call it (e.g. an Apple Health push and a manual "Sync now" landing minutes apart): whichever wins fires it, the other is a no-op.                                                                                                                                                                                                         |
| Provider sync (05:00)                       | **Unchanged.** Still the only source for CTL/ATL/eFTP/activities, which Apple Health doesn't supply. It stops being the _only_ caller of the brief/adaptation logic — just becomes one of several.                                                                                                                                                                                                                                                                                                          |
| Backstop                                    | Scheduler tick gets one more check: past **09:00 server-local**, for any user with no brief yet today, call `generateMorningInsight()` unconditionally (bypassing the calibrating gate) — same honest-degraded-state pattern (`calibrating` band) the app already surfaces elsewhere for incomplete data. Server-local, not athlete-local — consistent with the existing `SYNC_HOUR` and weekly-review-slot convention; see Non-goals.                                                                      |
| Backstop firing is final                    | Once a brief fires for the day — event-driven or backstop — it is not regenerated even if fuller data lands later that morning. `daily_metrics`/dashboard still update normally from later data; only the brief text/notification stays as first sent. Matches the existing at-most-once-per-day contract exactly, avoids a second "revise a sent brief" code path.                                                                                                                                         |
| Weekly review, monthly report               | **No change to trigger shape** — both aggregate a whole period rather than reacting to one event, so a calendar anchor remains correct. Move their slot from ~04:00 to align with the new ~09:00 checkpoint, so the prior day's/week's data has realistically had a chance to land, riding the same shared pass.                                                                                                                                                                                            |
| Ride/race debrief                           | **No change.** Already event-driven (15-min poll + Strava webhook); this design brings the rest of the system toward the shape this pipeline already has.                                                                                                                                                                                                                                                                                                                                                   |
| Ghost thread purge, daily EMA decay refresh | **No change.** Not wellness-reactive; correctly unconditional per-tick already.                                                                                                                                                                                                                                                                                                                                                                                                                             |

## Data availability (for context — not a new mechanism, just what feeds the trigger)

| Data                                                                     | Real source(s)                                                                   | When actually available                                                                                              |
| ------------------------------------------------------------------------ | -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Sleep, HRV, RHR                                                          | Apple Health push (now top-ranked per v0.25.14) or intervals.icu pull (fallback) | Whenever Health Auto Export's own schedule fires and delivers the night's data — not clock-bound from Recover's side |
| CTL/ATL/eFTP/VO2max, activities                                          | intervals.icu pull                                                               | 05:00 daily, or immediately via manual sync / Strava webhook catch-up (+90s)                                         |
| Workouts/rides (debrief loop)                                            | intervals.icu 15-min poll (06:00–23:00) + Strava webhook                         | Within 15 min of upload, or near-instant via Strava                                                                  |
| Body comp (weight, BF%, BP, BMI, lean mass, waist, blood O2, wrist temp) | Apple Health push or manual entry                                                | Whenever measured/synced — not brief-gating, no change here                                                          |

## Architecture

### New shared function — `src/lib/sync/wellness-changed.ts` (new file)

```ts
export async function onWellnessDataChanged(userId: string, date: string) {
  await recomputeDailyMetrics(userId, date); // existing logic, extracted/reused
  if (date !== localYmd(new Date())) return;
  const metrics = await getDailyMetrics(userId, date);
  if (metrics.band === "calibrating" && !(await hasRaceToday(userId))) return;
  await generateMorningInsight(userId); // already at-most-once/day internally
  await maybeSendMorningReadinessPush(userId);
  await runDailyAdaptation(userId, date);
}
```

Call sites:

- `src/lib/sync/scheduler.ts` — the existing per-completed-sync-job block
  (today's direct calls to `runDailyAdaptation`/`generateMorningInsight`/
  `maybeSendMorningReadinessPush` at `scheduler.ts:264-289`) is refactored to
  call the new shared function instead. Same trigger (sync_jobs completion),
  same call site — just factored so it's reusable, not moved.
- `src/lib/sync/apple-health-ingest.ts` — **new** call, after
  `applyWellnessPatch`, for each distinct date touched.
- Manual wellness entry save path — **new** call.

No changes needed inside `intervals-sync.ts` or the Whoop/Oura/Withings
processors themselves — they already report completion back to the
scheduler, which is where the (refactored) call happens.

### Backstop — `src/lib/sync/scheduler.ts`

New unconditional per-tick check (alongside the existing ghost-purge/decay
passes): for users with no brief sent today and local server time
`>= 09:00`, call `generateMorningInsight()` directly (bypassing the
calibrating gate the shared function normally applies).

### Weekly review / monthly report slot

`weeklyReviewDay`/hour config and the monthly at-most-once gate move from
~04:00 to align with the ~09:00 pass — no change to the gating logic itself,
just the time value.

## Non-goals

- **Real per-athlete timezone tracking.** Recover has no per-athlete
  timezone field anywhere (confirmed absent from `schema.ts`); this was
  explicitly deferred in
  `docs/specs/2026-07-23-activity-timezone-fix-design.md` as its own
  future project given the blast radius. The 09:00 backstop and the
  weekly/monthly slot move stay server-local, consistent with the existing
  `SYNC_HOUR` convention — not a regression, not a fix for that deferred
  gap either.
- **Regenerating an already-sent brief** when better data arrives after it
  fired (event-driven or backstop).
- **Changing weekly/monthly review from calendar-anchored to event-driven.**
- **Touching the ride/race debrief pipeline** — already event-driven, no
  gap found there.
- **Daily activity/workout data (steps, active energy, etc.) as a brief
  input** — out of scope per the adjacent v0.25.14 spec too; not something
  the brief consumes today.

## Testing

- `onWellnessDataChanged`: unit tests per call-site scenario — Apple Health
  ingest alone is sufficient to fire the brief when it completes the
  calibrating→real transition; a second call same day (e.g. intervals.icu's
  05:00 sync arriving after Apple Health already fired the brief) is a
  no-op on the brief but still recomputes `daily_metrics` and still runs
  daily adaptation.
- Backstop: a user with no data at all by 09:00 gets a `calibrating`-band
  brief once; a user whose data arrives at 09:05 (one tick after backstop
  already fired) does not get a second brief.
- Race exception: unchanged existing test coverage should still pass
  (calibrating band + race today still fires early).
- Weekly/monthly: slot-time-only change, existing gating tests should pass
  unmodified aside from the asserted hour.

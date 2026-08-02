# Configurable Wellness Sync Interval: Design

**Date:** 2026-08-02
**Status:** Approved
**Target release:** v0.34.0

## Goal

v0.33 added `runWellnessRefresh` to solve one specific problem: last night's
sleep landed a day late because the 05:00 daily sync runs ~95 minutes before
the Intervals.icu Companion writes. It solved that with a morning-only window
(05:00–12:00), a fixed 30-minute throttle, and a stop condition — "done for
the day once yesterday has a duration and a stage".

That stop condition is correct for sleep arrival and **actively wrong for
intraday freshness**: it halts wellness polling around 07:00 every day. The
Companion keeps writing through the day — steps, SpO2, hydration, respiratory
rate — and none of it reaches Recover until the next morning.

Activities are already near-real-time: `runActivityPolls` runs every
`POLL_INTERVAL_MIN = 15` (quiet 23:00–06:00). Wellness is the outlier.

Done when: an athlete can choose how often Recover checks intervals.icu for
wellness, the choice is visible in Settings, and wellness stays current
through the day rather than freezing after breakfast.

## Decisions

| Decision       | Choice                                                                                                                                                                                                                                                                                                                  |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Setting home   | `connections.wellness_poll_interval_min` (nullable smallint; null = default). It is a property of the intervals.icu connection and sits beside `last_wellness_poll_at`, which already lives there. `notification_prefs` would be convenient but is semantically about notifications.                                    |
| Values         | Daily only (off) / 60 / 30 / 15 minutes. Stored as the integer minutes; "Daily only" is `0`.                                                                                                                                                                                                                            |
| Default        | **30** — preserves roughly v0.33's cadence, so upgrading an instance never silently increases load on intervals.icu.                                                                                                                                                                                                    |
| Stop condition | **Removed.** `yesterdaySettled()` is deleted. It exists to stop polling once sleep lands, which defeats the entire point of an all-day interval. Sleep arrival is still served — a 15/30-minute interval is strictly more aggressive in the morning than the v0.33 throttle was.                                        |
| Window         | Active 05:00–23:00 local; quiet 23:00–05:00. Polling overnight buys nothing: the athlete is asleep, the Companion has not written the night yet, and the 05:00 daily sync covers the boundary. Starts at `SYNC_HOUR` rather than the activity poll's 06:00 so v0.33's current 05:00–06:00 coverage is not a regression. |
| Activity poll  | **Untouched.** Its 15-minute cadence and 23:00–06:00 quiet window stay as they are — the ride-debrief loop depends on its timing, and changing both at once would tangle two unrelated behaviours.                                                                                                                      |
| Load           | At 15 minutes: 72 wellness polls/day/user across an 18-hour window, on top of ~68 existing activity polls. intervals.icu is free and run by one developer, which is why the default stays at 30 and "Daily only" is offered. `icuFetch` already maps 429 → `ConnectorError("rate_limited")`.                            |
| Awake legend   | `SleepNightCard` renders an "Awake" legend entry that is permanently 0 on this route (the three stages sum to `sleepSecs` by construction). The entry is hidden when `awakeSecs === 0`, rather than implying a night with zero awakenings.                                                                              |

## Architecture

### Schema — migration `0036`

```sql
ALTER TABLE "connections" ADD COLUMN IF NOT EXISTS "wellness_poll_interval_min" smallint;
```

Nullable, no backfill, no default at the DB level — null means "use the
application default", so the default can change later without a data
migration. Remember to add the `_journal.json` entry; a hand-written
migration without one is silently skipped while `drizzle-kit migrate` still
reports success.

### Refresh pass — `src/lib/sync/wellness-refresh.ts`

- `WELLNESS_REFRESH_INTERVAL_MIN` becomes `DEFAULT_WELLNESS_POLL_INTERVAL_MIN = 30`.
- `WELLNESS_REFRESH_END_HOUR` moves 12 → 23.
- `yesterdaySettled()` and its query are deleted.
- The due-check reads each connection's own interval:
  `effectiveInterval = conn.wellnessPollIntervalMin ?? DEFAULT_WELLNESS_POLL_INTERVAL_MIN`,
  and a connection with `0` is skipped entirely (daily sync only).
- Because the interval is now per-connection, the `lt(lastWellnessPollAt, dueBefore)`
  predicate can no longer be a single SQL comparison against one cutoff. The
  query selects active intervals.icu connections and the per-connection due
  test happens in the loop. This is a handful of rows on a self-hosted
  instance; correctness beats one saved round trip.
- Everything else — the `userIds` test-only safety valve, stamp-the-cursor-first
  discipline, `wellnessDayToPatch` reuse, and the `onWellnessDataChanged` call —
  is unchanged.

### Settings — `src/components/settings/intervals-card.tsx`

A `<select>` beside "Sync now" with the four options, showing the current
value and the last poll time. Saved by a new server action
`setWellnessPollInterval(minutes: number)` in `src/app/settings/actions.ts`,
which validates the value against the allowed set (0/15/30/60) and rejects
anything else rather than writing an arbitrary number.

### Sleep card — `src/components/body/sleep-night-card.tsx`

The stage legend filters out entries whose value is 0 when the field has no
source. Deep/REM/Light are unaffected; only the permanently-zero Awake row
disappears.

## Testing

- **Due logic** (pure, no DB): a connection at 15/30/60 is due after its own
  interval and not before; `0` is never due; null falls back to 30.
- **Window:** open at 05:00 and 22:59, closed at 23:00 and 04:59.
- **No stop condition:** a connection whose yesterday already has stages is
  still polled — the regression test for the behaviour being removed.
- **Action validation:** `setWellnessPollInterval` accepts 0/15/30/60 and
  rejects 7, -1, and 1440.
- **Sleep legend:** an Awake entry of 0 is not rendered; a non-zero one is.
- Any DB-touching test carries `describe.skipIf(!hasDb)`.

## Verification

Tests passing is weak evidence for a producer change. After deploy: set the
interval to 15, confirm `connections.last_wellness_poll_at` advances roughly
every 15 minutes during the day, and confirm a `wellness_daily` row's
`updated_at` moves in the afternoon — the exact thing that could not happen
under v0.33's stop condition.

Run the full gate including `npm run build`; the standard gate omits it and it
is the only check that catches a sync export from a `"use server"` file.

## Out of scope

- Changing the activity poll's cadence or quiet hours.
- Per-provider sync intervals for Strava/Whoop/Oura/Withings. The column is
  named for wellness specifically so this does not over-promise; a general
  scheme can come later if it is ever wanted.
- Push notifications on intraday wellness changes. `onWellnessDataChanged`
  already has its own guards; polling more often must not mean notifying more
  often.

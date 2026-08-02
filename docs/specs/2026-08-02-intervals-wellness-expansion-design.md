# intervals.icu Wellness Expansion: Design

**Date:** 2026-08-02
**Status:** Approved
**Target release:** v0.33.0

## Goal

Health Auto Export's REST API automation is a paid feature. Its trial ended
on 2026-07-29 and Recover's `apple_health` connector has received nothing
since — verified: `connections.last_sync_at = 2026-07-29 13:45`, and only 5
`wellness_daily` rows (2026-07-25 → 2026-07-29) ever carried an
`apple_health` entry in `field_sources`.

The replacement sender is [Intervals.icu
Companion](https://apps.apple.com/us/app/intervals-icu-companion/id6739638454)
— a free third-party iOS app (two optional tip IAPs, nothing gated) that
reads HealthKit via background delivery and writes into the athlete's
intervals.icu wellness log. Recover already syncs intervals.icu daily, so
the transport is solved with zero code.

What is _not_ solved: `fetchDailyWellness()` maps 13 fields off the
intervals.icu wellness row and discards everything else into `raw`. Six
fields with **live columns already in the schema** are silently dropped
today, and six more now carry real data with nowhere to land.

Done when: every wellness field intervals.icu actually populates for this
athlete reaches `wellness_daily` through the existing per-field merge
policy, and last night's sleep is visible in the morning brief on the
morning it happened rather than a day later.

## Evidence

All field names, units, and scales below were read from the athlete's live
intervals.icu account on 2026-08-02 (945 wellness rows, 2024-01-01 →
2026-08-02). Nothing here is guessed. This matters: the
`2026-07-26-apple-health-hybrid-vitals-design.md` spec shipped six
_guessed_ HealthKit metric names, explicitly flagged as "unverified against
a real payload", and a wrong name drops data silently.

| intervals.icu key | Days | Latest     | Sample    | Recover column        |
| ----------------- | ---- | ---------- | --------- | --------------------- |
| `steps`           | 466  | 2026-08-02 | 392       | **new**               |
| `sleepQuality`    | 238  | 2026-08-01 | 3         | **new**               |
| `spO2`            | 166  | 2026-08-01 | 97.5      | `blood_oxygen_pct` ✅ |
| `avgSleepingHR`   | 51   | 2026-08-01 | 53.0      | **new**               |
| `bodyFat`         | 48   | 2026-07-31 | 15.7      | `body_fat_pct` ✅     |
| `hrvSDNN`         | 18   | 2026-08-01 | 66.0      | **new**               |
| `respiration`     | 18   | 2026-08-01 | 17.225653 | `respiratory_rate` ✅ |
| `readiness`       | 17   | 2026-07-31 | 71.0      | **new**               |
| `DeepSleep`       | 17   | 2026-07-31 | 3597      | `sleep_deep_secs` ✅  |
| `REMSleep`        | 17   | 2026-07-31 | 4437      | `sleep_rem_secs` ✅   |
| `LightSleep`      | 17   | 2026-07-31 | 11630     | `sleep_light_secs` ✅ |
| `hydrationVolume` | 16   | 2026-08-01 | 3.937     | **new**               |

`DeepSleep` / `REMSleep` / `LightSleep` are intervals.icu **custom wellness
input fields** (`type: INPUT_FIELD`), because intervals.icu has no native
sleep-stage model. They appear as flat keys on the same wellness row, in
**seconds**, and their sum equals `sleepSecs` exactly on every populated row
(20619, 27452, 19301, 19664 — 4/4). Awake time is therefore excluded from
`sleepSecs` by construction, not missing by accident.

## Decisions

| Decision                 | Choice                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Scope of mapping         | Every field with ≥16 days of real data (the 12 above). The 1–2 day subjective leftovers (`stress`, `mood`, `motivation`, `injury`, `hydration`, `soreness`, `fatigue` — latest 2025-12-08 and 2024-02-15) are **excluded** as YAGNI; Recover's journal already owns subjective input, and intervals' numeric `mood` would collide with Recover's existing `mood` text column. |
| `spO2` scale             | Written through **unscaled**. Observed 95.9–97.5, i.e. already a percentage. Apple Health's own `blood_oxygen_saturation` is a 0–1 fraction needing ×100 — applying that rule here would store 9650%.                                                                                                                                                                         |
| Stage source             | The **custom** `DeepSleep`/`REMSleep`/`LightSleep` keys.                                                                                                                                                                                                                                                                                                                      |
| `RespirationRate` trap   | The custom field `RespirationRate` exists in this account but has **never been written** (0 days). Companion writes the **native** `respiration`. Map the native field; ignore the custom one. Name-matching on "respiration" would bind to the decoy and yield permanent nulls.                                                                                              |
| `sleepAwakeSecs`         | Stays null on this route — no awake field exists. Not a mapping gap to re-investigate later.                                                                                                                                                                                                                                                                                  |
| `bedStart` / `bedEnd`    | Stay null. intervals.icu has no bed/wake window, native or custom. This is the known, accepted loss of routing through intervals.icu instead of a direct HealthKit push.                                                                                                                                                                                                      |
| `sleepQuality` surfacing | Column added and raw value stored, but **not rendered in UI this phase**. The scale is contested (intervals.icu's MCP metadata documents 1–5 inverted, 1=Great; project memory records 1–4). Rendering an unverified inverted scale would invert a recovery signal — exactly the fabrication class `docs/ROADMAP.md`'s honesty-debt section exists to prevent.                |
| `steps` bucket           | `PHYSIOLOGY`, not `LOAD`. `LOAD` is deliberately `["intervals_icu"]`-only because CTL/ATL are intervals' own model and a wearable's version would be fabrication. Steps are a plain device measurement Apple Health legitimately supplies, so it must stay writable by a better-ranked source.                                                                                |
| Priority ladders         | **Unchanged.** `apple_health` already outranks `intervals_icu` in `PHYSIOLOGY` and `BODY`, so the 5 surviving Apple Health days keep their own values and a future direct push automatically wins again.                                                                                                                                                                      |
| `temp*` flags            | Verified non-issue, no code needed: across 945 rows, `tempWeight=true` co-occurs with a present `weight` **0 times** (148/148 present weights have `tempWeight=false`); same for `tempRestingHR`. intervals.icu omits the value rather than carrying one forward, so Recover cannot store an interpolated reading as measured.                                                |
| Cadence                  | Bounded morning re-pull (below), rather than raising the global sync frequency.                                                                                                                                                                                                                                                                                               |

## Architecture

### Schema — `src/lib/db/schema.ts`, migration `0035`

Six additive nullable columns on `wellnessDaily`, no backfill, mirroring how
`vo2max` / `blood_oxygen_pct` were added:

| Column          | Type      | Source key        |
| --------------- | --------- | ----------------- |
| `sleeping_hr`   | `real`    | `avgSleepingHR`   |
| `hrv_sdnn_ms`   | `real`    | `hrvSDNN`         |
| `readiness`     | `real`    | `readiness`       |
| `hydration_l`   | `real`    | `hydrationVolume` |
| `steps`         | `integer` | `steps`           |
| `sleep_quality` | `integer` | `sleepQuality`    |

`hrv_sdnn_ms` is genuinely new information, not a duplicate: Recover's
existing `hrv_ms` is rMSSD, and intervals.icu supplies both.

### Merge policy — `src/lib/wellness-merge.ts`

`WellnessPatch` gains `sleepingHr`, `hrvSdnnMs`, `readiness`, `hydrationL`,
`steps`, `sleepQuality` (all `number | null`). `FIELD_PRIORITY` assigns
`sleepingHr`, `hrvSdnnMs`, `readiness`, `steps`, `sleepQuality` →
`PHYSIOLOGY`; `hydrationL` → `BODY` (an intake/composition measure, and the
ladder resolves identically for the sources in play).

### Connector — `src/lib/connectors/intervals.ts`

`IntervalsWellnessDay` gains the 12 fields. `fetchDailyWellness()` maps them
off the row with the existing `num()` helper, and the ingest path that builds
the `WellnessPatch` forwards them.

**Rename guard.** Custom field codes are user-renameable in the intervals.icu
UI; a rename silently turns the stage mapping into permanent nulls. When a row
has a non-null `sleepSecs` but none of the three stage keys, log once per sync
(not per row) at warn level, naming the keys looked for. Absent stages become
observable instead of quiet zeros — the same failure class as the Strava
`durationS` eligibility bug and the orphaned VAPID key, both of which cost a
full debugging session each because they failed silently.

### Cadence — `src/lib/sync/scheduler.ts`

`SYNC_HOUR = 5` (container TZ `Europe/Amsterdam`) means one wellness pull at
05:00 local. Today proved the miss: Recover pulled at 05:06 local, Companion
wrote at 06:39–06:42 local. Last night's sleep would not reach Recover until
the following morning.

Sleep is attributed to the **bed date**, not the wake date: the night of
Aug 1→2 landed on the `2026-08-01` row. The re-pull therefore must cover
yesterday, not just today.

`runWellnessRefresh()` joins the existing ~15-minute scheduler tick beside
`runActivityPolls()`:

- **Window:** only between `SYNC_HOUR` and 12:00 local. Outside it, no-op.
- **Range:** last 3 days — covers the bed-date attribution and any late
  Companion backfill without depending on resolving attribution precisely.
- **Throttle:** at most once per 30 minutes per user.
- **Stop condition:** done for the day once yesterday's row has `sleepSecs`
  and at least one stage field. Worst case ~14 extra calls/day/user; typical
  case 3–4.

This follows the existing bounded-recheck pattern in the same file (the
`BACKSTOP_HOUR` guard) rather than inventing a new one, and is a
tick-level guarded pass, **not** a `sync_jobs` row — a perpetually-pending
poll job would suppress `ensureJobsForConnections`' duplicate guard, the same
reasoning already recorded for `runActivityPolls`.

`runWellnessRefresh()` must fire the existing `onWellnessDataChanged(userId)`
hook when it writes, so the morning insight and push reflect the newly
arrived sleep rather than waiting for the next daily job.

### Connection hygiene

The `apple_health` connection is `status: active` while receiving nothing.
It is set to `inactive` (not deleted — the ingest token and its 5 days of
history stay valid, and re-enabling a paid HAE subscription should just
work). Settings' Apple Health card reflects the inactive state.

### UI — `/body` Trends tab

New stat rows for sleep stages, SpO2, respiratory rate, sleeping HR, HRV
SDNN, readiness, hydration, and steps, following the existing "latest
non-null value" lookup already used for weight/body-fat. `sleepQuality` is
excluded per the decision above. Before adding rows, scan the page for
values already displayed elsewhere and remove the duplicate rather than
showing it twice.

## Testing

- **Mapper unit tests** (no DB): all 12 keys present; each absent; `spO2`
  passed through unscaled; stage sum equals `sleepSecs`; the `RespirationRate`
  decoy is ignored while native `respiration` maps; the rename guard logs
  exactly once when `sleepSecs` is present without stages.
- **Merge tests:** each new field resolves through its ladder, and
  `apple_health` still beats `intervals_icu` for the overlapping stage fields.
- **Cadence tests:** no-op outside the window; throttle honoured; stop
  condition ends the day's polling; `onWellnessDataChanged` fires on write.
- Any test touching the DB carries `describe.skipIf(!hasDb)` — without it CI
  crashes the whole `checks` job instead of skipping, which is exactly how
  PR #20 went red.

## Verification

Tests passing is weak evidence here: this is a producer/consumer change, and
a green suite would not prove a single real row moved.

1. Run the full gate **including `npm run build`** — the standard gate omits
   it, and it is the only check that catches a sync export from a
   `"use server"` file.
2. After deploy, re-read a real `wellness_daily` row and confirm the stage,
   SpO2, respiration, sleeping-HR, SDNN, readiness, hydration and steps
   columns are populated from `intervals_icu` — the same live-payload rigor
   the hybrid-vitals spec committed to.
3. Confirm the morning re-pull actually fired by checking a row's
   `updated_at` falls after 06:40 local, not at 05:06.

## Out of scope

- Bed/wake window and awake time — unavailable via intervals.icu; would
  require a direct HealthKit → Recover push (paid Health Auto Export, the
  one-time-purchase Health Webhook app, or a hand-built iOS app).
- Building a native HealthKit app: needs a Mac, plus $99/yr or re-signing a
  free provisioning profile every 7 days, and buys nothing over Companion
  for overnight-only data.
- Google Fit / Health Connect: the Fit APIs reach end-of-service in late
  2026 and closed to new signups in May 2024; Health Connect is Android-only
  and on-device, so it needs an Android phone in daily use to be relevant.

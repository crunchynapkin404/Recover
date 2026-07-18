# Changelog

## v0.13.0 — 2026-07-18 — Deep Biology

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

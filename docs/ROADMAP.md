# Roadmap

Recover is built depth-first: make the daily loop genuinely useful for the
people already running it, then widen who can run it. Each phase ships as a
tagged release with its own definition of done. Order can shift if real usage
says otherwise — file an issue if something here matters to you.

## ✅ v0.1 — GitHub-ready release

- [x] intervals.icu sync (wellness, activities, CTL/ATL) with scheduler
- [x] Readiness engine on personal baselines (HRV, RHR, sleep, TSB)
- [x] Dashboard, journal, and performance log
- [x] AI coach — bring your own key (Anthropic or any OpenAI-compatible endpoint, Ollama included)
- [x] Built-in MCP server with scoped, revocable bearer tokens
- [x] Multi-user invites + Strava OAuth (provenance-aware, AI-excluded by default)
- [x] Docker self-hosting with prebuilt multi-arch images
- [x] Demo seed data, screenshots, docs, community files

## ✅ v0.2 — Phone & daily loop

The morning glance: install it like an app, get told when your score is ready.

- [x] PWA: manifest, icons, service worker
- [x] Web-push morning readiness notification after the overnight sync
- [x] Per-user notification subscriptions and settings
- [x] Manual resync: dashboard sync chip + pull-to-refresh in the installed app

**Done when:** installed on a phone, the morning notification arrives unattended.

## ✅ v0.3 — Analytics depth

More reasons to open the app than a single number.

- [x] Activity detail page: stream charts (HR, power, pace), laps/intervals
- [x] Fitness page: performance management chart (CTL/ATL/TSB over time)
- [x] Wellness trends: HRV, resting HR, and sleep against personal baselines
- [x] History/calendar polish

**Done when:** a month of training is explorable end-to-end.

## ✅ v0.4 — Coach Intelligence

The coach becomes a proactive, memory-rich training partner.

- [x] **Coach Memory**: persistent knowledge store (goals, injury history, race calendar, preferences) — structured JSON in DB, injected into system prompt, survives across threads
- [x] **Thinking Modes**: user selects Quick (haiku/flash) or Deep (opus/sonnet) per message or as default — maps to model selection at runtime
- [x] **Proactive Insights**: cron generates a morning message from overnight sync data → stored as coach message, visible on dashboard next visit (no push infra needed)
- [x] **Ghost Mode**: ephemeral threads (`ephemeral: true` column) — auto-purge after 24h via cleanup job; quick Q&A without cluttering history
- [x] **Coach Personalities**: selectable tone presets (Analytical, Encouraging, Direct) that modify system prompt preamble; stored in user settings
- [x] **Overtraining Warnings**: automatic alerts on sustained HRV suppression (>7 days) or RHR spikes (>10bpm above baseline)
- [x] **Extended MCP tools**: power/pace curves, best efforts, training load summaries

**Done when:** coach memory persists across threads; morning insight appears unasked; ghost threads auto-delete; thinking modes switch the underlying model.

## ✅ v0.5 — Training Intelligence

AI-generated structured training — the feature no WHOOP/Bevel competitor has with intervals.icu data.

- [x] **Training Plan Generation**: periodized multi-week plans from current CTL + target race date; stored as structured blocks in DB; coach tracks progress weekly
- [x] **Calendar Integration**: OAuth to Google Calendar; coach knows busy times and adjusts training suggestions ("You have meetings until 18:00 — I'd suggest an evening zone-2 ride")
- [x] **Artifacts**: coach can output inline SVG charts in chat (HRV trends, load vs recovery correlations, PMC projections) — rendered client-side from structured tool output
- [x] **Proactive Weekly Review**: scheduled job generates coach-written weekly summary comparing planned vs actual load, recovery trends, and next-week outlook

**Done when:** a training plan is generated from a race goal; calendar blocks are visible to the coach; inline charts render in chat; weekly review arrives automatically.

## ✅ v0.6 — Strava AI Descriptions

Auto-generate data-dense activity descriptions from intervals.icu metrics and push them to Strava.

- [x] **Strava write scope**: upgrade OAuth to include `activity:write`; prompt existing users to reconnect
- [x] **Description generator**: format activity metrics (load, IF, TRIMP, efficiency, form, PRs) into a compact emoji-rich block using intervals.icu data only
- [x] **Auto-describe post-sync**: opt-in setting; generates and pushes description after each new activity syncs
- [x] **Append mode**: preserves existing descriptions, adds AI block below a `---` separator
- [x] **Coach tool**: `describe_strava_activity` for manual trigger or custom descriptions
- [x] **Skip marker**: prevents double-writes on re-sync

**Done when:** new activities get a data-rich description on Strava within minutes of sync; existing descriptions are preserved; coach can describe on demand.

## ✅ v0.6.2 — Strava description fields

- [x] **Field selection**: per-user checklist of which metrics appear; live preview against a real activity
- [x] **Safe defaults**: no saved config = full v0.6 template; new fields never auto-appear for configured users
- [x] **Empty guard**: all fields off skips the write — no bare marker is ever published

**Done when:** a user unticks TRIMP and their next activity's description omits it.

## ✅ v0.7 — Score Integrity

Stop the app from knowing things it doesn't know: the journal fabricated
subjective input, and illness silently poisoned the baselines the readiness
score is measured against. Both had to be fixed before anything else consumes
those baselines.

- [x] **Honest subjective input**: unanswered energy/soreness/stress sliders write nothing instead of submitting invented defaults; unanswered state is announced to screen readers
- [x] **Day flags**: athletes flag abnormal days (🤒 ill, ✈️ travel, 🏔️ altitude); flagged days are excluded from rolling baselines but still scored
- [x] **Retroactive repair**: flagging a past day recomputes every score after it
- [x] **Honest degradation**: flagging most of the window returns `calibrating`, not a confident wrong number
- [x] **Coach visibility**: `get_wellness` returns day flags

**Done when:** saving the journal without touching a slider writes no
subjective values; a flagged illness day scores red but never appears in a
later day's baseline.

Design: [docs/specs/2026-07-15-v0.7-score-integrity-design.md](specs/2026-07-15-v0.7-score-integrity-design.md)

## ✅ v0.8 — Data Freedom

intervals.icu stops being a hard requirement. (Planned as v0.10; pulled
forward and shipped early — this section is the release that exists.)

- [x] Manual-first onboarding: fully usable with zero integrations
- [x] Manual vitals entry in the journal when no integration is active
- [x] Manual activity logging (`/activity/log`)
- [x] CSV import for wellness and activity history, with flexible column mapping
- [x] Fixed: `proxy.ts` exported `proxy()` instead of `middleware()` — the route guard had never run
- [x] v0.8.1: navigation to the activity-log and import pages

**Done when:** a user with no intervals.icu account gets a readiness score.

Apple Health file-export/webhook and a Google Health / Fitbit connector were
cut from this release and fold into v0.11 alongside the other connectors.

## ✅ v0.9.0 — Honest Body Intelligence

v0.7 fixed fabricated data in the database. It never reached the dashboard,
which still ships invented numbers: a hardcoded body-battery curve every
athlete sees identically, a `"22:30 – 23:00"` bedtime string literal, and a
47%-REM sleep breakdown backed by no data at all. Verified against the live
DB: intervals.icu's wellness payload carries **no sleep stages and no
bed/wake times** — those cards cannot be fixed, only removed.

- [x] **Body battery, for real**: energy curve modelled from morning readiness + real activity loads at their real times; explicitly labelled an estimate; returns nothing when readiness is `calibrating`
- [x] **Sleep debt**: cumulative deficit over 14 nights from real `sleepSecs`; missing nights skipped, never counted as perfect sleep
- [x] **Bedtime target**: derived from debt + a wake time the athlete sets; no wake time = no recommendation, never a guess
- [x] **Delete the unbackable**: sleep-stage breakdown and the `sleepHours / 8` "efficiency" figure

**Done when:** the dashboard contains no hardcoded physiological constant; a
day with training shows a curve that drops when the athlete actually trained;
an athlete with no wake time set sees a prompt, not a bedtime.

Design: [docs/specs/2026-07-16-v0.9.0-honest-body-intelligence-design.md](specs/2026-07-16-v0.9.0-honest-body-intelligence-design.md)

## ✅ v0.9.1 — Honest Pixels

Patch release: same defect class as v0.9.0, smaller pixels. Claimed the
v0.9.1 number, so the planned feature releases below shift one patch digit.

- [x] Favicon was still the stock Next.js triangle — replaced with the
      Recover ring on the dark app tile (multi-size ICO)
- [x] Sleep Score sparkline plotted `sleepSecs` under a `sleepScore` label
- [x] Sparklines no longer fabricate a flat line from <2 data points —
      empty path, no SVG rendered
- [x] `package.json` version drift (`0.8.0` at the v0.9.0 tag) corrected

## ✅ v0.9.2 — Adaptive Week (Smarter Coach)

Plans that react to the life the athlete actually had, not the one the plan
assumed. Shipped as the rolling week + daily adaptation
([design](specs/2026-07-17-v0.9.2-adaptive-week-design.md)).

- [x] **Rolling week + daily adaptation** (subsumes "adaptive training
      plans" and "adherence intelligence"): each week materializes from the
      skeleton against real availability — adherence below 70% rebuilds on
      actual load, a suppressed readiness trend reduces the target, a ±20%
      ramp guard clamps jumps, and a fully missed week restarts at 60% of
      skeleton; every morning the day re-adapts to readiness and available
      time, and every change is logged with a deterministic reason
- [x] **Coach visibility**: `get_week_plan`, `set_week_availability`,
      `get_plan_drift` tools; day-level `move_workout`/`swap_workout` in
      `update_training_plan`; morning insight and weekly review quote the
      logged adjustment reasons verbatim
- [x] **`/plan` page**: living week, adjustments timeline, remaining
      skeleton, availability intake with calendar prefill

**Done when:** skipping a week visibly reshapes next week's plan, and the coach
can explain what it changed and why. ✅

## ✅ v0.9.3 — Week Starts Now

Patch release: the living week begins when the plan does, not at the next
Monday's weekly review. Claimed the v0.9.3 number, so the planned feature
releases below shift one patch digit (again).

- [x] `generateTrainingPlan` materializes the current week immediately
- [x] "Plan this week" button on the `/plan` empty state (idempotent)
- [x] Regenerating a plan mid-week replaces the archived plan's open week
      instead of being shadowed by it until Monday, with a logged
      "plan changed" adjustment
- [x] Mid-week starts give already-past days zero availability — no
      fabricated workouts behind the clock

## ✅ v0.9.4 — Deeper Insights

- [x] **Correlation engine v2**: extend `lib/correlations.ts` — time-of-day patterns, weekday/weekend split, confidence intervals on impact scores; report "not enough data" rather than a thin correlation
- [x] **Auto-tags from activities**: derive "Hard session", "Double day", "Rest day", "Late training" from activity data instead of asking
- [x] **Achievements / streaks**: consistency milestones and plan completions. Shipped as sober milestones (design decision: no badges/XP).

**Done when:** auto-tags appear without user input; correlations carry a
confidence interval; a streak survives a restart. ✅

## v0.9.5 — Infrastructure

- [ ] **Nightly `pg_dump` backups**: to volume/S3, with a documented restore drill
- [ ] **Absorb `intervals-icu-mcp`**: merge the standalone server's tools into Recover's built-in MCP (58 → ~40 after dedupe)

**Done when:** a backup restores into a clean database unattended, and the
standalone MCP server can be retired.

## v0.10 — Deep Biology

Long-horizon health metrics. Deferred from the original v0.8 "Body
Intelligence" because the data isn't there yet: the live DB has 0/368 days of
blood pressure, 0/368 respiration, and only 79/368 VO2max.

- [ ] **Health Records**: upload blood test PDF/photo → LLM extracts biomarkers → `biomarkers` table
- [ ] **Biological Age**: weekly score from RHR baseline trend, HRV percentile-for-age, sleep consistency, VO2max, body composition; 20-year projection
- [ ] **Blood Pressure**: manual entry (`systolic`/`diastolic` exist in the intervals.icu payload but arrive empty)

**Done when:** a blood test PDF is parsed and biomarkers appear in the app.

## v0.11 — Wearable connectors

Whoop and Oura would also be the first providers to carry sleep stages and
bed/wake times — the data v0.9.0 had to delete cards for.

- [ ] Whoop OAuth (recovery, HRV, sleep)
- [ ] Oura OAuth
- [ ] Apple Health: file-export upload + Health Auto Export-style webhook (cut from v0.8)
- [ ] Google Health / Fitbit direct — if demand shows up

**Done when:** HRV/sleep flows in from a real Whoop or Oura account with full data isolation.

## Ongoing — operations track

Small chunks, shipped alongside feature phases.

- [ ] Sync-jobs admin UI
- [ ] Vercel + Neon deployment guide refresh
- [ ] Native `ubuntu-24.04-arm` release runners — restore the arm64 image dropped in v0.8 (QEMU builds took ~50 min)

## Ongoing — honesty debt

Fabrications v0.9.0 found but did not fix. All pre-existing; all the same
defect class as the sleep/energy cards that release cleaned up.

- [ ] **Recovery & Strain are invented for manual-only athletes**: `recoveryScore`/`strainFraction` come from `latest?.atl ?? 0` / `latest?.ctl ?? 0`, and `atl`/`ctl` are written only by the intervals.icu sync — so a v0.8 no-integration athlete gets a hero "Recovery 60" and "Strain 0.0" from zero data. Needs the `calibrating` treatment readiness already has, propagated through `ScoreRing`, `StrainBudget`, and the narrative.
- [ ] **"This Week" rings hardcoded**: `ringOuter={0.7}` / `ringInner={0.8}` for every athlete, forever. Blocked on the above — wiring the current values would just spread the fabrication.
- [x] **The logging "streak" is a count, not a streak**: `Math.min(window30.length, 30)` renders "22-day streak" for 22 scattered days. Folded into Achievements (v0.9.4). Fixed in v0.9.4: real consecutive runs on dashboard and journal.
- [x] **Sparklines flat-line on no data**: `sparkPath` returned `"M0 10 L100 10"` for <2 points — a visual claim of stability made from nothing. Fixed in v0.9.1: empty path, no SVG rendered.

## Ongoing — polish backlog

Considered for v0.9 and deliberately not scheduled. Cheap; pick up alongside
any release.

- [ ] Data export (GDPR): full history download — the read side of v0.8's import
- [ ] Default journal entries: pre-toggle frequent behaviors so only exceptions get marked
- [ ] Accessibility: ScoreRing aria labels, contrast, button roles
- [ ] Performance log filters: wire up the month/sport controls
- [ ] Dead UI sweep: remove non-functional settings controls (v0.9.0 cleared the dashboard's sleep/energy share)
- [x] Sleep Score sparkline plotted `sleepSecs` under a "Sleep Score" label — real data, wrong series. Fixed in v0.9.1.

## Not planned

- **Garmin direct** — no open consumer API; the approval-gated program and unofficial
  scraping libraries are both poor fits for a self-hosted project. Garmin users
  are well served via intervals.icu sync today.
- **Cloud-hosted SaaS version** — Recover is self-hosted on purpose.
- **Nutrition tracking** — out of scope for an endurance recovery app; users already have MyFitnessPal/Cronometer. May integrate read-only nutrition data from Apple Health in a future version if there's demand.
- **Strength Builder / Watch app** — intervals.icu and Garmin/Apple Watch handle workout execution; Recover focuses on recovery intelligence, not workout delivery.
